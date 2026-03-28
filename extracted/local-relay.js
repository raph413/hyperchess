import { cloneState, createGameState, makeMove } from './game-core.js';

const ROOMS_KEY = 'hyperchess-local-rooms';
const QUEUE_KEY = 'hyperchess-local-queue';
const RATINGS_KEY = 'hyperchess-local-ratings';
const BASE_ELO = 1000;
const ELO_DELTA = 10;
const channel = new BroadcastChannel('hyperchess-local-online');

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRatings() {
  return loadJson(RATINGS_KEY, {});
}

function getRating(profileId) {
  const ratings = getRatings();
  if (typeof ratings[profileId] !== 'number') {
    ratings[profileId] = BASE_ELO;
    saveJson(RATINGS_KEY, ratings);
  }
  return ratings[profileId];
}

function setRating(profileId, value) {
  const ratings = getRatings();
  ratings[profileId] = value;
  saveJson(RATINGS_KEY, ratings);
}

function loadRooms() {
  return loadJson(ROOMS_KEY, {});
}

function saveRooms(rooms) {
  saveJson(ROOMS_KEY, rooms);
}

function getQueue() {
  return loadJson(QUEUE_KEY, []);
}

function saveQueue(queue) {
  saveJson(QUEUE_KEY, queue);
}

function targetedSend(targetClientId, data) {
  channel.postMessage({ targetClientId, data });
}

function syncRoom(room, eventText = '') {
  const data = {
    type: 'state',
    ranked: Boolean(room.ranked),
    state: cloneState(room.game),
    players: {
      white: Boolean(room.whiteClientId),
      black: Boolean(room.blackClientId)
    },
    names: {
      white: room.whiteName || 'White',
      black: room.blackName || 'Black'
    },
    ratings: {
      white: getRating(room.whiteProfileId),
      black: getRating(room.blackProfileId)
    },
    eventText
  };

  if (room.whiteClientId) targetedSend(room.whiteClientId, data);
  if (room.blackClientId) targetedSend(room.blackClientId, data);
}

function leaveRoom(client) {
  const rooms = loadRooms();
  const room = rooms[client.roomId];
  if (!room) return;

  if (room.whiteClientId === client.id) room.whiteClientId = null;
  if (room.blackClientId === client.id) room.blackClientId = null;

  if (!room.whiteClientId && !room.blackClientId) {
    delete rooms[client.roomId];
    saveRooms(rooms);
    return;
  }

  saveRooms(rooms);
  syncRoom(room);
}

function applyRoomElo(room, winnerColor) {
  if (!room.ranked || room.rated) return '';

  const loserColor = winnerColor === 'w' ? 'b' : 'w';
  const winnerProfileId = winnerColor === 'w' ? room.whiteProfileId : room.blackProfileId;
  const loserProfileId = loserColor === 'w' ? room.whiteProfileId : room.blackProfileId;
  if (!winnerProfileId || !loserProfileId) return '';

  setRating(winnerProfileId, getRating(winnerProfileId) + ELO_DELTA);
  setRating(loserProfileId, getRating(loserProfileId) - ELO_DELTA);
  room.rated = true;
  return (winnerColor === 'w' ? room.whiteName : room.blackName) + ' gains +' + ELO_DELTA + ' Elo.';
}

function handleCreateRoom(client, message) {
  if (client.roomId) leaveRoom(client);
  client.name = message.name || 'White';
  client.playerToken = crypto.randomUUID();
  client.profileId = message.profileId || crypto.randomUUID();

  const rooms = loadRooms();
  let roomId = createRoomId();
  while (rooms[roomId]) roomId = createRoomId();

  rooms[roomId] = {
    id: roomId,
    ranked: false,
    rated: false,
    game: createGameState(),
    whiteClientId: client.id,
    blackClientId: null,
    whiteToken: client.playerToken,
    blackToken: null,
    whiteProfileId: client.profileId,
    blackProfileId: null,
    whiteName: client.name,
    blackName: 'Black'
  };
  saveRooms(rooms);
  client.roomId = roomId;
  client.color = 'w';

  targetedSend(client.id, {
    type: 'room-created',
    roomId,
    color: 'w',
    playerToken: client.playerToken,
    profileId: client.profileId,
    name: client.name,
    rating: getRating(client.profileId)
  });
  syncRoom(rooms[roomId]);
}

function handleJoinRoom(client, message) {
  const rooms = loadRooms();
  const roomId = String(message.roomId || '').toUpperCase();
  const room = rooms[roomId];
  if (!room) {
    targetedSend(client.id, { type: 'room-error', message: 'Room not found.' });
    return;
  }
  if (room.whiteClientId && room.blackClientId) {
    targetedSend(client.id, { type: 'room-error', message: 'This room is already full.' });
    return;
  }

  if (client.roomId) leaveRoom(client);
  client.name = message.name || 'Player';
  client.playerToken = crypto.randomUUID();
  client.profileId = message.profileId || crypto.randomUUID();
  client.roomId = roomId;

  if (!room.whiteClientId) {
    client.color = 'w';
    room.whiteClientId = client.id;
    room.whiteToken = client.playerToken;
    room.whiteProfileId = client.profileId;
    room.whiteName = client.name;
  } else {
    client.color = 'b';
    room.blackClientId = client.id;
    room.blackToken = client.playerToken;
    room.blackProfileId = client.profileId;
    room.blackName = client.name;
  }

  saveRooms(rooms);
  targetedSend(client.id, {
    type: 'room-joined',
    roomId,
    color: client.color,
    playerToken: client.playerToken,
    profileId: client.profileId,
    name: client.name,
    rating: getRating(client.profileId)
  });
  syncRoom(room, client.name + ' joined the room.');
}

function createRankedRoom(first, second) {
  const rooms = loadRooms();
  let roomId = createRoomId();
  while (rooms[roomId]) roomId = createRoomId();

  rooms[roomId] = {
    id: roomId,
    ranked: true,
    rated: false,
    game: createGameState(),
    whiteClientId: first.id,
    blackClientId: second.id,
    whiteToken: first.playerToken,
    blackToken: second.playerToken,
    whiteProfileId: first.profileId,
    blackProfileId: second.profileId,
    whiteName: first.name,
    blackName: second.name
  };

  saveRooms(rooms);

  targetedSend(first.id, {
    type: 'room-joined',
    roomId,
    color: 'w',
    playerToken: first.playerToken,
    profileId: first.profileId,
    name: first.name,
    rating: getRating(first.profileId),
    matched: true
  });

  targetedSend(second.id, {
    type: 'room-joined',
    roomId,
    color: 'b',
    playerToken: second.playerToken,
    profileId: second.profileId,
    name: second.name,
    rating: getRating(second.profileId),
    matched: true
  });

  syncRoom(rooms[roomId], 'Local quick match started.');
}

function handleQuickMatch(client, message) {
  if (client.roomId) leaveRoom(client);
  client.name = message.name || 'Player';
  client.playerToken = crypto.randomUUID();
  client.profileId = message.profileId || crypto.randomUUID();

  const queue = getQueue().filter(entry => entry.id !== client.id);
  const opponent = queue.shift();
  saveQueue(queue);

  if (!opponent) {
    queue.push({
      id: client.id,
      name: client.name,
      profileId: client.profileId,
      playerToken: client.playerToken
    });
    saveQueue(queue);
    targetedSend(client.id, { type: 'queue-status', status: 'waiting' });
    return;
  }

  createRankedRoom(opponent, client);
}

function handleCancelQuickMatch(client) {
  const queue = getQueue().filter(entry => entry.id !== client.id);
  saveQueue(queue);
  targetedSend(client.id, { type: 'queue-status', status: 'idle' });
}

function handleReconnect(client, message) {
  const rooms = loadRooms();
  const room = rooms[String(message.roomId || '').toUpperCase()];
  if (!room) {
    targetedSend(client.id, { type: 'room-error', message: 'Saved room no longer exists.' });
    return;
  }

  let color = null;
  if (room.whiteToken === message.playerToken) color = 'w';
  if (room.blackToken === message.playerToken) color = 'b';
  if (!color) {
    targetedSend(client.id, { type: 'room-error', message: 'Reconnect token is invalid.' });
    return;
  }

  client.roomId = room.id;
  client.color = color;
  client.playerToken = message.playerToken;
  client.profileId = message.profileId || (color === 'w' ? room.whiteProfileId : room.blackProfileId);
  client.name = message.name || (color === 'w' ? room.whiteName : room.blackName);

  if (color === 'w') room.whiteClientId = client.id;
  else room.blackClientId = client.id;
  saveRooms(rooms);

  targetedSend(client.id, {
    type: 'room-joined',
    roomId: room.id,
    color,
    playerToken: client.playerToken,
    profileId: client.profileId,
    name: client.name,
    rating: getRating(client.profileId),
    reconnected: true
  });
  syncRoom(room, client.name + ' reconnected.');
}

function handleMove(client, message) {
  const rooms = loadRooms();
  const room = rooms[client.roomId];
  if (!room) {
    targetedSend(client.id, { type: 'room-error', message: 'Room no longer exists.' });
    return;
  }

  const result = makeMove(room.game, client.color, message.from[0], message.from[1], message.to[0], message.to[1], Date.now());
  if (!result.ok) {
    targetedSend(client.id, { type: 'room-error', message: result.error });
    return;
  }

  const eloText = result.event.winner ? applyRoomElo(room, result.event.winner) : '';
  saveRooms(rooms);
  syncRoom(room, [eloText].filter(Boolean).join(' '));
}

export function createLocalSocket(handlers) {
  const client = {
    id: crypto.randomUUID(),
    roomId: null,
    color: null,
    name: null,
    profileId: null,
    playerToken: null
  };

  const socket = {
    readyState: 1,
    send(raw) {
      const message = JSON.parse(raw);
      switch (message.type) {
        case 'create-room':
          handleCreateRoom(client, message);
          break;
        case 'join-room':
          handleJoinRoom(client, message);
          break;
        case 'quick-match':
          handleQuickMatch(client, message);
          break;
        case 'cancel-quick-match':
          handleCancelQuickMatch(client);
          break;
        case 'reconnect':
          handleReconnect(client, message);
          break;
        case 'make-move':
          handleMove(client, message);
          break;
        default:
          targetedSend(client.id, { type: 'room-error', message: 'Unknown message type.' });
      }
    },
    close() {
      handleCancelQuickMatch(client);
      if (client.roomId) leaveRoom(client);
      handlers.onClose?.();
    }
  };

  channel.addEventListener('message', event => {
    if (event.data?.targetClientId === client.id) {
      handlers.onMessage?.({ data: JSON.stringify(event.data.data) });
    }
  });

  setTimeout(() => {
    handlers.onOpen?.();
    targetedSend(client.id, { type: 'welcome', clientId: client.id, local: true });
  }, 0);

  window.addEventListener('beforeunload', () => {
    try { socket.close(); } catch {}
  });

  return socket;
}
