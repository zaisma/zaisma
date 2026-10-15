// Four in a row game server: turn-based, two players, everyone else watches.
// It has no ticksPerSec, so the room sleeps between moves and costs almost nothing.
// A room labelled Room: Lobby is where players find an opponent: each pair gets a match
// room of their own (room.reserve), which starts with both seats taken.
//
// Messages, in whole words (rooms are billed per message, not by size):
//   from players: { column: 0 to 6 }, { playAgain: true }
//   to players:   the match: { board, seatPlayerIds, seatNames, isSeatPresent, turnSeat, winnerSeat, isDraw, winningLine }
//                 in the lobby: { waitingPlayerCount }
import type { GameServer, Player, Room } from "@zaisma/game-server";

const COLUMN_COUNT = 7;
const ROW_COUNT = 6;

type Seat = 1 | 2;

interface State {
  /** ROW_COUNT * COLUMN_COUNT cells, top row first: 0 empty, else the seat whose piece it is. */
  board: (0 | Seat)[];
  seatPlayerIds: [string | null, string | null];
  seatNames: [string, string];
  turnSeat: Seat;
  winnerSeat: Seat | null;
  isDraw: boolean;
  /** The cells of the winning four (or more), once there is one. */
  winningLine: number[];
  nextFirstSeat: Seat;
  /** In the lobby: players already sent to a match. */
  pairedPlayerIds: string[];
}

const LOBBY = "Lobby";

/** Who a lobby made a match for: room.reserve's startData. */
interface Match {
  seatPlayerIds: [string, string];
  seatNames: [string, string];
}

function freshBoard(firstSeat: Seat): Pick<State, "board" | "turnSeat" | "winnerSeat" | "isDraw" | "winningLine"> {
  return { board: Array(ROW_COUNT * COLUMN_COUNT).fill(0), turnSeat: firstSeat, winnerSeat: null, isDraw: false, winningLine: [] };
}

function findLine(board: State["board"], cell: number): number[] {
  const seat = board[cell];
  const startRow = Math.floor(cell / COLUMN_COUNT);
  const startColumn = cell % COLUMN_COUNT;
  for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line = [cell];
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
    isSeatPresent: state.seatPlayerIds.map((id) => (id ? here.has(id) : false)),
    turnSeat: state.turnSeat,
    winnerSeat: state.winnerSeat,
    isDraw: state.isDraw,
    winningLine: state.winningLine,
  });
}

/** The two players who've waited longest get a match room of their own, and move there. */
function pair(state: State, room: Room): void {
  const waiting = room.players.filter((player) => !state.pairedPlayerIds.includes(player.id));
  while (waiting.length >= 2) {
    const [first, second] = waiting.splice(0, 2) as [Player, Player];
    room.reserve({ playerIds: [first.id, second.id], startData: { seatPlayerIds: [first.id, second.id], seatNames: [first.name, second.name] } satisfies Match });
    state.pairedPlayerIds.push(first.id, second.id);
  }
  room.broadcast({ waitingPlayerCount: waiting.length });
}

const fourInARow: GameServer<State> = {
  maximumPlayerCount: 8,

  setup(startData) {
    const match = startData as Match | undefined;
    return {
      ...freshBoard(1),
      seatPlayerIds: match ? match.seatPlayerIds : [null, null],
      seatNames: match ? match.seatNames : ["", ""],
      nextFirstSeat: 2,
      pairedPlayerIds: [],
    };
  },

  onJoin(state, player: Player, room) {
    if (room.labels.Room === LOBBY) return pair(state, room);
    // Someone coming back keeps their seat. Otherwise take a free seat, or one whose player has gone.
    if (!state.seatPlayerIds.includes(player.id)) {
      const here = new Set(room.players.map((other) => other.id));
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

  onMessage(state, player, messageData, room) {
    const message = (messageData ?? {}) as { column?: unknown; playAgain?: unknown };
    if (room.labels.Room === LOBBY) return;
    const seatIndex = state.seatPlayerIds.indexOf(player.id);
    if (seatIndex === -1) return;
    const mySeat = (seatIndex + 1) as Seat;
    const isOver = state.winnerSeat !== null || state.isDraw;

    if (message.playAgain === true && isOver) {
      Object.assign(state, freshBoard(state.nextFirstSeat));
      state.nextFirstSeat = state.nextFirstSeat === 1 ? 2 : 1;
      return share(state, room);
    }
    const column = Number(message.column);
    if (isOver || state.turnSeat !== mySeat || !Number.isInteger(column) || column < 0 || column >= COLUMN_COUNT) return;
    let cell = -1;
    for (let row = ROW_COUNT - 1; row >= 0; row--) {
      if (state.board[row * COLUMN_COUNT + column] === 0) {
        cell = row * COLUMN_COUNT + column;
        break;
      }
    }
    if (cell === -1) return;
    state.board[cell] = mySeat;
    state.winningLine = findLine(state.board, cell);
    if (state.winningLine.length) state.winnerSeat = mySeat;
    else if (state.board.every((value) => value !== 0)) state.isDraw = true;
    else state.turnSeat = mySeat === 1 ? 2 : 1;
    share(state, room);
  },
};

export default fourInARow;
