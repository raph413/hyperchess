import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { cloneState, createGameState, makeMove } from './game-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const RATINGS_PATH = path.join(__dirname, 'ratings.json');
const BASE_ELO = 1000;
const ELO_DELTA = 10;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const rooms = new Map();
const clients = new Map();
const ratings = loadRatings();
const matchmakingQueue = [];

function loadRatings() {
  try {
    return JSON.parse(fs.readFileSync(RATINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveRatings() {
  fs.writeFileSync(RATINGS_PATH, JSON.stringify(ratings, null, 2));
}

function getRating(profileId) {
  if (!profileId) return BASE_ELO;
  if (typeof ratings[profileId] !== 'number') {
    ratings[profileId] = BASE_ELO;
    saveRatings();
  }
  return ratings[profileId];
}

function setRating(profileId, value) {
  if (!profileId) return;
  ratings[profileId] = value;
  saveRatings();
}

function createRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function parseJson(message) {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

function createSocketFrame(payload) {
  const payloadBuffer = Buffer.from(payload);
  const length = payloadBuffer.length;

  if (length < 126) {
    const frame = Buffer.alloc(2 + length);
    frame[0] = 0x81;
    frame[1] = length;
    payloadBuffer.copy(frame, 2);
    return frame;
  }

  if (length < 65536) {
    const frame = Buffer.alloc(4 + length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payloadBuffer.copy(frame, 4);
    return frame;
  }

  const frame = Buffer.alloc(10 + length);
  frame[0] = 0x81;
  frame[1] = 127;
  frame.writeBigUInt64BE(BigInt(length), 2);
  payloadBuffer.copy(frame, 10);
  return frame;
}

function decodeSocketFrame(buffer) {
  const firstByte = buffer[0];
  const opCode = firstByte & 0x0f;
  if (opCode === 0x8) return null;

  const secondByte = buffer[1];
  const masked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  }

  if (payloadLength === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);
  if (masked) {
    const maskingKey = buffer.subarray(offset, offset + 4);
    payload = buffer.subarray(offset + 4, offset + 4 + payloadLength);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskingKey[i % 4];
    }
  }

  return payload.toString('utf8');
}

function send(socket, data) {
  socket.write(createSocketFrame(JSON.stringify(data)));
}

function removeFromMatchmaking(socket) {
  const index = matchmakingQueue.indexOf(socket);
  if (index !== -1) {
    matchmakingQueue.splice(index, 1);
  }
}

function eventTextFromMove(event) {
  const playerName = event.player === 'w' ? 'White' : 'Black';
  const target = String.fromCharCode(97 + event.to[1]) + (8 - event.to[0]);
  const captureText = event.captured ? ' and captured ' + event.captured : '';
  return playerName + ' moved ' + event.piece + ' to ' + target + captureText + '.';
}

function broadcastRoom(room, message) {
  if (room.white) send(room.white, message);
  if (room.black) send(room.black, message);
}

function syncRoom(room, eventText = '') {
  const payload = {
    type: 'state',
    state: cloneState(room.game),
    ranked: Boolean(room.ranked),
    players: {
      white: Boolean(room.white),
      black: Boolean(room.black)
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

  broadcastRoom(room, payload);
}

function leaveCurrentRoom(socket) {
  removeFromMatchmaking(socket);

  const client = clients.get(socket);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  if (room.white === socket) room.white = null;
  if (room.black === socket) room.black = null;

  client.roomId = null;
  client.color = null;

  if (!room.white && !room.black) {
    rooms.delete(room.id);
    return;
  }

  broadcastRoom(room, {
    type: 'player-left',
    players: {
      white: Boolean(room.white),
      black: Boolean(room.black)
    }
  });
  syncRoom(room);
}

function createRoomForPlayers(whiteSocket, blackSocket, ranked = false) {
  let roomId = createRoomId();
  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const room = {
    id: roomId,
    white: null,
    black: null,
    whiteToken: null,
    blackToken: null,
    whiteProfileId: null,
    blackProfileId: null,
    whiteName: 'White',
    blackName: 'Black',
    ranked,
    rated: false,
    game: createGameState()
  };

  rooms.set(roomId, room);

  attachToRoom(whiteSocket, room, 'w');
  saveSeatMeta(room, 'w', clients.get(whiteSocket));

  attachToRoom(blackSocket, room, 'b');
  saveSeatMeta(room, 'b', clients.get(blackSocket));

  const whiteClient = clients.get(whiteSocket);
  const blackClient = clients.get(blackSocket);

  send(whiteSocket, {
    type: 'room-joined',
    roomId,
    color: 'w',
    playerToken: whiteClient.playerToken,
    profileId: whiteClient.profileId,
    name: whiteClient.name,
    rating: getRating(whiteClient.profileId),
    matched: true
  });

  send(blackSocket, {
    type: 'room-joined',
    roomId,
    color: 'b',
    playerToken: blackClient.playerToken,
    profileId: blackClient.profileId,
    name: blackClient.name,
    rating: getRating(blackClient.profileId),
    matched: true
  });

  syncRoom(room, 'Match found. Game started.');
}

function attachToRoom(socket, room, color) {
  const client = clients.get(socket);
  client.roomId = room.id;
  client.color = color;

  if (color === 'w') room.white = socket;
  if (color === 'b') room.black = socket;
}

function saveSeatMeta(room, color, client) {
  if (color === 'w') {
    room.whiteToken = client.playerToken;
    room.whiteProfileId = client.profileId;
    room.whiteName = client.name || 'White';
  }
  if (color === 'b') {
    room.blackToken = client.playerToken;
    room.blackProfileId = client.profileId;
    room.blackName = client.name || 'Black';
  }
}

function handleCreateRoom(socket, name, profileId) {
  leaveCurrentRoom(socket);

  const client = clients.get(socket);
  client.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 18) : 'White';
  client.playerToken = crypto.randomUUID();
  client.profileId = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : crypto.randomUUID();

  let roomId = createRoomId();
  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const room = {
    id: roomId,
    white: null,
    black: null,
    whiteToken: null,
    blackToken: null,
    whiteProfileId: null,
    blackProfileId: null,
    whiteName: 'White',
    blackName: 'Black',
    ranked: false,
    rated: false,
    game: createGameState()
  };

  rooms.set(roomId, room);
  attachToRoom(socket, room, 'w');
  saveSeatMeta(room, 'w', client);

  send(socket, {
    type: 'room-created',
    roomId,
    color: 'w',
    playerToken: client.playerToken,
    profileId: client.profileId,
    name: room.whiteName,
    rating: getRating(client.profileId)
  });
  syncRoom(room);
}

function handleQuickMatch(socket, name, profileId) {
  leaveCurrentRoom(socket);

  const client = clients.get(socket);
  client.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 18) : 'Player';
  client.playerToken = crypto.randomUUID();
  client.profileId = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : crypto.randomUUID();

  let opponent = null;
  while (matchmakingQueue.length > 0 && !opponent) {
    const candidate = matchmakingQueue.shift();
    if (candidate !== socket && clients.has(candidate)) {
      opponent = candidate;
    }
  }

  if (!opponent) {
    matchmakingQueue.push(socket);
    send(socket, { type: 'queue-status', status: 'waiting' });
    return;
  }

  const opponentClient = clients.get(opponent);
  if (!opponentClient) {
    matchmakingQueue.push(socket);
    send(socket, { type: 'queue-status', status: 'waiting' });
    return;
  }

  createRoomForPlayers(opponent, socket, true);
}

function handleCancelQuickMatch(socket) {
  removeFromMatchmaking(socket);
  send(socket, { type: 'queue-status', status: 'idle' });
}

function handleJoinRoom(socket, roomId, name, profileId) {
  if (!roomId || typeof roomId !== 'string') {
    send(socket, { type: 'room-error', message: 'Invalid room code.' });
    return;
  }

  leaveCurrentRoom(socket);

  const room = rooms.get(roomId.toUpperCase());
  if (!room) {
    send(socket, { type: 'room-error', message: 'Room not found.' });
    return;
  }

  let color = null;
  if (!room.white) color = 'w';
  else if (!room.black) color = 'b';

  if (!color) {
    send(socket, { type: 'room-error', message: 'This room is already full.' });
    return;
  }

  const client = clients.get(socket);
  client.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 18) : (color === 'w' ? 'White' : 'Black');
  client.playerToken = crypto.randomUUID();
  client.profileId = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : crypto.randomUUID();
  attachToRoom(socket, room, color);
  saveSeatMeta(room, color, client);
  send(socket, {
    type: 'room-joined',
    roomId: room.id,
    color,
    playerToken: client.playerToken,
    profileId: client.profileId,
    name: client.name,
    rating: getRating(client.profileId)
  });
  syncRoom(room, (color === 'w' ? 'White' : 'Black') + ' joined the room.');
}

function handleReconnect(socket, roomId, playerToken, name, profileId) {
  if (!roomId || !playerToken) {
    send(socket, { type: 'room-error', message: 'Reconnect payload is incomplete.' });
    return;
  }

  leaveCurrentRoom(socket);

  const room = rooms.get(String(roomId).toUpperCase());
  if (!room) {
    send(socket, { type: 'room-error', message: 'Saved room no longer exists.' });
    return;
  }

  let color = null;
  if (room.whiteToken === playerToken) color = 'w';
  if (room.blackToken === playerToken) color = 'b';

  if (!color) {
    send(socket, { type: 'room-error', message: 'Reconnect token is invalid.' });
    return;
  }

  const client = clients.get(socket);
  client.playerToken = playerToken;
  client.profileId = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : (color === 'w' ? room.whiteProfileId : room.blackProfileId);
  client.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 18) : (color === 'w' ? room.whiteName : room.blackName);

  attachToRoom(socket, room, color);
  saveSeatMeta(room, color, client);
  send(socket, {
    type: 'room-joined',
    roomId: room.id,
    color,
    playerToken,
    profileId: client.profileId,
    name: client.name,
    rating: getRating(client.profileId),
    reconnected: true
  });
  syncRoom(room, client.name + ' reconnected.');
}

function applyRoomElo(room, winnerColor) {
  if (!room.ranked) return '';
  if (room.rated) return '';
  const loserColor = winnerColor === 'w' ? 'b' : 'w';
  const winnerProfileId = winnerColor === 'w' ? room.whiteProfileId : room.blackProfileId;
  const loserProfileId = loserColor === 'w' ? room.whiteProfileId : room.blackProfileId;
  if (!winnerProfileId || !loserProfileId) return '';

  const nextWinnerRating = getRating(winnerProfileId) + ELO_DELTA;
  const nextLoserRating = getRating(loserProfileId) - ELO_DELTA;
  setRating(winnerProfileId, nextWinnerRating);
  setRating(loserProfileId, nextLoserRating);
  room.rated = true;

  const winnerName = winnerColor === 'w' ? room.whiteName : room.blackName;
  const loserName = loserColor === 'w' ? room.whiteName : room.blackName;
  return winnerName + ' gains +' + ELO_DELTA + ' Elo. ' + loserName + ' loses -' + ELO_DELTA + ' Elo.';
}

function handleMove(socket, from, to) {
  const client = clients.get(socket);
  if (!client?.roomId || !client.color) {
    send(socket, { type: 'room-error', message: 'Join a room first.' });
    return;
  }

  const room = rooms.get(client.roomId);
  if (!room) {
    send(socket, { type: 'room-error', message: 'Room no longer exists.' });
    return;
  }

  if (!Array.isArray(from) || !Array.isArray(to)) {
    send(socket, { type: 'room-error', message: 'Malformed move payload.' });
    return;
  }

  const result = makeMove(room.game, client.color, from[0], from[1], to[0], to[1], Date.now());
  if (!result.ok) {
    send(socket, { type: 'room-error', message: result.error });
    syncRoom(room);
    return;
  }

  const eloText = result.event.winner ? applyRoomElo(room, result.event.winner) : '';
  const combinedText = [eventTextFromMove(result.event), eloText].filter(Boolean).join(' ');
  syncRoom(room, combinedText);
}

function onClientMessage(socket, rawMessage) {
  const message = parseJson(rawMessage);
  if (!message?.type) {
    send(socket, { type: 'room-error', message: 'Malformed message.' });
    return;
  }

  switch (message.type) {
    case 'create-room':
      handleCreateRoom(socket, message.name, message.profileId);
      break;
    case 'join-room':
      handleJoinRoom(socket, message.roomId, message.name, message.profileId);
      break;
    case 'quick-match':
      handleQuickMatch(socket, message.name, message.profileId);
      break;
    case 'cancel-quick-match':
      handleCancelQuickMatch(socket);
      break;
    case 'reconnect':
      handleReconnect(socket, message.roomId, message.playerToken, message.name, message.profileId);
      break;
    case 'make-move':
      handleMove(socket, message.from, message.to);
      break;
    default:
      send(socket, { type: 'room-error', message: 'Unknown message type.' });
      break;
  }
}

const server = http.createServer((req, res) => {
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  reqPath = reqPath.split('?')[0];

  const resolvedPath = path.normalize(path.join(__dirname, reqPath));
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + accept,
    '',
    ''
  ].join('\r\n'));

  clients.set(socket, {
    id: crypto.randomUUID(),
    roomId: null,
    color: null,
    profileId: null,
    name: null,
    playerToken: null
  });

  send(socket, { type: 'welcome', clientId: clients.get(socket).id });

  socket.on('data', buffer => {
    try {
      const message = decodeSocketFrame(buffer);
      if (message === null) {
        socket.end();
        return;
      }
      onClientMessage(socket, message);
    } catch {
      send(socket, { type: 'room-error', message: 'Network frame error.' });
    }
  });

  socket.on('close', () => {
    leaveCurrentRoom(socket);
    clients.delete(socket);
  });

  socket.on('end', () => {
    leaveCurrentRoom(socket);
    clients.delete(socket);
  });

  socket.on('error', () => {
    leaveCurrentRoom(socket);
    clients.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log('HyperChess online server running on http://localhost:' + PORT);
});
