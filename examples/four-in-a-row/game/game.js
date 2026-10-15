// Four in a row client: shows the game server's board and sends the column you pick.
// "Find an opponent" waits in a lobby room until the game server pairs you with someone
// and moves you both to a match room of your own.
const boardElement = document.getElementById("board");
const infoElement = document.getElementById("info");
const playersElement = document.getElementById("players");
const afterElement = document.getElementById("after");
let room = null;
let game = null; // the game server's latest board and seats
let lobbyWaitingCount = null; // players waiting in the lobby with you, while you're in it

const cells = [];
for (let i = 0; i < 42; i++) {
  const cell = document.createElement("button");
  cell.className = "cell";
  cell.setAttribute("aria-label", `Column ${(i % 7) + 1}`);
  cell.onclick = () => room && room.send({ column: i % 7 });
  boardElement.append(cell);
  cells.push(cell);
}

function render() {
  if (lobbyWaitingCount !== null) {
    boardElement.style.opacity = 0.35;
    playersElement.innerHTML = "";
    infoElement.textContent = "Looking for an opponent…";
    afterElement.innerHTML = "";
    return;
  }
  boardElement.style.opacity = 1;
  if (!game || !room) return;
  const mySeat = game.seatPlayerIds.indexOf(room.me.id) + 1;
  cells.forEach((cell, i) => {
    cell.className = "cell" + (game.board[i] ? ` seat${game.board[i]}` : "") + (game.winningCells.includes(i) ? " win" : "");
  });
  playersElement.innerHTML = "";
  game.seatNames.forEach((name, i) => {
    const span = document.createElement("span");
    span.innerHTML = `<span class="dot seat${i + 1}"></span>`;
    span.append(name ? name + (game.isSeatPlayerHere[i] ? "" : " (away)") : "Waiting…");
    if (mySeat === i + 1) span.style.color = "#fff";
    playersElement.append(span);
  });
  const color = (seat) => (seat === 1 ? "Red" : "Yellow");
  const isOver = game.winnerSeat !== 0 || game.isDraw;
  if (!game.seatPlayerIds[1]) infoElement.textContent = "Waiting for a second player.";
  else if (game.isDraw) infoElement.textContent = "It's a draw.";
  else if (game.winnerSeat) infoElement.textContent = game.winnerSeat === mySeat ? "You win!" : `${color(game.winnerSeat)} wins.`;
  else if (!mySeat) infoElement.textContent = `Watching. ${color(game.turnSeat)} to play.`;
  else infoElement.textContent = game.turnSeat === mySeat ? "Your turn" : `${game.seatNames[game.turnSeat - 1]} is thinking…`;
  afterElement.innerHTML = "";
  if (!game.seatPlayerIds[1]) {
    const invite = document.createElement("button");
    invite.className = "again";
    invite.textContent = "Invite a friend";
    invite.onclick = async () => { if ((await Zaisma.invite(room)) === "copied") invite.textContent = "Link copied"; };
    afterElement.append(invite);
    const find = document.createElement("button");
    find.className = "again";
    find.textContent = "Find an opponent";
    find.onclick = findOpponent;
    afterElement.append(" ", find);
  }
  if (isOver && mySeat) {
    const again = document.createElement("button");
    again.className = "again";
    again.textContent = "Play again";
    again.onclick = () => room.send({ playAgain: true });
    afterElement.append(again);
  }
}

// Mute, block and report, from the game's own menu.
document.getElementById("players-button").onclick = () => room && Zaisma.openSafetyPanel(room);

function use(next) {
  room = next;
  game = null;
  lobbyWaitingCount = room.labels.Room === "Lobby" ? 0 : null;
  render();
  room.on("message", (message) => {
    if (message.lobbyWaitingCount !== undefined) lobbyWaitingCount = message.lobbyWaitingCount;
    else game = message;
    render();
  });
  room.on("connectionStatus", (connectionStatus) => {
    if (room !== next) return;
    if (connectionStatus !== "open") infoElement.textContent = connectionStatus === "reconnecting" ? "Reconnecting…" : "Disconnected. Reload to play again.";
    else render();
  });
  room.on("ended", (message) => { infoElement.textContent = message; });
  // The lobby found an opponent: leave it and join the match room it made for you both.
  room.on("move", (move) => {
    leave();
    join(() => move.join());
  });
}

async function join(how) {
  infoElement.textContent = "Connecting…";
  try {
    use(await how());
  } catch (error) {
    infoElement.textContent = error.message;
  }
}

function leave() {
  const old = room;
  room = null;
  if (old) old.leave();
}

function findOpponent() {
  leave();
  lobbyWaitingCount = 0;
  render();
  join(() => Zaisma.rooms.quickJoin({ labels: { Room: "Lobby" } }));
}

join(() => Zaisma.joinRoom());
