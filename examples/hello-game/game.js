// Shard Dodge: a tiny demo game for Zaisma. Dodge the falling shards.
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const msg = document.getElementById("msg");

let w, h, dpr;
function resize() {
  dpr = window.devicePixelRatio || 1;
  w = innerWidth;
  h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

let best = 0;
try { best = Number(localStorage.getItem("best")) || 0; } catch {}
bestEl.textContent = best ? `Best ${best}` : "";

const player = { x: 0, y: 0, r: 14, tx: null };
let shards = [], score = 0, playing = false, last = 0, spawn = 0, keys = {};

function start() {
  shards = [];
  score = 0;
  spawn = 0;
  player.x = w / 2;
  player.y = h - 60;
  player.tx = null;
  playing = true;
  msg.style.display = "none";
}

function end() {
  playing = false;
  if (score > best) {
    best = score;
    try { localStorage.setItem("best", String(best)); } catch {}
  }
  bestEl.textContent = `Best ${best}`;
  msg.innerHTML = `${score}<small>Tap to play again</small>`;
  msg.style.display = "flex";
}

addEventListener("keydown", (e) => { keys[e.key] = true; if (!playing && (e.key === " " || e.key === "Enter")) start(); });
addEventListener("keyup", (e) => { keys[e.key] = false; });
addEventListener("pointerdown", (e) => { if (!playing) start(); player.tx = e.clientX; });
addEventListener("pointermove", (e) => { if (playing && (e.buttons || e.pointerType === "mouse")) player.tx = e.clientX; });

function shard() {
  const size = 10 + Math.random() * 22;
  return { x: Math.random() * w, y: -size, size, vy: 140 + Math.random() * 120 + score * 4, spin: Math.random() * 6, a: 0 };
}

function step(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0);
  last = t;
  ctx.fillStyle = "#111214";
  ctx.fillRect(0, 0, w, h);

  if (playing) {
    const speed = 420;
    if (keys.ArrowLeft || keys.a) { player.x -= speed * dt; player.tx = null; }
    if (keys.ArrowRight || keys.d) { player.x += speed * dt; player.tx = null; }
    if (player.tx !== null) player.x += (player.tx - player.x) * Math.min(1, dt * 12);
    player.x = Math.max(player.r, Math.min(w - player.r, player.x));

    spawn -= dt;
    if (spawn <= 0) { shards.push(shard()); spawn = Math.max(0.12, 0.6 - score * 0.01); }
    for (const s of shards) { s.y += s.vy * dt; s.a += s.spin * dt; }
    const before = shards.length;
    shards = shards.filter((s) => s.y < h + 40);
    score += before - shards.length;
    scoreEl.textContent = score;
    if (shards.some((s) => Math.hypot(s.x - player.x, s.y - player.y) < s.size * 0.6 + player.r)) end();
  }

  for (const s of shards) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.fillStyle = "#d8dadf";
    ctx.beginPath();
    ctx.moveTo(0, -s.size);
    ctx.lineTo(s.size * 0.45, s.size * 0.6);
    ctx.lineTo(-s.size * 0.45, s.size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (playing) {
    ctx.fillStyle = "#5fd38d";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(step);
}
requestAnimationFrame(step);
