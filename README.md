# Among Us Multiplayer

A real-time multiplayer browser game — WebSocket server + HTML5 canvas client.

## Files

- **server.js** — WebSocket game server (ws)
- **among-us.html** — Browser client with canvas rendering
- **package.json** — Node.js project config

## Run locally

```bash
npm install
npm start
```

Server starts at `http://localhost:3099`. Open `among-us.html` in a browser to play.

## Deploy to Render

1. Push these 4 files to a GitHub repo
2. Create a new **Web Service** on Render, point it at the repo
3. Set the **Start Command** to `npm start`
4. Render auto-detects Node.js and runs `npm install` on deploy
