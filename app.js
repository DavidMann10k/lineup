"use strict";

const STORAGE_KEY = "lineup-state-v1";
const app = document.getElementById("app");
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

let state = loadState();
let lastSaveAt = 0;
let pendingFocusSelector = null;
let detailPlayerId = null;
let activeChipDrag = null;
let activePageSwipe = null;
let pendingViewTransition = null;
let suppressNextChipClick = false;

function createState() {
  return {
    view: "formation",
    formation: "2-3-1",
    formationError: "",
    rosterSort: "playtime",
    rosterSortDirection: "asc",
    rosterSortDefaultVersion: 2,
    selectedPlayerId: null,
    players: [],
    liveAssignments: {},
    stagedAssignments: {},
    openStints: {},
    events: [],
    clock: {
      running: false,
      elapsedSeconds: 0,
      period: 1,
      lastTickAt: null,
    },
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return createState();
    const base = createState();
    const useNewRosterDefault =
      !saved.rosterSortDefaultVersion &&
      (!Object.prototype.hasOwnProperty.call(saved, "rosterSort") ||
        (saved.rosterSort === "name" && (!saved.rosterSortDirection || saved.rosterSortDirection === "asc")));
    const rosterSort = useNewRosterDefault
      ? base.rosterSort
      : normalizeRosterSort(saved.rosterSort, base.rosterSort);
    const rosterSortDirection = useNewRosterDefault
      ? base.rosterSortDirection
      : normalizeRosterSortDirection(saved.rosterSortDirection, rosterSort);
    return {
      ...base,
      ...saved,
      clock: { ...base.clock, ...(saved.clock || {}), running: false, lastTickAt: null },
      rosterSort,
      rosterSortDirection,
      rosterSortDefaultVersion: base.rosterSortDefaultVersion,
      players: Array.isArray(saved.players) ? saved.players.map(normalizePlayer) : [],
      events: Array.isArray(saved.events) ? saved.events.slice(0, 30) : [],
      liveAssignments: saved.liveAssignments || {},
      stagedAssignments: saved.stagedAssignments || {},
      openStints: saved.openStints || {},
    };
  } catch {
    return createState();
  }
}

function normalizeRosterSort(value, fallback = "playtime") {
  return value === "playtime" || value === "active" || value === "name" ? value : fallback;
}

function defaultRosterSortDirection(sortKey) {
  return sortKey === "name" ? "asc" : "desc";
}

function normalizeRosterSortDirection(value, sortKey = "playtime") {
  if (value === "asc" || value === "desc") return value;
  return defaultRosterSortDirection(sortKey);
}

function normalizePlayer(player) {
  return {
    id: player.id || uid("player"),
    name: player.name || "Unnamed player",
    number: player.number || "",
    active: player.active !== false,
    totalSeconds: Number(player.totalSeconds || 0),
    benchSeconds: Number(player.benchSeconds || 0),
    positionSeconds: player.positionSeconds || {},
    history: Array.isArray(player.history) ? player.history : [],
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  lastSaveAt = Date.now();
}

function saveSoon() {
  if (Date.now() - lastSaveAt > 3500) saveState();
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPlayer(id) {
  return state.players.find((player) => player.id === id) || null;
}

function normalizeFormation(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, "");
  const parts = cleaned.split("-");
  let hasGoalie = false;
  const rowParts = [];

  if (!cleaned || parts.some((part) => !part)) {
    return { error: "Use soccer notation like G-2-3-1, 2-3-1, or 4-3-3." };
  }

  for (const part of parts) {
    if (/^g$/i.test(part)) {
      if (hasGoalie) return { error: "Use only one goalie marker." };
      hasGoalie = true;
      continue;
    }

    if (!/^\d{1,2}$/.test(part)) {
      return { error: "Use soccer notation like G-2-3-1, 2-3-1, or 4-3-3." };
    }

    rowParts.push(part);
  }

  if (!rowParts.length) {
    return { error: "Add at least one formation line." };
  }

  const rows = rowParts.map((part) => Number(part));
  const total = rows.reduce((sum, count) => sum + count, 0);

  if (rows.some((count) => !Number.isInteger(count) || count < 1 || count > 6)) {
    return { error: "Each formation line needs 1 to 6 players." };
  }

  const maxOutfield = hasGoalie ? 10 : 11;
  if (total > maxOutfield) {
    return { error: "Use 10 or fewer outfield spots with G, or 11 or fewer without G." };
  }

  return { value: `${hasGoalie ? "G-" : ""}${rowParts.join("-")}`, rows, hasGoalie };
}

function parseFormation() {
  const result = normalizeFormation(state.formation);
  if (result.error) return { rows: [2, 3, 1], hasGoalie: false };
  return result;
}

function getSlots() {
  const formation = parseFormation();
  const rows = formation.rows;
  const slots = [];

  if (formation.hasGoalie) {
    slots.push({
      id: "slot-gk",
      label: "GK",
      role: "Goalkeeper",
      x: 50,
      y: 91,
    });
  }

  const rowCount = rows.length;
  let outfieldIndex = 1;

  rows.forEach((count, rowIndex) => {
    const topY = 23;
    const bottomY = formation.hasGoalie ? 74 : 84;
    const y =
      rowCount === 1
        ? 52
        : bottomY - (bottomY - topY) * (rowIndex / Math.max(1, rowCount - 1));
    const prefix = rowIndex === 0 ? "D" : rowIndex === rowCount - 1 ? "F" : "M";
    const role = prefix === "D" ? "Defense" : prefix === "F" ? "Forward" : "Midfield";
    const labels = labelsForLine(prefix, count);

    for (let index = 0; index < count; index += 1) {
      slots.push({
        id: `slot-${outfieldIndex}`,
        label: labels[index],
        role,
        x: (100 / (count + 1)) * (index + 1),
        y,
      });
      outfieldIndex += 1;
    }
  });

  return slots;
}

function labelsForLine(prefix, count) {
  const labelSets = {
    D: {
      1: ["CB"],
      2: ["LB", "RB"],
      3: ["LB", "CB", "RB"],
      4: ["LB", "LCB", "RCB", "RB"],
      5: ["LWB", "LB", "CB", "RB", "RWB"],
      6: ["LWB", "LB", "LCB", "RCB", "RB", "RWB"],
    },
    M: {
      1: ["CM"],
      2: ["LM", "RM"],
      3: ["LM", "CM", "RM"],
      4: ["LM", "LCM", "RCM", "RM"],
      5: ["LW", "LM", "CM", "RM", "RW"],
      6: ["LW", "LM", "LCM", "RCM", "RM", "RW"],
    },
    F: {
      1: ["CF"],
      2: ["LF", "RF"],
      3: ["LF", "CF", "RF"],
      4: ["LW", "LF", "RF", "RW"],
      5: ["LW", "LF", "CF", "RF", "RW"],
      6: ["LW", "LF", "LCF", "RCF", "RF", "RW"],
    },
  };

  return (
    labelSets[prefix]?.[count] ||
    Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)
  );
}

function ensureAssignmentKeys() {
  const validIds = new Set(getSlots().map((slot) => slot.id));
  const livePlayerIds = new Set();
  const stagedPlayerIds = new Set();
  let changed = false;

  for (const key of Object.keys(state.liveAssignments)) {
    if (!validIds.has(key)) {
      delete state.liveAssignments[key];
      changed = true;
    }
  }

  for (const key of Object.keys(state.stagedAssignments)) {
    if (!validIds.has(key)) {
      delete state.stagedAssignments[key];
      changed = true;
    }
  }

  for (const key of Object.keys(state.openStints)) {
    if (!validIds.has(key)) {
      delete state.openStints[key];
      changed = true;
    }
  }

  for (const slotId of validIds) {
    const livePlayerId = state.liveAssignments[slotId];
    if (livePlayerId && (!getPlayer(livePlayerId) || livePlayerIds.has(livePlayerId))) {
      state.liveAssignments[slotId] = null;
      changed = true;
    } else if (livePlayerId) {
      livePlayerIds.add(livePlayerId);
    }

    if (!Object.prototype.hasOwnProperty.call(state.stagedAssignments, slotId)) {
      state.stagedAssignments[slotId] = state.liveAssignments[slotId] || null;
      changed = true;
    }

    const stagedPlayerId = state.stagedAssignments[slotId];
    if (stagedPlayerId && (!getPlayer(stagedPlayerId) || stagedPlayerIds.has(stagedPlayerId))) {
      state.stagedAssignments[slotId] = null;
      changed = true;
    } else if (stagedPlayerId) {
      stagedPlayerIds.add(stagedPlayerId);
    }
  }

  return changed;
}

function remapAssignmentsByPosition(previousSlots, nextSlots, assignments) {
  const assignmentsByLabel = new Map();

  for (const slot of previousSlots) {
    const playerId = assignments[slot.id];
    if (playerId && getPlayer(playerId)) assignmentsByLabel.set(slot.label, playerId);
  }

  const nextAssignments = {};
  const usedPlayerIds = new Set();

  for (const slot of nextSlots) {
    const playerId = assignmentsByLabel.get(slot.label) || null;
    if (playerId && !usedPlayerIds.has(playerId)) {
      nextAssignments[slot.id] = playerId;
      usedPlayerIds.add(playerId);
    } else {
      nextAssignments[slot.id] = null;
    }
  }

  return nextAssignments;
}

function accrueTime() {
  if (!state.clock.running) return;

  const now = Date.now();
  if (!state.clock.lastTickAt) state.clock.lastTickAt = now;

  const delta = Math.max(0, (now - state.clock.lastTickAt) / 1000);
  if (delta < 0.05) return;

  const slots = getSlots();
  const livePlayerIds = new Set();
  state.clock.elapsedSeconds += delta;
  state.clock.lastTickAt = now;

  for (const slot of slots) {
    const player = getPlayer(state.liveAssignments[slot.id]);
    if (!player) continue;
    livePlayerIds.add(player.id);
    player.totalSeconds = Number(player.totalSeconds || 0) + delta;
    player.positionSeconds[slot.label] = Number(player.positionSeconds[slot.label] || 0) + delta;
  }

  for (const player of state.players) {
    if (!player.active || livePlayerIds.has(player.id)) continue;
    player.benchSeconds = Number(player.benchSeconds || 0) + delta;
  }
}

function toggleClock() {
  ensureAssignmentKeys();
  if (state.clock.running) {
    accrueTime();
    state.clock.running = false;
    state.clock.lastTickAt = null;
  } else {
    if (!hasCompleteLiveLineup()) return;
    state.clock.running = true;
    state.clock.lastTickAt = Date.now();
  }
  saveState();
  render();
}

function nextPeriod() {
  ensureAssignmentKeys();
  if (!hasCompleteLiveLineup()) return;
  accrueTime();
  state.clock.running = false;
  state.clock.lastTickAt = null;
  state.clock.period += 1;
  addEvent("Period advanced", `Period ${state.clock.period}`);
  saveState();
  render();
}

function resetClock() {
  if (isClockAtZero()) return;
  if (!window.confirm("Reset the game clock? Player playtime totals will stay intact.")) return;
  accrueTime();
  closeLiveStints();
  state.clock.running = false;
  state.clock.elapsedSeconds = 0;
  state.clock.period = 1;
  state.clock.lastTickAt = null;
  openLiveStints();
  addEvent("Clock reset", "Player totals kept");
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

  state.clock.running = false;
  state.clock.elapsedSeconds = 0;
  state.clock.period = 1;
  state.clock.lastTickAt = null;
  state.openStints = {};
  state.events = [];
  state.liveAssignments = {};
  state.stagedAssignments = {};
  state.selectedPlayerId = null;

  for (const player of state.players) {
    player.totalSeconds = 0;
    player.benchSeconds = 0;
    player.positionSeconds = {};
    player.history = [];
  }

  saveState();
  render();
}

function applyFormation(value) {
  const result = normalizeFormation(value);
  if (result.error) {
    state.formationError = result.error;
    render();
    return;
  }

  if (result.value === state.formation) {
    state.formationError = "";
    saveState();
    render();
    return;
  }

  const previousSlots = getSlots();
  const previousLiveAssignments = { ...state.liveAssignments };
  const previousStagedAssignments = { ...state.stagedAssignments };

  accrueTime();
  closeLiveStints();

  state.formation = result.value;
  state.formationError = "";
  const nextSlots = getSlots();
  state.liveAssignments = remapAssignmentsByPosition(
    previousSlots,
    nextSlots,
    previousLiveAssignments,
  );
  state.stagedAssignments = remapAssignmentsByPosition(
    previousSlots,
    nextSlots,
    previousStagedAssignments,
  );
  state.openStints = {};
  ensureAssignmentKeys();
  openLiveStints();

  addEvent("Formation updated", result.value);
  saveState();
  render();
}

function addPlayer(name, number) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  state.players.push({
    id: uid("player"),
    name: trimmedName,
    number: number.trim(),
    active: true,
    totalSeconds: 0,
    benchSeconds: 0,
    positionSeconds: {},
    history: [],
  });

  saveState();
  render();
}

function setPlayerActive(playerId, active) {
  accrueTime();
  const player = getPlayer(playerId);
  if (!player) return;
  player.active = active;

  if (!active) {
    for (const slotId of Object.keys(state.stagedAssignments)) {
      if (state.stagedAssignments[slotId] === playerId) state.stagedAssignments[slotId] = null;
    }
    if (state.selectedPlayerId === playerId) state.selectedPlayerId = null;
  }

  saveState();
  render();
}

function removePlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;
  if (!window.confirm(`Remove ${player.name} from this lineup?`)) return;

  accrueTime();
  state.players = state.players.filter((entry) => entry.id !== playerId);
  for (const assignments of [state.liveAssignments, state.stagedAssignments]) {
    for (const slotId of Object.keys(assignments)) {
      if (assignments[slotId] === playerId) assignments[slotId] = null;
    }
  }

  for (const slotId of Object.keys(state.openStints)) {
    if (state.openStints[slotId].playerId === playerId) delete state.openStints[slotId];
  }

  if (state.selectedPlayerId === playerId) state.selectedPlayerId = null;
  if (detailPlayerId === playerId) detailPlayerId = null;
  saveState();
  render();
}

function stagePlayerInSlot(playerId, slotId) {
  accrueTime();
  ensureAssignmentKeys();
  const player = getPlayer(playerId);
  if (!player || !player.active) return;

  for (const key of Object.keys(state.stagedAssignments)) {
    if (state.stagedAssignments[key] === playerId) state.stagedAssignments[key] = null;
  }

  state.stagedAssignments[slotId] = playerId;
  state.selectedPlayerId = playerId;
  saveState();
  render();
}

function stageFieldPlayerInSlot(playerId, sourceSlotId, targetSlotId) {
  accrueTime();
  ensureAssignmentKeys();
  const player = getPlayer(playerId);
  if (!player || !player.active) return;
  if (!sourceSlotId || sourceSlotId === targetSlotId) return;

  const displacedPlayerId = state.stagedAssignments[targetSlotId] || state.liveAssignments[targetSlotId] || null;

  for (const key of Object.keys(state.stagedAssignments)) {
    if (state.stagedAssignments[key] === playerId) state.stagedAssignments[key] = null;
    if (displacedPlayerId && state.stagedAssignments[key] === displacedPlayerId) state.stagedAssignments[key] = null;
  }

  state.stagedAssignments[targetSlotId] = playerId;
  if (Object.prototype.hasOwnProperty.call(state.stagedAssignments, sourceSlotId)) {
    state.stagedAssignments[sourceSlotId] = displacedPlayerId && displacedPlayerId !== playerId ? displacedPlayerId : null;
  }
  state.selectedPlayerId = playerId;
  saveState();
  render();
}

function setSlotStage(slotId, playerId) {
  accrueTime();
  ensureAssignmentKeys();

  if (!playerId) {
    state.stagedAssignments[slotId] = null;
    saveState();
    render();
    return;
  }

  stagePlayerInSlot(playerId, slotId);
}

function stageSlotToBench(slotId, draggedPlayerId = null) {
  accrueTime();
  ensureAssignmentKeys();

  if (!Object.prototype.hasOwnProperty.call(state.stagedAssignments, slotId)) return;
  const livePlayerId = state.liveAssignments[slotId] || null;
  const stagedPlayerId = state.stagedAssignments[slotId] || null;
  if (!livePlayerId && !stagedPlayerId) return;

  const draggedDestination = draggedPlayerId
    ? getSlots().find((slot) => slot.id !== slotId && state.stagedAssignments[slot.id] === draggedPlayerId)
    : null;
  if (draggedPlayerId === livePlayerId && draggedDestination && stagedPlayerId && stagedPlayerId !== livePlayerId) {
    state.stagedAssignments[draggedDestination.id] = null;
    if (state.selectedPlayerId === livePlayerId || state.selectedPlayerId === stagedPlayerId) state.selectedPlayerId = null;
    saveState();
    render();
    return;
  }

  if (livePlayerId && stagedPlayerId && livePlayerId !== stagedPlayerId) {
    state.stagedAssignments[slotId] = livePlayerId;
    if (state.selectedPlayerId === stagedPlayerId) state.selectedPlayerId = null;
    saveState();
    render();
    return;
  }

  state.stagedAssignments[slotId] = null;
  if (state.selectedPlayerId === livePlayerId || state.selectedPlayerId === stagedPlayerId) state.selectedPlayerId = null;
  saveState();
  render();
}

function keepSlot(slotId) {
  accrueTime();
  state.stagedAssignments[slotId] = state.liveAssignments[slotId] || null;
  saveState();
  render();
}

function keepSwap(slotId, pairSlotId) {
  accrueTime();
  if (slotId) state.stagedAssignments[slotId] = state.liveAssignments[slotId] || null;
  if (pairSlotId) state.stagedAssignments[pairSlotId] = state.liveAssignments[pairSlotId] || null;
  saveState();
  render();
}

function setRosterSort(sortKey) {
  const nextSort = normalizeRosterSort(sortKey);
  if (state.rosterSort === nextSort) {
    state.rosterSortDirection = state.rosterSortDirection === "asc" ? "desc" : "asc";
  } else {
    state.rosterSort = nextSort;
    state.rosterSortDirection = defaultRosterSortDirection(nextSort);
  }
  saveState();
  render();
}

function commitSnapshot({ persist = true } = {}) {
  accrueTime();
  ensureAssignmentKeys();
  if (!isStagedFormationFilled()) return;

  const slots = getSlots();
  const previous = { ...state.liveAssignments };
  const next = {};
  const changes = [];

  for (const slot of slots) {
    const before = previous[slot.id] || null;
    const after = state.stagedAssignments[slot.id] || null;
    next[slot.id] = after;

    if (before === after) continue;

    if (before) closeStint(slot.id, before, slot);
    if (after) openStint(slot.id, after, slot);

    changes.push(`${slot.label}: ${playerName(before)} to ${playerName(after)}`);
  }

  state.liveAssignments = next;
  state.stagedAssignments = { ...next };
  addEvent(
    "Lineup set",
    changes.length ? summarizeChanges(changes) : "No lineup changes",
  );
  if (persist) {
    saveState();
    render();
  }
}

function closeLiveStints() {
  for (const slot of getSlots()) {
    const playerId = state.liveAssignments[slot.id];
    if (playerId) closeStint(slot.id, playerId, slot);
  }
}

function openLiveStints() {
  for (const slot of getSlots()) {
    const playerId = state.liveAssignments[slot.id];
    if (playerId) openStint(slot.id, playerId, slot);
  }
}

function openStint(slotId, playerId, slot) {
  state.openStints[slotId] = {
    playerId,
    position: slot.label,
    startedAt: state.clock.elapsedSeconds,
    period: state.clock.period,
  };
}

function closeStint(slotId, playerId, slot) {
  const player = getPlayer(playerId);
  const stint = state.openStints[slotId] || {
    playerId,
    position: slot.label,
    startedAt: state.clock.elapsedSeconds,
    period: state.clock.period,
  };

  if (player) {
    player.history.push({
      position: stint.position,
      startedAt: stint.startedAt,
      endedAt: state.clock.elapsedSeconds,
      period: stint.period,
    });
  }

  delete state.openStints[slotId];
}

function addEvent(title, detail) {
  state.events.unshift({
    id: uid("event"),
    title,
    detail,
    period: state.clock.period,
    clock: state.clock.elapsedSeconds,
    at: new Date().toISOString(),
  });
  state.events = state.events.slice(0, 30);
}

function summarizeChanges(changes) {
  if (changes.length <= 3) return changes.join(", ");
  return `${changes.slice(0, 3).join(", ")} and ${changes.length - 3} more`;
}

function playerName(playerId) {
  const player = getPlayer(playerId);
  return player ? player.name : "Open";
}

function getVisibleAssignmentPlayerIds(assignments) {
  return new Set(getSlots().map((slot) => assignments[slot.id]).filter(Boolean));
}

function getLivePlayerIds() {
  return getVisibleAssignmentPlayerIds(state.liveAssignments);
}

function isPlayerPlaytimeIncreasing(player) {
  if (!state.clock.running || !player) return false;
  return getLivePlayerIds().has(player.id);
}

function getStagedPlayerIds() {
  return getVisibleAssignmentPlayerIds(state.stagedAssignments);
}

function getBenchPlayers() {
  const live = getLivePlayerIds();
  const staged = getStagedPlayerIds();
  return state.players.filter((player) => player.active && !live.has(player.id) && !staged.has(player.id));
}

function getInactivePlayers() {
  return state.players.filter((player) => !player.active);
}

function comparePlayersByName(a, b) {
  const name = NAME_COLLATOR.compare(a.name, b.name);
  if (name) return name;
  const number = NAME_COLLATOR.compare(a.number, b.number);
  if (number) return number;
  return NAME_COLLATOR.compare(a.id, b.id);
}

function compareRosterPlayers(a, b) {
  const direction = state.rosterSortDirection === "desc" ? -1 : 1;
  let result = 0;

  if (state.rosterSort === "playtime") {
    result = Number(a.totalSeconds || 0) - Number(b.totalSeconds || 0);
  } else if (state.rosterSort === "active") {
    result = Number(Boolean(a.active)) - Number(Boolean(b.active));
  } else {
    result = comparePlayersByName(a, b);
  }

  if (result) return result * direction;
  return comparePlayersByName(a, b);
}

function getRosterPlayers() {
  return [...state.players].sort(compareRosterPlayers);
}

function isClockAtZero() {
  return Number(state.clock.elapsedSeconds || 0) <= 0;
}

function isAssignmentFormationFilled(assignments) {
  ensureAssignmentKeys();
  const usedPlayerIds = new Set();

  return getSlots().every((slot) => {
    const player = getPlayer(assignments[slot.id]);
    if (!player || !player.active || usedPlayerIds.has(player.id)) return false;
    usedPlayerIds.add(player.id);
    return true;
  });
}

function isStagedFormationFilled() {
  return isAssignmentFormationFilled(state.stagedAssignments);
}

function hasCompleteLiveLineup() {
  return isAssignmentFormationFilled(state.liveAssignments);
}

function getPendingSubs() {
  const slots = getSlots();
  const destinationByPlayerId = new Map();
  const handledSlotIds = new Set();
  const rows = [];

  for (const slot of slots) {
    const livePlayerId = state.liveAssignments[slot.id] || null;
    const stagedPlayerId = state.stagedAssignments[slot.id] || null;
    if (stagedPlayerId && stagedPlayerId !== livePlayerId) {
      destinationByPlayerId.set(stagedPlayerId, slot);
    }
  }

  for (const slot of slots) {
    if (handledSlotIds.has(slot.id)) continue;

    const outgoing = getPlayer(state.liveAssignments[slot.id]);
    const incoming = getPlayer(state.stagedAssignments[slot.id]);
    if (!outgoing || incoming?.id === outgoing.id) continue;

    const outgoingDestination = destinationByPlayerId.get(outgoing.id) || null;
    if (incoming && outgoingDestination && outgoingDestination.id !== slot.id) {
      const pairLivePlayerId = state.liveAssignments[outgoingDestination.id] || null;
      const pairStagedPlayerId = state.stagedAssignments[outgoingDestination.id] || null;
      if (pairLivePlayerId === incoming.id && pairStagedPlayerId === outgoing.id) {
        rows.push({
          slot: outgoingDestination,
          pairedSlot: slot,
          incoming: outgoing,
          outgoing: incoming,
          outgoingDestination: slot,
        });
        handledSlotIds.add(slot.id);
        handledSlotIds.add(outgoingDestination.id);
        continue;
      }
    }

    rows.push({ slot, incoming, outgoing, outgoingDestination });
  }

  return rows;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function positionType(code) {
  if (code === "GK") return "gk";
  if (code === "BE") return "be";
  if (code === "IN") return "in";
  if (/B$/.test(code) || code.includes("CB") || code.includes("WB") || code.startsWith("D")) return "d";
  if (code.includes("M") || code.startsWith("M")) return "m";
  if (code.includes("F") || code.startsWith("F") || code.includes("W")) return "f";
  return "unknown";
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
      <div class="header-primary">
        <img class="brand-mark" src="./assets/icon.svg" alt="">
        <nav class="view-tabs" aria-label="Screens">
          <button class="tab-button ${state.view === "roster" ? "active" : ""}" data-action="set-view" data-view="roster">Roster</button>
          <button class="tab-button ${state.view === "formation" ? "active" : ""}" data-action="set-view" data-view="formation">Formation</button>
        </nav>
      </div>
    </header>
  `;
}

function renderRoster() {
  const activeCount = state.players.filter((player) => player.active).length;
  const inactiveCount = state.players.length - activeCount;
  const onFieldCount = getLivePlayerIds().size;
  const benchCount = getBenchPlayers().length;

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

      <div class="stat-grid" aria-label="Roster totals">
        ${renderStat("Active", activeCount)}
        ${renderStat("On field", onFieldCount)}
        ${renderStat("Bench", benchCount)}
        ${renderStat("Inactive", inactiveCount)}
      </div>

      <div class="roster-table-wrap">
        ${state.players.length ? renderRosterTable() : `<div class="empty-state empty-padded">No players yet.</div>`}
      </div>
    </section>
  `;
}

function renderStat(label, value) {
  return `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
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

        <aside class="lineup-panel">
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
      ${getSlots().map(renderFieldSlot).join("")}
    </div>
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

function renderFieldSlot(slot) {
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
      ${renderSlotBubble(current, staged)}
      <span class="slot-name">${escapeHtml(slotName(current, staged))}</span>
    </button>
  `;
}

function renderSlotBubble(current, staged) {
  if (current && staged && current.id !== staged.id) {
    return `
      <span class="duo-bubbles">
        <span class="player-bubble">${escapeHtml(initials(current.name))}</span>
        <span class="player-bubble next">${escapeHtml(initials(staged.name))}</span>
      </span>
    `;
  }

  if (current && !staged) {
    return `
      <span class="duo-bubbles">
        <span class="player-bubble">${escapeHtml(initials(current.name))}</span>
        <span class="player-bubble empty">+</span>
      </span>
    `;
  }

  if (staged) return `<span class="player-bubble next">${escapeHtml(initials(staged.name))}</span>`;
  if (current) return `<span class="player-bubble">${escapeHtml(initials(current.name))}</span>`;
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

function renderSlotRow(slot) {
  const current = getPlayer(state.liveAssignments[slot.id]);
  const staged = getPlayer(state.stagedAssignments[slot.id]);
  const changed = (state.liveAssignments[slot.id] || null) !== (state.stagedAssignments[slot.id] || null);

  return `
    <div class="slot-row ${changed ? "changed" : ""}">
      <div class="slot-meta">
        <strong>${renderPositionCode(slot.label)}</strong>
        <span>${escapeHtml(slot.role)}</span>
      </div>
      <div class="slot-state">
        <div class="slot-current-next">
          <div>
            <span>On</span>
            <strong>${current ? escapeHtml(current.name) : "Open"}</strong>
          </div>
          <div>
            <span>Next</span>
            <strong>${staged ? escapeHtml(staged.name) : current ? "Off" : "Open"}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPlayerOptions(selectedId) {
  const liveIds = getLivePlayerIds();
  const eligible = state.players.filter((player) => player.active || player.id === selectedId || liveIds.has(player.id));
  return `
    <option value="">Open</option>
    ${eligible
      .map(
        (player) =>
          `<option value="${player.id}" ${player.id === selectedId ? "selected" : ""}>${escapeHtml(player.name)}${
            player.number ? ` #${escapeHtml(player.number)}` : ""
          }</option>`,
      )
      .join("")}
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
    node.hidden = isClockAtZero();
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
  saveSoon();
}, 1000);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
