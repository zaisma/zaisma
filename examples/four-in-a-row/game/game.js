// Four in a row client: shows the game server's board and sends the column you pick.
// "Find an opponent" waits in a lobby room until the game server pairs you with someone
// and moves you both to a match room of your own.
const boardEl = document.getElementById("board");
const infoEl = document.getElementById("info");
const playersEl = document.getElementById("players");
const afterEl = document.getElementById("after");
let room = null;
let state = null;
let lobby = null; // players waiting in the lobby with you, while you're in it

const cells = [];
for (let i = 0; i < 42; i++) {
  const b = document.createElement("button");
  b.className = "cell";
  b.setAttribute("aria-label", `Column ${(i % 7) + 1}`);
  b.onclick = () => room && room.send({ column: i % 7 });
  boardEl.append(b);
  cells.push(b);
}

function render() {
  if (lobby !== null) {
    boardEl.style.opacity = 0.35;
    playersEl.innerHTML = "";
    infoEl.textContent = "Looking for an opponent…";
    afterEl.innerHTML = "";
    return;
  }
  boardEl.style.opacity = 1;
  if (!state || !room) return;
  const mySeat = state.seatPlayerIds.indexOf(room.me.id) + 1;
  cells.forEach((c, i) => {
    c.className = "cell" + (state.board[i] ? ` p${state.board[i]}` : "") + (state.winningLine.includes(i) ? " win" : "");
  });
  playersEl.innerHTML = "";
  state.seatNames.forEach((name, i) => {
    const span = document.createElement("span");
    span.innerHTML = `<span class="dot p${i + 1}"></span>`;
    span.append(name ? name + (state.isSeatPresent[i] ? "" : " (away)") : "Waiting…");
    if (mySeat === i + 1) span.style.color = "#fff";
    playersEl.append(span);
  });
  const color = (n) => (n === 1 ? "Red" : "Yellow");
  if (!state.seatPlayerIds[1]) infoEl.textContent = "Waiting for a second player.";
  else if (state.isDraw) infoEl.textContent = "It's a draw.";
  else if (state.winnerSeat) infoEl.textContent = state.winnerSeat === mySeat ? "You win!" : `${color(state.winnerSeat)} wins.`;
  else if (!mySeat) infoEl.textContent = `Watching. ${color(state.turnSeat)} to play.`;
  else infoEl.textContent = state.turnSeat === mySeat ? "Your turn" : `${state.seatNames[state.turnSeat - 1]} is thinking…`;
  afterEl.innerHTML = "";
  if (!state.seatPlayerIds[1]) {
    const inv = document.createElement("button");
    inv.className = "again";
    inv.textContent = "Invite a friend";
    inv.onclick = async () => { if ((await Zaisma.invite(room)) === "copied") inv.textContent = "Link copied"; };
    afterEl.append(inv);
    const find = document.createElement("button");
    find.className = "again";
    find.textContent = "Find an opponent";
    find.onclick = findOpponent;
    afterEl.append(" ", find);
  }
  if ((state.winnerSeat || state.isDraw) && mySeat) {
    const again = document.createElement("button");
    again.className = "again";
    again.textContent = "Play again";
    again.onclick = () => room.send({ playAgain: true });
    afterEl.append(again);
  }
}

// Mute, block and report, from the game's own menu.
document.getElementById("players-btn").onclick = () => room && Zaisma.openSafetyPanel(room);

function use(next) {
  room = next;
  state = null;
  lobby = room.labels.Room === "Lobby" ? 0 : null;
  render();
  room.on("message", (messageData) => {
    if (messageData.waitingPlayerCount !== undefined) lobby = messageData.waitingPlayerCount;
    else state = messageData;
    render();
  });
  room.on("connection_status", (connectionStatus) => {
    if (room !== next) return;
    if (connectionStatus !== "open") infoEl.textContent = connectionStatus === "reconnecting" ? "Reconnecting…" : "Disconnected. Reload to play again.";
    else render();
  });
  room.on("ended", (message) => { infoEl.textContent = message; });
  // The lobby found an opponent: leave it and join the match room it made for you both.
  room.on("move", (move) => {
    leave();
    join(() => move.join());
  });
}

async function join(how) {
  infoEl.textContent = "Connecting…";
  try {
    use(await how());
  } catch (err) {
    infoEl.textContent = err.message;
  }
}

function leave() {
  const old = room;
  room = null;
  if (old) old.leave();
}

function findOpponent() {
  leave();
  lobby = 0;
  render();
  join(() => Zaisma.rooms.quickJoin({ labels: { Room: "Lobby" } }));
}

join(() => Zaisma.joinRoom());
