# Achtung, die Kurve!
This is an open source HTML5 implementation of the famous game also known as Curve Fever, Zatacka or simply Kurve.

## Want to download Achtung, die Kurve and play offline?
No problem! Just download the [sources](https://achtungkurve.com/download/kurve-1.5.0.zip) and double click the file index.html to open it in your favourite browser.

## Screenshots

![](images/screenshot_1.png "Start screen") ![](images/screenshot_2.png "Gameplay") ![](images/screenshot_3.png "Gameplay light")

## Development

### Requirements for development
- node.js
- npm
 
### Installing dependencies
```sh
npm install
```

### Run local server (including online multiplayer)
```sh
npm run dev
```

Open http://localhost:3000.

### Building sources during development
```sh
gulp watch
```

### Building sources for production
```sh
gulp build
```

## Realtime online multiplayer

The project now includes a built-in Socket.IO server for realtime multiplayer rooms with up to 5 players.

### How to play online
1. Open the game via the Node/Render server (not as plain file://).
2. In the menu, use the online panel:
3. Set a player name.
4. Optional: set a custom room name (emoji supported).
5. Host clicks "Create room".
6. Other players enter room code and click "Join".
7. Host clicks "Start match".

Current implementation details:
- Up to 5 players per room (red/orange/green/blue/purple)
- Start match with at least 2 connected players
- Custom room names (including emoji)
- Host-driven room lifecycle
- Realtime key relay via Socket.IO
- Deterministic seed per match for improved sync
- Branded in-game title: "Online Multiplayer by Bastian Curth"
- Session-based reconnect within a grace period (player keeps slot)
- Auto-pause on disconnect and auto-resume when all assigned players are back
- Memory-aware cleanup for Render free tier (stale disconnected players/rooms are removed automatically)

## Deploy on GitHub + Render

Recommended setup:
- GitHub repository as source of truth
- Render Web Service to host both static files and Socket.IO backend

### Steps
1. Push this project to your GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Use these settings:
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
4. Deploy.
5. Share the Render URL with your colleagues.

Optional health check endpoint:
- `/healthz`
