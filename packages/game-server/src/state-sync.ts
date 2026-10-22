/**
 * State sync (docs/DECISIONS.md, "Rooms carry PC-grade real-time games"): a game server with
 * stateSyncEnabled sends each player their view of the state, a full copy the first time and after that
 * only what changed, as { type: "state", serverTimeMs, full } and { type: "state", serverTimeMs, changes }.
 * Each change is [path, value] for a set and [path] for a removal: objects are compared key by key,
 * arrays index by index while their length stays the same and whole when it changes, everything else by
 * value. There are no acknowledgements: over a reliable connection a change can't be lost, and a player
 * whose connection is backed up gets nothing and then a full copy once they've caught up.
 *
 * Everything runs where the state lives: in the room on the developer's own server (RoomCore), and in
 * the game server's sandbox on Zaisma, which loads stateSyncModuleSource(). So it's one function with no
 * outside references, whose source is copied as it is. The SDK has its own copy of applyStateChanges,
 * which test/node/state-sync.test.ts holds equal to this one.
 */

/** Where in the state a change is: keys of objects and indexes of arrays, from the top. */
export type StatePath = (string | number)[];

/** A change to the state: [path, value] sets what's at path, [path] removes it. An empty path replaces the whole state. */
export type StateChange = [path: StatePath] | [path: StatePath, value: unknown];

/** One update for some players: a full copy of their view, or the changes since the last one they got. */
export type StateFrame = { full: unknown } | { changes: StateChange[] };

/** What a round of state sync sends, to whom, and what went wrong (a view that threw or was too big), for the game's errors. */
export interface StateRound {
  frames: { playerIds: string[]; frame: StateFrame }[];
  problems: string[];
}

/**
 * Who sees what, round after round: the last view each viewer was sent, so each round sends only what
 * changed. A viewer it hasn't sent to, or has forgotten, gets a full copy.
 */
export interface StateTracker {
  /** The viewer gets a full copy next: a new connection, or a backlog they've caught up from. */
  forget(viewerId: string): void;
  /**
   * This round's frames. viewOf answers a viewer's view (stateView), or null when everyone sees the
   * whole state. Backed-up viewers get nothing and a full copy once they're back; viewers not listed are forgotten.
   */
  round(state: unknown, viewerIds: readonly string[], viewOf: ((viewerId: string) => unknown) | null, backedUpViewerIds: ReadonlySet<string>): StateRound;
}

interface StateSyncParts {
  diffState(previous: unknown, next: unknown): StateChange[];
  applyStateChanges(state: unknown, changes: readonly StateChange[]): unknown;
  newStateTracker(maximumViewSizeBytes: number): StateTracker;
}

/** The parts, as one function with nothing from outside it, so its source runs the same in the sandbox. */
function stateSyncParts(): StateSyncParts {
  const isPlainObject = (given: unknown): given is Record<string, unknown> => typeof given === "object" && given !== null && !Array.isArray(given);

  function diffInto(previous: unknown, next: unknown, path: StatePath, changes: StateChange[]): void {
    if (previous === next) return;
    if (isPlainObject(previous) && isPlainObject(next)) {
      for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) changes.push([[...path, key]]);
      for (const key of Object.keys(next)) {
        if (Object.hasOwn(previous, key)) diffInto(previous[key], next[key], [...path, key], changes);
        else changes.push([[...path, key], next[key]]);
      }
      return;
    }
    if (Array.isArray(previous) && Array.isArray(next) && previous.length === next.length) {
      for (let i = 0; i < next.length; i++) diffInto(previous[i], next[i], [...path, i], changes);
      return;
    }
    changes.push([path, next]);
  }

  function diffState(previous: unknown, next: unknown): StateChange[] {
    const changes: StateChange[] = [];
    diffInto(previous, next, [], changes);
    return changes;
  }

  /**
   * The state with the changes applied, as a new state: what changed is copied along its path and the
   * rest is shared, so the state it was given stays as it was (the SDK keeps earlier ones for smoothing).
   */
  function applyStateChanges(state: unknown, changes: readonly StateChange[]): unknown {
    // Objects and arrays copied in this call, which its later changes may write to.
    const copied = new Set<unknown>();
    const copyOf = (given: unknown): Record<string | number, unknown> => {
      if (copied.has(given)) return given as Record<string | number, unknown>;
      const copy = Array.isArray(given) ? given.slice() : { ...(given as object) };
      copied.add(copy);
      return copy as Record<string | number, unknown>;
    };
    let root = state;
    for (const change of changes) {
      const path = change[0];
      if (!path.length) {
        root = change.length > 1 ? change[1] : null;
        continue;
      }
      root = copyOf(root);
      let parent = root as Record<string | number, unknown>;
      for (let i = 0; i < path.length - 1; i++) {
        const child = copyOf(parent[path[i]!]);
        parent[path[i]!] = child;
        parent = child;
      }
      const key = path[path.length - 1]!;
      // A key named __proto__ is plain data, as JSON.parse makes it, never the object's prototype.
      if (change.length > 1) Object.defineProperty(parent, key, { value: change[1], writable: true, enumerable: true, configurable: true });
      else delete parent[key];
    }
    return root;
  }

  function utf8SizeBytes(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  function newStateTracker(maximumViewSizeBytes: number): StateTracker {
    // Each viewer's last view as JSON and as a copy; viewers sent the same view share one.
    const sentViews = new Map<string, { text: string; view: unknown }>();
    let hasReportedTooBig = false;
    return {
      forget(viewerId) {
        sentViews.delete(viewerId);
      },
      round(state, viewerIds, viewOf, backedUpViewerIds) {
        const listed = new Set(viewerIds);
        for (const viewerId of [...sentViews.keys()]) if (!listed.has(viewerId)) sentViews.delete(viewerId);
        const round: StateRound = { frames: [], problems: [] };
        // This round's views by their JSON: each is copied, size-checked, sent in full and diffed once, whoever sees it.
        const views = new Map<string, { sent: { text: string; view: unknown } | null; fullFrame: StateRound["frames"][number] | null; changeFrames: Map<object, StateRound["frames"][number] | null> }>();
        let wholeStateText: string | undefined;
        let hasViewFailed = false;
        for (const viewerId of viewerIds) {
          if (backedUpViewerIds.has(viewerId)) {
            sentViews.delete(viewerId);
            continue;
          }
          let text: string | undefined;
          try {
            text = viewOf ? JSON.stringify(viewOf(viewerId)) : (wholeStateText ??= JSON.stringify(state));
          } catch (error) {
            if (!hasViewFailed) round.problems.push(viewOf ? `stateView failed: ${String((error as Error)?.stack || error)}` : `The state isn't plain JSON, so it can't be sent: ${String(error)}`);
            hasViewFailed = true;
            continue;
          }
          text ??= "null";
          const last = sentViews.get(viewerId);
          if (last && last.text === text) continue;
          let seen = views.get(text);
          if (!seen) {
            const sizeBytes = text.length * 3 > maximumViewSizeBytes ? utf8SizeBytes(text) : text.length;
            seen = { sent: sizeBytes > maximumViewSizeBytes ? null : { text, view: JSON.parse(text) }, fullFrame: null, changeFrames: new Map() };
            views.set(text, seen);
            if (!seen.sent && !hasReportedTooBig) {
              hasReportedTooBig = true;
              round.problems.push(`A player's view of the state is ${Math.round(sizeBytes / 1024)} KB as JSON, over the ${Math.round(maximumViewSizeBytes / 1024)} KB a player can be sent, so it isn't sent. Cut it to what each player needs with stateView.`);
            }
          }
          if (!seen.sent) {
            sentViews.delete(viewerId);
            continue;
          }
          let frame: StateRound["frames"][number] | null;
          if (!last) {
            if (!seen.fullFrame) round.frames.push((seen.fullFrame = { playerIds: [], frame: { full: seen.sent.view } }));
            frame = seen.fullFrame;
          } else {
            if (!seen.changeFrames.has(last)) {
              const changes = diffState(last.view, seen.sent.view);
              const made = changes.length ? { playerIds: [], frame: { changes } } : null;
              if (made) round.frames.push(made);
              seen.changeFrames.set(last, made);
            }
            frame = seen.changeFrames.get(last)!;
          }
          sentViews.set(viewerId, seen.sent);
          frame?.playerIds.push(viewerId);
        }
        return round;
      },
    };
  }

  return { diffState, applyStateChanges, newStateTracker };
}

const parts = stateSyncParts();

/** What changed from previous to next, as changes that applyStateChanges turns previous into next with. */
export const diffState = parts.diffState;

/** The state with the changes applied, as a new state; the one given stays as it was. */
export const applyStateChanges = parts.applyStateChanges;

/** A tracker of what each viewer was last sent, for rounds of state sync; views over maximumViewSizeBytes aren't sent. */
export const newStateTracker = parts.newStateTracker;

/**
 * The same parts as an ES module's source, for the game server's sandbox: export default is
 * { diffState, applyStateChanges, newStateTracker }. A bundler that names functions (esbuild's keepNames)
 * calls __name inside them, so the module gives it.
 */
export function stateSyncModuleSource(): string {
  return `var __name = (target) => target;\nexport default (${stateSyncParts.toString()})();\n`;
}
