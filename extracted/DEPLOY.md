# HyperChess Deployment

## What is required

The online mode needs a real Node server because matchmaking, rooms, Elo, and ranked coin rewards use WebSockets.

CrazyGames SDK is optional support for platform features like gameplay events. It is not the multiplayer server.

This project is ready to deploy as a single Node web service:

- static files are served by `server.js`
- WebSocket endpoint is `/ws`
- the server listens on `process.env.PORT`

## Quick deploy on Render

1. Put the contents of this folder in a GitHub repository.
2. Create a new Web Service on Render.
3. Point it at the repo.
4. Use these settings:

```txt
Environment: Node
Build Command: (leave empty)
Start Command: npm start
```

5. Deploy.

A ready-made [`render.yaml`](./render.yaml) is included, so Render can often detect the setup automatically.

## CrazyGames publishing flow

1. Deploy this folder as a public Node service.
2. Verify the game works from the deployed URL, including `/ws`.
3. Upload or point CrazyGames to the deployed web build.
4. Keep using the same backend for matchmaking and live games.

Do not publish the online mode from `file://` or a static host with no backend, because the game needs WebSockets for online play.

## Important notes

- `ratings.json` is stored on the server filesystem.
- On free/simple hosts, local filesystem storage is not durable across rebuilds/restarts.
- That means Elo can reset unless you later move ratings to a database.

## First production-safe improvement

If you want persistence that survives redeploys, the next step is:

1. replace `ratings.json` with a database
2. store profile ratings there
3. optionally store cosmetics/coins there too

## Local run

```bash
npm start
```

Then open:

```txt
http://localhost:3000
```

There are also local Windows helper files in this folder for manual testing, but the production path for CrazyGames is the Node service above.

## Recommended next step

After deployment, update the game description/UI copy to mention:

- `Quick match` is ranked
- room code matches are unranked
- coins are earned only in ranked
