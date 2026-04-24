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
    localName: 'Player',
    isMatchActive: false,

    sessionStorageKey: 'kurve-online-session-id',
    allowedPlayerIds: ['red', 'orange', 'green', 'blue', 'purple'],

    elements: {
        status: null,
        roomCodeInput: null,
        roomNameInput: null,
        playerNameInput: null,
        createRoomButton: null,
        joinRoomButton: null,
        leaveRoomButton: null,
        startMatchButton: null,
    },

    init: function() {
        this.initSessionId();
        this.initUi();

        if (!this.isSocketIoAvailable()) {
            this.setStatus('Online mode unavailable. Start via Render/Node server.');
        }
    },

    isSocketIoAvailable: function() {
        return typeof window.io === 'function';
    },

    initUi: function() {
        var container = document.createElement('div');
        container.id = 'online-panel';
        container.className = 'light';
        container.innerHTML =
            '<h4>Online Multiplayer by Bastian Curth</h4>' +
            '<div class="online-row online-note">' +
                '<span>Up to 5 players. Reconnect supported.</span>' +
            '</div>' +
            '<div class="online-row">' +
                '<input id="online-player-name" type="text" maxlength="16" placeholder="Your name" value="Player" />' +
            '</div>' +
            '<div class="online-row">' +
                '<input id="online-room-name" type="text" maxlength="32" placeholder="Room name (emoji welcome)" list="online-room-name-presets" />' +
            '</div>' +
            '<datalist id="online-room-name-presets">' +
                '<option value="Wolf Den 🐺"></option>' +
                '<option value="Office Laptop"></option>' +
                '<option value="Checkout Lane 3"></option>' +
                '<option value="Late Night Takeout"></option>' +
                '<option value="Sprint Retro Arena"></option>' +
            '</datalist>' +
            '<div class="online-row">' +
                '<input id="online-room-code" type="text" maxlength="6" placeholder="Room code" />' +
                '<button id="online-join" class="button">Join</button>' +
            '</div>' +
            '<div class="online-row">' +
                '<button id="online-create" class="button">Create room</button>' +
                '<button id="online-start" class="button" disabled>Start match</button>' +
                '<button id="online-leave" class="button" disabled>Leave</button>' +
            '</div>' +
            '<div id="online-status" class="online-status">Offline</div>';

        document.getElementById('menu-settings').insertAdjacentElement('afterend', container);

        this.elements.status = document.getElementById('online-status');
        this.elements.roomCodeInput = document.getElementById('online-room-code');
        this.elements.roomNameInput = document.getElementById('online-room-name');
        this.elements.playerNameInput = document.getElementById('online-player-name');
        this.elements.createRoomButton = document.getElementById('online-create');
        this.elements.joinRoomButton = document.getElementById('online-join');
        this.elements.leaveRoomButton = document.getElementById('online-leave');
        this.elements.startMatchButton = document.getElementById('online-start');

        this.elements.createRoomButton.addEventListener('click', this.onCreateRoom.bind(this));
        this.elements.joinRoomButton.addEventListener('click', this.onJoinRoom.bind(this));
        this.elements.leaveRoomButton.addEventListener('click', this.onLeaveRoom.bind(this));
        this.elements.startMatchButton.addEventListener('click', this.onStartMatch.bind(this));
    },

    ensureSocketConnection: function() {
        if (!this.isSocketIoAvailable()) {
            this.setStatus('Socket.io client not found.');
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

        return true;
    },

    onCreateRoom: function() {
        if (!this.ensureSocketConnection()) return;

        this.localName = this.getPlayerName();
        this.socket.emit('kurve:create-room', {
            name: this.localName,
            roomName: this.getRoomName(),
            sessionId: this.sessionId,
        });
        this.setStatus('Creating room ...');
    },

    onJoinRoom: function() {
        if (!this.ensureSocketConnection()) return;

        var roomCode = this.elements.roomCodeInput.value.trim().toUpperCase();

        if (roomCode.length < 4) {
            this.setStatus('Enter a valid room code.');
            return;
        }

        this.localName = this.getPlayerName();
        this.socket.emit('kurve:join-room', {
            roomCode: roomCode,
            name: this.localName,
            sessionId: this.sessionId,
        });
        this.setStatus('Joining room ' + roomCode + ' ...');
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
        this.elements.roomCodeInput.value = payload.roomCode;

        if (this.elements.roomNameInput && this.roomName) {
            this.elements.roomNameInput.value = this.roomName;
        }

        this.updatePlayerAssignment();
        this.syncButtons();

        var hostSuffix = this.isHost() ? ' You are host.' : '';
        var roomLabel = this.roomName ? this.roomName + ' (' + this.roomCode + ')' : this.roomCode;
        this.setStatus('Room ' + roomLabel + ': ' + this.getConnectedPlayerCount() + '/' + this.maxPlayers + ' connected.' + hostSuffix);
    },

    getRoomName: function() {
        var roomName = this.elements.roomNameInput ? this.elements.roomNameInput.value.trim() : '';
        if (roomName.length === 0) return '';

        return Array.from(roomName).slice(0, 32).join('');
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

        this.localPlayerId = payload.assignments[this.sessionId] || null;

        for (var i = 0; i < payload.players.length; i++) {
            this.activePlayerIds.push(payload.players[i].playerId);
        }

        if (this.localPlayerId === null) {
            this.setStatus('Missing local player assignment.');
            return;
        }

        this.startOnlineGame(payload.seed);
    },

    startOnlineGame: function(seed) {
        this.applyDeterministicRandom(seed);
        this.prepareOnlinePlayers();

        Kurve.Game.resetSession();
        Kurve.Game.setOnlineControls(this.localPlayerId);

        this.activePlayerIds.forEach(function(playerId) {
            Kurve.Game.curves.push(
                new Kurve.Curve(Kurve.getPlayer(playerId), Kurve.Game, Kurve.Field, Kurve.Config.Curve, Kurve.Sound.getAudioPlayer())
            );
        });

        Kurve.Field.init();
        Kurve.Menu.audioPlayer.pause('menu-music', {fade: 1000});
        Kurve.Game.startGame();

        u.addClass('hidden', 'layer-menu');
        u.removeClass('hidden', 'layer-game');

        Kurve.Game.onSpaceDown();
        this.setStatus('Match started. You are ' + this.localPlayerId + '.');
    },

    prepareOnlinePlayers: function() {
        Kurve.players.forEach(function(player) {
            Kurve.Menu.deactivatePlayer(player.getId());
            player.setSuperpower(Kurve.Factory.getSuperpower(Kurve.Superpowerconfig.types.NO_SUPERPOWER));
        });

        this.activePlayerIds.forEach(function(playerId) {
            Kurve.Menu.activatePlayer(playerId);
        });
    },

    applyDeterministicRandom: function(seed) {
        var state = seed >>> 0;

        Math.random = function() {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 4294967296;
        };
    },

    syncButtons: function() {
        var inRoom = this.isRoomJoined();
        var canStart = inRoom && this.isHost() && this.hasMinimumPlayers() && !this.isMatchActive;

        this.elements.leaveRoomButton.disabled = !inRoom;
        this.elements.startMatchButton.disabled = !canStart;
    },

    shouldConsumeMenuKey: function(event) {
        if (!this.isRoomJoined()) return false;
        if (event.target && (
            event.target.id === 'online-room-code' ||
            event.target.id === 'online-player-name' ||
            event.target.id === 'online-room-name'
        )) return false;

        return true;
    },

    onLocalGameplayKey: function(keyCode, isDown) {
        if (!this.isMatchActive || this.socket === null || !this.isRoomJoined()) return;

        var action = this.getActionForKeyCode(this.localPlayerId, keyCode);

        if (action === null) return;

        this.socket.emit('kurve:input', {
            roomCode: this.roomCode,
            action: action,
            isDown: isDown,
        });
    },

    onLocalSpaceKey: function() {
        if (!this.isMatchActive || this.socket === null || !this.isRoomJoined()) return;
        if (this.localPlayerId === null) return;

        this.socket.emit('kurve:control', {
            roomCode: this.roomCode,
            action: 'space',
        });
    },

    onRemoteInput: function(payload) {
        if (!this.isMatchActive || payload.playerId === this.localPlayerId) return;

        Kurve.Game.applyNetworkInput(payload.playerId, payload.action, payload.isDown);
    },

    onRemoteControl: function(payload) {
        if (!this.isMatchActive) return;
        if (payload.action === 'space') {
            Kurve.Game.onSpaceDown();
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

    initSessionId: function() {
        try {
            var existing = localStorage.getItem(this.sessionStorageKey);
            if (existing && existing.length >= 12) {
                this.sessionId = existing;
                return;
            }

            var generated = this.generateSessionId();
            this.sessionId = generated;
            localStorage.setItem(this.sessionStorageKey, generated);
        } catch (error) {
            this.sessionId = this.generateSessionId();
        }
    },

    generateSessionId: function() {
        return 's' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    },

    getActionForKeyCode: function(playerId, keyCode) {
        var player = Kurve.getPlayer(playerId);
        if (!player) return null;

        if (player.getKeyLeft() === keyCode) return 'left';
        if (player.getKeyRight() === keyCode) return 'right';
        if (player.getKeySuperpower() === keyCode) return 'superpower';

        return null;
    },

    setStatus: function(message) {
        if (this.elements.status) {
            this.elements.status.textContent = message;
        }
    },
};