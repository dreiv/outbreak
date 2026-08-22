import { CITY_MAP } from '../../shared/src/boardData';
import type { GameState, PlayerAction, PlayerCard, RegionId } from '../../shared/src/types';
import { REGION_META, ROLES } from '../../shared/src/types';

export type Dispatch = (action: PlayerAction) => void;

function roleLabel(roleId: string | null): string {
  return ROLES.find((r) => r.id === roleId)?.name ?? 'Unassigned';
}
function roleDesc(roleId: string | null): string {
  return ROLES.find((r) => r.id === roleId)?.description ?? '';
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export function renderSidebar(el: HTMLElement, state: GameState, myId: string, dispatch: Dispatch) {
  const me = state.players.find((p) => p.id === myId);
  const currentId = state.turnOrder[state.currentPlayerIndex];
  const current = state.players.find((p) => p.id === currentId);
  const isMyTurn = currentId === myId;

  const pips = Array.from({ length: 4 }, (_, i) =>
    `<div class="action-pip ${i < state.actionsRemaining ? 'filled' : ''}"></div>`).join('');

  const diseaseGrid = (Object.keys(REGION_META) as RegionId[]).map((r) => {
    const meta = REGION_META[r];
    const st = state.diseaseState[r];
    return `
      <div class="disease-chip ${st}">
        <span class="swatch" style="background:${meta.color}"></span>
        <span>${meta.label}</span>
        <span class="state">${st}</span>
        <span class="stat-row" style="padding:0"><b>${state.cubesRemaining[r]}</b>&nbsp;cubes left</span>
      </div>`;
  }).join('');

  const handHtml = (me?.hand ?? []).map((c) => {
    if (c.type === 'epidemic') {
      return `<div class="hand-card epidemic"><span>⚠️ Epidemic</span></div>`;
    }
    return `<div class="hand-card"><span>${CITY_MAP[c.city].name}</span></div>`;
  }).join('') || '<div class="empty-hint">No cards.</div>';

  const playersHtml = state.players.map((p) => {
    const isTurn = p.id === currentId;
    return `
      <div class="player-chip ${isTurn ? 'active' : ''}">
        <span>${p.name}${p.id === myId ? ' (you)' : ''} — ${CITY_MAP[p.location].name}</span>
        ${p.connected ? '' : '<span class="offline-tag">offline</span>'}
      </div>`;
  }).join('');

  const logHtml = state.log.slice(-40).map((l) => `<div>${l.text}</div>`).join('');

  el.innerHTML = `
    <div>
      <h2>Status</h2>
      <div class="turn-banner">
        <div class="who">${current ? current.name : '—'}${isMyTurn ? ' (your turn)' : ''}</div>
        <div class="role">${current ? roleLabel(current.role) : ''}</div>
        <div class="actions-left">${pips}</div>
        <button class="end-turn-btn" id="end-turn-btn" ${isMyTurn && state.phase === 'playing' ? '' : 'disabled'}>End Turn</button>
      </div>
    </div>

    <div>
      <h2>Your Role</h2>
      <div class="turn-banner">
        <div class="who">${roleLabel(me?.role ?? null)}</div>
        <div class="role" style="color: var(--text-dim)">${roleDesc(me?.role ?? null)}</div>
      </div>
    </div>

    <div>
      <h2>Strains</h2>
      <div class="disease-grid">${diseaseGrid}</div>
    </div>

    <div>
      <h2>Board</h2>
      <div class="stat-row"><span>Outbreaks</span><b>${state.outbreakCounter} / ${state.outbreakMax}</b></div>
      <div class="stat-row"><span>Infection rate</span><b>${state.infectionRate}</b></div>
      <div class="stat-row"><span>Research stations</span><b>${state.researchStations.length}</b></div>
      <div class="stat-row"><span>Player deck</span><b>${state.playerDeckSize} left</b></div>
      <div class="stat-row"><span>Infection deck</span><b>${state.infectionDeckSize} left</b></div>
      <div class="stat-row"><span>Epidemics resolved</span><b>${state.epidemicsResolved}</b></div>
    </div>

    <div>
      <h2>Your Hand</h2>
      <div class="hand-list">${handHtml}</div>
    </div>

    <div>
      <h2>Team</h2>
      <div class="players-list">${playersHtml}</div>
    </div>

    <div>
      <h2>Log</h2>
      <div class="log-list">${logHtml}</div>
    </div>
  `;

  el.querySelector('#end-turn-btn')?.addEventListener('click', () => dispatch({ type: 'end-turn' }));
}

// ---------------------------------------------------------------------------
// City popup — contextual actions
// ---------------------------------------------------------------------------

export function renderCityPopup(
  el: HTMLElement,
  state: GameState,
  myId: string,
  cityId: string,
  pos: { x: number; y: number },
  dispatch: Dispatch,
  onClose: () => void,
  onNeedCureCards: (region: RegionId) => void,
) {
  const me = state.players.find((p) => p.id === myId)!;
  const city = CITY_MAP[cityId];
  const isMyTurn = state.turnOrder[state.currentPlayerIndex] === myId && state.phase === 'playing';
  const hereIsCurrent = cityId === me.location;

  const cubes = Object.entries(state.cityCubes[cityId] ?? {}) as [RegionId, number][];
  const cubeRow = cubes.filter(([, n]) => n > 0).map(([r, n]) =>
    `<span class="cube-chip" style="background:${REGION_META[r].color}">${REGION_META[r].label} × ${n}</span>`,
  ).join('') || '<span class="empty-hint">No cubes here.</span>';

  const actions: string[] = [];
  const addBtn = (label: string, id: string) => actions.push(`<button class="action-btn" data-act="${id}">${label}</button>`);

  if (isMyTurn) {
    if (hereIsCurrent) {
      for (const [region] of cubes.filter(([, n]) => n > 0)) {
        addBtn(`Treat ${REGION_META[region].label}`, `treat:${region}`);
      }
      if (!state.researchStations.includes(cityId)) {
        addBtn('Build Research Station', 'build-station');
      }
      if (state.researchStations.includes(cityId)) {
        for (const region of Object.keys(REGION_META) as RegionId[]) {
          if (state.diseaseState[region] === 'active') {
            const needed = me.role === 'virologist' ? 4 : 5;
            const have = me.hand.filter((c) => c.type === 'city' && CITY_MAP[c.city].region === region).length;
            addBtn(`Discover Cure — ${REGION_META[region].label} (${have}/${needed})`, `cure:${region}`);
          }
        }
      }
      const othersHere = state.players.filter((p) => p.id !== myId && p.location === cityId);
      for (const other of othersHere) {
        const flexible = me.role === 'liaison-officer' || other.role === 'liaison-officer';
        const cardHereMine = me.hand.find((c) => c.type === 'city' && c.city === cityId);
        const cardHereTheirs = other.hand.find((c) => c.type === 'city' && c.city === cityId);
        if (cardHereMine || flexible) addBtn(`Give card to ${other.name}`, `share-give:${other.id}`);
        if (cardHereTheirs || flexible) addBtn(`Take card from ${other.name}`, `share-take:${other.id}`);
      }
    } else {
      if (CITY_MAP[me.location].connections.includes(cityId)) {
        addBtn(`Drive/Ferry to ${city.name}`, `drive`);
      }
      const hasTargetCard = me.hand.some((c) => c.type === 'city' && c.city === cityId);
      if (hasTargetCard) addBtn(`Direct Flight to ${city.name}`, `direct-flight`);
      const hasCurrentCard = me.hand.some((c) => c.type === 'city' && c.city === me.location);
      if (hasCurrentCard) addBtn(`Charter Flight to ${city.name}`, `charter-flight`);
      if (state.researchStations.includes(cityId) && state.researchStations.includes(me.location)) {
        addBtn(`Shuttle Flight to ${city.name}`, `shuttle-flight`);
      }
    }
  }

  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.innerHTML = `
    <button class="close-btn" id="popup-close">✕</button>
    <h3>${city.name} <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(${REGION_META[city.region].label.replace(' Strain', '')})</span></h3>
    <div class="cube-row">${cubeRow}</div>
    ${actions.length ? actions.join('') : '<div class="empty-hint">No actions available here right now.</div>'}
  `;
  el.querySelector('#popup-close')?.addEventListener('click', onClose);
  el.querySelectorAll<HTMLButtonElement>('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act!;
      if (act === 'drive') dispatch({ type: 'drive', to: cityId });
      else if (act === 'direct-flight') dispatch({ type: 'direct-flight', to: cityId });
      else if (act === 'charter-flight') dispatch({ type: 'charter-flight', to: cityId });
      else if (act === 'shuttle-flight') dispatch({ type: 'shuttle-flight', to: cityId });
      else if (act === 'build-station') dispatch({ type: 'build-station' });
      else if (act.startsWith('treat:')) dispatch({ type: 'treat', region: act.split(':')[1] as RegionId });
      else if (act.startsWith('cure:')) { onNeedCureCards(act.split(':')[1] as RegionId); return; }
      else if (act.startsWith('share-give:')) {
        dispatch({ type: 'share-knowledge', withPlayerId: act.split(':')[1], cityCard: cityId, direction: 'give' });
      } else if (act.startsWith('share-take:')) {
        dispatch({ type: 'share-knowledge', withPlayerId: act.split(':')[1], cityCard: cityId, direction: 'take' });
      }
      onClose();
    });
  });
}

// ---------------------------------------------------------------------------
// Cure card-selection modal
// ---------------------------------------------------------------------------

export function renderCureModal(
  el: HTMLElement,
  state: GameState,
  myId: string,
  region: RegionId,
  dispatch: Dispatch,
  onClose: () => void,
) {
  const me = state.players.find((p) => p.id === myId)!;
  const needed = me.role === 'virologist' ? 4 : 5;
  const matching = me.hand.filter((c) => c.type === 'city' && CITY_MAP[c.city].region === region) as (PlayerCard & { type: 'city' })[];

  const items = matching.map((c) => `
    <label><input type="checkbox" value="${c.uid}" /> ${CITY_MAP[c.city].name}</label>
  `).join('') || '<div class="empty-hint">No matching cards.</div>';

  el.innerHTML = `
    <div class="discard-modal">
      <h3>Discover Cure — ${REGION_META[region].label}</h3>
      <p style="color:var(--text-dim); font-size:13px;">Select exactly ${needed} matching city cards.</p>
      <div class="cure-select-list">${items}</div>
      <button class="btn-primary" id="cure-submit">Discover Cure</button>
      <button class="btn-secondary" id="cure-cancel" style="margin-top:8px; width:100%;">Cancel</button>
    </div>
  `;
  el.style.display = 'flex';
  el.querySelector('#cure-cancel')?.addEventListener('click', onClose);
  el.querySelector('#cure-submit')?.addEventListener('click', () => {
    const checked = Array.from(el.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')).map((i) => i.value);
    if (checked.length !== needed) {
      alert(`Select exactly ${needed} cards.`);
      return;
    }
    dispatch({ type: 'discover-cure', region, cardUids: checked });
    onClose();
  });
}

// ---------------------------------------------------------------------------
// Discard modal (forced, hand over limit)
// ---------------------------------------------------------------------------

export function renderDiscardModal(el: HTMLElement, state: GameState, myId: string, dispatch: Dispatch) {
  const me = state.players.find((p) => p.id === myId);
  if (!state.pendingDiscard || state.pendingDiscard.playerId !== myId || !me) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const over = me.hand.length - state.pendingDiscard.mustDiscardTo;
  const items = me.hand.map((c) => {
    const label = c.type === 'epidemic' ? '⚠️ Epidemic' : CITY_MAP[c.city].name;
    return `<div class="hand-card"><span>${label}</span><button data-uid="${c.uid}">Discard</button></div>`;
  }).join('');

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="discard-modal">
      <h3>Hand limit exceeded</h3>
      <p style="color:var(--text-dim); font-size:13px;">Discard ${over} more card${over === 1 ? '' : 's'} to continue.</p>
      <div class="hand-list">${items}</div>
    </div>
  `;
  el.querySelectorAll<HTMLButtonElement>('button[data-uid]').forEach((btn) => {
    btn.addEventListener('click', () => dispatch({ type: 'discard', cardUid: btn.dataset.uid! }));
  });
}

// ---------------------------------------------------------------------------
// Game-over overlay
// ---------------------------------------------------------------------------

export function renderGameOver(el: HTMLElement, state: GameState) {
  if (state.phase !== 'won' && state.phase !== 'lost') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const won = state.phase === 'won';
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="gameover-card ${won ? 'won' : 'lost'}">
      <h1>${won ? 'Outbreak Contained' : 'Containment Failed'}</h1>
      <p style="color:var(--text-dim)">${won ? 'All four strains have been cured. The world is safe — for now.' : (state.lossReason ?? 'The outbreak could not be stopped.')}</p>
      <button class="btn-primary" onclick="location.reload()">Return to Lobby</button>
    </div>
  `;
}
