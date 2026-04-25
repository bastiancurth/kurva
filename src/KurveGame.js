/**
 *
 * Program:     Kurve
 * Author:      Markus Mächler, marmaechler@gmail.com
 * License:     http://www.gnu.org/licenses/gpl.txt
 * Link:        http://achtungkurve.com
 *
 * Copyright © 2014, 2015 Markus Mächler
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

Kurve.Game = {    
    
    runIntervalId:          null,
    fps:                    null,
    intervalTimeOut:        null,
    maxPoints:              null,
        
    keysDown:               {},
    isRunning:              false,
    curves:                 [],
    runningCurves:          {},
    players:                [],
    deathMatch:             false,
    isPaused:               false,
    isRoundStarted:         false,
    playerScoresElement:    null,
    isGameOver:             false,
    CURRENT_FRAME_ID:       0,
    onlineControls:         null,
    onlinePendingKeys:      {},
    onlineInputQueue:       {},
    onlineInputDelayFrames: 8,
    deterministicRandomState: null,
    onlineRoundStartByPlayer: null,
    pendingOnlineRoundAdvance: false,
    windowListenersAdded: false,
    
    init: function() {
        this.fps = Kurve.Config.Game.fps;
        this.intervalTimeOut = Math.round(1000 / this.fps);
        this.playerScoresElement = document.getElementById('player-scores');

        this.Audio.init();
    },
    
    run: function() {
        if (this.onlineControls && this.onlineControls.enabled) {
            this.drawFrame();
            return;
        }

        requestAnimationFrame(this.drawFrame.bind(this));
    },
    
    drawFrame: function() {
        this.CURRENT_FRAME_ID++;
        this.processOnlineInputQueue(this.CURRENT_FRAME_ID);

        var runningPlayerIds = this.getDeterministicRunningPlayerIds();

        for (var i = 0; i < runningPlayerIds.length; i++) {
            var playerId = runningPlayerIds[i];
            for (var j = 0; this.runningCurves[playerId] && j < this.runningCurves[playerId].length; ++j) {
                this.runningCurves[playerId][j].drawNextFrame();
            }
        }
    },

    getDeterministicRunningPlayerIds: function() {
        var ids = [];

        for (var i = 0; i < this.curves.length; i++) {
            var playerId = this.curves[i].getPlayer().getId();
            if (!this.runningCurves[playerId]) continue;
            if (ids.indexOf(playerId) >= 0) continue;

            ids.push(playerId);
        }

        return ids;
    },
    
    addWindowListeners: function() {
        if (this.windowListenersAdded) return;

        Kurve.Menu.removeWindowListeners();
        
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));  
        this.windowListenersAdded = true;
    },
    
    onKeyDown: function(event) {
        if (Kurve.Menu.scrollKeys.indexOf(event.key) >= 0) {
            event.preventDefault(); //prevent page scrolling
        }

        if ( event.keyCode === 32 ) {
            if (this.onlineControls && this.onlineControls.enabled) {
                return;
            }

            this.onSpaceDown();
        }

        if (this.onlineControls && this.onlineControls.enabled && !this.isLocalInputKey(event.keyCode)) {
            return;
        }

        if (this.onlineControls && this.onlineControls.enabled) {
            if (this.onlinePendingKeys[event.keyCode] === true) return;

            this.onlinePendingKeys[event.keyCode] = true;
            Kurve.Online.onLocalGameplayKey(event.keyCode, true);
            return;
        }

        this.keysDown[event.keyCode] = true;
    },
    
    onKeyUp: function(event) {
        if (this.onlineControls && this.onlineControls.enabled && !this.isLocalInputKey(event.keyCode)) {
            return;
        }

        if (this.onlineControls && this.onlineControls.enabled) {
            delete this.onlinePendingKeys[event.keyCode];
            Kurve.Online.onLocalGameplayKey(event.keyCode, false);
            return;
        }

        delete this.keysDown[event.keyCode];
    },
    
    isKeyDown: function(keyCode) {
        return this.keysDown[keyCode] === true;
    },

    getPlayerById: function(playerId) {
        return Kurve.getPlayer(playerId);
    },

    setOnlineControls: function(localPlayerId) {
        this.onlineControls = {
            enabled: true,
            localPlayerId: localPlayerId,
        };
    },

    isLocalInputKey: function(keyCode) {
        if (!this.onlineControls || !this.onlineControls.enabled) return true;

        return keyCode === 37 || keyCode === 39 || keyCode === 40;
    },

    applyNetworkInput: function(playerId, action, isDown) {
        var player = this.getPlayerById(playerId);
        if (!player) return;

        var keyCode = null;

        if (action === 'left') keyCode = player.getKeyLeft();
        if (action === 'right') keyCode = player.getKeyRight();
        if (action === 'superpower') keyCode = player.getKeySuperpower();

        if (keyCode === null) return;

        if (isDown) {
            this.keysDown[keyCode] = true;
        } else {
            delete this.keysDown[keyCode];
        }
    },

    queueNetworkInput: function(playerId, action, isDown, applyFrame, senderFrameId) {
        var targetFrame = parseInt(applyFrame, 10);
        var sourceFrame = parseInt(senderFrameId, 10);

        if (!isNaN(targetFrame) && !isNaN(sourceFrame)) {
            var leadFrames = targetFrame - sourceFrame;
            if (leadFrames < 1) leadFrames = 1;
            targetFrame = this.CURRENT_FRAME_ID + leadFrames;
        }

        if (isNaN(targetFrame)) targetFrame = this.CURRENT_FRAME_ID + this.onlineInputDelayFrames;
        if (targetFrame <= this.CURRENT_FRAME_ID) targetFrame = this.CURRENT_FRAME_ID + 1;

        if (!this.onlineInputQueue[targetFrame]) {
            this.onlineInputQueue[targetFrame] = [];
        }

        this.onlineInputQueue[targetFrame].push({
            playerId: playerId,
            action: action,
            isDown: isDown === true,
        });
    },

    processOnlineInputQueue: function(frameId) {
        if (!this.onlineInputQueue[frameId]) return;

        var events = this.onlineInputQueue[frameId];
        delete this.onlineInputQueue[frameId];

        for (var i = 0; i < events.length; i++) {
            this.applyNetworkInput(events[i].playerId, events[i].action, events[i].isDown);
        }
    },

    resetSession: function() {
        this.keysDown = {};
        this.onlinePendingKeys = {};
        this.onlineInputQueue = {};
        this.curves = [];
        this.runningCurves = {};
        this.players = [];
        this.deathMatch = false;
        this.isPaused = false;
        this.isRoundStarted = false;
        this.isGameOver = false;
        this.CURRENT_FRAME_ID = 0;
        this.deterministicRandomState = null;
        this.onlineRoundStartByPlayer = null;
        this.pendingOnlineRoundAdvance = false;
    },

    exportState: function() {
        var runningPlayerIds = this.getDeterministicRunningPlayerIds();

        return {
            deterministicRandomState: this.deterministicRandomState,
            currentFrameId: this.CURRENT_FRAME_ID,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            isRoundStarted: this.isRoundStarted,
            deathMatch: this.deathMatch,
            isGameOver: this.isGameOver,
            maxPoints: this.maxPoints,
            runningPlayerIds: runningPlayerIds,
            players: this.players.map(function(player) {
                return {
                    id: player.getId(),
                    points: player.getPoints(),
                    superpowerType: player.getSuperpower().getType(),
                    superpowerCount: player.getSuperpower().getCount(),
                    color: player.getColor(),
                    active: player.isActive(),
                };
            }),
            curves: this.curves.map(function(curve) {
                return curve.exportState();
            }),
            field: Kurve.Field.exportState(),
        };
    },

    applyState: function(state) {
        if (!state) return;

        this.stopRun();
        this.resetSession();
        this.deterministicRandomState = state.deterministicRandomState >>> 0;
        this.CURRENT_FRAME_ID = state.currentFrameId || 0;
        this.isRunning = state.isRunning === true;
        this.isPaused = state.isPaused === true;
        this.isRoundStarted = state.isRoundStarted === true;
        this.deathMatch = state.deathMatch === true;
        this.isGameOver = state.isGameOver === true;
        this.maxPoints = state.maxPoints;

        if (state.players) {
            state.players.forEach(function(playerState) {
                var player = Kurve.getPlayer(playerState.id);
                if (!player) return;

                player.setPoints(playerState.points);
                player.setColor(playerState.color || null);
                player.setSuperpower(Kurve.Factory.getSuperpower(playerState.superpowerType));
                player.getSuperpower().setCount(playerState.superpowerCount);
                player.setIsActive(playerState.active === true);
            });
        }

        this.players = [];
        if (state.players) {
            for (var i = 0; i < state.players.length; i++) {
                var restoredPlayer = Kurve.getPlayer(state.players[i].id);
                if (restoredPlayer) {
                    this.players.push(restoredPlayer);
                }
            }
        }

        this.curves = [];
        this.runningCurves = {};

        if (state.curves) {
            for (var j = 0; j < state.curves.length; j++) {
                var curveState = state.curves[j];
                var curvePlayer = Kurve.getPlayer(curveState.playerId);

                if (!curvePlayer) continue;

                var curve = new Kurve.Curve(curvePlayer, this, Kurve.Field, Kurve.Config.Curve, Kurve.Sound.getAudioPlayer());
                curve.applyState(curveState);
                this.curves.push(curve);

                if (state.runningPlayerIds && state.runningPlayerIds.indexOf(curveState.playerId) >= 0) {
                    this.runningCurves[curveState.playerId] = [curve];
                }
            }
        }

        this.addWindowListeners();

        if (Kurve.Field.pixiApp === null) {
            Kurve.Field.init();
        } else {
            Kurve.Field.resize();
        }

        Kurve.Field.applyState(state.field || null);
        this.renderPlayerScores();

        if (this.isRunning && !this.isPaused) {
            this.startRun();
        }
    },

    setDeterministicSeed: function(seed) {
        this.deterministicRandomState = seed >>> 0;
    },

    random: function() {
        if (this.deterministicRandomState === null) return Math.random();

        this.deterministicRandomState = (1664525 * this.deterministicRandomState + 1013904223) >>> 0;
        return this.deterministicRandomState / 4294967296;
    },

    setOnlineRoundStart: function(roundStartByPlayer) {
        this.onlineRoundStartByPlayer = roundStartByPlayer || null;
    },

    exportScoreSnapshot: function() {
        var snapshot = {};

        this.players.forEach(function(player) {
            snapshot[player.getId()] = {
                points: player.getPoints(),
                superpowerCount: player.getSuperpower().getCount(),
            };
        });

        return snapshot;
    },

    applyScoreSnapshot: function(snapshot) {
        if (!snapshot) return;

        this.players.forEach(function(player) {
            var playerSnapshot = snapshot[player.getId()];
            if (!playerSnapshot) return;

            player.setPoints(playerSnapshot.points);
            player.getSuperpower().setCount(playerSnapshot.superpowerCount);
        });

        this.renderPlayerScores();
    },

    advanceOnlineRound: function() {
        if (!this.onlineControls || !this.onlineControls.enabled) return;
        if (this.isGameOver) return;
        if (this.isRunning) {
            this.pendingOnlineRoundAdvance = true;
            return;
        }

        if (this.isPaused) {
            this.endPause();
            return;
        }

        if (!this.isRoundStarted && !this.deathMatch) {
            this.startNewRound();
            return;
        }

        if (!this.isRoundStarted && this.deathMatch) {
            this.startDeathMatch();
        }
    },
    
    onSpaceDown: function() {
        if ( this.isGameOver ) return location.reload();
        if ( this.isRunning || this.isPaused ) return this.togglePause();
        if ( !this.isRoundStarted && !this.deathMatch) return this.startNewRound();
        if ( !this.isRoundStarted && this.deathMatch) return this.startDeathMatch();
    },
    
    togglePause: function() {
        if ( this.isPaused ) {
            this.endPause();
        } else {
            this.doPause();
        }
    },

    doPause: function() {
        if ( this.isPaused ) return;

        this.isPaused = true;
        this.Audio.pauseIn();
        this.stopRun();
        Kurve.Lightbox.show('<h2>Game is paused</h2>');
    },

    endPause: function() {
        if ( !this.isPaused ) return;

        this.isPaused = false;
        this.Audio.pauseOut();
        Kurve.Lightbox.hide();
        this.startRun();
    },
    
    startGame: function() {
        this.maxPoints = (this.curves.length - 1) * 10;
        
        this.addPlayers();
        this.addWindowListeners();
        this.renderPlayerScores();

        Kurve.Piwik.trackPageVariable(1, 'theme', Kurve.Theming.currentTheme);
        Kurve.Piwik.trackPageVariable(2, 'number_of_players', this.players.length);
        Kurve.Piwik.trackPageView('Game');
        
        this.startNewRound.bind(this);
    },
    
    renderPlayerScores: function() {
        var playerHTML  = '';
        
        this.players.sort(this.playerSorting);
        this.players.forEach(function(player) { playerHTML += player.renderScoreItem() });
        
        this.playerScoresElement.innerHTML = playerHTML;
    },
    
    playerSorting: function(playerA, playerB) {
        return playerB.getPoints() - playerA.getPoints();
    },
    
    addPlayers: function() {
        Kurve.Game.curves.forEach(function(curve) {
            for (var i=0; i<Kurve.Config.Game.initialSuperpowerCount; i++) {
                curve.getPlayer().getSuperpower().incrementCount();
            }

            Kurve.Game.players.push( curve.getPlayer() );
        });
    },
    
    notifyDeath: function(curve) {
        var playerId = curve.getPlayer().getId();
        // Drop this curve.
        if ( this.runningCurves[playerId] === undefined ) return;

        this.runningCurves[playerId].splice(this.runningCurves[playerId].indexOf(curve), 1);

        if ( this.runningCurves[playerId].length === 0 ) {
            // Drop this player.
            delete this.runningCurves[curve.getPlayer().getId()];

            var runningPlayerIds = this.getDeterministicRunningPlayerIds();
            for (var i = 0; i < runningPlayerIds.length; i++) {
                this.runningCurves[runningPlayerIds[i]][0].getPlayer().incrementPoints();
            }
        
            this.renderPlayerScores();

            if ( Object.keys(this.runningCurves).length === 2 ) {
                this.Audio.tension();
            }
        
            if ( Object.keys(this.runningCurves).length === 1 ) this.terminateRound();
        }
    },
    
    startNewRound: function() {
        this.isRoundStarted = true;
        this.CURRENT_FRAME_ID = 0;

        Kurve.Field.clearFieldContent();
        this.initRun();
        this.renderPlayerScores();

        setTimeout(this.startRun.bind(this), Kurve.Config.Game.startDelay);
        this.Audio.startNewRound();
    },
    
    startRun: function() {
        this.isRunning = true;
        this.runIntervalId = setInterval(this.run.bind(this), this.intervalTimeOut);
    },
    
    stopRun: function() {
        this.isRunning = false;
        clearInterval(this.runIntervalId);
    },
    
    initRun: function() {
        this.curves.forEach(function(curve) {
            Kurve.Game.runningCurves[curve.getPlayer().getId()] = [curve];

            var playerId = curve.getPlayer().getId();
            var roundStart = this.onlineRoundStartByPlayer ? this.onlineRoundStartByPlayer[playerId] : null;

            if (roundStart) {
                curve.setPosition(roundStart.x, roundStart.y);
                curve.setAngle(roundStart.angle);
            } else {
                var randomPosition = Kurve.Field.getRandomPosition();
                curve.setPosition(randomPosition.getPosX(), randomPosition.getPosY());
                curve.setRandomAngle();
            }

            curve.getPlayer().getSuperpower().init(curve);
            curve.drawCurrentPosition(Kurve.Field);
        }.bind(this));

        this.onlineRoundStartByPlayer = null;
    },
    
    terminateRound: function() {
        this.curves.forEach(function(curve) {
            curve.getPlayer().getSuperpower().close(curve);
        });

        if ( this.deathMatch ) {
            var survivingPlayerIds = this.getDeterministicRunningPlayerIds();
            var curve = survivingPlayerIds.length > 0 ? this.runningCurves[survivingPlayerIds[0]][0] : null;
            if (!curve) return;
            this.gameOver(curve.getPlayer());
        }

        this.isRoundStarted = false;
        this.stopRun();
        this.runningCurves  = {};
        this.incrementSuperpowers();
        this.Audio.terminateRound();
        Kurve.Field.resize();
        this.checkForWinner();

        if (this.onlineControls && this.onlineControls.enabled && Kurve.Online.isHost()) {
            Kurve.Online.sendRoundSync(this.exportScoreSnapshot());
        }

        if (this.onlineControls && this.onlineControls.enabled && this.pendingOnlineRoundAdvance && !this.isGameOver && !this.deathMatch) {
            this.pendingOnlineRoundAdvance = false;
            this.startNewRound();
            return;
        }

        if (this.onlineControls && this.onlineControls.enabled && !this.isGameOver && !this.deathMatch) {
            setTimeout(function() {
                if (Kurve.Online.isHost()) {
                    Kurve.Online.requestNextRound();
                }
            }, 1000);
        }
    },

    incrementSuperpowers: function() {
        var numberOfPlayers = this.players.length;

        if (numberOfPlayers === 2) {
            this.players[0].getSuperpower().incrementCount();
            this.players[1].getSuperpower().incrementCount();
        } else {
            for (var i in this.players) {
                if (parseInt(i) === 0) continue; // skip the leader

                this.players[i].getSuperpower().incrementCount();
            }

            // extra superpower for the loser
            this.players[numberOfPlayers - 1].getSuperpower().incrementCount();
        }
    },
    
    checkForWinner: function() {
        if ( this.deathMatch ) return;

        var winners = [];
        
        this.players.forEach(function(player) {
            if (player.getPoints() >= Kurve.Game.maxPoints) winners.push(player);
        });
        
        if (winners.length === 0) return;
        if (winners.length === 1) this.gameOver(winners[0]);
        if (winners.length  >  1) this.initDeathMatch(winners);
    },

    initDeathMatch: function(winners) {
        this.deathMatch = true;
        this.Audio.initDeathMatch();
        Kurve.Lightbox.show('<div class="deathmatch"><h1>DEATHMATCH!</h1></div>');

        var winnerCurves = [];
        this.curves.forEach(function(curve) {
            winners.forEach(function(player){
                if (curve.getPlayer() === player) {
                    winnerCurves.push(curve);
                    player.setColor(Kurve.Theming.getThemedValue('field', 'deathMatchColor'));
                }
            });
        });

        this.curves = winnerCurves;
    },
    
    startDeathMatch: function(winners) {
        Kurve.Piwik.trackPageVariable(3, 'death_match', 'yes');
        Kurve.Lightbox.hide();
        this.startNewRound();
    },
    
    gameOver: function(winner) {
        this.isGameOver = true;

        this.Audio.gameOver();
        Kurve.Piwik.trackPageVariable(4, 'finished_game', 'yes');
        Kurve.Piwik.trackPageView('GameOver');

        Kurve.Lightbox.show(
            '<h1 class="active ' + winner.getId() + '">' + winner.getId() + ' wins!</h1>' +
            '<a href="#" onclick="Kurve.reload(); return false;" title="Go back to the menu"  class="button">Start new game</a>'
        );
    },

    Audio: {
        stemLevel: 1,
        audioPlayer: null,
        defaultFadeTime: 1000,

        init: function() {
            this.audioPlayer = Kurve.Sound.getAudioPlayer();
        },

        startNewRound: function() {
            var startIn1Delay = Kurve.Config.Game.startDelay / 3;
            var startIn2Delay = 2 * startIn1Delay;
            var startOutDelay = 3 * startIn1Delay;

            setTimeout(this.audioPlayer.play.bind(this.audioPlayer, 'game-start-in', {reset: true}), startIn1Delay);
            setTimeout(this.audioPlayer.play.bind(this.audioPlayer, 'game-start-in', {reset: true}), startIn2Delay);
            setTimeout(function() {
                this.audioPlayer.play('game-start-out', {reset: true});
                this.setAllCurvesMuted('all', false);

                if ( Kurve.Game.deathMatch ) {
                    this.stemLevel = 3;
                    this.audioPlayer.play('game-music-stem-1', {fade: this.defaultFadeTime, volume: 1, background: true, loop: true, reset: true});
                    this.audioPlayer.play('game-music-stem-4', {fade: this.defaultFadeTime, volume: 1, background: true, loop: true, reset: true});
                } else {
                    this.stemLevel = 1;
                    this.audioPlayer.play('game-music-stem-1', {fade: this.defaultFadeTime, volume: 1, background: true, loop: true, reset: true});
                    this.audioPlayer.play('game-music-stem-2', {fade: this.defaultFadeTime, volume: 0, background: true, loop: true, reset: true});
                    this.audioPlayer.play('game-music-stem-3', {fade: this.defaultFadeTime, volume: 0, background: true, loop: true, reset: true});
                }
            }.bind(this), startOutDelay);
        },

        terminateRound: function() {
            this.pauseAllCurves('all', {reset: true});
            this.audioPlayer.pause('game-music-stem-1', {fade: this.defaultFadeTime, reset: true});
            this.audioPlayer.pause('game-music-stem-2', {fade: this.defaultFadeTime, reset: true});
            this.audioPlayer.pause('game-music-stem-3', {fade: this.defaultFadeTime, reset: true});
            this.audioPlayer.pause('game-music-stem-4', {fade: this.defaultFadeTime, reset: true});
            this.audioPlayer.play('game-end');
        },

        pauseIn: function() {
            this.audioPlayer.play('game-pause-in');
            this.setAllCurvesMuted('all', true);
            this.audioPlayer.setVolume('game-music-stem-1', {volume: 0.25, fade: this.defaultFadeTime});

            if (this.stemLevel > 1) {
                this.audioPlayer.setVolume('game-music-stem-2', {volume: 0, fade: this.defaultFadeTime});
            }

            if (this.stemLevel > 2) {
                this.audioPlayer.setVolume('game-music-stem-3', {volume: 0, fade: this.defaultFadeTime});
            }

            if (Kurve.Game.deathMatch) {
                this.audioPlayer.setVolume('game-music-stem-4', {volume: 0, fade: this.defaultFadeTime});
            }
        },

        pauseOut: function() {
            this.audioPlayer.play('game-pause-out');
            this.setAllCurvesMuted('all', false);
            this.audioPlayer.setVolume('game-music-stem-1', {volume: 1, fade: this.defaultFadeTime});

            if (this.stemLevel > 1) {
                this.audioPlayer.setVolume('game-music-stem-2', {volume: 0.5, fade: this.defaultFadeTime});
            }

            if (this.stemLevel > 2) {
                this.audioPlayer.setVolume('game-music-stem-3', {volume: 0.3, fade: this.defaultFadeTime});
            }

            if (Kurve.Game.deathMatch) {
                this.audioPlayer.setVolume('game-music-stem-4', {volume: 1, fade: this.defaultFadeTime});
            }
        },

        tension: function() {
            if (Kurve.Game.deathMatch) {
                return;
            }

            this.stemLevel = 3;
            this.audioPlayer.setVolume('game-music-stem-2', {volume: 0.5, fade: this.defaultFadeTime});
            this.audioPlayer.setVolume('game-music-stem-3', {volume: 0.3, fade: this.defaultFadeTime});
        },

        initDeathMatch: function() {
            this.audioPlayer.play('game-deathmatch');
        },

        gameOver: function() {
            this.audioPlayer.pause('all');
            this.audioPlayer.play('game-victory');
        },

        setAllCurvesMuted: function(soundKey, muted) {
            Kurve.Game.curves.forEach(function(curve) {
                curve.setMuted(soundKey, muted);
            });
        },

        pauseAllCurves: function(soundKey, options) {
            Kurve.Game.curves.forEach(function(curve) {
                curve.pause(soundKey, options);
            });
        }
    }
};
