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
let snaps = []; // [{ at, bodies: Map(id -> [x, y, score, dashing, out, name, color]) }]
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
  if (key !== sent && room) { sent = key; room.send({ i: v }); }
}
function dash() { if (room) room.send({ d: 1 }); }
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
    if (cur[4]) continue; // out
    const x = prev[0] + (cur[0] - prev[0]) * k;
    const y = prev[1] + (cur[1] - prev[1]) * k;
    ctx.beginPath();
    ctx.arc(x, y, BODY, 0, Math.PI * 2);
    ctx.fillStyle = cur[6];
    ctx.fill();
    if (cur[3]) { ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    if (id === meId) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, BODY + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = "#ddd";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(cur[5], x, y - BODY - 10);
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

function onSnapshot(list) {
  const bodies = new Map(list.map((r) => [r[0], r.slice(1)]));
  snaps.push({ at: performance.now(), bodies });
  if (snaps.length > 10) snaps.shift();
  const rows = [...list].sort((x, y) => y[3] - x[3]);
  boardEl.innerHTML = "";
  for (const r of rows) {
    const line = document.createElement("div");
    line.textContent = `${r[6]}  ${r[3]}`;
    line.style.color = r[7];
    if (room && room.me && r[0] === room.me.id) line.style.fontWeight = "700";
    boardEl.append(line);
  }
}

// Mute, block and report, from the game's own menu.
document.getElementById("players").onclick = () => room && Zaisma.openSafetyPanel(room);
const inviteBtn = document.getElementById("invite");
inviteBtn.onclick = async () => {
  if (!room) return;
  const result = await Zaisma.invite(room);
  if (result === "copied") { inviteBtn.textContent = "Link copied"; setTimeout(() => (inviteBtn.textContent = "Invite"), 1500); }
};

async function start() {
  try {
    room = await Zaisma.joinRoom();
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }
  statusEl.textContent = room.players.length < 2 ? "Practice with bots. Tap Invite to bring friends in." : "";
  setTimeout(() => { if (statusEl.textContent.startsWith("Practice")) statusEl.textContent = ""; }, 4000);
  room.on("message", (m) => {
    if (m.s) onSnapshot(m.s);
    if (m.ko) {
      const last = snaps.at(-1);
      const body = last && last.bodies.get(m.ko);
      if (body) flashes.push({ x: body[0], y: body[1], at: performance.now() });
    }
  });
  room.on("status", (s) => {
    statusEl.textContent = s === "reconnecting" ? "Reconnecting…" : s === "closed" ? "Disconnected. Reload to play again." : "";
  });
  room.on("ended", (reason) => { statusEl.textContent = reason; });
  input();
}
start();
