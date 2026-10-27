import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  PHOTODNA_MATCH_URL,
  PHOTODNA_MONTHLY_REQUEST_COUNT,
  PHOTODNA_REQUEST_INTERVAL_MS,
  readMatchHashAnswer,
  type PhotoDnaHashOutcome,
  type PhotoDnaMatchOutcome,
  type PhotoDnaPriority,
} from "@zaisma/core";

/**
 * PhotoDNA image matching for the site's scans (scan.ts there), through its service binding. Pictures
 * are hashed in a container running Microsoft's SDK and never leave Cloudflare; only the hashes go to
 * Microsoft, through one pacer that keeps every request within Microsoft's limits.
 */
export interface Env {
  HASHER: DurableObjectNamespace<PhotoDnaHasher>;
  PACER: DurableObjectNamespace<PhotoDnaPacer>;
}

/** Hasher containers: wrangler.jsonc's max_instances. */
const HASHER_COUNT = 2;
/** A container with nothing to do sleeps after this long. */
const HASHER_IDLE_MS = 2 * 60 * 1000;
const MAXIMUM_ATTEMPT_COUNT = 3;

/** What the site calls: `hash` for one picture, `match` for up to 5 hashes. */
export class PhotoDnaService extends WorkerEntrypoint<Env> {
  hash(bytes: Uint8Array): Promise<PhotoDnaHashOutcome> {
    return this.env.HASHER.getByName(`hasher-${Math.floor(Math.random() * HASHER_COUNT)}`).hash(bytes);
  }

  match(apiKey: string, hashes: string[], priority: PhotoDnaPriority): Promise<PhotoDnaMatchOutcome> {
    return this.env.PACER.getByName("pacer").match(apiKey, hashes, priority);
  }
}

export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;

/** One hasher container: started on the first picture, asleep after a couple of idle minutes. */
export class PhotoDnaHasher extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  async hash(bytes: Uint8Array): Promise<PhotoDnaHashOutcome> {
    try {
      this.starting ??= this.start().finally(() => (this.starting = undefined));
      await this.starting;
      const response = await this.ctx.container!.getTcpPort(8080).fetch("http://container/hash", { method: "POST", body: bytes });
      if (!response.ok) return { kind: "down", why: `the hasher answered ${response.status}` };
      const answer = (await response.json()) as PhotoDnaHashOutcome;
      return answer.kind === "hash" || answer.kind === "skip" ? answer : { kind: "down", why: "the hasher's answer wasn't readable" };
    } catch (error) {
      return { kind: "down", why: `the hasher didn't answer: ${String(error).slice(0, 200)}` };
    }
  }

  /** Starts the container if it's asleep, and waits until Microsoft's SDK has loaded. */
  private async start(): Promise<void> {
    const container = this.ctx.container!;
    // Under the durable_object scheduling policy (a new account's, as a restore makes) the code names the image and its
    // size; under the default policy (Zaisma's own account) wrangler.jsonc does, and there are no images here.
    const image = (container as { images?: Record<string, string> }).images?.main;
    if (!container.running) container.start({ enableInternet: false, ...(image ? { image, instance: "basic" } : {}) } as Parameters<typeof container.start>[0]);
    await container.setInactivityTimeout(HASHER_IDLE_MS);
    const port = container.getTcpPort(8080);
    let lastError: unknown;
    for (let attemptIndex = 0; attemptIndex < 150; attemptIndex++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`health ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(200);
    }
    throw new Error(`the hasher didn't start (${String(lastError)})`);
  }
}

interface Waiting {
  apiKey: string;
  hashes: string[];
  attemptIndex: number;
  resolve: (outcome: PhotoDnaMatchOutcome) => void;
}

/**
 * Every request to Microsoft goes through this one object: one request every PHOTODNA_REQUEST_INTERVAL_MS however many scans run at once, uploads before rechecks, and never past the monthly limit.
 * When Microsoft says to slow down or doesn't answer, the request waits its turn again, up to
 * MAXIMUM_ATTEMPT_COUNT tries, and then counts as down (the version passes on the other matcher).
 */
export class PhotoDnaPacer extends DurableObject<Env> {
  private readonly queues: Record<PhotoDnaPriority, Waiting[]> = { upload: [], recheck: [] };
  private nextSendAtMs = 0;
  private isPumping = false;

  match(apiKey: string, hashes: string[], priority: PhotoDnaPriority): Promise<PhotoDnaMatchOutcome> {
    return new Promise((resolve) => {
      this.queues[priority].push({ apiKey, hashes, attemptIndex: 0, resolve });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.isPumping) return;
    this.isPumping = true;
    try {
      for (let waiting = this.next(); waiting; waiting = this.next()) {
        const waitMs = this.nextSendAtMs - Date.now();
        if (waitMs > 0) await scheduler.wait(waitMs);
        this.nextSendAtMs = Math.max(this.nextSendAtMs, Date.now()) + PHOTODNA_REQUEST_INTERVAL_MS;
        // Sent without waiting for the answer: the limit is on requests a second, not on how many are open.
        void this.send(waiting);
      }
    } finally {
      this.isPumping = false;
    }
  }

  private next(): Waiting | undefined {
    return this.queues.upload.shift() ?? this.queues.recheck.shift();
  }

  private async send(waiting: Waiting): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    const monthKey = `request_count:${month}`;
    const requestCount = ((await this.ctx.storage.get<number>(monthKey)) ?? 0) + 1;
    if (requestCount > PHOTODNA_MONTHLY_REQUEST_COUNT) return waiting.resolve({ kind: "down", why: `this month's ${PHOTODNA_MONTHLY_REQUEST_COUNT.toLocaleString("en-US")} requests are used up` });
    await this.ctx.storage.put(monthKey, requestCount);

    let why: string;
    try {
      const response = await fetch(PHOTODNA_MATCH_URL, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": waiting.apiKey, "content-type": "application/json" },
        body: JSON.stringify(waiting.hashes.map((hash) => ({ DataRepresentation: "PreHashV2", Value: hash }))),
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return waiting.resolve({ kind: "down", why: `Microsoft turned down the key (${response.status}); check the PHOTODNA_KEY secret on zaisma-site` });
      }
      if (response.ok) return waiting.resolve(readMatchHashAnswer(await response.json().catch(() => null), waiting.hashes.length));
      why = `${response.status}`;
      // Slowed down: hold everything back a second, not just this request.
      if (response.status === 429) this.nextSendAtMs = Math.max(this.nextSendAtMs, Date.now() + 1000 * (Number(response.headers.get("retry-after")) || 1));
      await response.body?.cancel();
    } catch (error) {
      why = String(error).slice(0, 200);
    }
    if (++waiting.attemptIndex >= MAXIMUM_ATTEMPT_COUNT) return waiting.resolve({ kind: "down", why });
    this.queues.upload.unshift(waiting);
    void this.pump();
  }
}
