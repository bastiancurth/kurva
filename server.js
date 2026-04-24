'use strict';

var express = require('express');
var http = require('http');
var path = require('path');
var Server = require('socket.io').Server;

var app = express();
var server = http.createServer(app);
var io = new Server(server);

var PORT = process.env.PORT || 3000;
var MAX_PLAYERS = 5;
var RECONNECT_GRACE_MS = 120000;
var CLEANUP_INTERVAL_MS = 30000;
var PLAYER_IDS = ['red', 'orange', 'green', 'blue', 'purple'];
var ONLINE_FIELD_WIDTH = 1280;
var ONLINE_FIELD_HEIGHT = 720;
var ONLINE_FIELD_BORDER_PADDING = 80;
var ONLINE_MIN_SPAWN_DISTANCE = 130;
var SUPERPOWER_TYPES = [
    'RUN_FASTER',
    'RUN_SLOWER',
    'JUMP',
    'INVISIBLE',
    'VERTICAL_BAR',
    'CROSS_WALLS',
    'DARK_KNIGHT',
    'HYDRA',
    'REVERSE',
    'SQUARE_HEAD',
    'CHUCK_NORRIS',
    'SHOOT_HOLES',
];
var PUBLIC_ROOMS = [
    { code: 'werewolfs-den', name: "Werewolf's Den 🐺" },
    { code: 'javiers-pc', name: "Javier's PC" },
    { code: 'kaufland-corner', name: 'Kaufland Corner' },
    { code: 'break-room', name: 'Break Room' },
    { code: 'dev-hub', name: 'Dev Hub' },
    { code: 'qa-bench', name: 'QA Bench' },
    { code: 'lunch-table', name: 'Lunch Table' },
    { code: 'projector-lane', name: 'Projector Lane' },
    { code: 'server-room', name: 'Server Room' },
    { code: 'quiet-desk', name: 'Quiet Desk' },
];

var rooms = {};
var socketToRoom = {};
var socketToSession = {};

PUBLIC_ROOMS.forEach(function(roomDefinition) {
    rooms[roomDefinition.code] = {
        code: roomDefinition.code,
        name: roomDefinition.name,
        hostSessionId: null,
        players: [],
        assignments: {},
        matchActive: false,
        lastActivityAt: Date.now(),
    };
});

function sanitizeLabel(value, fallback, maxLength) {
    var normalized = typeof value === 'string' ? value.trim() : '';
    var symbols = Array.from(normalized);
    if (symbols.length === 0) return fallback;

    return symbols.slice(0, maxLength).join('');
}

function sanitizeSessionId(sessionId) {
    if (typeof sessionId !== 'string') return null;

    var cleaned = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64);
    if (cleaned.length < 8) return null;

    return cleaned;
}

function randomFloat(seedState) {
    seedState.value = (1664525 * seedState.value + 1013904223) >>> 0;
    return seedState.value / 4294967296;
}

function randomInt(seedState, min, max) {
    return min + Math.floor(randomFloat(seedState) * (max - min + 1));
}

function randomSpawn(seedState) {
    return {
        x: randomInt(seedState, ONLINE_FIELD_BORDER_PADDING, ONLINE_FIELD_WIDTH - ONLINE_FIELD_BORDER_PADDING),
        y: randomInt(seedState, ONLINE_FIELD_BORDER_PADDING, ONLINE_FIELD_HEIGHT - ONLINE_FIELD_BORDER_PADDING),
        angle: randomFloat(seedState) * Math.PI * 2,
    };
}

function getDistanceSquared(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function buildRoundStart(seed, connectedPlayers) {
    var seedState = { value: seed >>> 0 };
    var roundStart = {};
    var usedPositions = [];
    var minDistanceSquared = ONLINE_MIN_SPAWN_DISTANCE * ONLINE_MIN_SPAWN_DISTANCE;

    connectedPlayers.forEach(function(player) {
        var spawn = null;

        for (var i = 0; i < 40; i++) {
            var candidate = randomSpawn(seedState);
            var hasConflict = usedPositions.some(function(existingSpawn) {
                return getDistanceSquared(existingSpawn, candidate) < minDistanceSquared;
            });

            if (!hasConflict) {
                spawn = candidate;
                break;
            }
        }

        if (spawn === null) {
            spawn = randomSpawn(seedState);
        }

        usedPositions.push(spawn);
        roundStart[player.playerId] = spawn;
    });

    return roundStart;
}

function buildSuperpowerAssignments(seed, connectedPlayers) {
    var seedState = { value: (seed ^ 0x9e3779b9) >>> 0 };
    var assignments = {};

    connectedPlayers.forEach(function(player) {
        var type = SUPERPOWER_TYPES[randomInt(seedState, 0, SUPERPOWER_TYPES.length - 1)];
        assignments[player.playerId] = type;
    });

    return assignments;
}

function touchRoom(room) {
    room.lastActivityAt = Date.now();
}

function getConnectedPlayers(room) {
    return room.players.filter(function(player) {
        return player.connected === true;
    });
}

function normalizePlayerName(name) {
    return sanitizeLabel(name, 'Player', 16).toLowerCase();
}

function isNameTaken(room, playerName, sessionId) {
    var normalizedName = normalizePlayerName(playerName);

    for (var i = 0; i < room.players.length; i++) {
        var player = room.players[i];
        if (player.sessionId === sessionId) continue;
        if (normalizePlayerName(player.name) === normalizedName) return true;
    }

    return false;
}

function resolveHostSocketId(room) {
    for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].sessionId === room.hostSessionId && room.players[i].connected) {
            return room.players[i].socketId;
        }
    }

    var connectedPlayers = getConnectedPlayers(room);
    return connectedPlayers.length > 0 ? connectedPlayers[0].socketId : null;
}

function isAssignedSessionConnected(room, sessionId) {
    for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].sessionId === sessionId) {
            return room.players[i].connected === true;
        }
    }

    return false;
}

function areAllAssignedPlayersConnected(room) {
    var sessions = Object.keys(room.assignments);
    for (var i = 0; i < sessions.length; i++) {
        if (!isAssignedSessionConnected(room, sessions[i])) {
            return false;
        }
    }

    return sessions.length > 0;
}

function removePlayerFromRoom(room, sessionId) {
    room.players = room.players.filter(function(player) {
        return player.sessionId !== sessionId;
    });
    delete room.assignments[sessionId];

    if (room.hostSessionId === sessionId) {
        room.hostSessionId = room.players.length > 0 ? room.players[0].sessionId : null;
    }
}

function randomRoomCode() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';

    for (var i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    return code;
}

function createUniqueRoomCode() {
    var maxRetries = 20;

    for (var i = 0; i < maxRetries; i++) {
        var code = randomRoomCode();
        if (!rooms[code]) return code;
    }

    throw new Error('Unable to allocate room code');
}

function getRoomState(room) {
    return {
        roomCode: room.code,
        roomName: room.name,
        hostSocketId: resolveHostSocketId(room),
        players: room.players.map(function(player) {
            return {
                socketId: player.socketId,
                sessionId: player.sessionId,
                playerId: player.playerId,
                name: player.name,
                connected: player.connected,
            };
        }),
    };
}

function getRoomList() {
    return PUBLIC_ROOMS.map(function(roomDefinition) {
        var room = rooms[roomDefinition.code];
        var connectedPlayers = getConnectedPlayers(room).length;

        return {
            roomCode: room.code,
            roomName: room.name,
            connectedPlayers: connectedPlayers,
            maxPlayers: MAX_PLAYERS,
            matchActive: room.matchActive === true,
        };
    });
}

function emitRoomList(targetSocket) {
    var payload = { rooms: getRoomList() };

    if (targetSocket) {
        targetSocket.emit('kurve:rooms-list', payload);
        return;
    }

    io.emit('kurve:rooms-list', payload);
}

function emitRoomState(roomCode) {
    var room = rooms[roomCode];
    if (!room) return;

    io.to(roomCode).emit('kurve:room-state', getRoomState(room));
}

function leaveRoom(socket, keepSeat) {
    var roomCode = socketToRoom[socket.id];
    var sessionId = socketToSession[socket.id];
    if (!roomCode) return;

    var room = rooms[roomCode];
    if (!room) {
        delete socketToRoom[socket.id];
        delete socketToSession[socket.id];
        return;
    }

    delete socketToRoom[socket.id];
    delete socketToSession[socket.id];

    socket.leave(roomCode);

    if (!sessionId) return;

    var player = null;
    for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].sessionId === sessionId) {
            player = room.players[i];
            break;
        }
    }

    if (!player) return;

    if (keepSeat && room.matchActive && room.assignments[sessionId]) {
        player.connected = false;
        player.socketId = null;
        player.disconnectedAt = Date.now();

        io.to(roomCode).emit('kurve:player-drop', {
            playerId: player.playerId,
            name: player.name,
        });
        io.to(roomCode).emit('kurve:control', { action: 'pause' });
    } else {
        removePlayerFromRoom(room, sessionId);
    }

    if (Object.keys(room.assignments).length < 2) {
        room.matchActive = false;
    }

    touchRoom(room);

    if (room.players.length === 0) {
        room.assignments = {};
        room.matchActive = false;
        room.hostSessionId = null;
        touchRoom(room);
        emitRoomState(roomCode);
        emitRoomList();
        return;
    }

    emitRoomState(roomCode);
    emitRoomList();
}

function addPlayerToRoom(socket, roomCode, name, sessionId) {
    var room = rooms[roomCode];
    var validSessionId = sanitizeSessionId(sessionId);
    var sanitizedName = sanitizeLabel(name, 'Player', 16);

    if (!validSessionId) {
        socket.emit('kurve:error', { message: 'Invalid session. Refresh and try again.' });
        return;
    }

    if (!room) {
        socket.emit('kurve:error', { message: 'Room not found.' });
        return;
    }

    var reconnectingPlayer = null;

    for (var i = 0; i < room.players.length; i++) {
        if (room.players[i].sessionId === validSessionId) {
            reconnectingPlayer = room.players[i];
            break;
        }
    }

    if (!reconnectingPlayer && room.matchActive) {
        socket.emit('kurve:error', { message: 'Match is running. Please wait for the next game.' });
        return;
    }

    if (!reconnectingPlayer && room.players.length >= MAX_PLAYERS) {
        socket.emit('kurve:error', { message: 'Room is full.' });
        return;
    }

    if (!reconnectingPlayer && isNameTaken(room, sanitizedName, validSessionId)) {
        socket.emit('kurve:error', { message: 'That name is already in this room.' });
        return;
    }

    leaveRoom(socket, false);

    if (reconnectingPlayer) {
        reconnectingPlayer.socketId = socket.id;
        reconnectingPlayer.connected = true;
        reconnectingPlayer.disconnectedAt = null;
        reconnectingPlayer.name = sanitizedName;
    } else {
        var usedPlayerIds = room.players.map(function(player) {
            return player.playerId;
        });

        var playerId = null;
        for (var j = 0; j < PLAYER_IDS.length; j++) {
            if (usedPlayerIds.indexOf(PLAYER_IDS[j]) < 0) {
                playerId = PLAYER_IDS[j];
                break;
            }
        }

        if (playerId === null) {
            socket.emit('kurve:error', { message: 'No player slots left.' });
            return;
        }

        room.players.push({
            socketId: socket.id,
            sessionId: validSessionId,
            playerId: playerId,
            name: sanitizedName,
            connected: true,
            disconnectedAt: null,
        });
    }

    socketToRoom[socket.id] = roomCode;
    socketToSession[socket.id] = validSessionId;
    socket.join(roomCode);

    touchRoom(room);

    if (reconnectingPlayer) {
        io.to(roomCode).emit('kurve:player-rejoin', {
            playerId: reconnectingPlayer.playerId,
            name: reconnectingPlayer.name,
        });

        if (room.matchActive && areAllAssignedPlayersConnected(room)) {
            io.to(roomCode).emit('kurve:control', { action: 'resume' });
        }
    }

    emitRoomState(roomCode);
}

function cleanupRooms() {
    var now = Date.now();
    var roomCodes = Object.keys(rooms);

    for (var i = 0; i < roomCodes.length; i++) {
        var roomCode = roomCodes[i];
        var room = rooms[roomCode];
        if (!room) continue;

        var disconnectedSessions = [];

        for (var j = 0; j < room.players.length; j++) {
            var player = room.players[j];
            if (!player.connected && player.disconnectedAt && (now - player.disconnectedAt) > RECONNECT_GRACE_MS) {
                disconnectedSessions.push(player.sessionId);
            }
        }

        for (var k = 0; k < disconnectedSessions.length; k++) {
            removePlayerFromRoom(room, disconnectedSessions[k]);
        }

        if (Object.keys(room.assignments).length < 2) {
            room.matchActive = false;
        }

        if (disconnectedSessions.length > 0) {
            emitRoomState(roomCode);
            emitRoomList();
        }

        if (room.players.length === 0) {
            room.assignments = {};
            room.matchActive = false;
            room.hostSessionId = null;
            emitRoomState(roomCode);
        }
    }
}

app.use(express.static(path.resolve(__dirname)));

app.get('/healthz', function(req, res) {
    res.status(200).json({ ok: true });
});

io.on('connection', function(socket) {
    emitRoomList(socket);

    socket.on('kurve:rooms-list-request', function() {
        emitRoomList(socket);
    });

    socket.on('kurve:create-room', function(payload) {
        socket.emit('kurve:error', { message: 'Use the suggested rooms list.' });
    });

    socket.on('kurve:join-room', function(payload) {
        if (!payload || !payload.roomCode) {
            socket.emit('kurve:error', { message: 'Invalid room code.' });
            return;
        }

        var roomCode = String(payload.roomCode).trim();
        addPlayerToRoom(socket, roomCode, payload.name, payload.sessionId);
        emitRoomList();
    });

    socket.on('kurve:leave-room', function() {
        leaveRoom(socket, false);
        emitRoomList();
    });

    socket.on('kurve:start-match', function(payload) {
        var roomCode = payload && payload.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        var room = rooms[roomCode];
        if (resolveHostSocketId(room) !== socket.id) return;

        var connectedPlayers = getConnectedPlayers(room);
        if (connectedPlayers.length < 2) {
            socket.emit('kurve:error', { message: 'At least 2 connected players are required.' });
            return;
        }

        room.assignments = {};
        connectedPlayers.forEach(function(player) {
            room.assignments[player.sessionId] = player.playerId;
        });
        room.matchActive = true;
        touchRoom(room);

        var seed = Math.floor(Math.random() * 4294967295);
        var roundStart = buildRoundStart(seed, connectedPlayers);
        var superpowers = buildSuperpowerAssignments(seed, connectedPlayers);

        io.to(roomCode).emit('kurve:match-start', {
            seed: seed,
            assignments: room.assignments,
            roundStart: roundStart,
            superpowers: superpowers,
            players: connectedPlayers.map(function(player) {
                return {
                    sessionId: player.sessionId,
                    playerId: player.playerId,
                    name: player.name,
                };
            }),
        });
        emitRoomList();
    });

    socket.on('kurve:input', function(payload) {
        var roomCode = payload && payload.roomCode;
        if (!roomCode || !rooms[roomCode]) return;
        if (socketToRoom[socket.id] !== roomCode) return;

        var room = rooms[roomCode];
        var sessionId = socketToSession[socket.id];
        var playerId = sessionId ? room.assignments[sessionId] : null;
        if (!playerId) return;

        touchRoom(room);

        io.to(roomCode).emit('kurve:input', {
            playerId: playerId,
            action: payload.action,
            isDown: payload.isDown === true,
            applyFrame: parseInt(payload.applyFrame, 10),
        });
    });

    socket.on('kurve:control', function(payload) {
        var roomCode = payload && payload.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        var room = rooms[roomCode];
        if (socketToRoom[socket.id] !== roomCode) return;

        var sessionId = socketToSession[socket.id];
        if (!sessionId || !room.assignments[sessionId]) return;
        if (payload.action === 'next-round' && resolveHostSocketId(room) !== socket.id) return;

        touchRoom(room);

        var controlPayload = {
            action: payload.action,
        };

        if (payload.action === 'next-round') {
            var connectedPlayers = getConnectedPlayers(room);
            var roundSeed = Math.floor(Math.random() * 4294967295);
            controlPayload.roundStart = buildRoundStart(roundSeed, connectedPlayers);
        }

        io.to(roomCode).emit('kurve:control', {
            action: controlPayload.action,
            roundStart: controlPayload.roundStart,
        });
    });

    socket.on('disconnect', function() {
        leaveRoom(socket, true);
        emitRoomList();
    });
});

setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

server.listen(PORT, function() {
    console.log('Kurve server listening on port ' + PORT);
});