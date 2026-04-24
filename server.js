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
var EMPTY_ROOM_TTL_MS = 300000;
var CLEANUP_INTERVAL_MS = 30000;
var PLAYER_IDS = ['red', 'orange', 'green', 'blue', 'purple'];

var rooms = {};
var socketToRoom = {};
var socketToSession = {};

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

function touchRoom(room) {
    room.lastActivityAt = Date.now();
}

function getConnectedPlayers(room) {
    return room.players.filter(function(player) {
        return player.connected === true;
    });
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
        delete rooms[roomCode];
        return;
    }

    emitRoomState(roomCode);
}

function addPlayerToRoom(socket, roomCode, name, sessionId) {
    var room = rooms[roomCode];
    var validSessionId = sanitizeSessionId(sessionId);

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

    leaveRoom(socket, false);

    if (reconnectingPlayer) {
        reconnectingPlayer.socketId = socket.id;
        reconnectingPlayer.connected = true;
        reconnectingPlayer.disconnectedAt = null;
        reconnectingPlayer.name = sanitizeLabel(name, reconnectingPlayer.name, 16);
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
            name: sanitizeLabel(name, 'Player', 16),
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

        var connectedPlayers = getConnectedPlayers(room);
        var idleTooLong = connectedPlayers.length === 0 && (now - room.lastActivityAt) > EMPTY_ROOM_TTL_MS;

        if (room.players.length === 0 || idleTooLong) {
            delete rooms[roomCode];
            continue;
        }

        if (disconnectedSessions.length > 0) {
            emitRoomState(roomCode);
        }
    }
}

app.use(express.static(path.resolve(__dirname)));

app.get('/healthz', function(req, res) {
    res.status(200).json({ ok: true });
});

io.on('connection', function(socket) {
    socket.on('kurve:create-room', function(payload) {
        var roomCode;

        try {
            roomCode = createUniqueRoomCode();
        } catch (error) {
            socket.emit('kurve:error', { message: 'Could not create room. Try again.' });
            return;
        }

        rooms[roomCode] = {
            code: roomCode,
            name: sanitizeLabel(payload && payload.roomName, 'Team Room', 32),
            hostSessionId: sanitizeSessionId(payload && payload.sessionId),
            players: [],
            assignments: {},
            matchActive: false,
            lastActivityAt: Date.now(),
        };

        if (!rooms[roomCode].hostSessionId) {
            delete rooms[roomCode];
            socket.emit('kurve:error', { message: 'Invalid session. Refresh and try again.' });
            return;
        }

        addPlayerToRoom(socket, roomCode, payload && payload.name, payload && payload.sessionId);
    });

    socket.on('kurve:join-room', function(payload) {
        if (!payload || !payload.roomCode) {
            socket.emit('kurve:error', { message: 'Invalid room code.' });
            return;
        }

        var roomCode = String(payload.roomCode).toUpperCase();
        addPlayerToRoom(socket, roomCode, payload.name, payload.sessionId);
    });

    socket.on('kurve:leave-room', function() {
        leaveRoom(socket, false);
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

        io.to(roomCode).emit('kurve:match-start', {
            seed: Math.floor(Math.random() * 4294967295),
            assignments: room.assignments,
            players: connectedPlayers.map(function(player) {
                return {
                    sessionId: player.sessionId,
                    playerId: player.playerId,
                    name: player.name,
                };
            }),
        });
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

        socket.to(roomCode).emit('kurve:input', {
            playerId: playerId,
            action: payload.action,
            isDown: payload.isDown === true,
        });
    });

    socket.on('kurve:control', function(payload) {
        var roomCode = payload && payload.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        var room = rooms[roomCode];
        if (socketToRoom[socket.id] !== roomCode) return;

        var sessionId = socketToSession[socket.id];
        if (!sessionId || !room.assignments[sessionId]) return;

        touchRoom(room);

        socket.to(roomCode).emit('kurve:control', {
            action: payload.action,
        });
    });

    socket.on('disconnect', function() {
        leaveRoom(socket, true);
    });
});

setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

server.listen(PORT, function() {
    console.log('Kurve server listening on port ' + PORT);
});