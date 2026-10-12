// Four in a row game server: turn-based, two players, everyone else watches.
// It has no tickRate, so the room sleeps between moves and costs almost nothing.
// A room labelled Room: Lobby is where players find an opponent: each pair gets a match
// room of their own (room.reserve), which starts with both seats taken.
import type { GameServer, Player, Room } from "@zaisma/game-server";

const COLS = 7;
const ROWS = 6;

interface State {
  board: number[]; // ROWS * COLS, 0 empty, 1 or 2
  seats: [string | null, string | null];
  names: [string, string];
  turn: 1 | 2;
  winner: 0 | 1 | 2 | 3; // 3 = draw
  line: number[];
  firstNext: 1 | 2;
  /** In the lobby: players already sent to a match. */
  paired: string[];
}

const LOBBY = "Lobby";

/** Who a lobby made a match for: room.reserve's data. */
interface Match {
  seats: [string, string];
  names: [string, string];
}

function fresh(first: 1 | 2): Pick<State, "board" | "turn" | "winner" | "line"> {
  return { board: Array(ROWS * COLS).fill(0), turn: first, winner: 0, line: [] };
}

function findLine(board: number[], at: number): number[] {
  const who = board[at];
  const r0 = Math.floor(at / COLS);
  const c0 = at % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line = [at];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === who) {
        line.push(r * COLS + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (line.length >= 4) return line;
  }
  return [];
}

function share(state: State, room: Room): void {
  const here = new Set(room.players.map((p) => p.id));
  room.broadcast({
    board: state.board,
    seats: state.seats,
    names: state.names,
    present: state.seats.map((id) => (id ? here.has(id) : false)),
    turn: state.turn,
    winner: state.winner,
    line: state.line,
  });
}

/** The two players who've waited longest get a match room of their own, and move there. */
function pair(state: State, room: Room): void {
  const waiting = room.players.filter((p) => !state.paired.includes(p.id));
  while (waiting.length >= 2) {
    const [a, b] = waiting.splice(0, 2) as [Player, Player];
    room.reserve({ players: [a.id, b.id], data: { seats: [a.id, b.id], names: [a.name, b.name] } satisfies Match });
    state.paired.push(a.id, b.id);
  }
  room.broadcast({ lobby: waiting.length });
}

const fourInARow: GameServer<State> = {
  maxPlayers: 8,

  setup(data) {
    const match = data as Match | undefined;
    return { ...fresh(1), seats: match ? match.seats : [null, null], names: match ? match.names : ["", ""], firstNext: 2, paired: [] };
  },

  onJoin(state, player: Player, room) {
    if (room.labels.Room === LOBBY) return pair(state, room);
    // Someone coming back keeps their seat. Otherwise take a free seat, or one whose player has gone.
    if (!state.seats.includes(player.id)) {
      const here = new Set(room.players.map((p) => p.id));
      const seat = state.seats.findIndex((id) => id === null || !here.has(id));
      if (seat !== -1) {
        state.seats[seat] = player.id;
        state.names[seat] = player.name;
      }
    }
    share(state, room);
  },

  onLeave(state, player, room) {
    if (room.labels.Room === LOBBY) {
      state.paired = state.paired.filter((id) => id !== player.id);
      return pair(state, room);
    }
    share(state, room);
  },

  onMessage(state, player, msg, room) {
    const m = (msg ?? {}) as { col?: unknown; again?: unknown };
    if (room.labels.Room === LOBBY) return;
    const seat = state.seats.indexOf(player.id);
    if (seat === -1) return;
    const me = (seat + 1) as 1 | 2;

    if (m.again && state.winner) {
      Object.assign(state, fresh(state.firstNext));
      state.firstNext = state.firstNext === 1 ? 2 : 1;
      return share(state, room);
    }
    const col = Number(m.col);
    if (state.winner || state.turn !== me || !Number.isInteger(col) || col < 0 || col >= COLS) return;
    let at = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (state.board[r * COLS + col] === 0) {
        at = r * COLS + col;
        break;
      }
    }
    if (at === -1) return;
    state.board[at] = me;
    state.line = findLine(state.board, at);
    if (state.line.length) state.winner = me;
    else if (state.board.every((v) => v !== 0)) state.winner = 3;
    else state.turn = me === 1 ? 2 : 1;
    share(state, room);
  },
};

export default fourInARow;
