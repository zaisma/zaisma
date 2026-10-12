// Four in a row game server: turn-based, two players, everyone else watches.
// It has no tickRate, so the room sleeps between moves and costs almost nothing.
import type { GameServer, Player, Room } from "@zaisma/game-server";

const COLS = 7;
const ROWS = 6;

interface State {
  board: number[]; // ROWS * COLS, 0 empty, 1 or 2
  seats: [string | null, string | null];
  names: [string, string];
  turn: 1 | 2;
  winner: 0 | 1 | 2 | 3; // 3 = draw
  line: number[];
  firstNext: 1 | 2;
}

function fresh(first: 1 | 2): Pick<State, "board" | "turn" | "winner" | "line"> {
  return { board: Array(ROWS * COLS).fill(0), turn: first, winner: 0, line: [] };
}

function findLine(board: number[], at: number): number[] {
  const who = board[at];
  const r0 = Math.floor(at / COLS);
  const c0 = at % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line = [at];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === who) {
        line.push(r * COLS + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (line.length >= 4) return line;
  }
  return [];
}

function share(state: State, room: Room): void {
  const here = new Set(room.players.map((p) => p.id));
  room.broadcast({
    board: state.board,
    seats: state.seats,
    names: state.names,
    present: state.seats.map((id) => (id ? here.has(id) : false)),
    turn: state.turn,
    winner: state.winner,
    line: state.line,
  });
}

const fourInARow: GameServer<State> = {
  maxPlayers: 8,

  setup: () => ({ ...fresh(1), seats: [null, null], names: ["", ""], firstNext: 2 }),

  onJoin(state, player: Player, room) {
    // Someone coming back keeps their seat. Otherwise take a free seat, or one whose player has gone.
    if (!state.seats.includes(player.id)) {
      const here = new Set(room.players.map((p) => p.id));
      const seat = state.seats.findIndex((id) => id === null || !here.has(id));
      if (seat !== -1) {
        state.seats[seat] = player.id;
        state.names[seat] = player.name;
      }
    }
    share(state, room);
  },

  onLeave(state, _player, room) {
    share(state, room);
  },

  onMessage(state, player, msg, room) {
    const m = (msg ?? {}) as { col?: unknown; again?: unknown };
    const seat = state.seats.indexOf(player.id);
    if (seat === -1) return;
    const me = (seat + 1) as 1 | 2;

    if (m.again && state.winner) {
      Object.assign(state, fresh(state.firstNext));
      state.firstNext = state.firstNext === 1 ? 2 : 1;
      return share(state, room);
    }
    const col = Number(m.col);
    if (state.winner || state.turn !== me || !Number.isInteger(col) || col < 0 || col >= COLS) return;
    let at = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (state.board[r * COLS + col] === 0) {
        at = r * COLS + col;
        break;
      }
    }
    if (at === -1) return;
    state.board[at] = me;
    state.line = findLine(state.board, at);
    if (state.line.length) state.winner = me;
    else if (state.board.every((v) => v !== 0)) state.winner = 3;
    else state.turn = me === 1 ? 2 : 1;
    share(state, room);
  },
};

export default fourInARow;
