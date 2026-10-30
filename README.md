# Relay Chess

Four people play one game of chess. Two teammates share White, two share Black, and they alternate:

**White 1 → Black 1 → White 2 → Black 2 → White 1…**

Only the player whose turn it is can move. The server checks every move with [chess.js](https://github.com/jhlywa/chess.js), including castling, en passant, promotion, check, checkmate, stalemate, threefold repetition, the fifty-move rule, and insufficient material.

Create a table, share the short code or link, and pick a seat. The game starts when all four seats are filled. A refresh keeps your seat. You can resign, offer or accept a draw, rematch, read the move list, and optionally play with a shared team clock. The clock pauses if the player to move disconnects.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:4317 . Tests:

```bash
npm test
```

Production build:

```bash
npm run build
npm start
```

`npm start` listens on `PORT` (default `4317`).

## How a table works

1. One player creates a table and chooses a clock: off, 3+2, 5 minutes, 10 minutes, or 15+10. Each side shares one clock.
2. The others open the invite link or enter the code, type a name, and sit in White 1, White 2, Black 1, or Black 2.
3. On your turn, tap a piece and then a highlighted square, or drag it. Pawns that reach the last rank ask you which piece to promote to.
4. Offer a draw on your turn. Either player on the other team can accept. If they move instead, the offer is declined.
5. After the game, all four players can vote for a rematch. Seats stay the same.

Rooms live in memory on one server process. A restart clears them, and a deploy must stay on **a single instance** so everyone shares the same room. The seat token is stored in the browser’s `localStorage`. Finished games update a leaderboard in `data/leaderboard.json`. Names match without capitals, and the spelling shown is the most recent lobby name. That file survives a restart.

If a seated player's name is `chessgawd`, that team sees a best-move arrow on their own turn. The server asks the Lichess cloud eval and, if that has no answer, Stockfish on the server. Opponents are not sent the arrow. Stockfish is GPLv3.

## Deploy on the internet

Friends need a public URL. This app is one Node process: Express serves the site and Socket.IO syncs the game, so it fits Render, Railway, or Fly.

### Render

1. Push this project to GitHub.
2. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and select the repo. `render.yaml` sets the build, start command, and health check. Or create a **Web Service** by hand:
   - Runtime: **Node**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Health check path: `/health`
   - Environment: `NODE_ENV=production`
3. Use the free instance and leave the instance count at **1**.
4. Open the `https://<service>.onrender.com` URL Render gives you.

The free instance sleeps after inactivity. The first visit can take about a minute to wake, and sleeping clears any game in progress.

### Railway

1. Create a project at [railway.com](https://railway.com) from this repo.
2. Railway should detect Node. If it asks, set the build to `npm install && npm run build` and the start command to `npm start`.
3. Add a public domain under **Settings → Networking**.
4. Keep a single replica.

### Fly.io

1. Install the [flyctl](https://fly.io/docs/flyctl/install/) and sign in: `fly auth login`
2. From this directory, `fly launch --copy-config --no-deploy` and pick an app name if `relay-chess` is taken. Put that name in `fly.toml`.
3. `fly deploy`
4. `fly status` prints the hostname, like `https://relay-chess.fly.dev`.

The Docker image listens on port `8080`. `fly.toml` keeps one machine running so a game is not dropped between requests.

## Piece graphics

The board uses the Cburnett chess pieces by Colin M.L. Burnett, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Source: [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces). The queens are original drawings in that same style; the other pieces are unmodified.

## Layout

- `server/` — Express, Socket.IO, and the rules engine
- `shared/` — seats, clocks, and the state sent to browsers
- `client/` — React board and lobby
- `tests/` — turn order, rule edge cases, rooms, and a four-client game

## Video slots (Dragon Queen · Warzone · Gold Rush)

Three 5×3, 20-line machines in the Slots window share one engine (`shared/video-slots.ts`). The server
(`server/slots.ts`, socket `vslots_spin`) decides the full round with `crypto.randomInt` — base spin, free
spins, pick-a-chest, airstrike, hold-and-spin — then debits the bet and credits the total in one step on the
shared `casino_players` chips. The client only animates the returned script, so there is no bonus state to forge.
Bets: 20/40/60/100/200 (line bet = bet ÷ 20). Long-run RTP (10M rounds each, seeded): Dragon Queen 95.2%,
Warzone 94.8%, Gold Rush 95.0%; `tests/video-slots.test.ts` asserts each in [94%, 96%].

**Buy Bonus** (socket `vslots_buy`): pay a server-computed multiple of the bet for a round whose bonus is
guaranteed — Dragon Queen 17.6× (a spin drawn from those landing 3+ crowns → free spins), Warzone 10× (guaranteed
airstrike), Gold Rush 39.5× (a spin drawn from those landing 6+ coins → hold-and-spin). Multiples = seeded average
bought-round value ÷ 0.95 (16.70×, 9.47×, 37.57×); the tests assert buy-bonus RTP in [94%, 96%] per machine.
