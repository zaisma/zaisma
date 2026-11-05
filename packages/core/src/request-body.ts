/**
 * A request's body, never read past a size, whatever its headers say. A door's row names its size (docs/DOORS.md):
 * cappedRequest holds every reader behind the door to it, and the readers here hold a call that takes less to its own.
 */

/** What a door with no body in its row is held to: what's sent to one is never read, up to this. */
export const NO_BODY_MAXIMUM_SIZE_BYTES = 64 * 1024;

/** A body over the size its reader takes. Nothing past that size was read. */
export class BodyPastCapError extends Error {
  constructor(maximumSizeBytes: number) {
    super(`The body is over ${maximumSizeBytes} bytes.`);
    this.name = "BodyPastCapError";
  }
}

/** Reads a stream's bytes in turn, stopping with BodyPastCapError at the first byte past the size. */
function cappedReaderOf(body: ReadableStream<Uint8Array>, maximumSizeBytes: number) {
  const reader = body.getReader();
  let sizeBytes = 0;
  return {
    async nextChunk(): Promise<Uint8Array | null> {
      const { done: isDone, value: chunk } = await reader.read();
      if (isDone) return null;
      sizeBytes += chunk.byteLength;
      if (sizeBytes <= maximumSizeBytes) return chunk;
      await reader.cancel();
      throw new BodyPastCapError(maximumSizeBytes);
    },
    cancel: (reason?: unknown) => reader.cancel(reason),
  };
}

/** The size a request states and is held to, or null when its bytes are counted instead. */
function statedSizeBytesOf(request: Request): number | null {
  const stated = request.headers.get("content-length");
  return stated !== null && /^\d{1,15}$/.test(stated) && !request.headers.has("content-encoding") ? Number(stated) : null;
}

/**
 * The request as its door may read it: no reader, whichever it is, gets past the size. A stated size within it stays a
 * stated size, which storage needs to take a body as it arrives, and the stream ends the read at that size; anything
 * else is counted. The one request a door sees from here on, so what's kept per request (the session) is kept on it.
 */
export function cappedRequest(request: Request, maximumSizeBytes: number): Request {
  if (!request.body) return request;
  // These methods take no body, so no reader has anything to read.
  if (request.method === "GET" || request.method === "HEAD") return new Request(request, { body: null });
  const statedSizeBytes = statedSizeBytesOf(request);
  if (statedSizeBytes !== null && statedSizeBytes <= maximumSizeBytes) return new Request(request, { body: request.body.pipeThrough(new FixedLengthStream(statedSizeBytes)) });
  const reader = cappedReaderOf(request.body, maximumSizeBytes);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.nextChunk();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Request(request, { body });
}

/** The body's bytes, or BodyPastCapError with nothing past the size read. A stated size over it is refused before any of it is read. */
export async function readBodyBytes(request: Request, maximumSizeBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > maximumSizeBytes) throw new BodyPastCapError(maximumSizeBytes);
  if (!request.body) return new Uint8Array();
  const reader = cappedReaderOf(request.body, maximumSizeBytes);
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  for (let chunk = await reader.nextChunk(); chunk; chunk = await reader.nextChunk()) {
    chunks.push(chunk);
    sizeBytes += chunk.byteLength;
  }
  const bytes = new Uint8Array(sizeBytes);
  let filledSizeBytes = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, filledSizeBytes);
    filledSizeBytes += chunk.byteLength;
  }
  return bytes;
}

/** The body as text, as readBodyBytes reads it. */
export async function readBodyText(request: Request, maximumSizeBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(request, maximumSizeBytes));
}
