import { crazyGameplayStart, crazyGameplayStop, crazyHappytime } from './crazygames.js';
import { getSelectedTheme } from './shop-core.js';

const CD = 3000;

export const GL = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

export const INIT_BOARD = [
  ['bR','bN','bB','bQ','bK','bB','bN','bR'],
  ['bP','bP','bP','bP','bP','bP','bP','bP'],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  ['wP','wP','wP','wP','wP','wP','wP','wP'],
  ['wR','wN','wB','wQ','wK','wB','wN','wR'],
];

const isW = piece => piece && piece[0] === 'w';
const isB = piece => piece && piece[0] === 'b';
const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

let board;
let cds;
let selW;
let selB;
let scW;
let scB;
let dead;
let sqEls = [];
let tickInterval = null;
let ui = null;

function getUI() {
  if (ui) return ui;

  ui = {
    board: document.getElementById('board'),
    log: document.getElementById('glog'),
    scoreWhite: document.getElementById('sw'),
    scoreBlack: document.getElementById('sb'),
    winScreen: document.getElementById('win-screen'),
    winTitle: document.getElementById('win-title'),
    winSub: document.getElementById('win-sub'),
    whiteBar: document.getElementById('bw'),
    blackBar: document.getElementById('bb'),
    topbar: document.getElementById('game-topbar'),
    sidePanels: Array.from(document.querySelectorAll('.side-panel'))
  };

  return ui;
}

export function copyBoard() {
  return INIT_BOARD.map(row => row.slice());
}

export function getMoves(boardState, r, c) {
  const piece = boardState[r][c];
  if (!piece) return [];

  const type = piece[1];
  const color = piece[0];
  const ally = color === 'w' ? isW : isB;
  const foe = color === 'w' ? isB : isW;
  const moves = [];

  const add = (nr, nc) => {
    if (inBounds(nr, nc) && !ally(boardState[nr][nc])) {
      moves.push([nr, nc]);
    }
  };

  const slide = (dr, dc) => {
    let nr = r + dr;
    let nc = c + dc;

    while (inBounds(nr, nc)) {
      if (ally(boardState[nr][nc])) break;
      moves.push([nr, nc]);
      if (foe(boardState[nr][nc])) break;
      nr += dr;
      nc += dc;
    }
  };

  if (type === 'P') {
    const direction = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;

    if (inBounds(r + direction, c) && !boardState[r + direction][c]) {
      moves.push([r + direction, c]);
      if (r === startRow && !boardState[r + (2 * direction)][c]) {
        moves.push([r + (2 * direction), c]);
      }
    }

    [[r + direction, c - 1], [r + direction, c + 1]].forEach(([nr, nc]) => {
      if (inBounds(nr, nc) && foe(boardState[nr][nc])) {
        moves.push([nr, nc]);
      }
    });
  }

  if (type === 'N') {
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  }

  if (type === 'B' || type === 'Q') {
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr, dc]) => slide(dr, dc));
  }

  if (type === 'R' || type === 'Q') {
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => slide(dr, dc));
  }

  if (type === 'K') {
    [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  }

  return moves;
}

export function onCD(r, c) {
  return Boolean(cds[r * 8 + c] && Date.now() < cds[r * 8 + c]);
}

function setCD(r, c) {
  cds[r * 8 + c] = Date.now() + CD;
}

function addLog(message) {
  const { log } = getUI();
  const row = document.createElement('div');
  row.textContent = message;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function updateScores() {
  const { scoreWhite, scoreBlack } = getUI();
  scoreWhite.textContent = String(scW);
  scoreBlack.textContent = String(scB);
}

function showWin(title, sub) {
  const { winScreen, winTitle, winSub } = getUI();
  dead = true;
  winTitle.textContent = title;
  winSub.textContent = sub;
  winScreen.classList.add('show');
  crazyGameplayStop();
  crazyHappytime();
}

function doMove(fr, fc, tr, tc, player) {
  const captured = board[tr][tc];

  if (captured) {
    if (isW(captured)) scB++;
    else scW++;

    updateScores();

    if (captured[1] === 'K') {
      addLog((player === 'w' ? 'White' : 'Black') + ' captured the King!');
      showWin((player === 'w' ? 'White' : 'Black') + ' wins!', 'King captured!');
    }
  }

  board[tr][tc] = board[fr][fc];
  board[fr][fc] = null;

  if (board[tr][tc][1] === 'P') {
    if (tr === 0) board[tr][tc] = 'wQ';
    if (tr === 7) board[tr][tc] = 'bQ';
  }

  setCD(tr, tc);
  addLog((player === 'w' ? 'White' : 'Black') + ' moved ' + GL[board[tr][tc]] + ' -> ' + String.fromCharCode(97 + tc) + (8 - tr));
  paint();
}

function tryMove(selection, r, c, player) {
  if (!selection) return false;

  const moves = getMoves(board, selection[0], selection[1]);
  if (!moves.some(([mr, mc]) => mr === r && mc === c)) {
    return false;
  }

  doMove(selection[0], selection[1], r, c, player);
  return true;
}

function handleClick(r, c) {
  if (dead) return;

  const piece = board[r][c];

  if (piece && isW(piece)) {
    if (tryMove(selB, r, c, 'b')) {
      selB = null;
      return;
    }

    if (onCD(r, c)) {
      addLog('White piece cooling down - pick another.');
      return;
    }

    selW = [r, c];
    paint();
    return;
  }

  if (piece && isB(piece)) {
    if (tryMove(selW, r, c, 'w')) {
      selW = null;
      return;
    }

    if (onCD(r, c)) {
      addLog('Black piece cooling down - pick another.');
      return;
    }

    selB = [r, c];
    paint();
    return;
  }

  let moved = false;

  if (selW) {
    if (tryMove(selW, r, c, 'w')) {
      selW = null;
      moved = true;
    } else {
      selW = null;
    }
  }

  if (selB) {
    if (tryMove(selB, r, c, 'b')) {
      selB = null;
      moved = true;
    } else {
      selB = null;
    }
  }

  if (!moved) {
    paint();
  }
}

export function buildBoard() {
  const { board: boardEl, topbar, sidePanels } = getUI();
  const theme = getSelectedTheme();
  const topHeight = topbar.offsetHeight;
  const logHeight = 56;
  const pagePadding = window.innerWidth <= 700 ? 20 : 40;
  const visiblePanelWidth = sidePanels.reduce((sum, panel) => {
    if (window.getComputedStyle(panel).display === 'none') {
      return sum;
    }
    return sum + panel.offsetWidth;
  }, 0);
  const horizontalGutters = window.innerWidth <= 700 ? 24 : 56;
  const availableHeight = window.innerHeight - topHeight - logHeight - pagePadding;
  const availableWidth = window.innerWidth - visiblePanelWidth - horizontalGutters;
  const boardSize = Math.max(256, Math.min(availableHeight, availableWidth));
  const squareSize = Math.floor(boardSize / 8);

  boardEl.innerHTML = '';
  boardEl.dataset.theme = theme.id;
  boardEl.style.width = (squareSize * 8) + 'px';
  boardEl.style.height = (squareSize * 8) + 'px';
  sqEls = [];

  for (let r = 0; r < 8; r++) {
    sqEls[r] = [];
    for (let c = 0; c < 8; c++) {
      const square = document.createElement('div');
      square.className = 'sq';
      square.style.width = squareSize + 'px';
      square.style.height = squareSize + 'px';
      square.style.fontSize = (squareSize * 0.68) + 'px';
      square.addEventListener('click', () => handleClick(r, c));
      boardEl.appendChild(square);
      sqEls[r][c] = square;
    }
  }
}

export function paint() {
  const whiteMoves = selW ? new Set(getMoves(board, selW[0], selW[1]).map(([r, c]) => r * 8 + c)) : new Set();
  const blackMoves = selB ? new Set(getMoves(board, selB[0], selB[1]).map(([r, c]) => r * 8 + c)) : new Set();
  const now = Date.now();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = sqEls[r][c];
      if (!square) continue;

      const isLight = (r + c) % 2 === 0;
      const piece = board[r][c];
      const selectedByWhite = selW && selW[0] === r && selW[1] === c;
      const selectedByBlack = selB && selB[0] === r && selB[1] === c;
      const inWhiteMoves = whiteMoves.has(r * 8 + c);
      const inBlackMoves = blackMoves.has(r * 8 + c);
      const cooling = piece && onCD(r, c);

      let classes = 'sq ' + (r < 4 ? (isLight ? 'bl' : 'bd') : (isLight ? 'wl' : 'wd'));
      if (selectedByWhite) classes += ' sel-w';
      else if (selectedByBlack) classes += ' sel-b';
      if (inWhiteMoves || inBlackMoves) classes += piece ? ' mv-cap' : ' mv-dot';
      square.className = classes;

      let pieceEl = square.querySelector('.piece');
      if (piece) {
        if (!pieceEl) {
          pieceEl = document.createElement('div');
          square.appendChild(pieceEl);
        }
        pieceEl.className = 'piece piece-' + (isW(piece) ? 'white' : 'black') + (cooling ? ' cd' : '');
        pieceEl.textContent = GL[piece];
      } else if (pieceEl) {
        pieceEl.remove();
      }

      let bar = square.querySelector('.cdbar');
      if (cooling) {
        if (!bar) {
          bar = document.createElement('div');
          bar.className = 'cdbar';
          square.appendChild(bar);
        }
        bar.style.width = Math.max(0, ((cds[r * 8 + c] - now) / CD) * 100) + '%';
        bar.style.background = isW(piece) ? '#378ADD' : '#D85A30';
      } else if (bar) {
        bar.remove();
      }
    }
  }
}

function tick() {
  const { whiteBar, blackBar } = getUI();
  const now = Date.now();
  let maxWhite = 0;
  let maxBlack = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cooldownEnd = cds[r * 8 + c];
      const square = sqEls[r] && sqEls[r][c];
      if (!square) continue;

      if (cooldownEnd && cooldownEnd > now) {
        const piece = board[r][c];
        if (!piece) continue;

        const pct = ((cooldownEnd - now) / CD) * 100;
        if (isW(piece)) maxWhite = Math.max(maxWhite, pct);
        if (isB(piece)) maxBlack = Math.max(maxBlack, pct);

        const bar = square.querySelector('.cdbar');
        if (bar) bar.style.width = pct + '%';

        const pieceEl = square.querySelector('.piece');
        if (pieceEl && !pieceEl.classList.contains('cd')) {
          pieceEl.classList.add('cd');
        }
      } else if (cooldownEnd) {
        const pieceEl = square.querySelector('.piece');
        if (pieceEl) pieceEl.classList.remove('cd');

        const bar = square.querySelector('.cdbar');
        if (bar) bar.remove();
      }
    }
  }

  whiteBar.style.width = maxWhite + '%';
  blackBar.style.width = maxBlack + '%';
}

export function gameReset() {
  const { log, whiteBar, blackBar, winScreen } = getUI();
  board = copyBoard();
  cds = {};
  selW = null;
  selB = null;
  scW = 0;
  scB = 0;
  dead = false;
  log.innerHTML = '';
  whiteBar.style.width = '0%';
  blackBar.style.width = '0%';
  winScreen.classList.remove('show');
  updateScores();
  paint();
  crazyGameplayStart();
}

export function startGame() {
  buildBoard();
  gameReset();

  if (tickInterval) {
    clearInterval(tickInterval);
  }

  tickInterval = setInterval(tick, 50);
}

export function stopGame() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}



