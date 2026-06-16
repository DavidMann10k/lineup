"use strict";

const lineupCore = window.LineupCore;
if (!lineupCore) throw new Error("LineupCore failed to load.");

const STORAGE_KEY = lineupCore.STORAGE_KEY;
const app = document.getElementById("app");

let state = loadState();
let pendingFocusSelector = null;
let detailPlayerId = null;
let activeChipDrag = null;
let activePageSwipe = null;
let pendingViewTransition = null;
let suppressNextChipClick = false;
const INCOMING_BUBBLE_OFFSET = 32;

function createState() {
  return lineupCore.createState();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return lineupCore.normalizeSavedState(saved);
  } catch {
    return createState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getPlayer(id) {
  return lineupCore.getPlayer(state, id);
}

function getSlots() {
  return lineupCore.getSlots(state);
}

function ensureAssignmentKeys() {
  return lineupCore.ensureAssignmentKeys(state);
}

function accrueTime() {
  lineupCore.accrueTime(state);
}

function resumeRunningClock() {
  if (!state.clock.running) return;

  ensureAssignmentKeys();
  if (!state.clock.lastTickAt) state.clock.lastTickAt = Date.now();
  accrueTime();
  saveState();
}

function persistRunningClock() {
  if (!state.clock.running) return;
  accrueTime();
  saveState();
}

function toggleClock() {
  const result = lineupCore.toggleClock(state);
  if (!result.ok) return;
  saveState();
  render();
}

function nextPeriod() {
  const result = lineupCore.nextPeriod(state);
  if (!result.ok) return;
  saveState();
  render();
}

function resetClock() {
  if (lineupCore.isClockAtZero(state)) return;
  if (!window.confirm("Reset the game clock? Player playtime totals will stay intact.")) return;
  lineupCore.resetClock(state);
  saveState();
  render();
}

function resetForNewGame() {
  if (
    !window.confirm(
      "Reset for a new game? This clears the match log, playtime, position history, clock, and moves every player to the bench. Your roster and active choices stay intact.",
    )
  ) {
    return;
  }

  lineupCore.resetForNewGame(state);
  saveState();
  render();
}

function applyFormation(value) {
  const result = lineupCore.applyFormation(state, value);
  if (result.ok) saveState();
  render();
}

function addPlayer(name, number) {
  const result = lineupCore.addPlayer(state, name, number);
  if (!result.ok) return;
  saveState();
  render();
}

function setPlayerActive(playerId, active) {
  const result = lineupCore.setPlayerActive(state, playerId, active);
  if (!result.ok) return;
  saveState();
  render();
}

function removePlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;
  if (!window.confirm(`Remove ${player.name} from this lineup?`)) return;

  lineupCore.removePlayer(state, playerId);
  if (detailPlayerId === playerId) detailPlayerId = null;
  saveState();
  render();
}

function stagePlayerInSlot(playerId, slotId) {
  const result = lineupCore.stagePlayerInSlot(state, playerId, slotId);
  if (!result.ok) return;
  saveState();
  render();
}

function stageFieldPlayerInSlot(playerId, sourceSlotId, targetSlotId) {
  const result = lineupCore.stageFieldPlayerInSlot(state, playerId, sourceSlotId, targetSlotId);
  if (!result.ok) return;
  saveState();
  render();
}

function setSlotStage(slotId, playerId) {
  const result = lineupCore.setSlotStage(state, slotId, playerId);
  if (!result.ok) return;
  saveState();
  render();
}

function stageSlotToBench(slotId, draggedPlayerId = null) {
  const result = lineupCore.stageSlotToBench(state, slotId, draggedPlayerId);
  if (!result.ok) return;
  saveState();
  render();
}

function keepSlot(slotId) {
  lineupCore.keepSlot(state, slotId);
  saveState();
  render();
}

function keepSwap(slotId, pairSlotId) {
  lineupCore.keepSwap(state, slotId, pairSlotId);
  saveState();
  render();
}

function setRosterSort(sortKey) {
  lineupCore.setRosterSort(state, sortKey);
  saveState();
  render();
}

function commitSnapshot({ persist = true } = {}) {
  const result = lineupCore.commitSnapshot(state);
  if (!result.ok) return;
  if (persist) {
    saveState();
    render();
  }
}

function isPlayerPlaytimeIncreasing(player) {
  return lineupCore.isPlayerPlaytimeIncreasing(state, player);
}

function getBenchPlayers() {
  return lineupCore.getBenchPlayers(state);
}

function getInactivePlayers() {
  return lineupCore.getInactivePlayers(state);
}

function getRosterPlayers() {
  return lineupCore.getRosterPlayers(state);
}

function isStagedFormationFilled() {
  return lineupCore.isStagedFormationFilled(state);
}

function hasCompleteLiveLineup() {
  return lineupCore.hasCompleteLiveLineup(state);
}

function getPendingSubs() {
  return lineupCore.getPendingSubs(state);
}

function formatDuration(seconds) {
  return lineupCore.formatDuration(seconds);
}

function positionType(code) {
  return lineupCore.positionType(code);
}

function positionClass(code) {
  return `pos-${positionType(code)}`;
}

function renderPositionCode(code) {
  return `<span class="position-code ${positionClass(code)}">${escapeHtml(code)}</span>`;
}

function renderTimeCode(seconds) {
  return `<span class="time-code">${escapeHtml(formatDuration(seconds))}</span>`;
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function rosterBadgeText(player) {
  const number = String(player.number || "").trim();
  return number || initials(player.name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function render() {
  if (ensureAssignmentKeys()) saveState();
  const viewTransitionClass = pendingViewTransition ? `view-transition view-swipe-${pendingViewTransition}` : "";
  pendingViewTransition = null;

  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader()}
      <main class="content ${viewTransitionClass}">
        ${state.view === "roster" ? renderRoster() : renderFormation()}
      </main>
      ${renderFooter()}
      ${renderPlayerModal()}
    </div>
  `;
  wireDragAndDrop();
  wirePageSwipe();
  updateDynamicDom();
  updateSubstitutionLayer();
  restorePendingFocus();
}

function renderFooter() {
  return `
    <footer class="app-footer">
      <div class="footer-sales">
        <p>Like this custom mini-application? Want one customized and branded for your organization? It's easier than you think.</p>
        <button
          type="button"
          class="footer-cta"
          data-action="contact-owner"
        >I want one</button>
      </div>
      <div class="footer-credit">
        <span>Created by David Mann</span>
        <a href="https://github.com/DavidMann10k" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://mann.engineer" target="_blank" rel="noopener noreferrer">mann.engineer</a>
      </div>
    </footer>
  `;
}

function buildContactHref() {
  const user = ["da", "vid"].join("");
  const host = ["mann", "engineer"].join(".");
  const subject = encodeURIComponent("Custom mini-application inquiry");
  const body = encodeURIComponent(
    "Hi David,\n\nI'd like to talk about a custom mini-application for my organization.\n",
  );
  return `mailto:${user}@${host}?subject=${subject}&body=${body}`;
}

function restorePendingFocus() {
  if (!pendingFocusSelector) return;
  const selector = pendingFocusSelector;
  pendingFocusSelector = null;

  window.requestAnimationFrame(() => {
    const target = document.querySelector(selector);
    if (target instanceof HTMLElement) target.focus();
  });
}

function renderIcon(name) {
  const icons = {
    play: '<path d="M7 4v16l13-8L7 4z" fill="currentColor"></path>',
    pause:
      '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"></rect><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"></rect>',
    next:
      '<path d="M5 5v14l10-7L5 5z" fill="currentColor"></path><path d="M18 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>',
    refresh:
      '<path d="M18.8 8.2A7.2 7.2 0 1 0 19 15" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"></path><path d="M19 4.8v4.1h-4.1" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"></path>',
    swapVertical:
      '<path d="M8 4v14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="M4.5 14.5 8 18l3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M16 20V6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="M12.5 9.5 16 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>',
    chair:
      '<path d="M8 10h8a2 2 0 0 1 2 2v3H6v-3a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"></path><path d="M8 10V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"></path><path d="M7 15v5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"></path><path d="M17 15v5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"></path>',
    cancel:
      '<path d="m7 7 10 10" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"></path><path d="m17 7-10 10" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"></path>',
    check:
      '<path d="m5 12.5 4.2 4.2L19 6.8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>',
  };

  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || ""}</svg>`;
}

function renderHeader() {
  return `
    <header class="app-header">
      <img class="brand-mark" src="./assets/icon.svg" alt="">
      <nav class="view-tabs" aria-label="Screens">
        <button class="tab-button ${state.view === "roster" ? "active" : ""}" data-action="set-view" data-view="roster">Roster</button>
        <button class="tab-button ${state.view === "formation" ? "active" : ""}" data-action="set-view" data-view="formation">Formation</button>
      </nav>
    </header>
  `;
}

function renderRoster() {
  return `
    <section class="roster-screen">
      <div class="roster-toolbar">
        <form class="player-form" data-form="add-player">
          <div class="field-group grow">
            <label for="player-name">Player name</label>
            <input id="player-name" name="name" autocomplete="off" placeholder="Add player">
          </div>
          <div class="field-group">
            <label for="player-number">Number</label>
            <input id="player-number" name="number" autocomplete="off" inputmode="numeric" placeholder="Optional">
          </div>
          <button class="button green" type="submit">Add</button>
        </form>
      </div>

      <div class="roster-table-wrap">
        ${state.players.length ? renderRosterTable() : `<div class="empty-state empty-padded">No players yet.</div>`}
      </div>
    </section>
  `;
}

function renderRosterTable() {
  return `
    <table>
      <thead>
        <tr>
          ${renderRosterSortHeader("Player", "name")}
          ${renderRosterSortHeader("Active", "active")}
          ${renderRosterSortHeader("Playtime", "playtime")}
          <th>Usage</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody data-roster-body>
        ${getRosterPlayers().map(renderRosterRow).join("")}
      </tbody>
    </table>
  `;
}

function renderRosterSortHeader(label, sortKey) {
  const isActive = state.rosterSort === sortKey;
  const nextDirection = isActive && state.rosterSortDirection === "asc" ? "descending" : "ascending";
  const sortLabel = isActive ? (state.rosterSortDirection === "asc" ? "ascending" : "descending") : "none";
  const indicator = isActive ? (state.rosterSortDirection === "asc" ? "&uarr;" : "&darr;") : "";

  return `
    <th aria-sort="${sortLabel}">
      <a
        class="sort-header ${isActive ? "active" : ""}"
        href="#sort-${sortKey}"
        data-action="set-roster-sort"
        data-roster-sort="${sortKey}"
        aria-label="Sort ${escapeHtml(label)} ${nextDirection}"
      >
        <span>${escapeHtml(label)}</span>
        <span class="sort-indicator" aria-hidden="true">${indicator}</span>
      </a>
    </th>
  `;
}

function renderRosterRow(player) {
  const playtimeIncreasing = isPlayerPlaytimeIncreasing(player);
  return `
    <tr data-player-row="${player.id}">
      <td>
        <div class="player-name-cell">
          <span class="mini-bubble roster-badge">${escapeHtml(rosterBadgeText(player))}</span>
          <div>
            <a class="player-name-link" href="#player-${player.id}" data-action="open-player-details" data-player-id="${player.id}">${escapeHtml(player.name)}</a>
          </div>
        </div>
      </td>
      <td>
        <label class="switch">
          <input type="checkbox" ${player.active ? "checked" : ""} data-action="toggle-active" data-player-id="${player.id}" aria-label="Toggle ${escapeHtml(player.name)} active">
          <span aria-hidden="true"></span>
        </label>
      </td>
      <td
        class="playtime-cell ${playtimeIncreasing ? "increasing" : "idle"}"
        data-player-total="${player.id}"
        data-playtime-indicator="true"
        aria-label="${escapeHtml(player.name)} playtime ${playtimeIncreasing ? "increasing" : "not increasing"}"
      >${renderTimeCode(player.totalSeconds)}</td>
      <td>
        <div class="usage-list" data-player-usage="${player.id}">${renderUsageReadout(player)}</div>
      </td>
      <td>
        <div class="row-actions">
          <button class="button small ghost" data-action="remove-player" data-player-id="${player.id}">Remove</button>
        </div>
      </td>
    </tr>
  `;
}

function getPlayerCurrentCode(player) {
  const slots = getSlots();
  const liveSlot = slots.find((slot) => state.liveAssignments[slot.id] === player.id);
  if (liveSlot) return liveSlot.label;

  if (!player.active) return "IN";

  return "BE";
}

function getUsageEntries(player) {
  const entries = Object.entries(player.positionSeconds || {})
    .filter(([, seconds]) => seconds > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([code, seconds]) => ({ code, seconds }));

  if (Number(player.benchSeconds || 0) > 0.5) {
    entries.push({ code: "BE", seconds: Number(player.benchSeconds || 0) });
  }

  const currentCode = getPlayerCurrentCode(player);
  if (!entries.some((entry) => entry.code === currentCode)) {
    entries.push({
      code: currentCode,
      seconds: currentCode === "BE" ? Number(player.benchSeconds || 0) : 0,
    });
  }

  return entries;
}

function renderUsageReadout(player) {
  return getUsageEntries(player)
    .map(
      (entry) => `
        <span class="usage-row">
          ${renderPositionCode(entry.code)}
          ${renderTimeCode(entry.seconds)}
        </span>
      `,
    )
    .join("");
}

function renderPlayerModal() {
  const player = getPlayer(detailPlayerId);
  if (!player) return "";

  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="player-modal" role="dialog" aria-modal="true" aria-labelledby="player-modal-title">
        <div class="modal-head">
          <div class="player-modal-title">
            <span class="mini-bubble">${escapeHtml(initials(player.name))}</span>
            <div>
              <h2 id="player-modal-title">${escapeHtml(player.name)}</h2>
              ${player.number ? `<span>#${escapeHtml(player.number)}</span>` : ""}
            </div>
          </div>
          <button class="modal-close" data-action="close-player-details" aria-label="Close player details">
            ${renderIcon("cancel")}
          </button>
        </div>

        <div class="player-modal-grid">
          <div class="modal-stat">
            <span>Playtime</span>
            <strong data-player-total="${player.id}">${renderTimeCode(player.totalSeconds)}</strong>
          </div>
          <div class="modal-stat">
            <span>Status</span>
            <strong>${renderPositionCode(getPlayerCurrentCode(player))}</strong>
          </div>
        </div>

        <div class="modal-section">
          <h3>Usage</h3>
          <div class="usage-list modal-usage" data-player-usage="${player.id}">
            ${renderUsageReadout(player)}
          </div>
        </div>

        <div class="modal-actions">
          <label class="modal-toggle">
            <span>Active</span>
            <span class="switch">
              <input type="checkbox" ${player.active ? "checked" : ""} data-action="toggle-active" data-player-id="${player.id}" aria-label="Toggle ${escapeHtml(player.name)} active">
              <span aria-hidden="true"></span>
            </span>
          </label>
          <button class="button ghost" data-action="remove-player" data-player-id="${player.id}">Remove</button>
        </div>
      </section>
    </div>
  `;
}

function renderFormation() {
  const startingLineupSet = hasCompleteLiveLineup();

  return `
    <section class="formation-screen">
      <div class="formation-grid">
        <div>
          <section class="field-zone">
            ${renderPitch()}
          </section>
          ${startingLineupSet ? "" : renderStartingLineupPrompt()}
          ${renderBench()}
          ${renderSubsPanel()}
          ${renderFormationEditor()}
        </div>

        <aside>
          ${renderEventLog()}
        </aside>
      </div>
    </section>
  `;
}

function renderStartingLineupPrompt() {
  const stagedFilled = isStagedFormationFilled();
  return `
    <div class="lineup-start-message" role="status">
      <strong>Set the starting lineup</strong>
      <span>${stagedFilled ? "Use Set Lineup before starting the clock." : "Fill every position, then use Set Lineup before starting the clock."}</span>
    </div>
  `;
}

function renderSubsPanel() {
  const subs = getPendingSubs();
  if (!subs.length) return "";

  return `
    <section class="subs-panel" aria-label="Pending substitutions">
      <div class="subs-head">
        <h2>Subs</h2>
        <span class="selected-pill">${subs.length} pending</span>
      </div>
      <div class="subs-list">
        ${subs.map(renderSubRow).join("")}
      </div>
    </section>
  `;
}

function renderSubRow(sub) {
  const isSwap = Boolean(sub.pairedSlot);
  return `
    <div class="sub-row">
      <div class="sub-flow in">
        <strong class="sub-name ${sub.incoming ? "" : "empty"}">${sub.incoming ? escapeHtml(sub.incoming.name) : "Open"}</strong>
        <span class="sub-arrow" aria-hidden="true">&rarr;</span>
        <span class="sub-position ${positionClass(sub.slot.label)}" aria-hidden="true">${escapeHtml(sub.slot.label)}</span>
      </div>
      <button
        class="sub-cancel"
        type="button"
        data-action="${isSwap ? "keep-swap" : "keep-slot"}"
        data-slot-id="${escapeHtml(sub.slot.id)}"
        ${isSwap ? `data-pair-slot-id="${escapeHtml(sub.pairedSlot.id)}"` : ""}
        aria-label="Cancel substitution for ${escapeHtml(sub.slot.label)}"
      >
        ${renderIcon("cancel")}
      </button>
      <div class="sub-flow out">
        <strong class="sub-name">${escapeHtml(sub.outgoing.name)}</strong>
        <span class="sub-arrow" aria-hidden="true">&rarr;</span>
        ${
          sub.outgoingDestination
            ? `<span class="sub-position ${positionClass(sub.outgoingDestination.label)}" aria-hidden="true">${escapeHtml(sub.outgoingDestination.label)}</span>`
            : `<span class="sub-chair" aria-hidden="true">${renderIcon("chair")}</span>`
        }
      </div>
    </div>
  `;
}

function renderFormationEditor() {
  return `
    <section class="formation-editor">
      <form class="formation-form" data-form="formation">
        <div class="field-group">
          <label for="formation-input">Formation</label>
          <input id="formation-input" name="formation" value="${escapeHtml(state.formation)}" inputmode="text" autocomplete="off">
        </div>
        <button class="button secondary formation-apply" type="submit" aria-label="Apply formation">
          ${renderIcon("check")}
          <span>Apply</span>
        </button>
        ${state.formationError ? `<div class="form-error">${escapeHtml(state.formationError)}</div>` : ""}
      </form>
    </section>
  `;
}

function renderPitch() {
  const slots = getSlots();
  const movedFieldPlayerIds = getMovedFieldPlayerIds(slots);

  return `
    <div class="pitch" aria-label="Soccer field">
      ${renderFieldClock()}
      <div class="pitch-line half"></div>
      <div class="pitch-line center-circle"></div>
      <div class="pitch-line center-dot"></div>
      <div class="pitch-line penalty top"></div>
      <div class="pitch-line penalty bottom"></div>
      <div class="pitch-line goal top"></div>
      <div class="pitch-line goal bottom"></div>
      ${renderPendingMoveArrows()}
      ${slots.map((slot) => renderFieldSlot(slot, movedFieldPlayerIds)).join("")}
      ${renderStagedPlayerOverlays(slots)}
    </div>
  `;
}

function getMovedFieldPlayerIds(slots = getSlots()) {
  const livePlayerIds = new Set(slots.map((slot) => state.liveAssignments[slot.id]).filter(Boolean));
  const movedPlayerIds = new Set();

  for (const slot of slots) {
    const livePlayerId = state.liveAssignments[slot.id] || null;
    const stagedPlayerId = state.stagedAssignments[slot.id] || null;
    if (stagedPlayerId && stagedPlayerId !== livePlayerId && livePlayerIds.has(stagedPlayerId)) {
      movedPlayerIds.add(stagedPlayerId);
    }
  }

  return movedPlayerIds;
}

function renderPendingMoveArrows() {
  const arrows = getPendingMoveArrows();
  if (!arrows.length) return "";

  return `
    <svg class="pitch-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <marker id="move-arrow-head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      <g data-pitch-arrows></g>
    </svg>
  `;
}

function getPendingMoveArrows() {
  const slots = getSlots();
  const stagedSlotByPlayerId = new Map();
  const arrows = [];

  for (const slot of slots) {
    const livePlayerId = state.liveAssignments[slot.id] || null;
    const stagedPlayerId = state.stagedAssignments[slot.id] || null;
    if (stagedPlayerId && stagedPlayerId !== livePlayerId) {
      stagedSlotByPlayerId.set(stagedPlayerId, slot);
    }
  }

  for (const slot of slots) {
    const playerId = state.liveAssignments[slot.id] || null;
    if (!playerId) continue;

    const destinationSlot = stagedSlotByPlayerId.get(playerId);
    if (!destinationSlot || destinationSlot.id === slot.id) continue;

    arrows.push({
      playerId,
      fromSlotId: slot.id,
      toSlotId: destinationSlot.id,
    });
  }

  return arrows;
}

function renderPendingMoveArrow(from, to, bendSide = null) {
  const path = curveArrowPath(from, to, bendSide);

  return `
    <path
      class="pitch-move-arrow"
      d="${path}"
      marker-end="url(#move-arrow-head)"
    ></path>
  `;
}

function curveArrowPath(from, to, bendSide = null) {
  const endpoints = trimArrowEndpoints(from, to);
  const control = arrowControlPoint(endpoints, bendSide);

  return [
    "M",
    formatArrowCoord(endpoints.x1),
    formatArrowCoord(endpoints.y1),
    "Q",
    formatArrowCoord(control.x),
    formatArrowCoord(control.y),
    formatArrowCoord(endpoints.x2),
    formatArrowCoord(endpoints.y2),
  ].join(" ");
}

function trimArrowEndpoints(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };

  const trim = 18;
  const trimX = (dx / length) * trim;
  const trimY = (dy / length) * trim;

  return {
    x1: from.x + trimX,
    y1: from.y + trimY,
    x2: to.x - trimX,
    y2: to.y - trimY,
  };
}

function arrowControlPoint(endpoints, bendSide = null) {
  const midX = (endpoints.x1 + endpoints.x2) / 2;
  const midY = (endpoints.y1 + endpoints.y2) / 2;
  const dx = endpoints.x2 - endpoints.x1;
  const dy = endpoints.y2 - endpoints.y1;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: midX, y: midY };

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absY > absX * 1.15) {
    const bend = Math.min(46, Math.max(22, distance * 0.2));
    const horizontalDirection = bendSide || (dy >= 0 ? -1 : 1);
    return {
      x: midX + horizontalDirection * bend,
      y: midY,
    };
  }

  const bend = Math.min(48, Math.max(20, distance * 0.18));
  const verticalDirection = bendSide || horizontalArrowBendDirection(endpoints);

  return {
    x: midX,
    y: midY + verticalDirection * bend,
  };
}

function horizontalArrowBendDirection(endpoints) {
  const dx = endpoints.x2 - endpoints.x1;
  const dy = endpoints.y2 - endpoints.y1;
  if (Math.abs(dy) <= Math.max(4, Math.abs(dx) * 0.12)) return dx >= 0 ? -1 : 1;
  return endpoints.y1 > endpoints.y2 ? -1 : 1;
}

function formatArrowCoord(value) {
  return Number(value).toFixed(2);
}

function updateSubstitutionLayer() {
  const pitch = document.querySelector(".pitch");
  if (!pitch) return;

  positionStagedPlayerOverlays(pitch);
  updatePitchMoveArrows(pitch);
}

function positionStagedPlayerOverlays(pitch) {
  const pitchRect = pitch.getBoundingClientRect();

  pitch.querySelectorAll(".staged-player-overlay[data-slot-id]").forEach((overlay) => {
    const anchor = pitch.querySelector(dataSelector("data-slot-bubble-anchor", overlay.dataset.slotId));
    if (!anchor) return;

    const center = elementCenter(anchor, pitchRect);
    overlay.style.left = `${formatArrowCoord(center.x + INCOMING_BUBBLE_OFFSET)}px`;
    overlay.style.top = `${formatArrowCoord(center.y)}px`;
  });
}

function updatePitchMoveArrows(pitch) {
  const svg = pitch.querySelector(".pitch-arrows");
  const arrowLayer = pitch.querySelector("[data-pitch-arrows]");
  if (!svg || !arrowLayer) return;

  const pitchRect = pitch.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${formatArrowCoord(pitchRect.width)} ${formatArrowCoord(pitchRect.height)}`);

  const measuredArrows = getPendingMoveArrows()
    .map((arrow) => {
      const from = findPlayerBubble(pitch, "data-current-player-bubble", arrow.playerId);
      const to = findPlayerBubble(pitch, "data-incoming-player-bubble", arrow.playerId);
      if (!from || !to) return null;

      return {
        ...arrow,
        from: elementCenter(from, pitchRect),
        to: elementCenter(to, pitchRect),
      };
    })
    .filter(Boolean);

  arrowLayer.innerHTML = pairMoveArrowBends(measuredArrows)
    .map((arrow) => renderPendingMoveArrow(arrow.from, arrow.to, arrow.bendSide))
    .join("");
}

function pairMoveArrowBends(arrows) {
  const groups = new Map();

  for (const arrow of arrows) {
    const key = moveArrowPairKey(arrow);
    groups.set(key, [...(groups.get(key) || []), arrow]);
  }

  for (const group of groups.values()) {
    if (!isReciprocalMoveArrowPair(group)) continue;
    for (const arrow of group) {
      arrow.bendSide = pairedMoveArrowBendDirection(arrow);
    }
  }

  return arrows;
}

function moveArrowPairKey(arrow) {
  return [arrow.fromSlotId, arrow.toSlotId].sort().join(":");
}

function isReciprocalMoveArrowPair(group) {
  return (
    group.length === 2 &&
    group[0].fromSlotId === group[1].toSlotId &&
    group[0].toSlotId === group[1].fromSlotId
  );
}

function pairedMoveArrowBendDirection(arrow) {
  const dx = arrow.to.x - arrow.from.x;
  const dy = arrow.to.y - arrow.from.y;
  return Math.abs(dy) > Math.abs(dx) * 1.15 ? (dy >= 0 ? -1 : 1) : dx >= 0 ? -1 : 1;
}

function findPlayerBubble(root, attribute, playerId) {
  return root.querySelector(dataSelector(attribute, playerId));
}

function dataSelector(attribute, value) {
  const escaped = window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/"/g, '\\"');
  return `[${attribute}="${escaped}"]`;
}

function elementCenter(element, containerRect) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - containerRect.left + rect.width / 2,
    y: rect.top - containerRect.top + rect.height / 2,
  };
}

function renderStagedPlayerOverlays(slots = getSlots()) {
  const overlays = slots
    .map((slot) => {
      const livePlayerId = state.liveAssignments[slot.id] || null;
      const stagedPlayerId = state.stagedAssignments[slot.id] || null;
      const stagedPlayer = livePlayerId && stagedPlayerId !== livePlayerId ? getPlayer(stagedPlayerId) : null;
      return stagedPlayer ? renderStagedPlayerOverlay(slot, stagedPlayer) : "";
    })
    .filter(Boolean)
    .join("");

  if (!overlays) return "";

  return `<div class="substitution-bubble-layer" aria-hidden="true">${overlays}</div>`;
}

function renderStagedPlayerOverlay(slot, player) {
  return `
    <span
      class="staged-player-overlay"
      data-slot-id="${escapeHtml(slot.id)}"
    >
      <span class="bubble-sub-arrow">&larr;</span>
      <span class="player-bubble incoming" data-incoming-player-bubble="${escapeHtml(player.id)}">${escapeHtml(initials(player.name))}</span>
    </span>
  `;
}

function renderFieldClock() {
  const startingLineupSet = hasCompleteLiveLineup();
  const startDisabled = !state.clock.running && !startingLineupSet;
  const nextPeriodDisabled = !startingLineupSet;
  const playLabel = startDisabled ? "Set starting lineup before starting clock" : state.clock.running ? "Pause clock" : "Start clock";
  const clockStatus = state.clock.running ? "running" : "paused";

  return `
    <div class="field-clock">
      <div class="field-clock-group">
        <button class="clock-icon-button ${state.clock.running ? "pause" : "play"}" data-action="toggle-clock" aria-label="${playLabel}" title="${playLabel}" ${startDisabled ? "disabled" : ""}>
          ${renderIcon(state.clock.running ? "pause" : "play")}
        </button>
        <div class="clock-readout field-clock-readout ${clockStatus}" aria-label="${clockStatus === "running" ? "Clock running" : "Clock paused"}">
          <strong data-clock-time>${formatDuration(state.clock.elapsedSeconds)}</strong>
        </div>
      </div>
      <div class="field-clock-group" aria-label="Period controls">
        <div class="field-clock-period" aria-label="Period ${state.clock.period}">
          <span>Period</span>
          <strong data-clock-period>${state.clock.period}</strong>
        </div>
        <button class="clock-icon-button" data-action="next-period" aria-label="Next period" title="Next period" ${nextPeriodDisabled ? "disabled" : ""}>
          ${renderIcon("next")}
        </button>
      </div>
    </div>
  `;
}

function renderFieldSlot(slot, movedFieldPlayerIds = getMovedFieldPlayerIds()) {
  const current = getPlayer(state.liveAssignments[slot.id]);
  const staged = getPlayer(state.stagedAssignments[slot.id]);
  const isChanged = (state.liveAssignments[slot.id] || null) !== (state.stagedAssignments[slot.id] || null);
  const title = `${slot.label} ${slot.role}`;
  const dragAttributes = current
    ? `data-player-chip="${current.id}" data-drag-kind="field" data-source-slot-id="${slot.id}"`
    : "";

  return `
    <button
      class="field-slot ${positionClass(slot.label)} ${isChanged ? "changed" : ""}"
      style="left: ${slot.x}%; top: ${slot.y}%;"
      data-action="assign-slot"
      data-slot-id="${slot.id}"
      data-slot-drop="${slot.id}"
      ${dragAttributes}
      aria-label="${escapeHtml(title)}"
    >
      <span class="position-label">${renderPositionCode(slot.label)}</span>
      ${renderSlotBubble(slot, current, staged, movedFieldPlayerIds)}
      <span class="slot-name">${escapeHtml(slotName(current, staged))}</span>
    </button>
  `;
}

function renderSlotBubble(slot, current, staged, movedFieldPlayerIds = new Set()) {
  if (current && staged && current.id !== staged.id) {
    const outgoingClass = movedFieldPlayerIds.has(current.id) ? "" : " outgoing";
    return `<span class="player-bubble${outgoingClass}" data-current-player-bubble="${escapeHtml(current.id)}" data-slot-bubble-anchor="${escapeHtml(slot.id)}">${escapeHtml(initials(current.name))}</span>`;
  }

  if (current && !staged) {
    return `<span class="player-bubble outgoing" data-current-player-bubble="${escapeHtml(current.id)}" data-slot-bubble-anchor="${escapeHtml(slot.id)}">${escapeHtml(initials(current.name))}</span>`;
  }

  if (staged) return `<span class="player-bubble next" data-incoming-player-bubble="${escapeHtml(staged.id)}">${escapeHtml(initials(staged.name))}</span>`;
  if (current) return `<span class="player-bubble" data-current-player-bubble="${escapeHtml(current.id)}" data-slot-bubble-anchor="${escapeHtml(slot.id)}">${escapeHtml(initials(current.name))}</span>`;
  return `<span class="player-bubble empty">+</span>`;
}

function slotName(current, staged) {
  if (current && staged && current.id !== staged.id) return `${current.name} / ${staged.name}`;
  if (current && !staged) return `${current.name} off`;
  if (staged) return staged.name;
  if (current) return current.name;
  return "Open";
}

function renderBench() {
  const benchPlayers = getBenchPlayers();
  const inactivePlayers = getInactivePlayers();
  const canSetLineup = isStagedFormationFilled();

  return `
    <section class="bench-strip" data-bench-drop="true">
      <div class="bench-head">
        <div>
          <h2>Bench</h2>
        </div>
        <div class="bench-actions">
          <button class="button green bench-action" data-action="snapshot" ${canSetLineup ? "" : "disabled"} title="${canSetLineup ? "Set lineup" : "Fill every position before setting lineup"}">
            ${renderIcon("swapVertical")}
            <span>Set Lineup</span>
          </button>
        </div>
      </div>
      <div class="chip-list">
        ${benchPlayers.length ? benchPlayers.map((player) => renderPlayerChip(player)).join("") : `<span class="empty-state">No active bench players.</span>`}
      </div>
      ${
        inactivePlayers.length
          ? `<div class="chip-list inactive-strip">${inactivePlayers.map((player) => renderPlayerChip(player, true)).join("")}</div>`
          : ""
      }
    </section>
  `;
}

function renderPlayerChip(player, inactive = false) {
  return `
    <button
      class="player-chip ${state.selectedPlayerId === player.id ? "selected" : ""} ${inactive ? "inactive" : ""}"
      ${inactive ? "" : `data-action="select-player" data-player-id="${player.id}" data-player-chip="${player.id}"`}
      type="button"
    >
        <span class="mini-bubble">${escapeHtml(initials(player.name))}</span>
        <span class="chip-text">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${inactive ? "Inactive" : renderTimeCode(player.totalSeconds)}</span>
        </span>
      </button>
  `;
}

function renderEventLog() {
  return `
    <section class="event-log">
      <div class="event-head">
        <h2>Match log</h2>
        <button class="button small secondary event-reset" type="button" data-action="reset-new-game">
          ${renderIcon("refresh")}
          <span>New game</span>
        </button>
      </div>
      ${
        state.events.length
          ? `<ul class="event-list">${state.events.map(renderEvent).join("")}</ul>`
          : `<div class="empty-state">No snapshots yet.</div>`
      }
    </section>
  `;
}

function renderEvent(event) {
  return `
    <li class="event-item">
      <strong>${escapeHtml(event.title)}</strong>
      <span><span class="period-code">P${escapeHtml(event.period)}</span> ${renderTimeCode(event.clock)} - ${renderDecoratedText(event.detail)}</span>
    </li>
  `;
}

function renderDecoratedText(value) {
  const text = String(value ?? "");
  const pattern = /\b(GK|D\d+|M\d+|F\d+|BE|IN|CB|LB|RB|LWB|RWB|LCB|RCB|CM|LM|RM|LCM|RCM|LW|RW|CF|LF|RF|LCF|RCF)\b/g;
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    output += escapeHtml(text.slice(lastIndex, match.index));
    output += renderPositionCode(match[0]);
    lastIndex = pattern.lastIndex;
  }

  return output + escapeHtml(text.slice(lastIndex));
}

function updateDynamicDom() {
  document.querySelectorAll("[data-clock-time]").forEach((node) => {
    node.textContent = formatDuration(state.clock.elapsedSeconds);
  });
  document.querySelectorAll("[data-clock-period]").forEach((node) => {
    node.textContent = state.clock.period;
  });
  document.querySelectorAll("[data-reset-clock]").forEach((node) => {
    node.hidden = lineupCore.isClockAtZero(state);
  });
  document.querySelectorAll("[data-player-total]").forEach((node) => {
    const player = getPlayer(node.dataset.playerTotal);
    if (!player) return;
    node.innerHTML = renderTimeCode(player.totalSeconds);
    if (node.dataset.playtimeIndicator === "true") {
      const increasing = isPlayerPlaytimeIncreasing(player);
      node.classList.toggle("increasing", increasing);
      node.classList.toggle("idle", !increasing);
      node.setAttribute(
        "aria-label",
        `${player.name} playtime ${increasing ? "increasing" : "not increasing"}`,
      );
    }
  });
  document.querySelectorAll("[data-player-usage]").forEach((node) => {
    const player = getPlayer(node.dataset.playerUsage);
    if (player) node.innerHTML = renderUsageReadout(player);
  });
  updateRosterRowOrder();
}

function updateRosterRowOrder() {
  if (state.rosterSort !== "playtime") return;

  const body = document.querySelector("[data-roster-body]");
  if (!body) return;

  const rowsById = new Map(
    Array.from(body.querySelectorAll("[data-player-row]")).map((row) => [row.dataset.playerRow, row]),
  );
  const orderedIds = getRosterPlayers().map((player) => player.id);
  const currentIds = Array.from(rowsById.keys());

  if (orderedIds.length !== currentIds.length) return;
  if (orderedIds.every((id, index) => id === currentIds[index])) return;

  orderedIds.forEach((id) => {
    const row = rowsById.get(id);
    if (row) body.appendChild(row);
  });
}

function wireDragAndDrop() {
  document.querySelectorAll("[data-player-chip]").forEach((chip) => {
    chip.addEventListener("pointerdown", startChipPointerDrag);
  });
}

function wirePageSwipe() {
  const content = document.querySelector(".content");
  content?.addEventListener("pointerdown", startPageSwipe);
}

function isSwipeIgnoredTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest(
      'a, button, input, select, textarea, label, [data-player-chip], [data-slot-drop], [data-bench-drop], .player-modal, .modal-backdrop',
    ),
  );
}

function startPageSwipe(event) {
  if (event.pointerType !== "touch" || activeChipDrag || detailPlayerId || isSwipeIgnoredTarget(event.target)) return;

  const edgeGuard = 24;
  if (event.clientX <= edgeGuard || event.clientX >= window.innerWidth - edgeGuard) return;

  activePageSwipe = {
    pointerId: event.pointerId,
    source: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
  };

  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.addEventListener("pointerup", endPageSwipe);
  event.currentTarget.addEventListener("pointercancel", cancelPageSwipe);
}

function endPageSwipe(event) {
  if (!activePageSwipe || activePageSwipe.pointerId !== event.pointerId) return;

  const swipe = activePageSwipe;
  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;
  cleanupPageSwipe(event.pointerId);

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 70 || absX < absY * 1.45) return;

  const nextView = dx < 0 ? "formation" : "roster";
  if (state.view === nextView) return;

  pendingViewTransition = dx < 0 ? "left" : "right";
  state.view = nextView;
  saveState();
  render();
}

function cancelPageSwipe(event) {
  if (!activePageSwipe || activePageSwipe.pointerId !== event.pointerId) return;
  cleanupPageSwipe(event.pointerId);
}

function cleanupPageSwipe(pointerId) {
  const swipe = activePageSwipe;
  if (!swipe) return;

  swipe.source.releasePointerCapture?.(pointerId);
  swipe.source.removeEventListener("pointerup", endPageSwipe);
  swipe.source.removeEventListener("pointercancel", cancelPageSwipe);
  activePageSwipe = null;
}

function startChipPointerDrag(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const chip = event.currentTarget;
  const playerId = chip.dataset.playerChip;
  if (!playerId) return;

  activeChipDrag = {
    playerId,
    dragKind: chip.dataset.dragKind || "bench",
    sourceSlotId: chip.dataset.sourceSlotId || null,
    source: chip,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentDrop: null,
    ghost: null,
    dragging: false,
  };

  chip.setPointerCapture?.(event.pointerId);
  chip.addEventListener("pointermove", moveChipPointerDrag);
  chip.addEventListener("pointerup", endChipPointerDrag);
  chip.addEventListener("pointercancel", cancelChipPointerDrag);
}

function moveChipPointerDrag(event) {
  if (!activeChipDrag || activeChipDrag.pointerId !== event.pointerId) return;

  const dx = event.clientX - activeChipDrag.startX;
  const dy = event.clientY - activeChipDrag.startY;
  const distance = Math.hypot(dx, dy);

  if (!activeChipDrag.dragging) {
    if (distance < 8) return;
    activeChipDrag.dragging = true;
    activeChipDrag.source.classList.add("dragging");
    activeChipDrag.ghost = createDragGhost(activeChipDrag.source);
    document.body.appendChild(activeChipDrag.ghost);
  }

  event.preventDefault();
  moveDragGhost(event.clientX, event.clientY);
  updatePointerDropTarget(event.clientX, event.clientY);
}

function endChipPointerDrag(event) {
  if (!activeChipDrag || activeChipDrag.pointerId !== event.pointerId) return;

  const dropTarget = activeChipDrag.currentDrop;
  const playerId = activeChipDrag.playerId;
  const dragKind = activeChipDrag.dragKind;
  const sourceSlotId = activeChipDrag.sourceSlotId;
  const didDrag = activeChipDrag.dragging;
  cleanupChipPointerDrag(event.pointerId);

  if (didDrag && dropTarget) {
    suppressNextChipClick = true;
    window.setTimeout(() => {
      suppressNextChipClick = false;
    }, 350);
    if (dropTarget.dataset.slotDrop) {
      if (dragKind === "field" && sourceSlotId) {
        stageFieldPlayerInSlot(playerId, sourceSlotId, dropTarget.dataset.slotDrop);
      } else {
        stagePlayerInSlot(playerId, dropTarget.dataset.slotDrop);
      }
    } else if (dropTarget.dataset.benchDrop && dragKind === "field" && sourceSlotId) {
      stageSlotToBench(sourceSlotId, playerId);
    }
  }
}

function cancelChipPointerDrag(event) {
  if (!activeChipDrag || activeChipDrag.pointerId !== event.pointerId) return;
  cleanupChipPointerDrag(event.pointerId);
}

function createDragGhost(source) {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = "0px";
  ghost.style.top = "0px";
  return ghost;
}

function moveDragGhost(x, y) {
  if (!activeChipDrag?.ghost) return;
  activeChipDrag.ghost.style.transform = `translate(${Math.round(x + 10)}px, ${Math.round(y + 10)}px)`;
}

function updatePointerDropTarget(x, y) {
  const previous = activeChipDrag.currentDrop;
  activeChipDrag.ghost.hidden = true;
  const element = document.elementFromPoint(x, y);
  activeChipDrag.ghost.hidden = false;
  const next = element?.closest?.("[data-slot-drop], [data-bench-drop]") || null;

  if (previous === next) return;
  previous?.classList.remove("drag-over");
  next?.classList.add("drag-over");
  activeChipDrag.currentDrop = next;
}

function cleanupChipPointerDrag(pointerId) {
  const drag = activeChipDrag;
  if (!drag) return;

  drag.source.releasePointerCapture?.(pointerId);
  drag.source.removeEventListener("pointermove", moveChipPointerDrag);
  drag.source.removeEventListener("pointerup", endChipPointerDrag);
  drag.source.removeEventListener("pointercancel", cancelChipPointerDrag);
  drag.source.classList.remove("dragging");
  drag.currentDrop?.classList.remove("drag-over");
  drag.ghost?.remove();
  activeChipDrag = null;
}

document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.hasAttribute("data-modal-backdrop")) {
    detailPlayerId = null;
    render();
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;

  if ((action === "select-player" || action === "assign-slot") && suppressNextChipClick) {
    suppressNextChipClick = false;
    event.preventDefault();
    return;
  }

  if (action === "set-view") {
    state.view = target.dataset.view;
    saveState();
    render();
  }

  if (action === "contact-owner") {
    event.preventDefault();
    window.location.href = buildContactHref();
  }

  if (action === "set-roster-sort") {
    event.preventDefault();
    setRosterSort(target.dataset.rosterSort);
  }

  if (action === "toggle-clock") toggleClock();
  if (action === "next-period") nextPeriod();
  if (action === "reset-clock") resetClock();
  if (action === "reset-new-game") resetForNewGame();
  if (action === "snapshot") commitSnapshot();
  if (action === "remove-player") removePlayer(target.dataset.playerId);
  if (action === "open-player-details") {
    event.preventDefault();
    detailPlayerId = target.dataset.playerId;
    render();
    window.requestAnimationFrame(() => {
      document.querySelector(".modal-close")?.focus();
    });
  }
  if (action === "close-player-details") {
    detailPlayerId = null;
    render();
  }

  if (action === "select-player") {
    const player = getPlayer(target.dataset.playerId);
    if (player && player.active) {
      state.selectedPlayerId = player.id;
      saveState();
      render();
    }
  }

  if (action === "assign-slot") {
    const slotId = target.dataset.slotId;
    const playerId = state.stagedAssignments[slotId] || state.liveAssignments[slotId] || null;
    if (state.selectedPlayerId) {
      stagePlayerInSlot(state.selectedPlayerId, slotId);
    } else if (playerId) {
      state.selectedPlayerId = playerId;
      saveState();
      render();
    }
  }

  if (action === "keep-slot") keepSlot(target.dataset.slotId);
  if (action === "keep-swap") keepSwap(target.dataset.slotId, target.dataset.pairSlotId);
  if (action === "clear-slot") setSlotStage(target.dataset.slotId, "");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !detailPlayerId) return;
  detailPlayerId = null;
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.action === "toggle-active") {
    setPlayerActive(target.dataset.playerId, target.checked);
  }

  if (target.dataset.action === "stage-select") {
    setSlotStage(target.dataset.slotId, target.value);
  }

});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.dataset.form === "add-player") {
    event.preventDefault();
    const data = new FormData(form);
    const nameInput = form.querySelector('input[name="name"]');
    const name = String(data.get("name") || "");
    if (!name.trim()) {
      pendingFocusSelector = null;
      if (nameInput instanceof HTMLElement) nameInput.focus();
      return;
    }
    pendingFocusSelector = nameInput?.id ? `#${nameInput.id}` : null;
    addPlayer(name, String(data.get("number") || ""));
    form.reset();
  }

  if (form.dataset.form === "formation") {
    event.preventDefault();
    const data = new FormData(form);
    applyFormation(String(data.get("formation") || ""));
  }
});

setInterval(() => {
  if (!state.clock.running) return;
  accrueTime();
  updateDynamicDom();
  saveState();
}, 1000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    persistRunningClock();
  } else {
    resumeRunningClock();
    updateDynamicDom();
    updateSubstitutionLayer();
  }
});
document.addEventListener("freeze", persistRunningClock);
document.addEventListener("resume", () => {
  resumeRunningClock();
  updateDynamicDom();
  updateSubstitutionLayer();
});
window.addEventListener("pageshow", () => {
  resumeRunningClock();
  updateDynamicDom();
  updateSubstitutionLayer();
});
window.addEventListener("pagehide", persistRunningClock);
window.addEventListener("resize", updateSubstitutionLayer);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

resumeRunningClock();
render();
