// Arena client: sends input when it changes and draws the game server's
// snapshots, smoothed by drawing slightly in the past between two snapshots.
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const RADIUS = 360;
const BODY = 18;
const DELAY = 100; // ms behind the newest snapshot

let room = null;
let snaps = []; // [{ at, bodies: Map(playerId -> { x, y, score, isDashing, isOut, name, color }) }]
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
let sent = "";
function input() {
  let x = 0, y = 0;
  if (stick) { x = stick.x; y = stick.y; }
  else {
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    if (keys.has("w") || keys.has("arrowup")) y -= 1;
    if (keys.has("s") || keys.has("arrowdown")) y += 1;
  }
  const v = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  const key = v.join(",");
  if (key !== sent && room) { sent = key; room.send({ input: v }); }
}
function dash() { if (room) room.send({ dash: true }); }
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " || k === "shift") { if (!e.repeat) dash(); e.preventDefault(); return; }
  keys.add(k); input();
});
addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); input(); });
addEventListener("blur", () => { keys.clear(); input(); });
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  if (e.clientX > innerWidth / 2) return dash();
  stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
});
canvas.addEventListener("pointermove", (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, d = Math.hypot(dx, dy), max = 50;
  stick.x = d ? (dx / d) * Math.min(1, d / max) : 0;
  stick.y = d ? (dy / d) * Math.min(1, d / max) : 0;
  input();
});
const endStick = (e) => { if (stick && e.pointerId === stick.id) { stick = null; input(); } };
canvas.addEventListener("pointerup", endStick);
canvas.addEventListener("pointercancel", endStick);
if (matchMedia("(pointer: coarse)").matches) document.getElementById("help").innerHTML = "Left side: move · Right side: dash<br>Bump players off the edge";

function draw() {
  requestAnimationFrame(draw);
  const w = canvas.width, h = canvas.height;
  const scale = Math.min(w, h) / (RADIUS * 2 + 80);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0d0e10";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(scale, 0, 0, scale, w / 2, h / 2);

  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#1c1e22";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#3a3d44";
  ctx.stroke();

  // Pick the two snapshots around (now - DELAY) and blend between them.
  const t = performance.now() - DELAY;
  let a = snaps[0], b = snaps[0];
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].at <= t && snaps[i + 1].at >= t) { a = snaps[i]; b = snaps[i + 1]; break; }
    if (snaps[i + 1].at < t) { a = b = snaps[i + 1]; }
  }
  if (!a) return;
  const k = b === a ? 0 : Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)));
  const meId = room && room.me && room.me.id;

  for (const [id, cur] of b.bodies) {
    const prev = a.bodies.get(id) || cur;
    if (cur.isOut) continue;
    const x = prev.x + (cur.x - prev.x) * k;
    const y = prev.y + (cur.y - prev.y) * k;
    ctx.beginPath();
    ctx.arc(x, y, BODY, 0, Math.PI * 2);
    ctx.fillStyle = cur.color;
    ctx.fill();
    if (cur.isDashing) { ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    if (id === meId) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, BODY + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = "#ddd";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(cur.name, x, y - BODY - 10);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = (performance.now() - f.at) / 600;
    if (age > 1) { flashes.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(f.x, f.y, BODY + age * 60, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255,255,255,${1 - age})`;
    ctx.stroke();
  }
}
requestAnimationFrame(draw);

function onSnapshot(snapshot) {
  const bodies = new Map(snapshot.map((body) => [body.playerId, body]));
  snaps.push({ at: performance.now(), bodies });
  if (snaps.length > 10) snaps.shift();
  const rows = [...snapshot].sort((first, second) => second.score - first.score);
  boardEl.innerHTML = "";
  for (const body of rows) {
    const line = document.createElement("div");
    line.textContent = `${body.name}  ${body.score}`;
    line.style.color = body.color;
    if (room && room.me && body.playerId === room.me.id) line.style.fontWeight = "700";
    boardEl.append(line);
  }
}

// Mute, block and report, from the game's own menu.
document.getElementById("players").onclick = () => room && Zaisma.openSafetyPanel(room);
// Your color: picked with the Color button, kept for next time and brought into each room as join data.
const COLORS = ["#ff5d5d", "#4fc3ff", "#ffd84f", "#7dff8a", "#d07bff", "#ff9e4f", "#4fffe1", "#ff7bc4"];
const colorBtn = document.getElementById("color");
let color = null;
try { color = localStorage.getItem("arena:color"); } catch (e) { /* storage off */ }
function showColor() { colorBtn.style.borderColor = color || "#444"; }
showColor();
colorBtn.onclick = () => {
  color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
  try { localStorage.setItem("arena:color", color); } catch (e) { /* fine */ }
  showColor();
  if (room) room.send({ color });
};
const inviteBtn = document.getElementById("invite");
inviteBtn.onclick = async () => {
  if (!room) return;
  const result = await Zaisma.invite(room);
  if (result === "copied") { inviteBtn.textContent = "Link copied"; setTimeout(() => (inviteBtn.textContent = "Invite"), 1500); }
};

async function start() {
  try {
    // A drop-in game: the room the player's link points to, else a busy arena with space, else a new one.
    room = await Zaisma.rooms.quickJoin({ joinData: color ? { color } : undefined });
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }
  statusEl.textContent = room.players.length < 2 ? "Practice with bots. Tap Invite to bring friends in." : "";
  setTimeout(() => { if (statusEl.textContent.startsWith("Practice")) statusEl.textContent = ""; }, 4000);
  room.on("message", (messageData) => {
    if (messageData.snapshot) onSnapshot(messageData.snapshot);
    if (messageData.knockedOutPlayerId) {
      const last = snaps.at(-1);
      const body = last && last.bodies.get(messageData.knockedOutPlayerId);
      if (body) flashes.push({ x: body.x, y: body.y, at: performance.now() });
    }
  });
  // Walked away (idle, or the tab hidden for a while): out of the match, with the seat kept a few minutes. Any key brings them back.
  room.on("connection_status", (connectionStatus) => {
    statusEl.textContent =
      connectionStatus === "reconnecting" ? "Reconnecting…" : connectionStatus === "away" ? "You stepped away. Press any key to jump back in." : connectionStatus === "closed" ? "Disconnected. Reload to play again." : "";
  });
  room.on("ended", (message) => { statusEl.textContent = message; });
  input();
}
start();
