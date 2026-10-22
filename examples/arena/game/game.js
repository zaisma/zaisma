// Arena client: sends input when it changes and draws the game server's state,
// smoothed by room.smoothedState(): a moment behind, between the two updates around then.
const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const statusElement = document.getElementById("status");
const boardElement = document.getElementById("board");
const PLATFORM_RADIUS = 360;
const BODY_RADIUS = 18;

/** @typedef {{ name: string, color: string, x: number, y: number, score: number, isDashing: boolean, isOut: boolean }} ShownBody */
/** @typedef {{ bodies: Record<string, ShownBody> }} World */

/** @type {Zaisma.Room | null} */
let room = null;
const flashes = [];

function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
}
addEventListener("resize", resize);
resize();

// Input: keyboard, plus a touch stick on the left half and dash on the right half.
const keys = new Set();
let stick = null;
let lastSentInput = "";
function sendInput() {
  let inputX = 0, inputY = 0;
  if (stick) { inputX = stick.inputX; inputY = stick.inputY; }
  else {
    if (keys.has("a") || keys.has("arrowleft")) inputX -= 1;
    if (keys.has("d") || keys.has("arrowright")) inputX += 1;
    if (keys.has("w") || keys.has("arrowup")) inputY -= 1;
    if (keys.has("s") || keys.has("arrowdown")) inputY += 1;
  }
  const input = [Math.round(inputX * 10) / 10, Math.round(inputY * 10) / 10];
  const key = input.join(",");
  if (key !== lastSentInput && room) { lastSentInput = key; room.send({ input }); }
}
function dash() { if (room) room.send({ dash: true }); }
addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === " " || key === "shift") { if (!event.repeat) dash(); event.preventDefault(); return; }
  keys.add(key); sendInput();
});
addEventListener("keyup", (event) => { keys.delete(event.key.toLowerCase()); sendInput(); });
addEventListener("blur", () => { keys.clear(); sendInput(); });
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  if (event.clientX > innerWidth / 2) return dash();
  stick = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, inputX: 0, inputY: 0 };
});
canvas.addEventListener("pointermove", (event) => {
  if (!stick || event.pointerId !== stick.pointerId) return;
  const offsetX = event.clientX - stick.startX, offsetY = event.clientY - stick.startY, distance = Math.hypot(offsetX, offsetY), fullTiltPx = 50;
  stick.inputX = distance ? (offsetX / distance) * Math.min(1, distance / fullTiltPx) : 0;
  stick.inputY = distance ? (offsetY / distance) * Math.min(1, distance / fullTiltPx) : 0;
  sendInput();
});
const endStick = (event) => { if (stick && event.pointerId === stick.pointerId) { stick = null; sendInput(); } };
canvas.addEventListener("pointerup", endStick);
canvas.addEventListener("pointercancel", endStick);
if (matchMedia("(pointer: coarse)").matches) document.getElementById("help").innerHTML = "Left side: move · Right side: dash<br>Bump players off the edge";

function draw() {
  requestAnimationFrame(draw);
  const width = canvas.width, height = canvas.height;
  const scale = Math.min(width, height) / (PLATFORM_RADIUS * 2 + 80);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#0d0e10";
  context.fillRect(0, 0, width, height);
  context.setTransform(scale, 0, 0, scale, width / 2, height / 2);

  context.beginPath();
  context.arc(0, 0, PLATFORM_RADIUS, 0, Math.PI * 2);
  context.fillStyle = "#1c1e22";
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "#3a3d44";
  context.stroke();

  // The world 100 ms behind the room's clock, positions blended between the two updates around then.
  const world = /** @type {World | null} */ (room && room.smoothedState());
  if (!world) return;
  const myId = room && room.me && room.me.id;
  // Players whose connection dropped are frozen by the game server, and drawn dimmed until they're back.
  const lostIds = new Set(room ? room.players.filter((player) => player.awayReason === "lost").map((player) => player.id) : []);

  for (const [id, body] of Object.entries(world.bodies)) {
    if (body.isOut) continue;
    const { x, y } = body;
    context.globalAlpha = lostIds.has(id) ? 0.35 : 1;
    context.beginPath();
    context.arc(x, y, BODY_RADIUS, 0, Math.PI * 2);
    context.fillStyle = body.color;
    context.fill();
    if (body.isDashing) { context.lineWidth = 5; context.strokeStyle = "#fff"; context.stroke(); }
    if (id === myId) { context.lineWidth = 3; context.strokeStyle = "#fff"; context.beginPath(); context.arc(x, y, BODY_RADIUS + 7, 0, Math.PI * 2); context.stroke(); }
    context.fillStyle = "#ddd";
    context.font = "14px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(lostIds.has(id) ? `${body.name} (reconnecting…)` : body.name, x, y - BODY_RADIUS - 10);
  }
  context.globalAlpha = 1;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const flash = flashes[i];
    const age = (performance.now() - flash.startedAtMs) / 600;
    if (age > 1) { flashes.splice(i, 1); continue; }
    context.beginPath();
    context.arc(flash.x, flash.y, BODY_RADIUS + age * 60, 0, Math.PI * 2);
    context.lineWidth = 4;
    context.strokeStyle = `rgba(255,255,255,${1 - age})`;
    context.stroke();
  }
}
requestAnimationFrame(draw);

/** The scores board, redrawn only when a score, name or color changed. */
let shownBoard = "";
function showBoard(/** @type {World} */ world) {
  const bodies = Object.entries(world.bodies).sort(([, first], [, second]) => second.score - first.score);
  const board = JSON.stringify(bodies.map(([id, body]) => [id, body.name, body.score, body.color]));
  if (board === shownBoard) return;
  shownBoard = board;
  boardElement.innerHTML = "";
  for (const [id, body] of bodies) {
    const line = document.createElement("div");
    line.textContent = `${body.name}  ${body.score}`;
    line.style.color = body.color;
    if (room && room.me && id === room.me.id) line.style.fontWeight = "700";
    boardElement.append(line);
  }
}

// Mute, block and report, from the game's own menu.
document.getElementById("players").onclick = () => room && Zaisma.openSafetyPanel(room);
// Your color: picked with the Color button, kept for next time and brought into each room as join data.
const COLORS = ["#ff5d5d", "#4fc3ff", "#ffd84f", "#7dff8a", "#d07bff", "#ff9e4f", "#4fffe1", "#ff7bc4"];
const colorButton = document.getElementById("color");
let color = null;
try { color = localStorage.getItem("arena:color"); } catch { /* storage off */ }
function showColor() { colorButton.style.borderColor = color || "#444"; }
showColor();
colorButton.onclick = () => {
  color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
  try { localStorage.setItem("arena:color", color); } catch { /* fine */ }
  showColor();
  if (room) room.send({ color });
};
const inviteButton = document.getElementById("invite");
inviteButton.onclick = async () => {
  if (!room) return;
  const shared = await Zaisma.invite(room);
  if (shared === "copied") { inviteButton.textContent = "Link copied"; setTimeout(() => (inviteButton.textContent = "Invite"), 1500); }
};

// The best scores board: a request to the game server (its onRequest), outside the room. Best scores are saved as players leave.
const bestScoresElement = document.getElementById("best-scores");
document.getElementById("best").onclick = async () => {
  if (!bestScoresElement.hidden) { bestScoresElement.hidden = true; return; }
  const list = bestScoresElement.querySelector("ol");
  list.textContent = "Loading…";
  bestScoresElement.hidden = false;
  try {
    const bestScores = /** @type {{ name: string, bestScore: number, isMe: boolean }[]} */ (await Zaisma.server.request({ type: "bestScores" }));
    list.innerHTML = "";
    for (const best of bestScores) {
      const line = document.createElement("li");
      line.textContent = `${best.name}  ${best.bestScore}`;
      if (best.isMe) line.style.fontWeight = "700";
      list.append(line);
    }
    if (!bestScores.length) list.textContent = "No best scores yet. Knock someone off the edge, then leave the arena.";
  } catch (error) {
    list.textContent = error.message;
  }
};

// Friends playing now, with Join: the same Players panel as Zaisma's game bar (Zaisma.openSafetyPanel lists them).
document.getElementById("friends").onclick = () => room && Zaisma.openSafetyPanel(room);

/** @param {string} [roomCode] a friend's arena; else the linked one, a busy one or a new one */
async function start(roomCode) {
  try {
    // A drop-in game: the room the player's link points to, else a busy arena with space, else a new one.
    room = roomCode ? await Zaisma.joinRoom({ roomCode, joinData: color ? { color } : null }) : await Zaisma.rooms.quickJoin({ joinData: color ? { color } : null });
  } catch (error) {
    // The developer made multiplayer need a Zaisma account: ask the guest to sign in without leaving the game, then join as the account.
    if (error.code === "account_needed") return askToSignIn();
    statusElement.textContent = error.message;
    return;
  }
  statusElement.textContent = room.players.length < 2 ? "Practice with bots. Tap Invite to bring friends in." : "";
  setTimeout(() => { if (statusElement.textContent.startsWith("Practice")) statusElement.textContent = ""; }, 4000);
  room.on("state", (state) => showBoard(/** @type {World} */ (state)));
  room.on("message", (message) => {
    const world = /** @type {World | null} */ (room && room.state);
    const body = message.knockedOutId && world && world.bodies[message.knockedOutId];
    if (body) flashes.push({ x: body.x, y: body.y, startedAtMs: performance.now() });
  });
  // Walked away (idle, or the tab hidden for a while): out of the match, with the seat kept a few minutes. Any key brings them back.
  room.on("connectionStatus", (connectionStatus) => {
    statusElement.textContent =
      connectionStatus === "reconnecting" ? "Reconnecting…" : connectionStatus === "away" ? "You stepped away. Press any key to jump back in." : connectionStatus === "closed" ? "Disconnected. Reload to play again." : "";
  });
  room.on("ended", (message) => { statusElement.textContent = message; });
  sendInput();
}

async function askToSignIn() {
  statusElement.textContent = "Playing online needs a Zaisma account.";
  try {
    await Zaisma.player.signIn();
  } catch (error) {
    statusElement.textContent = error.code === "sign_in_declined" ? "Playing online needs a Zaisma account. Reload the game to sign in." : error.message;
    return;
  }
  start();
}
start();
