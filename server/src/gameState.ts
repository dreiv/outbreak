import { randomUUID } from "node:crypto";
import {
  CITIES,
  CITY_MAP,
  STARTING_CITY,
  isConnected,
} from "../../shared/src/boardData.js";
import {
  GameState,
  Player,
  PlayerAction,
  PlayerCard,
  RegionId,
  RoleId,
  ROLES,
  HAND_LIMIT,
  EVENTS,
  EventId,
  DEFAULT_EPIDEMIC_COUNT,
} from "../../shared/src/types.js";

const REGIONS: RegionId[] = ["azure", "crimson", "amber", "verdant"];
const VALID_EPIDEMIC_COUNTS = new Set([4, 5, 6]);
function normalizeEpidemicCount(n: number): number {
  return VALID_EPIDEMIC_COUNTS.has(n) ? n : DEFAULT_EPIDEMIC_COUNT;
}
const INFECTION_RATE_TRACK = [2, 2, 2, 3, 3, 4, 4];
const OUTBREAK_MAX = 8;
const DEAL_SIZE: Record<number, number> = {
  2: 4,
  3: 3,
  4: 3,
  5: 2,
  6: 2,
  7: 2,
};

// Server-only bookkeeping — never broadcast (would leak deck order).
export interface RoomInternal {
  playerDeck: PlayerCard[];
  infectionDeck: string[]; // index 0 = bottom, last = top
  freeMoveUsed: Set<string>; // logistics-chief per-turn tracker
}

export interface Room {
  state: GameState;
  internal: RoomInternal | null; // null while in lobby
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fresh read each call — avoids TS narrowing `state.phase` across mutations.
function isLost(state: GameState): boolean {
  return (state.phase as string) === "lost";
}

function log(state: GameState, text: string, extra?: { cityId?: string }) {
  state.log.push({ id: randomUUID(), ts: Date.now(), text, ...extra });
  if (state.log.length > 200) state.log.shift();
}

export function createRoom(roomId: string): Room {
  const state: GameState = {
    roomId,
    phase: "lobby",
    players: [],
    turnOrder: [],
    currentPlayerIndex: 0,
    actionsRemaining: 4,
    turnsPlayed: 0,
    cityCubes: {},
    cubesRemaining: { azure: 24, crimson: 24, amber: 24, verdant: 24 },
    diseaseState: {
      azure: "active",
      crimson: "active",
      amber: "active",
      verdant: "active",
    },
    researchStations: [STARTING_CITY],
    infectionRate: INFECTION_RATE_TRACK[0],
    infectionRateTrack: INFECTION_RATE_TRACK,
    infectionRateIndex: 0,
    outbreakCounter: 0,
    outbreakMax: OUTBREAK_MAX,
    playerDeckSize: 0,
    playerDiscard: [],
    infectionDeckSize: 0,
    infectionDiscard: [],
    log: [],
    pendingDiscard: null,
    epidemicsResolved: 0,
    epidemicCount: DEFAULT_EPIDEMIC_COUNT,
    oneQuietNightActive: false,
    pendingForecast: null,
  };
  return { state, internal: null };
}

// Lobby-only: lets any seated player choose the difficulty (Epidemic count)
// before Start Game is pressed. Mirrors the physical game's difficulty dial.
export function setEpidemicCount(room: Room, count: number): string | null {
  if (room.state.phase !== "lobby")
    return "Difficulty can only be changed before the game starts.";
  room.state.epidemicCount = normalizeEpidemicCount(count);
  return null;
}

export function addPlayer(
  room: Room,
  playerId: string,
  name: string,
): string | null {
  if (room.state.phase !== "lobby") return "Game already in progress.";
  if (room.state.players.length >= 4) return "Room is full (max 4 players).";
  if (room.state.players.some((p) => p.id === playerId)) return null;
  room.state.players.push({
    id: playerId,
    name,
    role: null,
    location: STARTING_CITY,
    hand: [],
    connected: true,
  });
  log(room.state, `${name} joined the room.`);
  return null;
}

function handLimitFor(p: Player): number {
  return p.role === "archivist" ? HAND_LIMIT + 1 : HAND_LIMIT;
}

export function startGame(room: Room): string | null {
  const { state } = room;
  if (state.phase !== "lobby") return "Game already started.";
  if (state.players.length < 2) return "Need at least 2 players to start.";

  // Assign roles
  const roleIds = shuffle(ROLES.map((r) => r.id)).slice(
    0,
    state.players.length,
  ) as RoleId[];
  state.players.forEach((p, i) => {
    p.role = roleIds[i];
    p.location = STARTING_CITY;
    p.hand = [];
  });

  // Build & shuffle infection deck
  const infectionDeck = shuffle(CITIES.map((c) => c.id));

  // Initial infection: 3 cities get 3/2/1 cubes
  const internal: RoomInternal = {
    playerDeck: [],
    infectionDeck,
    freeMoveUsed: new Set(),
  };
  for (const amount of [3, 2, 1]) {
    for (let i = 0; i < 3; i++) {
      const cityId = internal.infectionDeck.pop();
      if (!cityId) break;
      state.infectionDiscard.push(cityId);
      const region = CITY_MAP[cityId].region;
      for (let k = 0; k < amount; k++)
        addCubeToCity(state, cityId, region, new Set());
    }
  }

  // Player deck: one card per city plus the 5 Event cards, shuffled together
  // exactly like city cards (they can be dealt into a starting hand or drawn
  // later), hands dealt, then epidemics seeded per the chosen difficulty.
  const cityCards: PlayerCard[] = CITIES.map(
    (c) => ({ type: "city", city: c.id, uid: randomUUID() }) as const,
  );
  const eventCards: PlayerCard[] = EVENTS.map(
    (e) => ({ type: "event", event: e.id, uid: randomUUID() }) as const,
  );
  const regularCards: PlayerCard[] = shuffle([...cityCards, ...eventCards]);
  const dealSize = DEAL_SIZE[state.players.length] ?? 2;
  for (const p of state.players) {
    for (let i = 0; i < dealSize; i++) {
      const card = regularCards.pop();
      if (card) p.hand.push(card);
    }
  }
  const epidemicCount = normalizeEpidemicCount(state.epidemicCount);
  const piles: PlayerCard[][] = Array.from(
    { length: epidemicCount },
    () => [],
  );
  regularCards.forEach((card, i) => piles[i % epidemicCount].push(card));
  const deckWithEpidemics: PlayerCard[] = [];
  for (const pile of piles) {
    const withEpidemic = shuffle([
      ...pile,
      { type: "epidemic", uid: randomUUID() } as const,
    ]);
    deckWithEpidemics.push(...withEpidemic);
  }
  // [0] is drawn first -> end of array is the "top"
  internal.playerDeck = deckWithEpidemics.reverse();

  room.internal = internal;
  state.turnOrder = shuffle(state.players.map((p) => p.id));
  state.currentPlayerIndex = 0;
  state.actionsRemaining = 4;
  state.playerDeckSize = internal.playerDeck.length;
  state.infectionDeckSize = internal.infectionDeck.length;
  state.epidemicCount = epidemicCount;
  state.phase = "playing";
  log(state, "The outbreak response begins. Good luck.");
  return null;
}

// --------------------------------------------------------------------------
// Core disease mechanics
// --------------------------------------------------------------------------

function addCubeToCity(
  state: GameState,
  city: string,
  region: RegionId,
  visited: Set<string>,
) {
  if (isLost(state)) return;
  if (state.diseaseState[region] === "eradicated") return;
  const cur = state.cityCubes[city]?.[region] ?? 0;

  if (cur >= 3) {
    if (visited.has(city)) return; // already chained through this city
    visited.add(city);
    state.outbreakCounter++;
    log(
      state,
      `Outbreak in ${CITY_MAP[city].name}! (${state.outbreakCounter}/${state.outbreakMax})`,
      { cityId: city },
    );
    if (state.outbreakCounter >= state.outbreakMax) {
      state.phase = "lost";
      state.lossReason =
        "The outbreak counter reached its maximum — containment has failed.";
      return;
    }
    for (const neighbor of CITY_MAP[city].connections) {
      addCubeToCity(state, neighbor, region, visited);
      if (isLost(state)) return;
    }
    return;
  }

  if (state.cubesRemaining[region] <= 0) {
    state.phase = "lost";
    state.lossReason = `The world ran out of ${region} disease cubes.`;
    return;
  }
  if (!state.cityCubes[city]) state.cityCubes[city] = {};
  state.cityCubes[city]![region] = cur + 1;
  state.cubesRemaining[region]--;
}

function totalCubesOfRegion(state: GameState, region: RegionId): number {
  let sum = 0;
  for (const city of Object.keys(state.cityCubes))
    sum += state.cityCubes[city]?.[region] ?? 0;
  return sum;
}

function checkWin(state: GameState) {
  if (REGIONS.every((r) => state.diseaseState[r] !== "active")) {
    state.phase = "won";
    log(state, "All four strains cured. Humanity holds the line. Victory!");
  }
}

// --------------------------------------------------------------------------
// Turn sequencing
// --------------------------------------------------------------------------

function currentPlayer(state: GameState): Player | undefined {
  const id = state.turnOrder[state.currentPlayerIndex];
  return state.players.find((p) => p.id === id);
}

function drawPlayerCards(room: Room) {
  const { state, internal } = room;
  if (!internal) return;
  const player = currentPlayer(state);
  if (!player) return;

  for (let i = 0; i < 2; i++) {
    if (isLost(state)) return;
    const card = internal.playerDeck.pop();
    if (!card) {
      state.phase = "lost";
      state.lossReason = "The response team ran out of briefing cards.";
      return;
    }
    if (card.type === "epidemic") {
      resolveEpidemic(room);
    } else {
      player.hand.push(card);
    }
  }
  state.playerDeckSize = internal.playerDeck.length;

  const limit = handLimitFor(player);
  if (player.hand.length > limit) {
    state.pendingDiscard = { playerId: player.id, mustDiscardTo: limit };
    log(state, `${player.name} must discard down to ${limit} cards.`);
  }
}

function resolveEpidemic(room: Room) {
  const { state, internal } = room;
  if (!internal) return;
  state.epidemicsResolved++;
  log(state, "Epidemic!");

  // 1. Increase
  state.infectionRateIndex = Math.min(
    state.infectionRateIndex + 1,
    state.infectionRateTrack.length - 1,
  );
  state.infectionRate = state.infectionRateTrack[state.infectionRateIndex];

  // 2. Infect — draw from the BOTTOM of the infection deck, hit it 3x
  const cityId = internal.infectionDeck.shift();
  if (cityId) {
    state.infectionDiscard.push(cityId);
    const region = CITY_MAP[cityId].region;
    const visited = new Set<string>();
    for (let k = 0; k < 3; k++) {
      addCubeToCity(state, cityId, region, visited);
      if (isLost(state)) return;
    }
  }

  // 3. Intensify — shuffle discard onto the top of the draw pile
  const shuffledDiscard = shuffle(state.infectionDiscard);
  internal.infectionDeck.push(...shuffledDiscard);
  state.infectionDiscard = [];
  state.infectionDeckSize = internal.infectionDeck.length;
}

function infectionStep(room: Room) {
  const { state, internal } = room;
  if (!internal || isLost(state)) return;
  if (state.oneQuietNightActive) {
    state.oneQuietNightActive = false;
    log(state, "One Quiet Night — the infection step is skipped.");
    return;
  }
  for (let i = 0; i < state.infectionRate; i++) {
    const cityId = internal.infectionDeck.pop();
    if (!cityId) break; // deck exhaustion is not a loss here
    state.infectionDiscard.push(cityId);
    const region = CITY_MAP[cityId].region;
    addCubeToCity(state, cityId, region, new Set());
    if (isLost(state)) return;
  }
  state.infectionDeckSize = internal.infectionDeck.length;
}

function finishTurn(room: Room) {
  const { state, internal } = room;
  if (!internal) return;
  infectionStep(room);
  if (isLost(state)) return;
  state.turnsPlayed++;
  checkWin(state);
  if (state.phase === "won") return;
  internal.freeMoveUsed.clear();
  state.currentPlayerIndex =
    (state.currentPlayerIndex + 1) % state.turnOrder.length;
  state.actionsRemaining = 4;
  const next = currentPlayer(state);
  if (next) log(state, `It's ${next.name}'s turn.`);
}

function endOfActions(room: Room) {
  const { state } = room;
  drawPlayerCards(room);
  if (isLost(state) || state.phase === "won") return;
  if (state.pendingDiscard) return; // wait for the discard before infecting
  finishTurn(room);
}

// --------------------------------------------------------------------------
// Disconnection handling
// --------------------------------------------------------------------------

// Called when a disconnected player's grace period expires (see rooms.ts).
// Frees the seat in the lobby, or auto-discards/skips mid-game so the
// game doesn't stall on them.
export function forfeitPlayer(room: Room, playerId: string): void {
  const { state } = room;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;

  if (state.phase === "lobby") {
    state.players = state.players.filter((p) => p.id !== playerId);
    log(state, `${player.name} left the room.`);
    return;
  }

  if (state.phase !== "playing") return;

  // Mid-discard: auto-discard down to the limit so the game isn't stuck.
  if (state.pendingDiscard && state.pendingDiscard.playerId === playerId) {
    while (player.hand.length > state.pendingDiscard.mustDiscardTo) {
      const idx = player.hand.findIndex((c) => c.type === "city");
      const [card] = player.hand.splice(idx === -1 ? 0 : idx, 1);
      if (isDiscardable(card)) state.playerDiscard.push(card);
    }
    log(state, `${player.name} disconnected — their hand was auto-discarded.`);
    state.pendingDiscard = null;
    finishTurn(room);
    return;
  }

  // Their turn: skip it so the game doesn't stall.
  if (state.turnOrder[state.currentPlayerIndex] === playerId) {
    log(state, `${player.name} disconnected — their turn is skipped.`);
    state.actionsRemaining = 0;
    endOfActions(room);
  }
}

// --------------------------------------------------------------------------
// Action application
// --------------------------------------------------------------------------

function findCardIndex(
  hand: PlayerCard[],
  predicate: (c: PlayerCard) => boolean,
): number {
  return hand.findIndex(predicate);
}

// City and Event cards go to the discard pile when discarded/played;
// Epidemic cards never sit in a hand long enough to be discarded this way.
function isDiscardable(card: PlayerCard): boolean {
  return card.type === "city" || card.type === "event";
}

const EVENT_FOR_ACTION: Record<string, EventId> = {
  "play-government-grant": "government-grant",
  "play-airlift": "airlift",
  "play-forecast": "forecast",
  "play-resilient-population": "resilient-population",
  "play-one-quiet-night": "one-quiet-night",
};

// All five "play-*" event actions carry a cardUid; pull it out without an
// `any` cast so the switch below still gets full narrowing on `action`.
function eventCardUid(action: PlayerAction): string | null {
  switch (action.type) {
    case "play-government-grant":
    case "play-airlift":
    case "play-forecast":
    case "play-resilient-population":
    case "play-one-quiet-night":
      return action.cardUid;
    default:
      return null;
  }
}

export function applyAction(
  room: Room,
  playerId: string,
  action: PlayerAction,
): string | null {
  const { state, internal } = room;
  if (state.phase !== "playing") return "Game is not in progress.";
  if (!internal) return "Game not initialized.";
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return "Unknown player.";

  if (action.type === "discard") {
    if (!state.pendingDiscard || state.pendingDiscard.playerId !== playerId) {
      return "No discard is pending for you.";
    }
    const idx = findCardIndex(player.hand, (c) => c.uid === action.cardUid);
    if (idx === -1) return "Card not in hand.";
    const [card] = player.hand.splice(idx, 1);
    if (isDiscardable(card)) state.playerDiscard.push(card);
    log(state, `${player.name} discarded a card.`);
    if (player.hand.length <= state.pendingDiscard.mustDiscardTo) {
      state.pendingDiscard = null;
      finishTurn(room);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Event cards: playable by whoever holds them at any time — not just
  // on their own turn, and never spending an action — matching the
  // physical game. Placed ahead of the turn/action gates below.
  // ------------------------------------------------------------------
  if (action.type in EVENT_FOR_ACTION) {
    const wantedEvent = EVENT_FOR_ACTION[action.type];
    const cardUid = eventCardUid(action);
    const idx = findCardIndex(
      player.hand,
      (c) => c.type === "event" && c.uid === cardUid,
    );
    if (idx === -1) return "You do not hold that event card.";
    const card = player.hand[idx];
    if (card.type !== "event" || card.event !== wantedEvent) {
      return "That card doesn't match this event.";
    }

    switch (action.type) {
      case "play-government-grant": {
        if (!CITY_MAP[action.city]) return "Unknown city.";
        if (state.researchStations.includes(action.city))
          return "A research station already exists there.";
        state.researchStations.push(action.city);
        log(
          state,
          `${player.name} played Government Grant — a research station rises in ${CITY_MAP[action.city].name}.`,
        );
        break;
      }
      case "play-airlift": {
        const target = state.players.find((p) => p.id === action.playerId);
        if (!target) return "Unknown player.";
        if (!CITY_MAP[action.to]) return "Unknown city.";
        target.location = action.to;
        log(
          state,
          `${player.name} played Airlift — ${target.name} is moved to ${CITY_MAP[action.to].name}.`,
        );
        break;
      }
      case "play-forecast": {
        if (!internal) return "Game not initialized.";
        if (state.pendingForecast) return "A Forecast is already pending.";
        const n = Math.min(6, internal.infectionDeck.length);
        // internal.infectionDeck's *end* is the top (drawn first via pop());
        // reversing that slice gives it in actual draw order.
        const top = internal.infectionDeck.slice(-n).reverse();
        state.pendingForecast = { playerId, cities: top };
        log(
          state,
          `${player.name} played Forecast — the team peeks at the top of the Infection Deck.`,
        );
        break;
      }
      case "play-resilient-population": {
        const dIdx = state.infectionDiscard.indexOf(action.cityId);
        if (dIdx === -1)
          return "That city is not in the infection discard pile.";
        state.infectionDiscard.splice(dIdx, 1);
        log(
          state,
          `${player.name} played Resilient Population — ${CITY_MAP[action.cityId].name} is removed from the game.`,
        );
        break;
      }
      case "play-one-quiet-night": {
        state.oneQuietNightActive = true;
        log(
          state,
          `${player.name} played One Quiet Night — the next infection step will be skipped.`,
        );
        break;
      }
    }

    player.hand.splice(idx, 1);
    state.playerDiscard.push(card);

    // Playing an event card shrinks your hand — if that clears your own
    // pending forced discard, resolve it immediately.
    if (
      state.pendingDiscard &&
      state.pendingDiscard.playerId === playerId &&
      player.hand.length <= state.pendingDiscard.mustDiscardTo
    ) {
      state.pendingDiscard = null;
      finishTurn(room);
    }
    return null;
  }

  if (action.type === "resolve-forecast") {
    if (!internal) return "Game not initialized.";
    if (!state.pendingForecast) return "No Forecast is pending.";
    if (state.pendingForecast.playerId !== playerId) {
      return "Only the player who played Forecast can set the new order.";
    }
    const { cities } = state.pendingForecast;
    const validPermutation =
      action.order.length === cities.length &&
      new Set(action.order).size === cities.length &&
      action.order.every((c) => cities.includes(c));
    if (!validPermutation) {
      return "The new order must contain exactly the revealed cities.";
    }
    const n = cities.length;
    // order[0] should be drawn next -> lands at the end of the array (top).
    internal.infectionDeck.splice(
      internal.infectionDeck.length - n,
      n,
      ...action.order.slice().reverse(),
    );
    state.pendingForecast = null;
    log(state, `${player.name} rearranged the top of the Infection Deck.`);
    return null;
  }

  const isTurn = state.turnOrder[state.currentPlayerIndex] === playerId;
  if (!isTurn) return "It is not your turn.";
  if (state.pendingDiscard)
    return "A discard is pending before the game can continue.";

  switch (action.type) {
    case "end-turn": {
      state.actionsRemaining = 0;
      endOfActions(room);
      return null;
    }
    case "drive": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      if (!isConnected(player.location, action.to))
        return "That city is not connected.";
      player.location = action.to;
      const free =
        player.role === "logistics-chief" &&
        !internal.freeMoveUsed.has(player.id);
      if (free) internal.freeMoveUsed.add(player.id);
      else state.actionsRemaining--;
      log(state, `${player.name} traveled to ${CITY_MAP[action.to].name}.`);
      break;
    }
    case "direct-flight": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      const idx = findCardIndex(
        player.hand,
        (c) => c.type === "city" && c.city === action.to,
      );
      if (idx === -1) return "You do not hold a card for that city.";
      player.hand.splice(idx, 1);
      player.location = action.to;
      state.actionsRemaining--;
      log(state, `${player.name} flew direct to ${CITY_MAP[action.to].name}.`);
      break;
    }
    case "charter-flight": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      const idx = findCardIndex(
        player.hand,
        (c) => c.type === "city" && c.city === player.location,
      );
      if (idx === -1) return "You do not hold the card for your current city.";
      if (!CITY_MAP[action.to]) return "Unknown destination.";
      player.hand.splice(idx, 1);
      player.location = action.to;
      state.actionsRemaining--;
      log(
        state,
        `${player.name} chartered a flight to ${CITY_MAP[action.to].name}.`,
      );
      break;
    }
    case "shuttle-flight": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      if (!state.researchStations.includes(player.location))
        return "No research station in your current city.";
      if (!state.researchStations.includes(action.to))
        return "No research station at the destination.";
      player.location = action.to;
      state.actionsRemaining--;
      log(
        state,
        `${player.name} took a shuttle flight to ${CITY_MAP[action.to].name}.`,
      );
      break;
    }
    case "treat": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      const cur = state.cityCubes[player.location]?.[action.region] ?? 0;
      if (cur <= 0) return "No cubes of that color here.";
      const removeAll =
        player.role === "field-medic" ||
        state.diseaseState[action.region] === "cured";
      const removed = removeAll ? cur : 1;
      const remaining = cur - removed;
      if (remaining > 0) {
        state.cityCubes[player.location]![action.region] = remaining;
      } else {
        // Drop the entry rather than leave a stale `0` — cityCubes is
        // iterated, so "no entry" must mean "no cubes".
        delete state.cityCubes[player.location]![action.region];
        if (Object.keys(state.cityCubes[player.location]!).length === 0) {
          delete state.cityCubes[player.location];
        }
      }
      state.cubesRemaining[action.region] += removed;
      if (
        state.diseaseState[action.region] === "cured" &&
        totalCubesOfRegion(state, action.region) === 0
      ) {
        state.diseaseState[action.region] = "eradicated";
        log(state, `${action.region} strain eradicated!`);
      }
      state.actionsRemaining--;
      log(
        state,
        `${player.name} treated ${action.region} in ${CITY_MAP[player.location].name}.`,
      );
      break;
    }
    case "build-station": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      if (state.researchStations.includes(player.location))
        return "A station already exists here.";
      if (player.role !== "quartermaster") {
        const idx = findCardIndex(
          player.hand,
          (c) => c.type === "city" && c.city === player.location,
        );
        if (idx === -1)
          return "You do not hold the card for your current city.";
        const [card] = player.hand.splice(idx, 1);
        if (card.type === "city") state.playerDiscard.push(card);
      }
      state.researchStations.push(player.location);
      state.actionsRemaining--;
      log(
        state,
        `${player.name} built a research station in ${CITY_MAP[player.location].name}.`,
      );
      break;
    }
    case "share-knowledge": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      const other = state.players.find((p) => p.id === action.withPlayerId);
      if (!other) return "Unknown player.";
      const colocated = player.location === other.location;
      const courierInvolved =
        player.role === "courier" || other.role === "courier";
      if (!colocated && !courierInvolved)
        return "Both players must be in the same city.";
      const flexibleCard =
        player.role === "liaison-officer" || other.role === "liaison-officer";

      const giver = action.direction === "give" ? player : other;
      const receiver = action.direction === "give" ? other : player;
      const idx = findCardIndex(
        giver.hand,
        (c) => c.type === "city" && c.city === action.cityCard,
      );
      if (idx === -1) return "That card is not in the giving player's hand.";
      if (!flexibleCard && action.cityCard !== player.location) {
        return "The shared card must match the current city (unless a Liaison Officer is involved).";
      }
      const [card] = giver.hand.splice(idx, 1);
      receiver.hand.push(card);
      state.actionsRemaining--;
      log(
        state,
        `${player.name} ${action.direction === "give" ? "gave a card to" : "took a card from"} ${other.name}.`,
      );
      break;
    }
    case "discover-cure": {
      if (state.actionsRemaining <= 0) return "No actions remaining.";
      if (!state.researchStations.includes(player.location))
        return "You must be at a research station.";
      if (state.diseaseState[action.region] !== "active")
        return "That strain is already cured.";
      const needed = player.role === "virologist" ? 4 : 5;
      if (action.cardUids.length !== needed)
        return `You must discard exactly ${needed} matching city cards.`;
      const cards: PlayerCard[] = [];
      for (const uid of action.cardUids) {
        const c = player.hand.find((h) => h.uid === uid);
        if (
          !c ||
          c.type !== "city" ||
          CITY_MAP[c.city].region !== action.region
        ) {
          return "All cards must be city cards of the cured region.";
        }
        cards.push(c);
      }
      player.hand = player.hand.filter((c) => !action.cardUids.includes(c.uid));
      state.playerDiscard.push(...cards);
      if (totalCubesOfRegion(state, action.region) === 0) {
        state.diseaseState[action.region] = "eradicated";
      } else {
        state.diseaseState[action.region] = "cured";
      }
      state.actionsRemaining--;
      log(
        state,
        `${player.name} discovered the cure for the ${action.region} strain!`,
      );
      checkWin(state);
      break;
    }
    default:
      return "Unknown action.";
  }

  if (
    state.phase === "playing" &&
    state.actionsRemaining <= 0 &&
    !state.pendingDiscard
  ) {
    endOfActions(room);
  }
  return null;
}