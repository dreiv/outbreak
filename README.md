# Outbreak Protocol

A browser-playable, cooperative disease-outbreak-control game for 2–4 players.
Original names, original 44-city map, original card flavor — inspired by the
"stop the outbreaks" genre of cooperative board games, not a reproduction of
any specific publisher's board, art, or card text.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm run dev
```

This uses **Turborepo** to start both halves of the app at once:

- `outbreak-server` — the WebSocket game server, on `ws://localhost:8787`
- `outbreak-client` — the Vite dev server, on `http://localhost:5173`

Open `http://localhost:5173` in a browser tab per player (or share the URL
across your network — see "Playing across devices" below). Enter a name and
a room code; everyone who enters the same room code joins the same game.
Once 2–4 players are in the lobby, anyone can hit **Start Game**.

## Playing across devices / with friends

By default the client talks to `ws://<the page's hostname>:8787`, so if you
run `npm run dev` on a machine reachable on your LAN, other players can visit
`http://<your-lan-ip>:5173` and it'll just work. For a real deployment,
put the server behind a domain/TLS and set `VITE_WS_URL` (e.g. in a
`client/.env` file: `VITE_WS_URL=wss://your-domain/ws`) before building the
client.

## How it plays

- **Board**: 44 real-world cities across 4 regions (Azure, Crimson, Amber,
  Verdant), connected by a hand-authored network of plausible travel routes.
  Not a reproduction of any commercial board's exact city list or layout.
- **4 actions per turn**: drive/ferry, direct flight (discard a matching city
  card), charter flight (discard your current city's card, fly anywhere),
  shuttle flight (between two research stations), treat a disease, build a
  research station, share knowledge, or discover a cure.
- **After your actions**: you draw 2 cards (watch out for Epidemics — they
  raise the infection rate, infect a new city hard, and reshuffle the
  infection discard pile back on top of the deck), then the board infects
  cities equal to the current infection rate. A city that would take a 4th
  cube of a color **outbreaks** instead, spreading to every neighbor
  (chain reactions are tracked to avoid infinite loops).
- **Roles**: 7 original roles are dealt at random — Logistics Chief, Field
  Medic, Virologist, Courier, Liaison Officer, Archivist, Quartermaster —
  each with one special ability, shown in the sidebar once assigned.
- **Win**: cure all 4 strains. **Lose**: the outbreak counter maxes out, a
  disease's cube supply runs out, or the player deck runs out.

Click any city on the map — it shows only the actions that are actually
legal from that city given your current position, hand, and turn state.

## Architecture

```
/shared   TypeScript types + board data, imported by both server and client
          so message/action shapes can't drift between them.
/server   Node.js + ws WebSocket server. Holds the single authoritative
          GameState per room, in-memory. Validates and applies every action
          server-side — clients never resolve game logic themselves.
/client   Vite + TypeScript. Renders the board as an inline SVG (clickable
          city nodes), plus a sidebar for hand/roles/cure status/log.
```

**Limitation, by design**: game rooms live entirely in server memory — there
is no database. A room's state is lost if the server process restarts, and a
room is torn down once everyone has been disconnected for longer than the
2-minute reconnect grace period. This is fine for the small (2–4 player),
short-lived sessions this game is built for, but it means this isn't
suitable for long-running or persistent games without adding real storage.

The `state_diff` WebSocket message currently sends the *full* game state on
every change rather than a true incremental diff — simplest correct thing
for a small in-memory state object; worth revisiting if the state grows.

## Scripts

- `npm run dev` — start server + client together via Turborepo
- `npm run build` — production build both packages
- `npm install --workspace server && npm start --workspace server` — run the
  built server standalone (after `npm run build`)
