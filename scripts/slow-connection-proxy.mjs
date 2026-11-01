// A slow line for a browser that can't slow itself (Safari has no throttling a script can set): an HTTP proxy on this machine that
// tunnels each https connection (CONNECT) and gives every byte the line of Slow 3G as DevTools has it: a second each way (2 s a round
// trip) and 50 KB a second each way, shared by every connection, as one phone's connection is. Used by scripts/speed-night.mjs.
//
//   node scripts/slow-connection-proxy.mjs [--port 8899]     runs it until stopped

import { createServer } from "node:http";
import { connect } from "node:net";

export const SLOW_3G_LINE = { oneWayDelayMs: 1000, bytesPerSec: 50 * 1024 };

/**
 * One direction of the line: a chunk goes out once the bytes before it have (bytesPerSec, shared by every connection) and arrives
 * oneWayDelayMs later, so what each connection sends keeps its order. deliver(chunk) is called at its time; nowMs and wait are for tests.
 */
export class SlowLine {
  constructor({ oneWayDelayMs, bytesPerSec }, { nowMs = () => Date.now(), wait = (work, delayMs) => setTimeout(work, delayMs) } = {}) {
    Object.assign(this, { oneWayDelayMs, bytesPerSec, nowMs, wait, freeAtMs: 0 });
  }
  /** When a chunk of this many bytes sent now arrives. */
  arrivalMs(sizeBytes) {
    this.freeAtMs = Math.max(this.freeAtMs, this.nowMs()) + (sizeBytes / this.bytesPerSec) * 1000;
    return this.freeAtMs + this.oneWayDelayMs;
  }
  send(chunk, deliver) {
    const atMs = this.arrivalMs(chunk.length);
    this.wait(() => deliver(chunk), Math.max(0, atMs - this.nowMs()));
  }
}

/** Starts the proxy; resolves to { port, close() }. */
export function startSlowProxy({ port = 0, line = SLOW_3G_LINE } = {}) {
  const down = new SlowLine(line), up = new SlowLine(line);
  const server = createServer((request, response) => {
    response.writeHead(405, { "Content-Type": "text/plain" });
    response.end("Only https, through CONNECT.");
  });
  server.on("connect", (request, client, head) => {
    const [host, portText] = (request.url ?? "").split(":");
    const upstream = connect(Number(portText) || 443, host, () => {
      down.send(Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n"), (chunk) => client.writable && client.write(chunk));
      if (head?.length) up.send(head, (chunk) => upstream.writable && upstream.write(chunk));
      client.on("data", (chunk) => up.send(chunk, (sent) => upstream.writable && upstream.write(sent)));
      upstream.on("data", (chunk) => down.send(chunk, (sent) => client.writable && client.write(sent)));
    });
    const end = () => { client.destroy(); upstream.destroy(); };
    upstream.on("error", end); client.on("error", end); upstream.on("close", end); client.on("close", end);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) })));
}

if (process.argv[1] === import.meta.filename) {
  const portAt = process.argv.indexOf("--port");
  const { port } = await startSlowProxy({ port: portAt > 0 ? Number(process.argv[portAt + 1]) : 8899 });
  console.log(`Slow 3G proxy on 127.0.0.1:${port}`);
}
