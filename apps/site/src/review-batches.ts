import Anthropic from "@anthropic-ai/sdk";
import { AI_REVIEW_LIMITS, addReviewUsage, newId, reviewCostCents, sha256Hex } from "@zaisma/core";
import type { Env } from "./env.ts";
import { judgeAnswerOf, judgeRequest, type JudgeAnswer, type JudgeVersion } from "./review-judge.ts";
import { answerOf, codeReadRequest, pictureReadRequest, type ReadCode, type ReaderAnswer, type ReadPictures, type StoredMessage } from "./review-readers.ts";

/**
 * The AI review in half-price batches ("Fixed checks first, the AI review after publishing" in docs/DECISIONS.md).
 * A review is a pass that can run again at any time: it asks the readers and the judge through the stand-ins here,
 * which answer from what's stored and note what isn't. What's missing goes to Anthropic as a batch, and when the
 * batch ends the pass runs again from the top, so a crash, a retried message or a lost one costs nothing but the pass.
 */

/** Anthropic's batches, as the review uses them; tests stand in for it. */
export interface ReviewBatchClient {
  create(apiKey: string, requests: BatchRequest[]): Promise<string>;
  isEnded(apiKey: string, batchId: string): Promise<boolean>;
  results(apiKey: string, batchId: string): AsyncIterable<BatchResult>;
  cancel(apiKey: string, batchId: string): Promise<void>;
}

export interface BatchRequest {
  customId: string;
  messageRequest: Anthropic.MessageCreateParamsNonStreaming;
}

/** A batch's answer to one request: its message, or null when it errored, expired or was canceled. */
export interface BatchResult {
  customId: string;
  model: string | null;
  message: StoredMessage | null;
}

export const anthropicBatches: ReviewBatchClient = {
  async create(apiKey, requests) {
    return (await new Anthropic({ apiKey, maxRetries: 2, timeout: 300_000 }).messages.batches.create({ requests: requests.map((request) => ({ custom_id: request.customId, params: request.messageRequest })) })).id;
  },
  async isEnded(apiKey, batchId) {
    return (await new Anthropic({ apiKey, maxRetries: 2 }).messages.batches.retrieve(batchId)).processing_status === "ended";
  },
  async *results(apiKey, batchId) {
    for await (const entry of await new Anthropic({ apiKey, maxRetries: 2, timeout: 300_000 }).messages.batches.results(batchId)) {
      const message = entry.result.type === "succeeded" ? entry.result.message : null;
      yield { customId: entry.custom_id, model: message?.model ?? null, message: message && { content: message.content, stop_reason: message.stop_reason, usage: message.usage } };
    }
  },
  async cancel(apiKey, batchId) {
    await new Anthropic({ apiKey, maxRetries: 2 }).messages.batches.cancel(batchId);
  },
};

/**
 * What a version's review was told so far, by request. messages: what its batches answered, null when a batch
 * couldn't. direct: what a question asked again at full price answered, so a later pass doesn't pay for it twice.
 */
interface StoredAnswers {
  messages: Record<string, StoredMessage | null>;
  direct: Record<string, ReaderAnswer | JudgeAnswer>;
}

const answersKey = (versionId: string) => `review-answers/${versionId}.json`;

async function storedAnswers(env: Env, versionId: string): Promise<StoredAnswers> {
  const stored = await env.GAMES.get(answersKey(versionId));
  return stored ? ((await stored.json()) as StoredAnswers) : { messages: {}, direct: {} };
}

const putAnswers = (env: Env, versionId: string, answers: StoredAnswers) => env.GAMES.put(answersKey(versionId), JSON.stringify(answers), { httpMetadata: { contentType: "application/json" } });

/** A version's review is over or dropped: its batches' rows and stored answers go, and any batch still running is canceled. */
export async function forgetReviewBatches(env: Env, versionId: string, client: ReviewBatchClient): Promise<void> {
  const { results } = await env.DB.prepare("SELECT anthropic_batch_id FROM review_batches WHERE version_id = ? AND ended_at_ms IS NULL").bind(versionId).all<{ anthropic_batch_id: string }>();
  if (env.ANTHROPIC_API_KEY) for (const batch of results) await client.cancel(env.ANTHROPIC_API_KEY, batch.anthropic_batch_id).catch(() => {});
  await env.DB.prepare("DELETE FROM review_batches WHERE version_id = ?").bind(versionId).run();
  await env.GAMES.delete(answersKey(versionId));
}

/** Whether a batch of this version's is still running. */
export async function hasRunningBatch(env: Env, versionId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM review_batches WHERE version_id = ? AND ended_at_ms IS NULL LIMIT 1").bind(versionId).first());
}

/**
 * Stores the answers of this version's ended batches once, and counts what they cost at half price. A second run
 * reads the same answers and counts nothing: the mark goes on after the answers are stored, in one claim.
 */
export async function collectEndedBatches(env: Env, versionId: string, client: ReviewBatchClient, nowMs = Date.now()): Promise<void> {
  const { results: batches } = await env.DB.prepare("SELECT id, anthropic_batch_id FROM review_batches WHERE version_id = ? AND ended_at_ms IS NOT NULL AND collected_at_ms IS NULL").bind(versionId).all<{ id: string; anthropic_batch_id: string }>();
  if (batches.length === 0) return;
  const answers = await storedAnswers(env, versionId);
  let costCents = 0;
  for (const batch of batches) {
    for await (const answered of client.results(env.ANTHROPIC_API_KEY ?? "", batch.anthropic_batch_id)) {
      answers.messages[answered.customId] = answered.message;
      if (answered.message && answered.model) costCents += reviewCostCents(answered.model, usageCounts(answered.message), true);
    }
  }
  await putAnswers(env, versionId, answers);
  let isClaimed = false;
  for (const batch of batches) {
    const claim = await env.DB.prepare("UPDATE review_batches SET collected_at_ms = ? WHERE id = ? AND collected_at_ms IS NULL").bind(nowMs, batch.id).run();
    if (claim.meta.changes) isClaimed = true;
  }
  if (isClaimed && costCents > 0) await addReviewUsage(env.DB, costCents);
}

const usageCounts = (message: StoredMessage) => ({
  inputTokenCount: message.usage.input_tokens,
  outputTokenCount: message.usage.output_tokens,
  cacheReadTokenCount: message.usage.cache_read_input_tokens ?? 0,
  cacheWriteTokenCount: message.usage.cache_creation_input_tokens ?? 0,
});

/** The stand-ins a pass reads and judges through, and what it found missing. */
export interface BatchedPass {
  readCode: ReadCode;
  readPictures: ReadPictures;
  judge: JudgeVersion;
  /** Something wasn't answered yet, so the pass can't decide. */
  hasMissingAnswers(): boolean;
  /** Sends what's still waiting. */
  sendMissing(): Promise<void>;
}

/**
 * A pass over stored answers: each request has an ID from a hash of what it asks, so the same read asks the same
 * question whichever pass makes it. Requests go out as they fill a batch, so hundreds of pictures never sit in a
 * Worker's memory together. A question a batch couldn't answer, or a judge's answer its safeguard declined, is
 * asked directly at full price, which keeps the judge's tries before a person.
 */
export async function batchedPass(env: Env, versionId: string, client: ReviewBatchClient, direct: { readCode: ReadCode; readPictures: ReadPictures; judge: JudgeVersion }): Promise<BatchedPass> {
  const answers = await storedAnswers(env, versionId);
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  let waiting: BatchRequest[] = [];
  let waitingSizeBytes = 0;
  let wasMissing = false;
  let sends: Promise<void> = Promise.resolve();

  const send = (requests: BatchRequest[]) => {
    sends = sends.then(async () => {
      const batchId = await client.create(apiKey, requests);
      await env.DB.prepare("INSERT INTO review_batches (id, version_id, anthropic_batch_id, request_count, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(newId("review_batch"), versionId, batchId, requests.length, Date.now()).run();
    });
    return sends;
  };
  const ask = async (customId: string, messageRequest: Anthropic.MessageCreateParamsNonStreaming) => {
    wasMissing = true;
    const sizeBytes = JSON.stringify(messageRequest).length;
    if (waiting.length && waitingSizeBytes + sizeBytes > AI_REVIEW_LIMITS.maximumBatchSizeBytes) {
      const full = waiting;
      waiting = [];
      waitingSizeBytes = 0;
      await send(full);
    }
    waiting.push({ customId, messageRequest });
    waitingSizeBytes += sizeBytes;
  };
  const noAnswer: ReaderAnswer = { items: [], outcome: "read", costCents: 0, inputTokenCount: 0, outputTokenCount: 0 };
  const idOf = async (parts: unknown) => `r${(await sha256Hex(new TextEncoder().encode(JSON.stringify(parts)))).slice(0, 60)}`;
  // Asked at full price, once: counted now, and kept for every later pass.
  const askedDirectly = async <Answer extends ReaderAnswer | JudgeAnswer>(customId: string, ask: () => Promise<Answer>): Promise<Answer> => {
    if (Object.hasOwn(answers.direct, customId)) return answers.direct[customId] as Answer;
    const answer = await ask();
    await addReviewUsage(env.DB, answer.costCents);
    answers.direct[customId] = answer;
    await putAnswers(env, versionId, answers);
    return answer;
  };

  return {
    hasMissingAnswers: () => wasMissing,
    sendMissing: async () => {
      if (waiting.length) await send(waiting);
      waiting = [];
      await sends;
    },
    readCode: async (key, model, chunk, readerContext) => {
      const customId = await idOf([model, chunk.files]);
      if (!Object.hasOwn(answers.messages, customId)) {
        await ask(customId, codeReadRequest(model, chunk, readerContext));
        return noAnswer;
      }
      const message = answers.messages[customId];
      return message ? answerOf(model, message, new Set(chunk.files.map((file) => file.path)), false, true) : askedDirectly(customId, () => direct.readCode(key, model, chunk, readerContext));
    },
    readPictures: async (key, model, pictures) => {
      const customId = await idOf([model, pictures]);
      if (!Object.hasOwn(answers.messages, customId)) {
        await ask(customId, pictureReadRequest(model, pictures));
        return noAnswer;
      }
      const message = answers.messages[customId];
      return message ? answerOf(model, message, new Set(pictures.map((picture) => picture.path)), true, true) : askedDirectly(customId, () => direct.readPictures(key, model, pictures));
    },
    judge: async (key, model, brief) => {
      const customId = await idOf([model, brief]);
      if (!Object.hasOwn(answers.messages, customId)) {
        await ask(customId, judgeRequest(model, brief));
        return NO_VERDICT;
      }
      const message = answers.messages[customId];
      if (!message || message.stop_reason === "refusal") return askedDirectly(customId, () => direct.judge(key, model, brief));
      const counts = usageCounts(message);
      return judgeAnswerOf(message, brief, {
        declinedAttemptCount: 0,
        costCents: reviewCostCents(model, counts, true),
        inputTokenCount: counts.inputTokenCount + counts.cacheReadTokenCount + counts.cacheWriteTokenCount,
        outputTokenCount: counts.outputTokenCount,
      });
    },
  };
}

/** What the stand-in answers a judge it hasn't asked yet: the pass stops at hasMissingAnswers before anyone reads it. */
const NO_VERDICT: JudgeAnswer = { verdict: "hold", summary: "", findings: [], isChildSafety: false, followedReviewPrecedentNumbers: [], declinedAttemptCount: 0, costCents: 0, inputTokenCount: 0, outputTokenCount: 0 };

/** Every 5 minutes: mark the batches that ended, and answer with the versions none of whose batches still run. */
export async function endedBatchVersions(env: Env, client: ReviewBatchClient, nowMs = Date.now()): Promise<string[]> {
  if (!env.ANTHROPIC_API_KEY) return [];
  const { results } = await env.DB.prepare("SELECT id, version_id, anthropic_batch_id FROM review_batches WHERE ended_at_ms IS NULL ORDER BY created_at_ms LIMIT 200").all<{ id: string; version_id: string; anthropic_batch_id: string }>();
  const versionIds = new Set<string>();
  for (const batch of results) {
    if (!(await client.isEnded(env.ANTHROPIC_API_KEY, batch.anthropic_batch_id).catch(() => false))) continue;
    await env.DB.prepare("UPDATE review_batches SET ended_at_ms = ? WHERE id = ?").bind(nowMs, batch.id).run();
    versionIds.add(batch.version_id);
  }
  const ready: string[] = [];
  for (const versionId of versionIds) if (!(await hasRunningBatch(env, versionId))) ready.push(versionId);
  return ready;
}
