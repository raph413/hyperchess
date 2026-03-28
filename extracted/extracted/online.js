import { CD, GL, createGameState, getMoves, isOnCooldown } from './game-core.js';
import { crazyGameplayStart, crazyGameplayStop, crazyHappytime, crazyLoadingStart, crazyLoadingStop, initCrazyGamesSDK, preventCrazyPageScroll } from './crazygames.js';
import { rewardCoins } from './shop-core.js';

const state = {
  socket: null,
  clientId: null,
  roomId: '',
  playerColor: null,
  playerToken: null,
  profileId: null,
  nickname: '',
  rating: 1000,
  ranked: false,
  game: createGameState(),
  players: { white: false, black: false },
  names: { white: 'White', black: 'Black' },
  ratings: { white: 1000, black: 1000 },
  selection: null,
  connected: false,
  everConnected: false,
  joined: false,
  rewardedForMatch: false,
  sqEls: [],
  resizeFrame: null,
  tickInterval: null
};

const ui = {
  lobby: document.getElementById('online-lobby'),
  game: document.getElementById('online-game'),
  createBtn: document.getElementById('create-room-btn'),
  quickMatchBtn: document.getElementById('quick-match-btn'),
  cancelMatchBtn: document.getElementById('cancel-match-btn'),
  joinBtn: document.getElementById('join-room-btn'),
  nicknameInput: document.getElementById('nickname-input'),
  roomInput: document.getElementById('room-input'),
  roomPanel: document.getElementById('room-panel'),
  roomCode: document.getElementById('room-code'),
  playerElo: document.getElementById('player-elo'),
  roomLink: document.getElementById('room-link'),
  copyRoomBtn: document.getElementById('copy-room-btn'),
  lobbyStatus: document.getElementById('lobby-status'),
  board: document.getElementById('board'),
  log: document.getElementById('glog'),
  scoreWhite: document.getElementById('sw'),
  scoreBlack: document.getElementById('sb'),
  whiteBar: document.getElementById('bw'),
  blackBar: document.getElementById('bb'),
  topbar: document.getElementById('game-topbar'),
  sidePanels: Array.from(document.querySelectorAll('.side-panel')),
  connectionPill: document.getElementById('connection-pill'),
  turnPill: document.getElementById('turn-pill'),
  roomPill: document.getElementById('room-pill'),
  modePill: document.getElementById('mode-pill'),
  waitingBanner: document.getElementById('waiting-banner'),
  backLobbyBtn: document.getElementById('back-lobby-btn'),
  winScreen: document.getElementById('win-screen'),
  winTitle: document.getElementById('win-title'),
  winSub: document.getElementById('win-sub'),
  playerOneStatus: document.getElementById('player-one-status'),
  playerTwoStatus: document.getElementById('player-two-status'),
  playerOneLabel: document.getElementById('player-one-label'),
  playerTwoLabel: document.getElementById('player-two-label')
};

const STORAGE_KEY = 'hyperchess-online-session';
const PROFILE_KEY = 'hyperchess-online-profile';

function makeId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (saved?.profileId) return saved;
  } catch {}

  const created = { profileId: makeId(), nickname: '' };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(created));
  return created;
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    profileId: state.profileId,
    nickname: state.nickname
  }));
}

function getNickname() {
  const value = ui.nicknameInput.value.trim();
  return (value || 'Player').slice(0, 18);
}

function persistSession() {
  if (!state.roomId || !state.playerToken || !state.playerColor || !state.profileId) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    roomId: state.roomId,
    playerToken: state.playerToken,
    playerColor: state.playerColor,
    nickname: state.nickname,
    profileId: state.profileId
  }));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function readSavedSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function setLobbyStatus(message, tone = '') {
  ui.lobbyStatus.textContent = message;
  ui.lobbyStatus.dataset.tone = tone;
}

function setQueueState(waiting) {
  ui.cancelMatchBtn.classList.toggle('hidden', !waiting);
  ui.quickMatchBtn.classList.toggle('hidden', waiting);
}

function addLog(message) {
  const row = document.createElement('div');
  row.textContent = message;
  ui.log.appendChild(row);
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setConnectionState(connected) {
  state.connected = connected;
  ui.connectionPill.textContent = connected ? 'Connected' : 'Disconnected';
  ui.connectionPill.dataset.state = connected ? 'ok' : 'bad';
  if (!connected) {
    if (window.location.protocol === 'file:') {
      setLobbyStatus('Open this game from a deployed server or localhost, not as a file.', 'bad');
    } else if (!state.everConnected) {
      setLobbyStatus('Cannot reach the online server. Deploy the backend before publishing to CrazyGames.', 'bad');
    } else {
      setLobbyStatus('Connection lost. Reload the page to reconnect.', 'bad');
    }
  }
}

function renderRoomInfo() {
  if (!state.roomId) return;
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set('room', state.roomId);
  ui.roomPanel.classList.remove('hidden');
  ui.roomCode.textContent = state.roomId;
  ui.playerElo.textContent = String(state.rating);
  ui.roomLink.textContent = inviteUrl.toString();
  ui.roomPill.textContent = 'Room ' + state.roomId;
  ui.modePill.textContent = state.ranked ? 'Ranked' : 'Unranked';
  ui.modePill.dataset.state = state.ranked ? 'ok' : 'warn';
}

function updatePresence() {
  const whiteReady = state.players.white;
  const blackReady = state.players.black;
  ui.playerOneLabel.textContent = 'White - ' + (state.names.white || 'White');
  ui.playerTwoLabel.textContent = 'Black - ' + (state.names.black || 'Black');
  ui.playerOneStatus.textContent = (whiteReady ? 'Connected and ready' : 'Waiting for player...') + ' - Elo ' + (state.ratings.white ?? 1000);
  ui.playerTwoStatus.textContent = (blackReady ? 'Connected and ready' : 'Waiting for player...') + ' - Elo ' + (state.ratings.black ?? 1000);
  ui.waitingBanner.classList.toggle('hidden', whiteReady && blackReady);

  if (!whiteReady || !blackReady) {
    ui.turnPill.textContent = 'Waiting for opponent';
    ui.turnPill.dataset.state = 'warn';
    crazyGameplayStop();
    return;
  }

  if (state.playerColor) {
    const colorName = state.playerColor === 'w' ? 'White' : 'Black';
    ui.turnPill.textContent = state.nickname + ' as ' + colorName;
    ui.turnPill.dataset.state = 'ok';
    crazyGameplayStart();
  } else {
    ui.turnPill.textContent = 'Spectator';
    ui.turnPill.dataset.state = 'warn';
    crazyGameplayStop();
  }
}

function buildBoard() {
  const topHeight = ui.topbar.offsetHeight;
  const logHeight = 82;
  const pagePadding = window.innerWidth <= 700 ? 26 : 46;
  const visiblePanelWidth = ui.sidePanels.reduce((sum, panel) => {
    if (window.getComputedStyle(panel).display === 'none') return sum;
    return sum + panel.offsetWidth;
  }, 0);
  const availableHeight = window.innerHeight - topHeight - logHeight - pagePadding;
  const availableWidth = window.innerWidth - visiblePanelWidth - (window.innerWidth <= 700 ? 30 : 72);
  const boardSize = Math.max(256, Math.min(availableHeight, availableWidth));
  const squareSize = Math.floor(boardSize / 8);

  ui.board.innerHTML = '';
  ui.board.style.width = (squareSize * 8) + 'px';
  ui.board.style.height = (squareSize * 8) + 'px';
  state.sqEls = [];

  for (let r = 0; r < 8; r++) {
    state.sqEls[r] = [];
    for (let c = 0; c < 8; c++) {
      const square = document.createElement('div');
      square.className = 'sq';
      square.style.width = squareSize + 'px';
      square.style.height = squareSize + 'px';
      square.style.fontSize = (squareSize * 0.68) + 'px';
      square.addEventListener('click', () => handleSquareClick(r, c));
      ui.board.appendChild(square);
      state.sqEls[r][c] = square;
    }
  }
}

function currentMoveSet() {
  if (!state.selection) return new Set();
  return new Set(getMoves(state.game.board, state.selection[0], state.selection[1]).map(([r, c]) => r * 8 + c));
}

function paintBoard() {
  const moveSet = currentMoveSet();
  const now = Date.now();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = state.sqEls[r]?.[c];
      if (!square) continue;

      const isLight = (r + c) % 2 === 0;
      const piece = state.game.board[r][c];
      const selected = state.selection && state.selection[0] === r && state.selection[1] === c;
      const cooling = piece && isOnCooldown(state.game, r, c, now);
      const isMove = moveSet.has(r * 8 + c);

      let classes = 'sq ' + (r < 4 ? (isLight ? 'bl' : 'bd') : (isLight ? 'wl' : 'wd'));
      if (selected) {
        classes += state.playerColor === 'w' ? ' sel-w' : ' sel-b';
      }
      if (isMove) classes += piece ? ' mv-cap' : ' mv-dot';
      square.className = classes;

      let pieceEl = square.querySelector('.piece');
        if (piece) {
          if (!pieceEl) {
            pieceEl = document.createElement('div');
            square.appendChild(pieceEl);
          }
          pieceEl.className = 'piece piece-' + (piece[0] === 'w' ? 'white' : 'black') + (cooling ? ' cd' : '');
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
        const key = r * 8 + c;
        bar.style.width = Math.max(0, ((state.game.cooldowns[key] - now) / CD) * 100) + '%';
        bar.style.background = piece[0] === 'w' ? '#378ADD' : '#D85A30';
      } else if (bar) {
        bar.remove();
      }
    }
  }
}

function tickCooldownBars() {
  const now = Date.now();
  let maxWhite = 0;
  let maxBlack = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = state.game.board[r][c];
      if (!piece) continue;
      const key = r * 8 + c;
      const end = state.game.cooldowns[key];
      if (!end || end <= now) continue;
      const pct = ((end - now) / CD) * 100;
      if (piece[0] === 'w') maxWhite = Math.max(maxWhite, pct);
      else maxBlack = Math.max(maxBlack, pct);
    }
  }

  ui.whiteBar.style.width = maxWhite + '%';
  ui.blackBar.style.width = maxBlack + '%';
  paintBoard();
}

function renderGameState() {
  ui.scoreWhite.textContent = String(state.game.scores.white);
  ui.scoreBlack.textContent = String(state.game.scores.black);
  ui.playerElo.textContent = String(state.rating);
  updatePresence();

  if (state.game.winner) {
    if (state.ranked && state.playerColor && !state.rewardedForMatch) {
      const won = state.game.winner === state.playerColor;
      const reward = won ? 40 : 10;
      const rewardState = rewardCoins(reward);
      state.rewardedForMatch = true;
      addLog((won ? 'Ranked win reward' : 'Ranked finish reward') + ': +' + reward + ' coins. Total coins: ' + rewardState.coins);
    }
    ui.winScreen.classList.add('show');
    ui.winTitle.textContent = (state.game.winner === 'w' ? 'White' : 'Black') + ' wins!';
    ui.winSub.textContent = state.game.winReason || 'King captured!';
    crazyGameplayStop();
    crazyHappytime();
  } else {
    state.rewardedForMatch = false;
    ui.winScreen.classList.remove('show');
  }

  paintBoard();
}

function showGame() {
  ui.lobby.classList.add('hidden');
  ui.game.classList.remove('hidden');
  buildBoard();
  renderGameState();
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(message));
}

function joinRoom(roomId) {
  const normalized = roomId.trim().toUpperCase();
  if (!normalized) {
    setLobbyStatus('Enter a room code first.', 'bad');
    return;
  }
  const name = getNickname();
  state.nickname = name;
  saveProfile();
  send({ type: 'join-room', roomId: normalized, name, profileId: state.profileId });
}

function handleSquareClick(r, c) {
  if (!state.joined || !state.playerColor || state.game.winner) return;

  const piece = state.game.board[r][c];

  if (piece && piece[0] === state.playerColor) {
    if (isOnCooldown(state.game, r, c)) {
      addLog('This piece is cooling down.');
      return;
    }
    state.selection = [r, c];
    paintBoard();
    return;
  }

  if (!state.selection) return;

  const [fromRow, fromCol] = state.selection;
  const allowed = getMoves(state.game.board, fromRow, fromCol)
    .some(([mr, mc]) => mr === r && mc === c);

  if (!allowed) {
    state.selection = null;
    paintBoard();
    return;
  }

  send({
    type: 'make-move',
    from: [fromRow, fromCol],
    to: [r, c]
  });
  state.selection = null;
  paintBoard();
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'welcome':
      state.clientId = message.clientId;
      setLobbyStatus('Connected. Create a room or join one with a code.');
      break;
    case 'room-created':
      state.roomId = message.roomId;
      state.playerColor = message.color;
      state.playerToken = message.playerToken;
      state.profileId = message.profileId;
      state.nickname = message.name;
      state.rating = message.rating ?? state.rating;
      state.ranked = false;
      state.rewardedForMatch = false;
      state.joined = true;
      saveProfile();
      persistSession();
      renderRoomInfo();
      setQueueState(false);
      showGame();
      setLobbyStatus('Room created. Share the code with your opponent.', 'ok');
      break;
    case 'room-joined':
      state.roomId = message.roomId;
      state.playerColor = message.color;
      state.playerToken = message.playerToken;
      state.profileId = message.profileId;
      state.nickname = message.name;
      state.rating = message.rating ?? state.rating;
      state.ranked = Boolean(message.matched);
      state.rewardedForMatch = false;
      state.joined = true;
      saveProfile();
      persistSession();
      renderRoomInfo();
      setQueueState(false);
      showGame();
      setLobbyStatus(
        message.matched
          ? 'Match found. Good luck.'
          : message.reconnected
            ? 'Reconnected to room ' + message.roomId + '.'
            : 'Joined room ' + message.roomId + '.',
        'ok'
      );
      break;
    case 'queue-status':
      if (message.status === 'waiting') {
        setQueueState(true);
        setLobbyStatus('Searching for a random opponent...', 'warn');
      } else {
        setQueueState(false);
        setLobbyStatus('Matchmaking cancelled.', 'ok');
      }
      break;
    case 'state':
      state.game = message.state;
      state.ranked = Boolean(message.ranked);
      state.players = message.players;
      state.names = message.names || state.names;
      state.ratings = message.ratings || state.ratings;
      state.rating = state.playerColor === 'w' ? (state.ratings.white ?? state.rating) : state.playerColor === 'b' ? (state.ratings.black ?? state.rating) : state.rating;
      state.selection = null;
      renderGameState();
      if (message.eventText) addLog(message.eventText);
      break;
    case 'room-error':
      if (message.message.includes('Reconnect') || message.message.includes('Saved room')) {
        clearSession();
      }
      setLobbyStatus(message.message, 'bad');
      break;
    case 'player-left':
      setLobbyStatus('The other player disconnected. The room is still open.', 'warn');
      addLog('A player left the room.');
      state.players = message.players;
      updatePresence();
      break;
    default:
      break;
  }
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(protocol + '//' + window.location.host + '/ws');
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.everConnected = true;
    setConnectionState(true);
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) {
      joinRoom(roomFromUrl);
      ui.roomInput.value = roomFromUrl.toUpperCase();
      return;
    }
    const savedSession = readSavedSession();
    if (savedSession?.roomId && savedSession?.playerToken) {
      ui.nicknameInput.value = savedSession.nickname || '';
      send({
        type: 'reconnect',
        roomId: savedSession.roomId,
        playerToken: savedSession.playerToken,
        name: savedSession.nickname || 'Player',
        profileId: savedSession.profileId || state.profileId
      });
    }
  });

  socket.addEventListener('close', () => {
    setConnectionState(false);
  });

  socket.addEventListener('error', () => {
    setConnectionState(false);
  });

  socket.addEventListener('message', event => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch {
      setLobbyStatus('Received malformed data from the server.', 'bad');
    }
  });
}

function copyRoomLink() {
  if (!ui.roomLink.textContent) return;
  navigator.clipboard.writeText(ui.roomLink.textContent)
    .then(() => setLobbyStatus('Invite link copied to clipboard.', 'ok'))
    .catch(() => setLobbyStatus('Could not copy the invite link.', 'bad'));
}

function bindEvents() {
  const profile = getProfile();
  state.profileId = profile.profileId;
  const remembered = readSavedSession();
  ui.nicknameInput.value = remembered?.nickname || profile.nickname || '';
  ui.createBtn.addEventListener('click', () => {
    const name = getNickname();
    state.nickname = name;
    saveProfile();
    send({ type: 'create-room', name, profileId: state.profileId });
  });
  ui.quickMatchBtn.addEventListener('click', () => {
    const name = getNickname();
    state.nickname = name;
    saveProfile();
    send({ type: 'quick-match', name, profileId: state.profileId });
  });
  ui.cancelMatchBtn.addEventListener('click', () => {
    send({ type: 'cancel-quick-match' });
  });
  ui.joinBtn.addEventListener('click', () => joinRoom(ui.roomInput.value));
  ui.roomInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      joinRoom(ui.roomInput.value);
    }
  });
  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = ui.roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  ui.nicknameInput.addEventListener('input', () => {
    ui.nicknameInput.value = ui.nicknameInput.value.replace(/\s+/g, ' ').slice(0, 18);
    state.nickname = ui.nicknameInput.value.trim();
    saveProfile();
  });
  ui.copyRoomBtn.addEventListener('click', copyRoomLink);
  ui.backLobbyBtn.addEventListener('click', () => {
    clearSession();
    window.location.href = 'index.html';
  });
  window.addEventListener('resize', () => {
    if (!state.joined) return;
    if (state.resizeFrame !== null) {
      cancelAnimationFrame(state.resizeFrame);
    }
    state.resizeFrame = requestAnimationFrame(() => {
      buildBoard();
      renderGameState();
      state.resizeFrame = null;
    });
  });
}

bindEvents();
preventCrazyPageScroll();
initCrazyGamesSDK().then(async () => {
  await crazyLoadingStart();
  connect();
  state.tickInterval = setInterval(tickCooldownBars, 100);
  await crazyLoadingStop();
});
