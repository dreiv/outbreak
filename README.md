# Outbreak Protocol

A browser-playable, cooperative strategy game for 2–4 players. Inspired by classic disease-control board games, players must coordinate their unique skills to halt global infections, discover cures, and save humanity before time runs out.

## Quick Start & Network Play

Requires Node.js 18+. To start both the Vite client and the WebSocket server locally using Turborepo, run:

```bash
npm install
npm run dev

```

Open `http://localhost:5173` in a browser (one tab per player). Enter a name and a shared room code to join the lobby. Once everyone is in, anyone can hit **Start Game**.

> **Playing with friends:** By default, the client connects to `ws://<the page's hostname>:8787`. If you run this on your LAN, friends can join via `http://<your-lan-ip>:5173`. For a real deployment, put the server behind a domain and set the `VITE_WS_URL` environment variable before building the client.

## Gameplay Mechanics

Navigate the interactive SVG map by clicking any city—the UI will intelligently display only the legal actions available based on your hand, position, and turn state.

- **The Board:** Travel across 44 globally distributed cities spanning 4 distinct regions (Azure, Crimson, Amber, Verdant).
- **Your Turn:** Spend up to 4 actions to move (drive/ferry, direct flight, charter flight, or shuttle), treat diseases, build research stations, share knowledge, or discover a cure.
- **Escalating Threat:** After acting, draw 2 cards. Beware of Epidemics that accelerate infection rates and intensify the crisis. The board then infects cities—if a city receives a 4th disease cube, it triggers a cascading **outbreak** into neighboring cities.
- **Unique Roles:** Players are randomly assigned one of 7 distinct specialists (e.g., Field Medic, Virologist, Logistics Chief), each bringing a crucial passive ability to the team.
- **Win or Lose:** Victory is achieved by curing all 4 disease strains. You lose if the outbreak counter maxes out, a disease cube supply is exhausted, or the player deck runs empty.

## Architecture & Scripts

The game relies on an authoritative server model where clients never resolve game logic. Rooms live entirely in server memory; they are safely torn down once everyone has been disconnected past a 2-minute grace period.

- `/shared`: TypeScript types and board data imported by both client and server to prevent state drift.
- `/server`: Node.js + WebSocket server holding the authoritative, in-memory GameState per room.
- `/client`: Vite + TypeScript frontend rendering the interactive SVG board and game UI.

To build and run for production, use `npm run build`, then run `npm start --workspace server`.
