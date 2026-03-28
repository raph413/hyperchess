export const CD = 3000;

export const GL = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

export const INIT_BOARD = [
  ['bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR'],
  ['bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP'],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ['wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP'],
  ['wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR']
];

const isWhite = piece => piece && piece[0] === 'w';
const isBlack = piece => piece && piece[0] === 'b';
const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

export function copyBoard() {
  return INIT_BOARD.map(row => row.slice());
}

export function createGameState() {
  return {
    board: copyBoard(),
    cooldowns: {},
    scores: { white: 0, black: 0 },
    winner: null,
    winReason: '',
    lastMove: null
  };
}

export function getMoves(board, r, c) {
  const piece = board[r]?.[c];
  if (!piece) return [];

  const type = piece[1];
  const color = piece[0];
  const ally = color === 'w' ? isWhite : isBlack;
  const enemy = color === 'w' ? isBlack : isWhite;
  const moves = [];

  const add = (nr, nc) => {
    if (inBounds(nr, nc) && !ally(board[nr][nc])) {
      moves.push([nr, nc]);
    }
  };

  const slide = (dr, dc) => {
    let nr = r + dr;
    let nc = c + dc;

    while (inBounds(nr, nc)) {
      if (ally(board[nr][nc])) break;
      moves.push([nr, nc]);
      if (enemy(board[nr][nc])) break;
      nr += dr;
      nc += dc;
    }
  };

  if (type === 'P') {
    const direction = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;

    if (inBounds(r + direction, c) && !board[r + direction][c]) {
      moves.push([r + direction, c]);
      if (r === startRow && !board[r + 2 * direction][c]) {
        moves.push([r + 2 * direction, c]);
      }
    }

    [[r + direction, c - 1], [r + direction, c + 1]].forEach(([nr, nc]) => {
      if (inBounds(nr, nc) && enemy(board[nr][nc])) {
        moves.push([nr, nc]);
      }
    });
  }

  if (type === 'N') {
    [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
      .forEach(([dr, dc]) => add(r + dr, c + dc));
  }

  if (type === 'B' || type === 'Q') {
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dr, dc]) => slide(dr, dc));
  }

  if (type === 'R' || type === 'Q') {
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => slide(dr, dc));
  }

  if (type === 'K') {
    [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
      .forEach(([dr, dc]) => add(r + dr, c + dc));
  }

  return moves;
}

export function isOnCooldown(state, r, c, now = Date.now()) {
  const key = r * 8 + c;
  return Boolean(state.cooldowns[key] && now < state.cooldowns[key]);
}

export function getMoveNotation(row, col) {
  return String.fromCharCode(97 + col) + (8 - row);
}

export function makeMove(state, playerColor, fromRow, fromCol, toRow, toCol, now = Date.now()) {
  if (state.winner) {
    return { ok: false, error: 'Game is already over.' };
  }

  if (!inBounds(fromRow, fromCol) || !inBounds(toRow, toCol)) {
    return { ok: false, error: 'Move is out of bounds.' };
  }

  const piece = state.board[fromRow][fromCol];
  if (!piece) {
    return { ok: false, error: 'No piece on the selected square.' };
  }

  if (piece[0] !== playerColor) {
    return { ok: false, error: 'That piece belongs to the other player.' };
  }

  if (isOnCooldown(state, fromRow, fromCol, now)) {
    return { ok: false, error: 'This piece is cooling down.' };
  }

  const legalMoves = getMoves(state.board, fromRow, fromCol);
  const isLegal = legalMoves.some(([r, c]) => r === toRow && c === toCol);
  if (!isLegal) {
    return { ok: false, error: 'Illegal move.' };
  }

  const captured = state.board[toRow][toCol];
  state.board[toRow][toCol] = piece;
  state.board[fromRow][fromCol] = null;

  if (state.board[toRow][toCol][1] === 'P') {
    if (toRow === 0) state.board[toRow][toCol] = 'wQ';
    if (toRow === 7) state.board[toRow][toCol] = 'bQ';
  }

  state.cooldowns[toRow * 8 + toCol] = now + CD;
  delete state.cooldowns[fromRow * 8 + fromCol];

  let event = {
    player: playerColor,
    piece: state.board[toRow][toCol],
    from: [fromRow, fromCol],
    to: [toRow, toCol],
    captured,
    notation: getMoveNotation(toRow, toCol),
    winner: null
  };

  if (captured) {
    if (captured[0] === 'w') state.scores.black += 1;
    else state.scores.white += 1;

    if (captured[1] === 'K') {
      state.winner = playerColor;
      state.winReason = 'King captured!';
      event.winner = playerColor;
    }
  }

  state.lastMove = {
    ...event,
    at: now
  };

  return { ok: true, event };
}

export function cloneState(state) {
  return {
    board: state.board.map(row => row.slice()),
    cooldowns: { ...state.cooldowns },
    scores: { ...state.scores },
    winner: state.winner,
    winReason: state.winReason,
    lastMove: state.lastMove ? { ...state.lastMove } : null
  };
}
