// Four in a row game server: turn-based, two players, everyone else watches.
// It has no ticksPerSec, so the room sleeps between moves and costs almost nothing.
// A room labelled Room: Lobby is where players find an opponent: each pair gets a match
// room of their own (room.reserve), which starts with both seats taken. A player whose
// connection drops keeps their seat for the room's reconnectTimeoutSec (30 seconds):
// their opponent waits, and their game shows them reconnecting.
import type { GameServer, Player, Room } from "@zaisma/game-server";

const COLUMN_COUNT = 7;
const ROW_COUNT = 6;

/** Seat 1 plays red and seat 2 yellow; 0 is nobody. */
type Seat = 0 | 1 | 2;

interface State {
  /** ROW_COUNT * COLUMN_COUNT cells, top row first: the seat whose piece is there, or 0. */
  board: Seat[];
  seatPlayerIds: [string | null, string | null];
  seatNames: [string, string];
  turnSeat: 1 | 2;
  winnerSeat: Seat;
  isDraw: boolean;
  /** The cells of the winning line, for the game to light up. */
  winningCells: number[];
  firstSeatNext: 1 | 2;
  /** In the lobby: players already sent to a match. */
  pairedPlayerIds: string[];
}

const LOBBY = "Lobby";

/** Who a lobby made a match for: room.reserve's setupData. */
interface Match {
  seatPlayerIds: [string, string];
  seatNames: [string, string];
}

/** What players send: a column to drop a piece in, or a new game once one is over. */
interface PlayerMessage {
  column?: unknown;
  playAgain?: unknown;
}

function freshGame(firstSeat: 1 | 2): Pick<State, "board" | "turnSeat" | "winnerSeat" | "isDraw" | "winningCells"> {
  return { board: Array(ROW_COUNT * COLUMN_COUNT).fill(0), turnSeat: firstSeat, winnerSeat: 0, isDraw: false, winningCells: [] };
}

function findLine(board: Seat[], placedIndex: number): number[] {
  const seat = board[placedIndex];
  const startRow = Math.floor(placedIndex / COLUMN_COUNT);
  const startColumn = placedIndex % COLUMN_COUNT;
  for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line = [placedIndex];
    for (const direction of [1, -1]) {
      let row = startRow + rowStep * direction;
      let column = startColumn + columnStep * direction;
      while (row >= 0 && row < ROW_COUNT && column >= 0 && column < COLUMN_COUNT && board[row * COLUMN_COUNT + column] === seat) {
        line.push(row * COLUMN_COUNT + column);
        row += rowStep * direction;
        column += columnStep * direction;
      }
    }
    if (line.length >= 4) return line;
  }
  return [];
}

function share(state: State, room: Room): void {
  const here = new Set(room.players.map((player) => player.id));
  room.broadcast({
    board: state.board,
    seatPlayerIds: state.seatPlayerIds,
    seatNames: state.seatNames,
    isSeatPlayerHere: state.seatPlayerIds.map((id) => (id ? here.has(id) : false)),
    turnSeat: state.turnSeat,
    winnerSeat: state.winnerSeat,
    isDraw: state.isDraw,
    winningCells: state.winningCells,
  });
}

/** The two players who've waited longest get a match room of their own, and move there. Players whose connection dropped wait until they're back. */
function pair(state: State, room: Room): void {
  const waiting = room.players.filter((player) => !state.pairedPlayerIds.includes(player.id) && room.awayReason(player.id) === null);
  while (waiting.length >= 2) {
    const [first, second] = waiting.splice(0, 2) as [Player, Player];
    room.reserve({ playerIds: [first.id, second.id], setupData: { seatPlayerIds: [first.id, second.id], seatNames: [first.name, second.name] } satisfies Match });
    state.pairedPlayerIds.push(first.id, second.id);
  }
  room.broadcast({ lobbyWaitingCount: waiting.length });
}

const fourInARow: GameServer<State> = {
  maximumPlayerCount: 8,

  setup(setupData) {
    const match = setupData as Match | null;
    return {
      ...freshGame(1),
      seatPlayerIds: match ? match.seatPlayerIds : [null, null],
      seatNames: match ? match.seatNames : ["", ""],
      firstSeatNext: 2,
      pairedPlayerIds: [],
    };
  },

  onJoin(state, player: Player, room) {
    if (room.labels.Room === LOBBY) return pair(state, room);
    // Someone coming back keeps their seat. Otherwise take a free seat, or one whose player has gone.
    if (!state.seatPlayerIds.includes(player.id)) {
      const here = new Set(room.players.map((inRoom) => inRoom.id));
      const seatIndex = state.seatPlayerIds.findIndex((id) => id === null || !here.has(id));
      if (seatIndex !== -1) {
        state.seatPlayerIds[seatIndex] = player.id;
        state.seatNames[seatIndex] = player.name;
      }
    }
    share(state, room);
  },

  onLeave(state, player, room) {
    if (room.labels.Room === LOBBY) {
      state.pairedPlayerIds = state.pairedPlayerIds.filter((id) => id !== player.id);
      return pair(state, room);
    }
    share(state, room);
  },

  // Back after a dropped connection: in the lobby they can be paired again; in a match, they get the board as it is now.
  onBack(state, player, room) {
    if (room.labels.Room === LOBBY) return pair(state, room);
    share(state, room);
  },

  onMessage(state, player, message, room) {
    const sent = (message ?? {}) as PlayerMessage;
    if (room.labels.Room === LOBBY) return;
    const seatIndex = state.seatPlayerIds.indexOf(player.id);
    if (seatIndex === -1) return;
    const mySeat = (seatIndex + 1) as 1 | 2;
    const isOver = state.winnerSeat !== 0 || state.isDraw;

    if (sent.playAgain === true && isOver) {
      Object.assign(state, freshGame(state.firstSeatNext));
      state.firstSeatNext = state.firstSeatNext === 1 ? 2 : 1;
      return share(state, room);
    }
    const column = Number(sent.column);
    if (isOver || state.turnSeat !== mySeat || !Number.isInteger(column) || column < 0 || column >= COLUMN_COUNT) return;
    let placedIndex = -1;
    for (let row = ROW_COUNT - 1; row >= 0; row--) {
      if (state.board[row * COLUMN_COUNT + column] === 0) {
        placedIndex = row * COLUMN_COUNT + column;
        break;
      }
    }
    if (placedIndex === -1) return;
    state.board[placedIndex] = mySeat;
    state.winningCells = findLine(state.board, placedIndex);
    if (state.winningCells.length) state.winnerSeat = mySeat;
    else if (state.board.every((cell) => cell !== 0)) state.isDraw = true;
    else state.turnSeat = mySeat === 1 ? 2 : 1;
    share(state, room);
  },
};

export default fourInARow;
