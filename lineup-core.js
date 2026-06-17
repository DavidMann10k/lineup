(function initLineupCore(global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  global.LineupCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function createLineupCore() {
  "use strict";

  const STORAGE_KEY = "lineup-state-v1";
  const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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

  function normalizeSavedState(saved) {
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
      clock: normalizeClock({ ...base.clock, ...(saved.clock || {}) }),
      rosterSort,
      rosterSortDirection,
      rosterSortDefaultVersion: base.rosterSortDefaultVersion,
      players: Array.isArray(saved.players) ? saved.players.map(normalizePlayer) : [],
      events: Array.isArray(saved.events) ? saved.events.slice(0, 30) : [],
      liveAssignments: isRecord(saved.liveAssignments) ? { ...saved.liveAssignments } : {},
      stagedAssignments: isRecord(saved.stagedAssignments) ? { ...saved.stagedAssignments } : {},
      openStints: isRecord(saved.openStints) ? { ...saved.openStints } : {},
    };
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeRosterSort(value, fallback = "playtime") {
    return value === "playtime" || value === "active" || value === "name" ? value : fallback;
  }

  function normalizeClock(clock) {
    const lastTickAt = Number(clock.lastTickAt || 0);
    const period = Number(clock.period || 1);

    return {
      running: Boolean(clock.running),
      elapsedSeconds: Math.max(0, Number(clock.elapsedSeconds || 0)),
      period: Number.isFinite(period) && period >= 1 ? Math.floor(period) : 1,
      lastTickAt: Number.isFinite(lastTickAt) && lastTickAt > 0 ? lastTickAt : null,
    };
  }

  function defaultRosterSortDirection(sortKey) {
    return sortKey === "name" ? "asc" : "desc";
  }

  function normalizeRosterSortDirection(value, sortKey = "playtime") {
    if (value === "asc" || value === "desc") return value;
    return defaultRosterSortDirection(sortKey);
  }

  function normalizePlayer(player = {}) {
    return {
      id: player.id || uid("player"),
      name: player.name || "Unnamed player",
      number: player.number || "",
      active: player.active !== false,
      totalSeconds: Number(player.totalSeconds || 0),
      benchSeconds: Number(player.benchSeconds || 0),
      positionSeconds: isRecord(player.positionSeconds) ? { ...player.positionSeconds } : {},
      history: Array.isArray(player.history) ? player.history.slice() : [],
    };
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function optionUid(options, prefix) {
    return typeof options.uid === "function" ? options.uid(prefix) : uid(prefix);
  }

  function optionNow(options) {
    return typeof options.now === "function" ? options.now() : Date.now();
  }

  function optionNowIso(options) {
    if (typeof options.nowIso === "function") return options.nowIso();
    return new Date(optionNow(options)).toISOString();
  }

  function getPlayer(state, id) {
    return state.players.find((player) => player.id === id) || null;
  }

  function normalizeFormation(value) {
    const cleaned = String(value || "")
      .trim()
      .replace(/\s+/g, "");
    const goalieMarkers = cleaned.match(/g/gi) || [];
    let body = cleaned;
    let hasGoalie = false;

    if (!cleaned) {
      return { error: "Use soccer notation like G-2-3-1, 231, or 4-3-3." };
    }

    if (goalieMarkers.length > 1) return { error: "Use only one goalie marker." };

    if (/^g-?/i.test(body)) {
      hasGoalie = true;
      body = body.replace(/^g-?/i, "");
    }

    if (!body) {
      return { error: "Add at least one formation line." };
    }

    if (goalieMarkers.length && !hasGoalie) {
      return { error: "Use soccer notation like G-2-3-1, 231, or 4-3-3." };
    }

    if (!/^[1-6](?:-?[1-6])*$/.test(body)) {
      return { error: "Use soccer notation like G-2-3-1, 231, or 4-3-3." };
    }

    const rowParts = body.replace(/-/g, "").split("");
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

  function parseFormation(state) {
    const result = normalizeFormation(typeof state === "string" ? state : state.formation);
    if (result.error) return { rows: [2, 3, 1], hasGoalie: false };
    return result;
  }

  function getSlots(state) {
    const formation = parseFormation(state);
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

  function ensureAssignmentKeys(state) {
    const validIds = new Set(getSlots(state).map((slot) => slot.id));
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
      if (livePlayerId && (!getPlayer(state, livePlayerId) || livePlayerIds.has(livePlayerId))) {
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
      if (stagedPlayerId && (!getPlayer(state, stagedPlayerId) || stagedPlayerIds.has(stagedPlayerId))) {
        state.stagedAssignments[slotId] = null;
        changed = true;
      } else if (stagedPlayerId) {
        stagedPlayerIds.add(stagedPlayerId);
      }
    }

    return changed;
  }

  function remapAssignmentsByPosition(state, previousSlots, nextSlots, assignments) {
    const assignmentsByLabel = new Map();

    for (const slot of previousSlots) {
      const playerId = assignments[slot.id];
      if (playerId && getPlayer(state, playerId)) assignmentsByLabel.set(slot.label, playerId);
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

  function accrueTime(state, options = {}) {
    if (!state.clock.running) return { ok: true, delta: 0 };

    const now = optionNow(options);
    if (!state.clock.lastTickAt) state.clock.lastTickAt = now;
    if (state.clock.lastTickAt > now) state.clock.lastTickAt = now;

    const delta = Math.max(0, (now - state.clock.lastTickAt) / 1000);
    if (delta < 0.05) return { ok: true, delta: 0 };

    const slots = getSlots(state);
    const livePlayerIds = new Set();
    state.clock.elapsedSeconds += delta;
    state.clock.lastTickAt = now;

    for (const slot of slots) {
      const player = getPlayer(state, state.liveAssignments[slot.id]);
      if (!player) continue;
      livePlayerIds.add(player.id);
      player.totalSeconds = Number(player.totalSeconds || 0) + delta;
      player.positionSeconds[slot.label] = Number(player.positionSeconds[slot.label] || 0) + delta;
    }

    for (const player of state.players) {
      if (!player.active || livePlayerIds.has(player.id)) continue;
      player.benchSeconds = Number(player.benchSeconds || 0) + delta;
    }

    return { ok: true, delta };
  }

  function toggleClock(state, options = {}) {
    ensureAssignmentKeys(state);
    if (state.clock.running) {
      accrueTime(state, options);
      state.clock.running = false;
      state.clock.lastTickAt = null;
      return { ok: true, running: false };
    }

    if (!hasCompleteLiveLineup(state)) return { ok: false, reason: "incomplete-live-lineup" };

    state.clock.running = true;
    state.clock.lastTickAt = optionNow(options);
    return { ok: true, running: true };
  }

  function nextPeriod(state, options = {}) {
    ensureAssignmentKeys(state);
    if (!hasCompleteLiveLineup(state)) return { ok: false, reason: "incomplete-live-lineup" };

    accrueTime(state, options);
    state.clock.running = false;
    state.clock.lastTickAt = null;
    state.clock.period += 1;
    addEvent(state, "Period advanced", `Period ${state.clock.period}`, options);
    return { ok: true, period: state.clock.period };
  }

  function resetClock(state, options = {}) {
    if (isClockAtZero(state)) return { ok: false, reason: "clock-at-zero" };

    accrueTime(state, options);
    closeLiveStints(state);
    state.clock.running = false;
    state.clock.elapsedSeconds = 0;
    state.clock.period = 1;
    state.clock.lastTickAt = null;
    openLiveStints(state);
    addEvent(state, "Clock reset", "Player totals kept", options);
    return { ok: true };
  }

  function resetForNewGame(state) {
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

    return { ok: true };
  }

  function applyFormation(state, value, options = {}) {
    const result = normalizeFormation(value);
    if (result.error) {
      state.formationError = result.error;
      return { ok: false, error: result.error };
    }

    if (result.value === state.formation) {
      state.formationError = "";
      return { ok: true, changed: false };
    }

    const previousSlots = getSlots(state);
    const previousLiveAssignments = { ...state.liveAssignments };
    const previousStagedAssignments = { ...state.stagedAssignments };

    accrueTime(state, options);
    closeLiveStints(state);

    state.formation = result.value;
    state.formationError = "";
    const nextSlots = getSlots(state);
    state.liveAssignments = remapAssignmentsByPosition(
      state,
      previousSlots,
      nextSlots,
      previousLiveAssignments,
    );
    state.stagedAssignments = remapAssignmentsByPosition(
      state,
      previousSlots,
      nextSlots,
      previousStagedAssignments,
    );
    state.openStints = {};
    ensureAssignmentKeys(state);
    openLiveStints(state);

    addEvent(state, "Formation updated", result.value, options);
    return { ok: true, changed: true };
  }

  function addPlayer(state, name, number = "", options = {}) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return { ok: false, reason: "blank-name" };

    const player = {
      id: optionUid(options, "player"),
      name: trimmedName,
      number: String(number || "").trim(),
      active: true,
      totalSeconds: 0,
      benchSeconds: 0,
      positionSeconds: {},
      history: [],
    };

    state.players.push(player);
    return { ok: true, player };
  }

  function setPlayerActive(state, playerId, active, options = {}) {
    accrueTime(state, options);
    const player = getPlayer(state, playerId);
    if (!player) return { ok: false, reason: "missing-player" };
    player.active = Boolean(active);

    if (!active) {
      for (const slotId of Object.keys(state.stagedAssignments)) {
        if (state.stagedAssignments[slotId] === playerId) state.stagedAssignments[slotId] = null;
      }
      if (state.selectedPlayerId === playerId) state.selectedPlayerId = null;
    }

    return { ok: true };
  }

  function removePlayer(state, playerId, options = {}) {
    const player = getPlayer(state, playerId);
    if (!player) return { ok: false, reason: "missing-player" };

    accrueTime(state, options);
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
    return { ok: true, player };
  }

  function stagePlayerInSlot(state, playerId, slotId, options = {}) {
    accrueTime(state, options);
    ensureAssignmentKeys(state);
    const player = getPlayer(state, playerId);
    if (!player || !player.active) return { ok: false, reason: "inactive-or-missing-player" };

    for (const key of Object.keys(state.stagedAssignments)) {
      if (state.stagedAssignments[key] === playerId) state.stagedAssignments[key] = null;
    }

    state.stagedAssignments[slotId] = playerId;
    state.selectedPlayerId = playerId;
    return { ok: true };
  }

  function stageFieldPlayerInSlot(state, playerId, sourceSlotId, targetSlotId, options = {}) {
    accrueTime(state, options);
    ensureAssignmentKeys(state);
    const player = getPlayer(state, playerId);
    if (!player || !player.active) return { ok: false, reason: "inactive-or-missing-player" };
    if (!sourceSlotId || sourceSlotId === targetSlotId) return { ok: false, reason: "same-slot" };

    const displacedPlayerId = state.stagedAssignments[targetSlotId] || state.liveAssignments[targetSlotId] || null;
    const sourceLivePlayerId = state.liveAssignments[sourceSlotId] || null;
    const sourceReplacementId = state.stagedAssignments[sourceSlotId] || null;
    const shouldKeepSourceReplacement =
      sourceLivePlayerId === playerId && sourceReplacementId && sourceReplacementId !== playerId;

    for (const key of Object.keys(state.stagedAssignments)) {
      if (state.stagedAssignments[key] === playerId) state.stagedAssignments[key] = null;
      if (displacedPlayerId && state.stagedAssignments[key] === displacedPlayerId) state.stagedAssignments[key] = null;
    }

    state.stagedAssignments[targetSlotId] = playerId;
    if (Object.prototype.hasOwnProperty.call(state.stagedAssignments, sourceSlotId)) {
      state.stagedAssignments[sourceSlotId] = shouldKeepSourceReplacement
        ? sourceReplacementId
        : displacedPlayerId && displacedPlayerId !== playerId
          ? displacedPlayerId
          : null;
    }
    state.selectedPlayerId = playerId;
    return { ok: true };
  }

  function setSlotStage(state, slotId, playerId, options = {}) {
    accrueTime(state, options);
    ensureAssignmentKeys(state);

    if (!playerId) {
      state.stagedAssignments[slotId] = null;
      return { ok: true };
    }

    return stagePlayerInSlot(state, playerId, slotId, options);
  }

  function stageSlotToBench(state, slotId, draggedPlayerId = null, options = {}) {
    accrueTime(state, options);
    ensureAssignmentKeys(state);

    if (!Object.prototype.hasOwnProperty.call(state.stagedAssignments, slotId)) {
      return { ok: false, reason: "missing-slot" };
    }
    const livePlayerId = state.liveAssignments[slotId] || null;
    const stagedPlayerId = state.stagedAssignments[slotId] || null;
    if (!livePlayerId && !stagedPlayerId) return { ok: false, reason: "empty-slot" };

    const draggedDestination = draggedPlayerId
      ? getSlots(state).find((slot) => slot.id !== slotId && state.stagedAssignments[slot.id] === draggedPlayerId)
      : null;
    if (draggedPlayerId === livePlayerId && draggedDestination && stagedPlayerId && stagedPlayerId !== livePlayerId) {
      state.stagedAssignments[draggedDestination.id] = null;
      if (state.selectedPlayerId === livePlayerId || state.selectedPlayerId === stagedPlayerId) {
        state.selectedPlayerId = null;
      }
      return { ok: true };
    }

    if (livePlayerId && stagedPlayerId && livePlayerId !== stagedPlayerId) {
      state.stagedAssignments[slotId] = livePlayerId;
      if (state.selectedPlayerId === stagedPlayerId) state.selectedPlayerId = null;
      return { ok: true };
    }

    state.stagedAssignments[slotId] = null;
    if (state.selectedPlayerId === livePlayerId || state.selectedPlayerId === stagedPlayerId) {
      state.selectedPlayerId = null;
    }
    return { ok: true };
  }

  function keepSlot(state, slotId, options = {}) {
    accrueTime(state, options);
    state.stagedAssignments[slotId] = state.liveAssignments[slotId] || null;
    return { ok: true };
  }

  function keepSwap(state, slotId, pairSlotId, options = {}) {
    accrueTime(state, options);
    if (slotId) state.stagedAssignments[slotId] = state.liveAssignments[slotId] || null;
    if (pairSlotId) state.stagedAssignments[pairSlotId] = state.liveAssignments[pairSlotId] || null;
    return { ok: true };
  }

  function setRosterSort(state, sortKey) {
    const nextSort = normalizeRosterSort(sortKey);
    if (state.rosterSort === nextSort) {
      state.rosterSortDirection = state.rosterSortDirection === "asc" ? "desc" : "asc";
    } else {
      state.rosterSort = nextSort;
      state.rosterSortDirection = defaultRosterSortDirection(nextSort);
    }
    return { ok: true };
  }

  function commitSnapshot(state, options = {}) {
    accrueTime(state, options);
    ensureAssignmentKeys(state);
    if (!isStagedFormationFilled(state)) return { ok: false, reason: "incomplete-staged-lineup" };

    const slots = getSlots(state);
    const previous = { ...state.liveAssignments };
    const next = {};
    const changes = [];

    for (const slot of slots) {
      const before = previous[slot.id] || null;
      const after = state.stagedAssignments[slot.id] || null;
      next[slot.id] = after;

      if (before === after) continue;

      if (before) closeStint(state, slot.id, before, slot);
      if (after) openStint(state, slot.id, after, slot);

      changes.push(`${slot.label}: ${playerName(state, before)} to ${playerName(state, after)}`);
    }

    state.liveAssignments = next;
    state.stagedAssignments = { ...next };
    addEvent(state, "Lineup set", changes.length ? summarizeChanges(changes) : "No lineup changes", options);
    return { ok: true, changes };
  }

  function closeLiveStints(state) {
    for (const slot of getSlots(state)) {
      const playerId = state.liveAssignments[slot.id];
      if (playerId) closeStint(state, slot.id, playerId, slot);
    }
    return { ok: true };
  }

  function openLiveStints(state) {
    for (const slot of getSlots(state)) {
      const playerId = state.liveAssignments[slot.id];
      if (playerId) openStint(state, slot.id, playerId, slot);
    }
    return { ok: true };
  }

  function openStint(state, slotId, playerId, slot) {
    state.openStints[slotId] = {
      playerId,
      position: slot.label,
      startedAt: state.clock.elapsedSeconds,
      period: state.clock.period,
    };
    return { ok: true };
  }

  function closeStint(state, slotId, playerId, slot) {
    const player = getPlayer(state, playerId);
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
    return { ok: true };
  }

  function addEvent(state, title, detail, options = {}) {
    const event = {
      id: optionUid(options, "event"),
      title,
      detail,
      period: state.clock.period,
      clock: state.clock.elapsedSeconds,
      at: optionNowIso(options),
    };
    state.events.unshift(event);
    state.events = state.events.slice(0, 30);
    return event;
  }

  function summarizeChanges(changes) {
    if (changes.length <= 3) return changes.join(", ");
    return `${changes.slice(0, 3).join(", ")} and ${changes.length - 3} more`;
  }

  function playerName(state, playerId) {
    const player = getPlayer(state, playerId);
    return player ? player.name : "Open";
  }

  function getVisibleAssignmentPlayerIds(state, assignments) {
    return new Set(getSlots(state).map((slot) => assignments[slot.id]).filter(Boolean));
  }

  function getLivePlayerIds(state) {
    return getVisibleAssignmentPlayerIds(state, state.liveAssignments);
  }

  function isPlayerPlaytimeIncreasing(state, player) {
    if (!state.clock.running || !player) return false;
    return getLivePlayerIds(state).has(player.id);
  }

  function getStagedPlayerIds(state) {
    return getVisibleAssignmentPlayerIds(state, state.stagedAssignments);
  }

  function getBenchPlayers(state) {
    const live = getLivePlayerIds(state);
    const staged = getStagedPlayerIds(state);
    return state.players.filter((player) => player.active && !live.has(player.id) && !staged.has(player.id));
  }

  function getInactivePlayers(state) {
    return state.players.filter((player) => !player.active);
  }

  function comparePlayersByName(a, b) {
    const name = NAME_COLLATOR.compare(a.name, b.name);
    if (name) return name;
    const number = NAME_COLLATOR.compare(a.number, b.number);
    if (number) return number;
    return NAME_COLLATOR.compare(a.id, b.id);
  }

  function compareRosterPlayers(state, a, b) {
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

  function getRosterPlayers(state) {
    return [...state.players].sort((a, b) => compareRosterPlayers(state, a, b));
  }

  function isClockAtZero(state) {
    return Number(state.clock.elapsedSeconds || 0) <= 0;
  }

  function isAssignmentFormationFilled(state, assignments) {
    ensureAssignmentKeys(state);
    const usedPlayerIds = new Set();

    return getSlots(state).every((slot) => {
      const player = getPlayer(state, assignments[slot.id]);
      if (!player || !player.active || usedPlayerIds.has(player.id)) return false;
      usedPlayerIds.add(player.id);
      return true;
    });
  }

  function isStagedFormationFilled(state) {
    return isAssignmentFormationFilled(state, state.stagedAssignments);
  }

  function hasCompleteLiveLineup(state) {
    return isAssignmentFormationFilled(state, state.liveAssignments);
  }

  function getPendingSubs(state) {
    const slots = getSlots(state);
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

      const outgoing = getPlayer(state, state.liveAssignments[slot.id]);
      const incoming = getPlayer(state, state.stagedAssignments[slot.id]);
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

  return {
    STORAGE_KEY,
    createState,
    normalizeSavedState,
    normalizeRosterSort,
    normalizeClock,
    defaultRosterSortDirection,
    normalizeRosterSortDirection,
    normalizePlayer,
    uid,
    getPlayer,
    normalizeFormation,
    parseFormation,
    getSlots,
    labelsForLine,
    ensureAssignmentKeys,
    remapAssignmentsByPosition,
    accrueTime,
    toggleClock,
    nextPeriod,
    resetClock,
    resetForNewGame,
    applyFormation,
    addPlayer,
    setPlayerActive,
    removePlayer,
    stagePlayerInSlot,
    stageFieldPlayerInSlot,
    setSlotStage,
    stageSlotToBench,
    keepSlot,
    keepSwap,
    setRosterSort,
    commitSnapshot,
    closeLiveStints,
    openLiveStints,
    openStint,
    closeStint,
    addEvent,
    summarizeChanges,
    playerName,
    getVisibleAssignmentPlayerIds,
    getLivePlayerIds,
    isPlayerPlaytimeIncreasing,
    getStagedPlayerIds,
    getBenchPlayers,
    getInactivePlayers,
    comparePlayersByName,
    compareRosterPlayers,
    getRosterPlayers,
    isClockAtZero,
    isAssignmentFormationFilled,
    isStagedFormationFilled,
    hasCompleteLiveLineup,
    getPendingSubs,
    formatDuration,
    positionType,
  };
});
