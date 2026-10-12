// Four in a row client: shows the game server's board and sends the column you pick.
const boardEl = document.getElementById("board");
const infoEl = document.getElementById("info");
const playersEl = document.getElementById("players");
const afterEl = document.getElementById("after");
let room = null;
let state = null;

const cells = [];
for (let i = 0; i < 42; i++) {
  const b = document.createElement("button");
  b.className = "cell";
  b.setAttribute("aria-label", `Column ${(i % 7) + 1}`);
  b.onclick = () => room && room.send({ col: i % 7 });
  boardEl.append(b);
  cells.push(b);
}

function render() {
  if (!state || !room) return;
  const mySeat = state.seats.indexOf(room.me.id) + 1;
  cells.forEach((c, i) => {
    c.className = "cell" + (state.board[i] ? ` p${state.board[i]}` : "") + (state.line.includes(i) ? " win" : "");
  });
  playersEl.innerHTML = "";
  state.names.forEach((name, i) => {
    const span = document.createElement("span");
    span.innerHTML = `<span class="dot p${i + 1}"></span>`;
    span.append(name ? name + (state.present[i] ? "" : " (away)") : "Waiting…");
    if (mySeat === i + 1) span.style.color = "#fff";
    playersEl.append(span);
  });
  const color = (n) => (n === 1 ? "Red" : "Yellow");
  if (!state.seats[1]) infoEl.textContent = "Waiting for a second player. Use Invite above.";
  else if (state.winner === 3) infoEl.textContent = "It's a draw.";
  else if (state.winner) infoEl.textContent = state.winner === mySeat ? "You win!" : `${color(state.winner)} wins.`;
  else if (!mySeat) infoEl.textContent = `Watching. ${color(state.turn)} to play.`;
  else infoEl.textContent = state.turn === mySeat ? "Your turn" : `${state.names[state.turn - 1]} is thinking…`;
  afterEl.innerHTML = "";
  if (state.winner && mySeat) {
    const again = document.createElement("button");
    again.className = "again";
    again.textContent = "Play again";
    again.onclick = () => room.send({ again: true });
    afterEl.append(again);
  }
}

async function start() {
  try {
    room = await Zaisma.joinRoom();
  } catch (err) {
    infoEl.textContent = err.message;
    return;
  }
  room.on("message", (m) => { state = m; render(); });
  room.on("status", (s) => { if (s !== "open") infoEl.textContent = s === "reconnecting" ? "Reconnecting…" : "Disconnected. Reload to play again."; else render(); });
  room.on("ended", (reason) => { infoEl.textContent = reason; });
}
start();
