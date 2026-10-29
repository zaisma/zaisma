// The fast lane to your own server: WebTransport (HTTP/3 over UDP) beside the WebSocket, for games that join
// with transport: "webtransport". Latest-only sends go as datagrams, so a late one is dropped instead of holding
// up what comes after it; everything else rides one stream, framed as the wire comment in src/room.ts says
// (above ServerMessage). @fails-components/webtransport serves it: an optional peer dependency, which developers
// who use the fast lane install themselves, loaded only when the runner is given one, so nobody else installs or loads it.
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { GameServerError } from "../src/internal.ts";

const FAST_LANE_PACKAGES = ["@fails-components/webtransport", "@fails-components/webtransport-transport-http3-quiche"];
const TEXT_KIND_NUMBER = 0;
const BYTES_KIND_NUMBER = 1;
/** A stream frame's header: its payload's length (4 bytes, big-endian), then its kind. */
const FRAME_HEADER_SIZE_BYTES = 5;
/** A session's datagram size when it doesn't say: under the 1200 bytes every QUIC path carries, less QUIC's and HTTP/3's own. */
const DEFAULT_MAXIMUM_DATAGRAM_SIZE_BYTES = 1100;
/** A closing session waits this long for what it sent before it to go out, then closes anyway. */
const CLOSE_WAIT_MS = 2000;
const ROOM_PATH = /^\/v1\/rooms\//;

const ignore = () => {};

/** The error for a fast lane whose package isn't there: the runner exits with it, and startServer's fastLaneReady rejects with it. */
function notInstalled() {
  return new GameServerError("bad_option", "webtransportPort", `The fast lane needs ${FAST_LANE_PACKAGES.join(" and ")}, which aren't installed.`, `Install them (npm install ${FAST_LANE_PACKAGES.join(" ")}) for --webtransport-port, or leave the fast lane out.`);
}

/**
 * Listen for WebTransport sessions on a UDP port, with the server's certificate (PEM). Each session at
 * /v1/rooms/... whose client opens its stream within helloMs goes to onConnection(socket, path, origin),
 * where socket has the surface the runner uses on a ws WebSocket. Answers { sockets, close() } once it listens.
 */
export async function startFastLane({ port, certificatePem, keyPem, helloMs, maximumFrameSizeBytes, onConnection }) {
  let webtransport;
  try {
    webtransport = await import(FAST_LANE_PACKAGES[0]);
    // The HTTP/3 binary comes in a package of its own, which the first loads only when a server starts.
    await webtransport.quicheLoaded;
  } catch {
    throw notInstalled();
  }
  const listen = async (host) => {
    const server = new webtransport.Http3Server({ port, host, secret: randomBytes(32).toString("hex"), cert: certificatePem, privKey: keyPem });
    server.startServer();
    await server.ready;
    return server;
  };
  // IPv6 and IPv4 together where the machine has IPv6, else IPv4 alone.
  const server = await listen("::").catch(() => listen("0.0.0.0"));
  const sockets = new Set();
  // Every room address goes to one stream of sessions, carrying its own path; the room checks it as for the WebSocket.
  server.setRequestCallback(async ({ header }) => {
    const path = String(header[":path"] ?? "");
    if (!ROOM_PATH.test(path)) return { header, path, status: 404 };
    return { header: { ...header, ":path": "/v1/rooms" }, path: "/v1/rooms", userData: { path }, status: 200 };
  });
  const sessions = server.sessionStream("/v1/rooms").getReader();
  void (async () => {
    for (;;) {
      const { value: session, done } = await sessions.read();
      if (done) return;
      take(session).catch(ignore);
    }
  })();

  async function take(session) {
    await session.ready;
    // The client opens its stream first, with its hello: a session that doesn't is closed.
    const streams = session.incomingBidirectionalStreams.getReader();
    let timer;
    const stream = await Promise.race([streams.read().then((read) => read.value), new Promise((resolve) => (timer = setTimeout(resolve, helloMs)))]);
    clearTimeout(timer);
    if (!stream) return void session.close({ closeCode: 4001, reason: "no_hello" });
    // One stream is all a player has; any other is turned away.
    void (async () => {
      for (;;) {
        const { value: other, done } = await streams.read().catch(() => ({ done: true }));
        if (done) return;
        other.readable.cancel().catch(ignore);
        other.writable.abort().catch(ignore);
      }
    })();
    const socket = new FastLaneSocket(session, stream, maximumFrameSizeBytes);
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket, session.userData?.path ?? "", typeof session.header?.origin === "string" ? session.header.origin : undefined);
    socket.start();
  }

  return {
    sockets,
    close() {
      try {
        server.stopServer();
      } catch {}
    },
  };
}

/**
 * One player's fast-lane session, with what the runner uses on a ws WebSocket: send(message, { binary, delivery }),
 * close(code, reason), terminate(), bufferedAmount, and "message" (payload, isBinary, isDatagram) and "close" (code) events.
 */
class FastLaneSocket extends EventEmitter {
  constructor(session, stream, maximumFrameSizeBytes) {
    super();
    this.session = session;
    this.stream = stream;
    this.maximumFrameSizeBytes = maximumFrameSizeBytes;
    this.writer = stream.writable.getWriter();
    const datagrams = session.datagrams;
    this.datagramWriter = (typeof datagrams.createWritable === "function" ? datagrams.createWritable() : datagrams.writable).getWriter();
    /** Bytes handed to the stream and not yet taken by it, as a WebSocket's bufferedAmount. */
    this.bufferedAmount = 0;
    this.isOpen = true;
    this.isClosed = false;
  }

  /** Read the stream and the datagrams, and hear the session close: after onConnection has its listeners on. */
  start() {
    this.session.closed.then((closeInfo) => this.end(closeInfo?.closeCode ?? 1005), () => this.end(1006));
    this.readStream().catch(() => this.terminate());
    this.readDatagrams().catch(ignore);
  }

  async readStream() {
    const reader = this.stream.readable.getReader();
    let buffered = Buffer.alloc(0);
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) return;
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
      while (buffered.length >= FRAME_HEADER_SIZE_BYTES) {
        const payloadSizeBytes = buffered.readUInt32BE(0);
        const kindNumber = buffered[4];
        // Over the limit, or of a kind the wire doesn't have: this connection ends, as a WebSocket's does.
        if (payloadSizeBytes > this.maximumFrameSizeBytes || (kindNumber !== TEXT_KIND_NUMBER && kindNumber !== BYTES_KIND_NUMBER)) return this.terminate();
        if (buffered.length < FRAME_HEADER_SIZE_BYTES + payloadSizeBytes) break;
        const payload = Buffer.from(buffered.subarray(FRAME_HEADER_SIZE_BYTES, FRAME_HEADER_SIZE_BYTES + payloadSizeBytes));
        buffered = buffered.subarray(FRAME_HEADER_SIZE_BYTES + payloadSizeBytes);
        if (!this.isClosed) this.emit("message", payload, kindNumber === BYTES_KIND_NUMBER, false);
      }
    }
  }

  async readDatagrams() {
    const reader = this.session.datagrams.readable.getReader();
    for (;;) {
      const { value: datagram, done } = await reader.read();
      if (done || this.isClosed) return;
      const kindNumber = datagram[0];
      // A datagram that isn't one of the wire's is dropped, as a lost one would be.
      if (datagram.length < 1 || (kindNumber !== TEXT_KIND_NUMBER && kindNumber !== BYTES_KIND_NUMBER)) continue;
      this.emit("message", Buffer.from(datagram.subarray(1)), kindNumber === BYTES_KIND_NUMBER, true);
    }
  }

  /** The most a datagram carries on this session. */
  maximumDatagramSizeBytes() {
    const maximumSizeBytes = this.session.datagrams.maxDatagramSize;
    return typeof maximumSizeBytes === "number" && maximumSizeBytes > 0 ? maximumSizeBytes : DEFAULT_MAXIMUM_DATAGRAM_SIZE_BYTES;
  }

  /** A text, or a binary frame with { binary: true }. A latest-only one goes as a datagram when it fits; the rest on the stream, in order. */
  send(message, options = {}) {
    if (!this.isOpen) return;
    const kindNumber = options.binary ? BYTES_KIND_NUMBER : TEXT_KIND_NUMBER;
    const payload = typeof message === "string" ? Buffer.from(message, "utf8") : message;
    if (options.delivery === "latest_only" && 1 + payload.length <= this.maximumDatagramSizeBytes()) {
      const datagram = new Uint8Array(1 + payload.length);
      datagram[0] = kindNumber;
      datagram.set(payload, 1);
      this.datagramWriter.write(datagram).catch(ignore);
      return;
    }
    const frame = Buffer.alloc(FRAME_HEADER_SIZE_BYTES + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    frame[4] = kindNumber;
    frame.set(payload, FRAME_HEADER_SIZE_BYTES);
    this.bufferedAmount += frame.length;
    this.writer.write(frame).then(() => (this.bufferedAmount -= frame.length), ignore);
  }

  /** Close with a code and reason, after what was sent before goes out (as a WebSocket's close frame waits behind it). */
  close(closeCode = 1000, reason = "") {
    if (!this.isOpen) return;
    this.isOpen = false;
    let timer;
    Promise.race([this.writer.close(), new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_WAIT_MS)))])
      .catch(ignore)
      .finally(() => {
        clearTimeout(timer);
        this.end(closeCode, reason);
      });
  }

  /** Close now, dropping what hasn't gone out. */
  terminate() {
    this.isOpen = false;
    this.end(1006, "");
  }

  end(closeCode, reason = "") {
    if (this.isClosed) return;
    this.isOpen = false;
    this.isClosed = true;
    try {
      this.session.close({ closeCode, reason });
    } catch {}
    this.emit("close", closeCode);
  }
}
