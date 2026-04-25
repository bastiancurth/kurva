/**
 *
 * Program:     Kurve
 * Author:      Markus Maechler, marmaechler@gmail.com
 * License:     http://www.gnu.org/licenses/gpl.txt
 * Link:        http://achtungkurve.com
 *
 * Copyright (c) 2014, 2015 Markus Maechler
 *
 * Kurve is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Kurve is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Kurve.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

'use strict';

Kurve.Online = {

    socket: null,
    roomCode: null,
    roomName: null,
    players: [],
    maxPlayers: 5,
    hostSocketId: null,
    localSocketId: null,
    sessionId: null,
    localPlayerId: null,
    activePlayerIds: [],
    assignedSuperpowers: {},
    localName: 'Player',
    isMatchActive: false,
    socketIoClientLoading: false,

    sessionStorageKey: 'kurve-online-session-id',
    allowedPlayerIds: ['red', 'orange', 'green', 'blue', 'purple'],

    elements: {
        status: null,
        playerNameInput: null,
        roomList: null,
        joinRoomButton: null,
        leaveRoomButton: null,
        startMatchButton: null,
    },

    init: function() {
        this.initSessionId();
        this.initUi();
        this.ensureSocketConnection();
        this.setStatus('Online rooms will appear when the connection is ready.');
    },

    isSocketIoAvailable: function() {
        return typeof window.io === 'function';
    },

    initUi: function() {
        if (document.getElementById('menu-players')) {
            u.addClass('hidden', 'menu-players');
        }

        var container = document.createElement('div');
        container.id = 'online-panel';
        container.className = 'light';
        container.innerHTML =
            '<h4>Online Multiplayer by Bastian Curth</h4>' +
            '<div class="online-row online-note">' +
                '<span>Up to 5 players per room. Enter a name, then join a room.</span>' +
            '</div>' +
            '<div class="online-row">' +
                '<input id="online-player-name" type="text" maxlength="16" placeholder="Your name" value="Player" />' +
            '</div>' +
            '<div class="online-row">' +
                '<button id="online-start" class="button" disabled>Start match</button>' +
                '<button id="online-leave" class="button" disabled>Leave</button>' +
            '</div>' +
            '<div class="online-room-list-wrap">' +
                '<h5>Suggested rooms</h5>' +
                '<div id="online-room-list" class="online-room-list">Loading rooms ...</div>' +
            '</div>' +
            '<div id="online-status" class="online-status">Offline</div>';

        document.getElementById('menu-settings').insertAdjacentElement('afterend', container);

        this.elements.status = document.getElementById('online-status');
        this.elements.playerNameInput = document.getElementById('online-player-name');
        this.elements.joinRoomButton = null;
        this.elements.leaveRoomButton = document.getElementById('online-leave');
        this.elements.startMatchButton = document.getElementById('online-start');
        this.elements.roomList = document.getElementById('online-room-list');
        this.elements.leaveRoomButton.addEventListener('click', this.onLeaveRoom.bind(this));
        this.elements.startMatchButton.addEventListener('click', this.onStartMatch.bind(this));
    },

    ensureSocketConnection: function() {
        if (!this.isSocketIoAvailable()) {
            this.loadSocketIoClient();
            return false;
        }

        if (this.socket !== null) return true;

        this.socket = window.io();

        this.socket.on('connect', function() {
            this.localSocketId = this.socket.id;

            if (this.roomCode !== null) {
                this.socket.emit('kurve:join-room', {
                    roomCode: this.roomCode,
                    name: this.getPlayerName(),
                    sessionId: this.sessionId,
                });
                this.setStatus('Reconnecting to room ' + this.roomCode + ' ...');
                return;
            }

            this.setStatus('Connected. Create or join a room.');
        }.bind(this));

        this.socket.on('disconnect', function() {
            this.localSocketId = null;
            this.syncButtons();
            this.setStatus('Disconnected. Trying to reconnect ...');
        }.bind(this));

        this.socket.on('kurve:error', function(payload) {
            this.setStatus(payload.message);
        }.bind(this));

        this.socket.on('kurve:room-state', function(payload) {
            this.onRoomState(payload);
        }.bind(this));

        this.socket.on('kurve:match-start', function(payload) {
            this.onMatchStart(payload);
        }.bind(this));

        this.socket.on('kurve:input', function(payload) {
            this.onRemoteInput(payload);
        }.bind(this));

        this.socket.on('kurve:control', function(payload) {
            this.onRemoteControl(payload);
        }.bind(this));

        this.socket.on('kurve:player-drop', function(payload) {
            this.onPlayerDrop(payload);
        }.bind(this));

        this.socket.on('kurve:player-rejoin', function(payload) {
            this.onPlayerRejoin(payload);
        }.bind(this));

        this.socket.on('kurve:rooms-list', function(payload) {
            this.renderRoomList(payload.rooms || []);
        }.bind(this));

        this.socket.emit('kurve:rooms-list-request');

        return true;
    },

    loadSocketIoClient: function() {
        if (this.socketIoClientLoading || this.isSocketIoAvailable()) return;

        this.socketIoClientLoading = true;

        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = '/socket.io/socket.io.js';
        script.onload = function() {
            this.socketIoClientLoading = false;
            this.setStatus('Multiplayer client loaded.');
            this.ensureSocketConnection();
        }.bind(this);
        script.onerror = function() {
            this.socketIoClientLoading = false;
            this.setStatus('Multiplayer client could not be loaded.');
        }.bind(this);

        document.head.appendChild(script);
    },

    onCreateRoom: function() {
        return;
    },

    onJoinRoom: function(roomCode) {
        if (!this.ensureSocketConnection()) return;

        if (!roomCode) {
            this.setStatus('Choose a room from the list.');
            return;
        }

        this.localName = this.getPlayerName();
        this.socket.emit('kurve:join-room', {
            roomCode: roomCode,
            name: this.localName,
            sessionId: this.sessionId,
        });
        this.setStatus('Joining ' + roomCode + ' ...');
    },

    onJoinRoomFromList: function(roomCode) {
        this.onJoinRoom(roomCode);
    },

    onLeaveRoom: function() {
        if (this.roomCode === null) return;

        if (this.socket !== null) {
            this.socket.emit('kurve:leave-room', { roomCode: this.roomCode });
        }

        this.roomCode = null;
        this.roomName = null;
        this.players = [];
        this.hostSocketId = null;
        this.localPlayerId = null;
        this.activePlayerIds = [];
        this.isMatchActive = false;
        this.syncButtons();
        this.setStatus('Room left.');
    },

    onStartMatch: function() {
        if (!this.isHost() || !this.hasMinimumPlayers() || this.roomCode === null) return;

        this.socket.emit('kurve:start-match', { roomCode: this.roomCode });
    },

    isRoomJoined: function() {
        return this.roomCode !== null;
    },

    isHost: function() {
        return this.localSocketId !== null && this.hostSocketId === this.localSocketId;
    },

    getConnectedPlayerCount: function() {
        var connected = 0;

        for (var i = 0; i < this.players.length; i++) {
            if (this.players[i].connected !== false) connected++;
        }

        return connected;
    },

    hasMinimumPlayers: function() {
        return this.getConnectedPlayerCount() >= 2;
    },

    getPlayerName: function() {
        var name = this.elements.playerNameInput.value.trim();
        if (name.length === 0) return 'Player';

        return name.substring(0, 16);
    },

    onRoomState: function(payload) {
        this.roomCode = payload.roomCode;
        this.roomName = payload.roomName || null;
        this.players = payload.players;
        this.hostSocketId = payload.hostSocketId;

        this.updatePlayerAssignment();
        this.syncButtons();

        var hostSuffix = this.isHost() ? ' You are host.' : '';
        var roomLabel = this.roomName || this.roomCode;
        this.setStatus('Room ' + roomLabel + ': ' + this.getConnectedPlayerCount() + '/' + this.maxPlayers + ' connected.' + hostSuffix);
    },

    renderRoomList: function(rooms) {
        if (!this.elements.roomList) return;

        if (!rooms || rooms.length === 0) {
            this.elements.roomList.innerHTML = '<div class="online-room-empty">No open rooms yet.</div>';
            return;
        }

        var roomHtml = '';

        for (var i = 0; i < rooms.length; i++) {
            var room = rooms[i];
            var label = room.roomName ? room.roomName : 'Room';
            var canJoin = room.connectedPlayers < room.maxPlayers && !room.matchActive;

            roomHtml += '<div class="online-room-item">' +
                '<div class="online-room-meta">' +
                    '<strong>' + label + '</strong>' +
                    '<span>' + room.connectedPlayers + '/' + room.maxPlayers + (room.matchActive ? ' · in match' : '') + '</span>' +
                '</div>' +
                '<button class="button" data-room-code="' + room.roomCode + '"' + (canJoin ? '' : ' disabled') + '>Join</button>' +
            '</div>';
        }

        this.elements.roomList.innerHTML = roomHtml;

        var buttons = this.elements.roomList.querySelectorAll('button[data-room-code]');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].addEventListener('click', function(event) {
                var code = event.currentTarget.getAttribute('data-room-code');
                this.onJoinRoomFromList(code);
            }.bind(this));
        }
    },

    updatePlayerAssignment: function() {
        var localPlayer = null;

        for (var i = 0; i < this.players.length; i++) {
            if (this.players[i].sessionId === this.sessionId) {
                localPlayer = this.players[i];
            }
        }

        this.localPlayerId = localPlayer ? localPlayer.playerId : null;
    },

    onMatchStart: function(payload) {
        this.isMatchActive = true;
        this.activePlayerIds = [];
        this.assignedSuperpowers = payload.superpowers || {};

        this.localPlayerId = payload.assignments[this.sessionId] || null;

        for (var i = 0; i < payload.players.length; i++) {
            this.activePlayerIds.push(payload.players[i].playerId);
        }

        if (this.localPlayerId === null) {
            this.setStatus('Missing local player assignment.');
            return;
        }

        this.startOnlineGame(payload.seed, payload.roundStart || null);
    },

    startOnlineGame: function(seed, roundStart) {
        Kurve.Game.resetSession();
        Kurve.Game.setDeterministicSeed(seed);
        Kurve.Game.setOnlineRoundStart(roundStart);
        this.prepareOnlinePlayers();
        Kurve.Game.setOnlineControls(this.localPlayerId);

        this.activePlayerIds.forEach(function(playerId) {
            Kurve.Game.curves.push(
                new Kurve.Curve(Kurve.getPlayer(playerId), Kurve.Game, Kurve.Field, Kurve.Config.Curve, Kurve.Sound.getAudioPlayer())
            );
        });

        Kurve.Field.init();
        Kurve.Menu.audioPlayer.pause('menu-music', {fade: 1000});
        Kurve.Game.startGame();

        u.addClass('online-mode', 'app');
        u.addClass('hidden', 'layer-menu');
        u.removeClass('hidden', 'layer-game');

        Kurve.Game.onSpaceDown();
        this.setStatus('Match started. You are ' + this.localPlayerId + '.');
    },

    prepareOnlinePlayers: function() {
        var availableTypes = Object.keys(Kurve.Superpowerconfig.types)
            .map(function(key) { return Kurve.Superpowerconfig.types[key]; })
            .filter(function(type) {
                return type !== Kurve.Superpowerconfig.types.NO_SUPERPOWER &&
                       type !== Kurve.Superpowerconfig.types.RANDOM;
            });

        Kurve.players.forEach(function(player) {
            Kurve.Menu.deactivatePlayer(player.getId());
            player.setSuperpower(Kurve.Factory.getSuperpower(Kurve.Superpowerconfig.types.NO_SUPERPOWER));
        });

        this.activePlayerIds.forEach(function(playerId) {
            var randomType = this.assignedSuperpowers[playerId] || availableTypes[Math.floor(Kurve.Game.random() * availableTypes.length)];
            if (randomType) {
                Kurve.getPlayer(playerId).setSuperpower(Kurve.Factory.getSuperpower(randomType));
            }

            Kurve.Menu.activatePlayer(playerId);
        }.bind(this));
    },

    syncButtons: function() {
        var inRoom = this.isRoomJoined();
        var canStart = inRoom && this.isHost() && this.hasMinimumPlayers() && !this.isMatchActive;

        this.elements.leaveRoomButton.disabled = !inRoom;
        this.elements.startMatchButton.disabled = !canStart;
    },

    shouldConsumeMenuKey: function(event) {
        if (!this.isRoomJoined()) return false;
        if (event.target && event.target.id === 'online-player-name') return false;

        return true;
    },

    onLocalGameplayKey: function(keyCode, isDown) {
        if (!this.isMatchActive || this.socket === null || !this.isRoomJoined()) return;

        var action = this.getActionForOnlineKeyCode(keyCode);
        var applyFrame = Kurve.Game.CURRENT_FRAME_ID + Kurve.Game.onlineInputDelayFrames;

        if (action === null) return;

        this.socket.emit('kurve:input', {
            roomCode: this.roomCode,
            action: action,
            isDown: isDown,
            applyFrame: applyFrame,
        });
    },

    onLocalSpaceKey: function() {
        return;
    },

    onRemoteInput: function(payload) {
        if (!this.isMatchActive) return;

        Kurve.Game.queueNetworkInput(payload.playerId, payload.action, payload.isDown, payload.applyFrame);
    },

    onRemoteControl: function(payload) {
        if (!this.isMatchActive) return;
        if (payload.action === 'space') {
            Kurve.Game.onSpaceDown();
            return;
        }

        if (payload.action === 'next-round') {
            Kurve.Game.setOnlineRoundStart(payload.roundStart || null);
            Kurve.Game.advanceOnlineRound();
            return;
        }

        if (payload.action === 'round-sync') {
            Kurve.Game.applyScoreSnapshot(payload.data ? payload.data.scoreSnapshot : null);
            return;
        }

        if (payload.action === 'pause') {
            if (Kurve.Game.isRunning && !Kurve.Game.isPaused) Kurve.Game.togglePause();
            return;
        }

        if (payload.action === 'resume') {
            if (Kurve.Game.isPaused) Kurve.Game.togglePause();
        }
    },

    onPlayerDrop: function(payload) {
        if (!this.isMatchActive) return;

        this.setStatus((payload && payload.name ? payload.name : 'A player') + ' disconnected. Match paused.');
    },

    onPlayerRejoin: function(payload) {
        if (!this.isMatchActive) return;

        this.setStatus((payload && payload.name ? payload.name : 'A player') + ' rejoined the match.');
    },

    requestNextRound: function() {
        if (!this.isMatchActive || !this.isHost() || this.socket === null || !this.isRoomJoined()) return;

        this.socket.emit('kurve:control', {
            roomCode: this.roomCode,
            action: 'next-round',
        });
    },

    sendRoundSync: function(scoreSnapshot) {
        if (!this.isMatchActive || !this.isHost() || this.socket === null || !this.isRoomJoined()) return;

        this.socket.emit('kurve:control', {
            roomCode: this.roomCode,
            action: 'round-sync',
            data: {
                scoreSnapshot: scoreSnapshot,
            },
        });
    },

    initSessionId: function() {
        try {
            var existing = sessionStorage.getItem(this.sessionStorageKey);
            if (existing && existing.length >= 12) {
                this.sessionId = existing;
                return;
            }

            var generated = this.generateSessionId();
            this.sessionId = generated;
            sessionStorage.setItem(this.sessionStorageKey, generated);
        } catch (error) {
            this.sessionId = this.generateSessionId();
        }
    },

    generateSessionId: function() {
        return 's' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    },

    getActionForOnlineKeyCode: function(keyCode) {
        if (keyCode === 37) return 'left';
        if (keyCode === 39) return 'right';
        if (keyCode === 40) return 'superpower';

        return null;
    },

    setStatus: function(message) {
        if (this.elements.status) {
            this.elements.status.textContent = message;
        }
    },
};