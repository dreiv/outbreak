// Game QA Testing Agent harness.
// Boots against the running WebSocket server, connects Player 1 & Player 2,
// runs a complete match turn-by-turn, and logs bugs / crashes / illegal states.
//
// Run with the server already up:  npx tsx qa/qa-harness.ts
import WebSocket from "ws";
import { CITY_MAP } from "../shared/src/boardData.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WS_URL = process.env.QA_WS_URL || "ws://localhost:8787";
const ROOM_ID = `qa-${Date.now()}`;
const MAX_TURNS = 100; // full player-turns before we declare a stall
const TIME_LIMIT_MS = 5 * 60 * 1000; // hard wall-clock cap
const MAX_ACTIONS_PER_TURN = 12; // safety: 4 actions + discards + buffer
const REGIONS = ["azure", "crimson", "amber", "verdant"] as const;

// ---------------------------------------------------------------------------
// Issue log
// ---------------------------------------------------------------------------
interface Issue {
  id: number;
  ts: string;
  turn: number | null;
  actor: string;
  action: string;
  expected: string;
  actual: string;
  severity: "Low" | "Medium" | "Critical";
  raw: string;
}
const issues: Issue[] = [];
let issueCounter = 0;
let currentTurn = 0;
const loggedInvariants = new Set<string>();

function addIssue(p: {
  actor: string;
  action: string;
  expected: string;
  actual: string;
  severity: Issue["severity"];
  raw: string;
}) {
  issueCounter++;
  issues.push({
    id: issueCounter,
    ts: new Date().toISOString(),
    turn: currentTurn,
    ...p,
  });
}

// ---------------------------------------------------------------------------
// Client wrapper (one per player)
// ---------------------------------------------------------------------------
type Ev =
  | { kind: "state"; state: any }
  | { kind: "error"; message: string }
  | { kind: "joined"; playerId: string; roomId: string }
  | { kind: "pong" };

class Client {
  name: string;
  ws: WebSocket | null = null;
  latestState: any = null;
  stateVersion = 0; // counts state_sync/state_diff only
  joinedInfo: { playerId: string; roomId: string } | null = null;
  events: Ev[] = [];
  private _stateWaiters: Array<() => void> = [];
  private _eventWaiters: Array<() => void> = [];

  constructor(name: string) {
    this.name = name;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(
        () => reject(new Error(`${this.name}: connection timeout`)),
        5000,
      );
      ws.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`${this.name}: ws error: ${e.message}`));
      });
      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this._onMessage(msg);
      });
    });
  }

  private _onMessage(msg: any) {
    switch (msg.type) {
      case "state_sync":
      case "state_diff": {
        this.latestState = msg.state;
        this.stateVersion++;
        const sw = this._stateWaiters.splice(0);
        sw.forEach((w) => w());
        this._push({ kind: "state", state: msg.state });
        break;
      }
      case "joined": {
        this.joinedInfo = { playerId: msg.playerId, roomId: msg.roomId };
        this._push({
          kind: "joined",
          playerId: msg.playerId,
          roomId: msg.roomId,
        });
        break;
      }
      case "error": {
        this._push({ kind: "error", message: msg.message });
        break;
      }
      case "pong": {
        this._push({ kind: "pong" });
        break;
      }
    }
  }

  private _push(ev: Ev) {
    this.events.push(ev);
    const ew = this._eventWaiters.splice(0);
    ew.forEach((w) => w());
  }

  send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(msg));
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  // Resolve when stateVersion > sinceVersion.
  async waitForState(sinceVersion: number, timeout = 5000): Promise<any> {
    if (this.stateVersion > sinceVersion) return this.latestState;
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${this.name}: timeout waiting for state`)),
        timeout,
      );
      this._stateWaiters.push(() => {
        clearTimeout(t);
        resolve(this.latestState);
      });
    });
  }

  // Resolve with the event at index `sinceSeq` (the next event).
  async waitForEvent(sinceSeq: number, timeout = 5000): Promise<Ev> {
    if (this.events.length > sinceSeq) return this.events[sinceSeq];
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${this.name}: timeout waiting for event`)),
        timeout,
      );
      this._eventWaiters.push(() => {
        if (this.events.length > sinceSeq) {
          clearTimeout(t);
          resolve(this.events[sinceSeq]);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Action selection — cooperative "win" AI (only ever emits rule-legal actions).
// Both players focus on the same target region: hoard its cards, keep the
// board contained, and cure it at a research station. Repeat per region.
// ---------------------------------------------------------------------------
// Planning layer: persistent per-player region commitments. Without this,
// the target region was recomputed from scratch on every single action, so
// a player 4 cards into a cure could get flip-flopped onto a different
// region (or into firefighting) the instant the board shifted. Now a
// commitment sticks once meaningfully invested, and is only dropped when
// the region is cured/eradicated.
type Region = (typeof REGIONS)[number];
const commitments = new Map<string, Region>(); // playerId -> region

const STICKY_CARD_THRESHOLD = 2; // cards in a region before we lock in
const URGENT_CUBE_THRESHOLD = 3; // one infection away from an outbreak
const CRITICAL_OUTBREAK_MARGIN = 1; // how close to outbreakMax is "crisis mode"

function neededCardsFor(player: any): number {
  return player.role === "virologist" ? 4 : 5;
}

function handCardsOf(player: any, region: string) {
  return player.hand.filter(
    (c: any) => c.type === "city" && CITY_MAP[c.city].region === region,
  );
}

// How many more matching cards `player` needs to cure `region` — lower is
// "closer to done". This single metric embeds role-awareness for free: a
// Virologist's threshold is 4 instead of 5, so an equal hand always scores
// them as closer to completion, which is what should drive who takes point
// on a given region.
function cardsAwayFrom(player: any, region: string): number {
  return neededCardsFor(player) - handCardsOf(player, region).length;
}

// Resolve (and persist) this player's target region for the turn. Sticks to
// an existing commitment once invested; otherwise picks whichever active
// region this player is closest to completing, preferring one the teammate
// isn't already committed to (dedup) unless the overlapping option is
// clearly better than any alternative.
function resolveTarget(state: any, player: any): string | null {
  const active = REGIONS.filter((r) => state.diseaseState[r] === "active");
  if (active.length === 0) {
    commitments.delete(player.id);
    return null;
  }

  const existing = commitments.get(player.id);
  if (existing && active.includes(existing)) {
    if (handCardsOf(player, existing).length >= STICKY_CARD_THRESHOLD) {
      return existing; // hold the line — don't re-shop for a "better" target
    }
  } else if (existing) {
    commitments.delete(player.id); // committed region is no longer active
  }

  const teammateTarget = state.players
    .filter((p: any) => p.id !== player.id)
    .map((p: any) => commitments.get(p.id))
    .find((r: Region | undefined) => r && active.includes(r));

  const scored = active
    .map((r) => ({ r, away: cardsAwayFrom(player, r) }))
    .sort((a, b) => a.away - b.away);
  const best = scored[0];
  const bestNonOverlap = scored.find((s) => s.r !== teammateTarget);

  // Only avoid the overlap when it doesn't cost much; if the overlapping
  // region is meaningfully closer to done, pile on and help finish it.
  const pick =
    !bestNonOverlap ||
    (best.r === teammateTarget && bestNonOverlap.away - best.away > 1)
      ? best
      : bestNonOverlap;

  commitments.set(player.id, pick.r);
  return pick.r;
}

function threeCubeCities(state: any): string[] {
  return Object.keys(state.cityCubes).filter((city) =>
    REGIONS.some((r) => (state.cityCubes[city][r] ?? 0) >= 3),
  );
}

function bfsDistances(from: string): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const queue: string[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of CITY_MAP[cur].connections)
      if (!(nb in dist)) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
  }
  return dist;
}

function nearestOf(candidates: string[], from: string): string | null {
  if (candidates.length === 0) return null;
  const dist = bfsDistances(from);
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates)
    if (c in dist && dist[c] < bestD) {
      bestD = dist[c];
      best = c;
    }
  return best;
}

function travelToward(state: any, player: any, dest: string): any | null {
  const loc = player.location;
  if (loc === dest) return null;
  // Shuttle-flight: instant station-to-station hop. Checked first since it
  // beats a multi-hop drive whenever it applies (both endpoints are
  // research stations) and previously was never generated at all.
  if (
    state.researchStations.includes(loc) &&
    state.researchStations.includes(dest)
  )
    return { type: "shuttle-flight", to: dest };
  if (CITY_MAP[loc].connections.includes(dest))
    return { type: "drive", to: dest };
  if (player.hand.some((c: any) => c.type === "city" && c.city === dest))
    return { type: "direct-flight", to: dest };
  if (player.hand.some((c: any) => c.type === "city" && c.city === loc))
    return { type: "charter-flight", to: dest };
  // BFS from the DESTINATION so we can tell, for each neighbor of `loc`, how
  // much closer it actually gets us to `dest`. (Previously this ran
  // bfsDistances(loc), which made every direct neighbor's distance exactly 1
  // by construction — the loop below always picked the first-listed
  // neighbor regardless of `dest`, so multi-hop travel never converged.)
  const distFromDest = bfsDistances(dest);
  let next: string | null = null;
  let bestD = distFromDest[loc] ?? Infinity;
  for (const nb of CITY_MAP[loc].connections)
    if (nb in distFromDest && distFromDest[nb] < bestD) {
      bestD = distFromDest[nb];
      next = nb;
    }
  return next ? { type: "drive", to: next } : null;
}

function worstRegionAt(state: any, city: string): string | null {
  const c = state.cityCubes[city];
  if (!c) return null;
  const regions = REGIONS.filter((r) => (c[r] ?? 0) > 0).sort(
    (a, b) => (c[b] ?? 0) - (c[a] ?? 0),
  );
  return regions[0] ?? null;
}

function chooseAction(state: any, player: any): any {
  const loc = player.location;
  const target = resolveTarget(state, player);
  const needed = neededCardsFor(player);
  const targetCards = target ? handCardsOf(player, target) : [];
  const stocked = target !== null && targetCards.length >= needed;

  // 1. Must-discard: shed a non-target city card first, then a non-city
  //    (event/other) card, and only fall back to a target-region card if
  //    the hand is somehow made up of nothing else — this used to fall
  //    straight to hand[0], which could (and did, per the logs) mean
  //    discarding one of the exact cards being hoarded for a cure.
  if (state.pendingDiscard && state.pendingDiscard.playerId === player.id) {
    const nonTargetCity = player.hand.find(
      (c: any) =>
        c.type === "city" &&
        (target ? CITY_MAP[c.city].region !== target : true),
    );
    const nonCity = player.hand.find((c: any) => c.type !== "city");
    const card = nonTargetCity || nonCity || player.hand[0];
    if (card) return { type: "discard", cardUid: card.uid };
    return { type: "end-turn" };
  }
  if (state.actionsRemaining <= 0) return { type: "end-turn" };

  // 2. Cure the target region right now if we're at a station with enough cards.
  if (
    target &&
    state.researchStations.includes(loc) &&
    targetCards.length >= needed
  ) {
    return {
      type: "discover-cure",
      region: target,
      cardUids: targetCards.slice(0, needed).map((c: any) => c.uid),
    };
  }

  // 3. EMERGENCY containment. A city at 3 cubes is one infection card from
  //    an outbreak. Responding AT our own location is always free (no
  //    travel cost) and happens regardless of stocked status. Traveling
  //    to fight a fire elsewhere is different: the diagnostics showed
  //    stocked players (sometimes holding 6-7 cards against a 4-5 need)
  //    never reaching a station because *any* emergency anywhere on the
  //    board kept pulling them back into firefighting forever, even when
  //    their teammate was free to cover it. A stocked player now only
  //    leaves their beeline to a station for a real crisis (the outbreak
  //    counter nearly maxed) — otherwise, banking an actual cure is worth
  //    more than chasing one more 3-cube city that isn't theirs to solve.
  const crisisMode =
    state.outbreakCounter >= state.outbreakMax - CRITICAL_OUTBREAK_MARGIN;
  const emergencyThreshold = crisisMode ? 2 : URGENT_CUBE_THRESHOLD;
  const emergencies = Object.keys(state.cityCubes).filter((city) =>
    REGIONS.some((r) => (state.cityCubes[city][r] ?? 0) >= emergencyThreshold),
  );
  if (emergencies.includes(loc)) {
    const region = worstRegionAt(state, loc);
    if (region) return { type: "treat", region };
  }
  if (emergencies.length && (!stocked || crisisMode)) {
    // Dedup: if a teammate is already standing on an emergency city (about
    // to treat it this action), don't also converge on it — go cover a
    // still-unhandled one instead, if there is one.
    const others = (state.players ?? []).filter((p: any) => p.id !== player.id);
    const covered = new Set(
      others
        .filter((p: any) => emergencies.includes(p.location))
        .map((p: any) => p.location),
    );
    const pool = emergencies.filter((c) => !covered.has(c));
    const dest = nearestOf(pool.length ? pool : emergencies, loc);
    if (dest) {
      const act = travelToward(state, player, dest);
      if (act) return act;
    }
  }

  // 4. Bank the cure — once we've got enough matching cards for our
  //    committed region, head straight for a station instead of getting
  //    pulled into non-urgent firefighting along the way.
  if (stocked && !state.researchStations.includes(loc)) {
    const dest = nearestOf(state.researchStations, loc);
    if (dest) {
      const act = travelToward(state, player, dest);
      if (act) return act;
    }
  }

  // 5. Free containment: treat cubes at our CURRENT location only — this
  //    costs no travel/turns, so it's worth doing on the way through.
  const regionHere = worstRegionAt(state, loc);
  if (regionHere) return { type: "treat", region: regionHere };

  // 6. Prophylactic containment: a 2-cube city one hop away is cheap
  //    insurance against it becoming tomorrow's emergency — a single drive
  //    now (treated next visit via tier 5) instead of a multi-hop scramble
  //    once it's already critical. Skipped once stocked: a fully-loaded
  //    player is already committed to tier 4's beeline and shouldn't be
  //    pulled off it for a problem that isn't theirs to solve.
  if (!stocked) {
    const adjacentDanger = (CITY_MAP[loc].connections as string[]).find((nb) =>
      REGIONS.some((r) => (state.cityCubes[nb]?.[r] ?? 0) >= 2),
    );
    if (adjacentDanger) return { type: "drive", to: adjacentDanger };
  }

  // 7. Get back to a research station in preparation for a future cure.
  if (!state.researchStations.includes(loc)) {
    const dest = nearestOf(state.researchStations, loc);
    if (dest) {
      const act = travelToward(state, player, dest);
      if (act) return act;
    }
    const hasCard =
      player.role === "quartermaster" ||
      player.hand.some((c: any) => c.type === "city" && c.city === loc);
    if (hasCard) return { type: "build-station" };
  }

  // 8. Default: end turn (the 2-card draw happens automatically).
  return { type: "end-turn" };
}

function describeAction(a: any): string {
  switch (a.type) {
    case "drive":
      return `drive -> ${a.to}`;
    case "direct-flight":
      return `direct-flight -> ${a.to}`;
    case "charter-flight":
      return `charter-flight -> ${a.to}`;
    case "shuttle-flight":
      return `shuttle-flight -> ${a.to}`;
    case "treat":
      return `treat ${a.region}`;
    case "build-station":
      return "build-station";
    case "share-knowledge":
      return `share-knowledge ${a.direction} ${a.cityCard} (with ${a.withPlayerId})`;
    case "discover-cure":
      return `discover-cure ${a.region} (${a.cardUids.length} cards)`;
    case "discard":
      return `discard ${a.cardUid}`;
    case "end-turn":
      return "end-turn";
    default:
      return a.type;
  }
}

function summarize(s: any): any {
  if (!s) return null;
  return {
    phase: s.phase,
    currentPlayerIndex: s.currentPlayerIndex,
    actionsRemaining: s.actionsRemaining,
    turnsPlayed: s.turnsPlayed,
    outbreakCounter: s.outbreakCounter,
    cubesRemaining: s.cubesRemaining,
    diseaseState: s.diseaseState,
    playerDeckSize: s.playerDeckSize,
    infectionDeckSize: s.infectionDeckSize,
    pendingDiscard: s.pendingDiscard,
    lossReason: s.lossReason,
    logTail: s.log?.slice(-5)?.map((l: any) => l.text),
  };
}

// ---------------------------------------------------------------------------
// Invariant checks (return a list of violation strings; empty = healthy)
// ---------------------------------------------------------------------------
function checkInvariants(s: any): string[] {
  const v: string[] = [];
  if (!s) return ["state is null"];

  if (!["lobby", "playing", "won", "lost"].includes(s.phase))
    v.push(`invalid phase: ${s.phase}`);
  if (s.actionsRemaining < 0 || s.actionsRemaining > 4)
    v.push(`actionsRemaining out of range: ${s.actionsRemaining}`);
  if (s.currentPlayerIndex < 0 || s.currentPlayerIndex >= s.turnOrder.length)
    v.push(
      `currentPlayerIndex out of range: ${s.currentPlayerIndex} (turnOrder len ${s.turnOrder.length})`,
    );

  const playerIds = s.players.map((p: any) => p.id).sort();
  const turnIds = s.turnOrder.slice().sort();
  if (JSON.stringify(playerIds) !== JSON.stringify(turnIds))
    v.push(
      `turnOrder does not match players: ${JSON.stringify({ playerIds, turnIds })}`,
    );

  for (const r of REGIONS)
    if (s.cubesRemaining[r] < 0)
      v.push(`cubesRemaining[${r}] negative: ${s.cubesRemaining[r]}`);

  for (const [city, cubes] of Object.entries<any>(s.cityCubes)) {
    for (const [r, n] of Object.entries<any>(cubes)) {
      if (n < 0 || n > 3) v.push(`cityCubes[${city}][${r}] out of range: ${n}`);
    }
  }

  if (s.outbreakCounter < 0 || s.outbreakCounter > s.outbreakMax)
    v.push(
      `outbreakCounter out of range: ${s.outbreakCounter}/${s.outbreakMax}`,
    );
  if (s.playerDeckSize < 0)
    v.push(`playerDeckSize negative: ${s.playerDeckSize}`);
  if (s.infectionDeckSize < 0)
    v.push(`infectionDeckSize negative: ${s.infectionDeckSize}`);
  if (s.turnsPlayed < 0) v.push(`turnsPlayed negative: ${s.turnsPlayed}`);

  // Hand limit is enforced only at the card-draw step (end of turn). A player
  // can legally hold extra cards mid-turn after receiving them via
  // share-knowledge; at most 4 can be received in one turn (one per action).
  for (const p of s.players) {
    const limit = p.role === "archivist" ? 8 : 7;
    if (p.hand.length > limit + 4)
      v.push(
        `hand size implausibly large for ${p.name}: ${p.hand.length} > ${limit}+4`,
      );
  }

  const rs = s.researchStations;
  if (new Set(rs).size !== rs.length)
    v.push(`duplicate research stations: ${JSON.stringify(rs)}`);

  for (const r of REGIONS)
    if (!["active", "cured", "eradicated"].includes(s.diseaseState[r]))
      v.push(`invalid diseaseState[${r}]: ${s.diseaseState[r]}`);

  if (
    s.infectionRateIndex < 0 ||
    s.infectionRateIndex >= s.infectionRateTrack.length
  )
    v.push(`infectionRateIndex out of range: ${s.infectionRateIndex}`);
  if (s.infectionRate !== s.infectionRateTrack[s.infectionRateIndex])
    v.push(
      `infectionRate mismatch: ${s.infectionRate} vs track[${s.infectionRateIndex}]=${s.infectionRateTrack[s.infectionRateIndex]}`,
    );

  if (s.pendingDiscard) {
    const pd = s.pendingDiscard;
    if (pd.mustDiscardTo < 0)
      v.push(`pendingDiscard.mustDiscardTo negative: ${pd.mustDiscardTo}`);
    if (!s.players.some((p: any) => p.id === pd.playerId))
      v.push(`pendingDiscard.playerId not a player: ${pd.playerId}`);
  }

  if (s.epidemicsResolved < 0)
    v.push(`epidemicsResolved negative: ${s.epidemicsResolved}`);
  if (!Array.isArray(s.log)) v.push("log is not an array");

  // Strong accounting invariant: supply + in-play must equal the 24-cube
  // starting supply for every region (cubes only move between the two).
  for (const r of REGIONS) {
    let total = 0;
    for (const cubes of Object.values<any>(s.cityCubes))
      total += (cubes[r] ?? 0) as number;
    if (s.cubesRemaining[r] + total !== 24)
      v.push(
        `cube accounting mismatch for ${r}: remaining(${s.cubesRemaining[r]}) + inPlay(${total}) = ${s.cubesRemaining[r] + total} (expected 24)`,
      );
  }

  return v;
}

function runInvariantChecks(state: any) {
  for (const violation of checkInvariants(state)) {
    if (!loggedInvariants.has(violation)) {
      loggedInvariants.add(violation);
      addIssue({
        actor: "Engine",
        action: "Invariant check",
        expected: "All state invariants hold",
        actual: violation,
        severity: "Critical",
        raw: JSON.stringify(summarize(state)),
      });
    }
  }
}

function checkDesync(p1: Client, p2: Client) {
  const a = JSON.stringify(p1.latestState);
  const b = JSON.stringify(p2.latestState);
  if (a !== b) {
    addIssue({
      actor: "Engine",
      action: "State desync check",
      expected: "Player 1 and Player 2 observe identical state",
      actual: "States diverged after a server broadcast",
      severity: "Critical",
      raw: "DESYNC: P1 vs P2 state mismatch",
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function printReport(finalState: any) {
  console.log("\n" + "=".repeat(72));
  console.log("QA ISSUE LOG");
  console.log("=".repeat(72));
  if (issues.length === 0) {
    console.log("No issues found. Match completed cleanly.");
  } else {
    for (const iss of issues) {
      console.log(`\n[ISSUE ${iss.id}]`);
      console.log(`- Timestamp / Turn: ${iss.ts} (turn ${iss.turn ?? "n/a"})`);
      console.log(`- Actor: ${iss.actor}`);
      console.log(`- Action Attempted: ${iss.action}`);
      console.log(`- Expected Outcome: ${iss.expected}`);
      console.log(`- Actual Outcome: ${iss.actual}`);
      console.log(`- Severity: ${iss.severity}`);
      console.log(`- Raw Log / Error Trace:\n${iss.raw}`);
    }
  }
  console.log("=".repeat(72));
  console.log(
    `Match result: phase=${finalState?.phase ?? "unknown"}, ` +
      `turnsPlayed=${finalState?.turnsPlayed ?? "n/a"}, ` +
      `outbreakCounter=${finalState?.outbreakCounter ?? "n/a"}/${finalState?.outbreakMax ?? "?"}`,
  );
  if (finalState?.phase === "lost")
    console.log(`Loss reason: ${finalState.lossReason}`);
  if (finalState?.phase === "won") console.log("Result: VICTORY");
  printCureProgress(finalState);
  console.log(`Total issues logged: ${issues.length}`);
  console.log("=".repeat(72));
}

// Snapshot of how close each region/player was to a cure when the match
// ended — without this we're tuning chooseAction blind.
function printCureProgress(finalState: any) {
  if (!finalState?.diseaseState || !finalState?.players) return;
  console.log("-".repeat(72));
  console.log("CURE PROGRESS AT END OF MATCH");
  for (const r of REGIONS) {
    const cubesOnBoard = Object.values(finalState.cityCubes ?? {}).reduce(
      (sum: number, cubes: any) => sum + (cubes[r] ?? 0),
      0,
    );
    console.log(
      `  ${r}: ${finalState.diseaseState[r]} (cubes on board: ${cubesOnBoard})`,
    );
  }
  for (const p of finalState.players) {
    const held = REGIONS.map((r) => `${r}=${handCardsOf(p, r).length}`).join(
      ", ",
    );
    console.log(
      `  ${p.name ?? p.id} (${p.role}): committed=${commitments.get(p.id) ?? "none"}, ` +
        `needed=${neededCardsFor(p)}, hand[${held}]`,
    );
  }
  console.log("-".repeat(72));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const p1 = new Client("Player 1");
  const p2 = new Client("Player 2");

  const cleanup = () => {
    p1.close();
    p2.close();
  };

  // --- Step 1: connect both players ---------------------------------------
  try {
    await Promise.all([p1.connect(WS_URL), p2.connect(WS_URL)]);
    console.log(`[QA] Connected both players to ${WS_URL}`);
  } catch (e) {
    addIssue({
      actor: "Engine",
      action: "WebSocket connect",
      expected: "Both players connect to the server",
      actual: String(e),
      severity: "Critical",
      raw: String(e),
    });
    printReport(null);
    cleanup();
    process.exit(1);
  }

  // --- Join the lobby ----------------------------------------------------
  try {
    p1.send({
      type: "join_room",
      roomId: ROOM_ID,
      playerName: "Player 1",
      playerId: "p1",
    });
    await p1.waitForState(0, 5000);
    p2.send({
      type: "join_room",
      roomId: ROOM_ID,
      playerName: "Player 2",
      playerId: "p2",
    });
    await p2.waitForState(0, 5000);
    // Let P1 receive P2's join broadcast so both views converge.
    await p1.waitForState(p1.stateVersion, 2000).catch(() => {});
  } catch (e) {
    addIssue({
      actor: "Engine",
      action: "join_room",
      expected: "Both players seated in lobby",
      actual: String(e),
      severity: "Critical",
      raw: String(e),
    });
    printReport(null);
    cleanup();
    process.exit(1);
  }

  const lobbyState = p1.latestState;
  if (
    !lobbyState ||
    lobbyState.phase !== "lobby" ||
    lobbyState.players.length !== 2
  ) {
    addIssue({
      actor: "Engine",
      action: "Confirm MatchReady (lobby)",
      expected: "phase=lobby with 2 players",
      actual: `phase=${lobbyState?.phase}, players=${lobbyState?.players?.length}`,
      severity: "Critical",
      raw: "MatchReady = False",
    });
    printReport(null);
    cleanup();
    process.exit(1);
  }
  console.log("[QA] MatchReady = True (both players in lobby)");

  // --- Start the game ----------------------------------------------------
  try {
    const p1vBefore = p1.stateVersion;
    const p2vBefore = p2.stateVersion;
    p1.send({ type: "start_game", roomId: ROOM_ID });
    const st = await p1.waitForState(p1vBefore, 5000);
    // Let Player 2 receive the start broadcast so both views converge.
    await p2.waitForState(p2vBefore, 5000).catch(() => {});
    if (st.phase !== "playing") {
      addIssue({
        actor: "Engine",
        action: "start_game",
        expected: "phase=playing",
        actual: `phase=${st.phase}`,
        severity: "Critical",
        raw: JSON.stringify(st.log?.slice(-3)),
      });
      printReport(st);
      cleanup();
      process.exit(1);
    }
  } catch (e) {
    addIssue({
      actor: "Engine",
      action: "start_game",
      expected: "phase=playing",
      actual: String(e),
      severity: "Critical",
      raw: String(e),
    });
    printReport(p1.latestState);
    cleanup();
    process.exit(1);
  }
  console.log("[QA] Game started (phase=playing). Running match loop...");

  // --- Step 2/3: match loop ---------------------------------------------
  let turnCount = 0;
  const startTime = Date.now();
  let hardFail = false;

  // Real player IDs assigned by the server (UUIDs), captured on join.
  const p1Id = p1.joinedInfo?.playerId;
  const p2Id = p2.joinedInfo?.playerId;

  while (true) {
    const st = p1.latestState;
    if (!st || st.phase !== "playing") break;
    if (turnCount >= MAX_TURNS) {
      addIssue({
        actor: "Engine",
        action: "Match loop",
        expected: `Match reaches a terminal state before ${MAX_TURNS} turns`,
        actual: `Reached MAX_TURNS=${MAX_TURNS} with no terminal state`,
        severity: "Medium",
        raw: "Match Stalled / Timeout Error",
      });
      break;
    }
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      addIssue({
        actor: "Engine",
        action: "Match loop",
        expected: `Match completes within ${TIME_LIMIT_MS}ms`,
        actual: `Exceeded wall-clock time limit`,
        severity: "Medium",
        raw: "Match Stalled / Timeout Error",
      });
      break;
    }

    currentTurn = turnCount;
    const curId = st.turnOrder[st.currentPlayerIndex];
    const actor = curId === p1Id ? p1 : p2;
    let actionsThisTurn = 0;

    while (actionsThisTurn < MAX_ACTIONS_PER_TURN) {
      const s = actor.latestState;
      if (!s || s.phase !== "playing") break;
      const cur = s.turnOrder[s.currentPlayerIndex];
      if (cur !== curId) break; // turn advanced
      const pendingForCur =
        s.pendingDiscard && s.pendingDiscard.playerId === cur;
      // A pending discard must be driven even though actions are spent.
      if (s.actionsRemaining <= 0 && !pendingForCur) break; // safety
      const player = s.players.find((p: any) => p.id === cur);
      const action = chooseAction(s, player);
      const actionDesc = describeAction(action);

      const p1vBefore = p1.stateVersion;
      const p2vBefore = p2.stateVersion;
      const since = actor.events.length;
      actor.send({
        type: "player_action",
        roomId: ROOM_ID,
        playerId: cur,
        action,
      });

      let ev: Ev;
      try {
        ev = await actor.waitForEvent(since, 5000);
      } catch (e) {
        addIssue({
          actor: curId,
          action: actionDesc,
          expected: "Server responds with a state update",
          actual: "No response within timeout (possible hang/crash)",
          severity: "Critical",
          raw: String(e),
        });
        hardFail = true;
        break;
      }

      if (ev.kind === "error") {
        // Server rejected an action we believe is legal -> retry once.
        const since2 = actor.events.length;
        actor.send({
          type: "player_action",
          roomId: ROOM_ID,
          playerId: cur,
          action,
        });
        let ev2: Ev;
        try {
          ev2 = await actor.waitForEvent(since2, 5000);
        } catch (e) {
          addIssue({
            actor: curId,
            action: actionDesc,
            expected: "Server responds on retry",
            actual: "No response within timeout on retry",
            severity: "Critical",
            raw: String(e),
          });
          hardFail = true;
          break;
        }
        if (ev2.kind === "error") {
          addIssue({
            actor: curId,
            action: actionDesc,
            expected: "Action accepted (legal per rules)",
            actual: `Rejected twice: "${ev.message}" / "${ev2.message}"`,
            severity: "Critical",
            raw: JSON.stringify(summarize(actor.latestState)),
          });
          hardFail = true;
          break;
        }
        addIssue({
          actor: curId,
          action: actionDesc,
          expected: "Action accepted on first attempt",
          actual: `First attempt rejected ("${ev.message}"); retry succeeded`,
          severity: "Medium",
          raw: JSON.stringify(summarize(actor.latestState)),
        });
      }

      // Settle BOTH clients so both views converge before comparing.
      if (p1.stateVersion <= p1vBefore)
        await p1.waitForState(p1vBefore, 2000).catch(() => {});
      if (p2.stateVersion <= p2vBefore)
        await p2.waitForState(p2vBefore, 2000).catch(() => {});
      checkDesync(p1, p2);
      runInvariantChecks(actor.latestState);

      actionsThisTurn++;
    }

    if (actionsThisTurn >= MAX_ACTIONS_PER_TURN) {
      addIssue({
        actor: curId,
        action: "Turn did not terminate",
        expected: "Turn completes within 4 actions + discards",
        actual: `Hit MAX_ACTIONS_PER_TURN=${MAX_ACTIONS_PER_TURN}`,
        severity: "Critical",
        raw: "Possible infinite loop / stuck turn",
      });
      hardFail = true;
      break;
    }

    turnCount++;
    if (hardFail) break;
  }

  // --- Final verification ------------------------------------------------
  const finalState = p1.latestState;
  checkDesync(p1, p2);
  runInvariantChecks(finalState);

  console.log(
    `[QA] Match ended. phase=${finalState?.phase}, turnsPlayed=${finalState?.turnsPlayed}, turnsDriven=${turnCount}`,
  );

  // --- Step 4: report & shutdown ----------------------------------------
  printReport(finalState);
  cleanup();
  process.exit(0);
}

main().catch((e) => {
  console.error("[QA] Harness crashed:", e);
  process.exit(1);
});
