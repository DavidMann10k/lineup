const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../lineup-core.js");

function createHarness() {
  let now = 1_000_000;
  let nextId = 0;

  const options = {
    now: () => now,
    nowIso: () => new Date(now).toISOString(),
    uid: (prefix) => `${prefix}-${(nextId += 1)}`,
  };

  return {
    state: core.createState(),
    options,
    advance(seconds) {
      now += seconds * 1000;
    },
  };
}

function addPlayers(state, names, options) {
  return names.map((name, index) => {
    const result = core.addPlayer(state, name, String(index + 1), options);
    assert.equal(result.ok, true);
    return result.player;
  });
}

function fillStagedLineup(state, players, options) {
  const slots = core.getSlots(state);
  assert.ok(players.length >= slots.length);

  slots.forEach((slot, index) => {
    const result = core.stagePlayerInSlot(state, players[index].id, slot.id, options);
    assert.equal(result.ok, true);
  });

  return slots;
}

test("normalizes soccer formation notation and rejects invalid formations", () => {
  assert.equal(core.createState().formation, "G-2-3-1");

  assert.deepEqual(core.normalizeFormation(" G - 2 - 3 - 1 "), {
    value: "G-2-3-1",
    rows: [2, 3, 1],
    hasGoalie: true,
  });
  assert.deepEqual(core.normalizeFormation("G231"), {
    value: "G-2-3-1",
    rows: [2, 3, 1],
    hasGoalie: true,
  });
  assert.deepEqual(core.normalizeFormation("231"), {
    value: "2-3-1",
    rows: [2, 3, 1],
    hasGoalie: false,
  });
  assert.deepEqual(core.normalizeFormation("4-3-3"), {
    value: "4-3-3",
    rows: [4, 3, 3],
    hasGoalie: false,
  });
  assert.deepEqual(core.getSlots("G-2-3-1").map((slot) => slot.label), [
    "GK",
    "LB",
    "RB",
    "LM",
    "CM",
    "RM",
    "CF",
  ]);

  assert.match(core.normalizeFormation("").error, /Use soccer notation/);
  assert.match(core.normalizeFormation("G-G-2-3-1").error, /only one goalie/i);
  assert.match(core.normalizeFormation("G-6-5").error, /10 or fewer outfield/);
  assert.match(core.normalizeFormation("2-x-1").error, /Use soccer notation/);
});

test("moves and removes staged-only players before the first lineup is set", () => {
  const harness = createHarness();
  const { state, options } = harness;
  const players = addPlayers(state, ["Alex", "Blair"], options);

  assert.equal(core.applyFormation(state, "G-2-3-1", options).ok, true);
  const slots = core.getSlots(state);
  const sourceSlot = slots[1];
  const targetSlot = slots[2];
  const swapSlot = slots[3];

  assert.equal(core.stagePlayerInSlot(state, players[0].id, sourceSlot.id, options).ok, true);
  assert.equal(state.stagedAssignments[sourceSlot.id], players[0].id);
  assert.equal(state.liveAssignments[sourceSlot.id] || null, null);

  assert.equal(core.stageFieldPlayerInSlot(state, players[0].id, sourceSlot.id, targetSlot.id, options).ok, true);
  assert.equal(state.stagedAssignments[sourceSlot.id], null);
  assert.equal(state.stagedAssignments[targetSlot.id], players[0].id);

  assert.equal(core.stagePlayerInSlot(state, players[1].id, swapSlot.id, options).ok, true);
  assert.equal(core.stageFieldPlayerInSlot(state, players[0].id, targetSlot.id, swapSlot.id, options).ok, true);
  assert.equal(state.stagedAssignments[targetSlot.id], players[1].id);
  assert.equal(state.stagedAssignments[swapSlot.id], players[0].id);

  assert.equal(core.stageSlotToBench(state, swapSlot.id, players[0].id, options).ok, true);
  assert.equal(state.stagedAssignments[swapSlot.id], null);
  assert.equal(core.getStagedPlayerIds(state).has(players[0].id), false);
  assert.equal(core.getStagedPlayerIds(state).has(players[1].id), true);
});

test("keeps a bench substitution when its outgoing field player is dragged to another slot", () => {
  const harness = createHarness();
  const { state, options } = harness;
  const players = addPlayers(
    state,
    ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper"],
    options,
  );

  assert.equal(core.applyFormation(state, "G-2-3-1", options).ok, true);
  const slots = fillStagedLineup(state, players, options);
  assert.equal(core.commitSnapshot(state, options).ok, true);

  const sourceSlot = slots[1];
  const targetSlot = slots[2];
  const outgoingSourcePlayer = players[1];
  const outgoingTargetPlayer = players[2];
  const benchPlayer = players[7];

  assert.equal(core.stagePlayerInSlot(state, benchPlayer.id, sourceSlot.id, options).ok, true);
  assert.equal(state.stagedAssignments[sourceSlot.id], benchPlayer.id);

  assert.equal(
    core.stageFieldPlayerInSlot(state, outgoingSourcePlayer.id, sourceSlot.id, targetSlot.id, options).ok,
    true,
  );

  assert.equal(state.stagedAssignments[sourceSlot.id], benchPlayer.id);
  assert.equal(state.stagedAssignments[targetSlot.id], outgoingSourcePlayer.id);
  assert.equal(core.getStagedPlayerIds(state).has(outgoingTargetPlayer.id), false);

  const pending = core.getPendingSubs(state);
  assert.equal(pending.length, 2);

  assert.deepEqual(
    pending.map((sub) => ({
      slot: sub.slot.id,
      incoming: sub.incoming?.id || null,
      outgoing: sub.outgoing?.id || null,
      outgoingDestination: sub.outgoingDestination?.id || null,
    })),
    [
      {
        slot: sourceSlot.id,
        incoming: benchPlayer.id,
        outgoing: outgoingSourcePlayer.id,
        outgoingDestination: targetSlot.id,
      },
      {
        slot: targetSlot.id,
        incoming: outgoingSourcePlayer.id,
        outgoing: outgoingTargetPlayer.id,
        outgoingDestination: null,
      },
    ],
  );
});

test("keeps both pending rows when a bench player is dragged onto an existing on-field swap", () => {
  const harness = createHarness();
  const { state, options } = harness;
  const players = addPlayers(
    state,
    ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper"],
    options,
  );

  assert.equal(core.applyFormation(state, "G-2-3-1", options).ok, true);
  const slots = fillStagedLineup(state, players, options);
  assert.equal(core.commitSnapshot(state, options).ok, true);

  const sourceSlot = slots[1];
  const targetSlot = slots[2];
  const outgoingSourcePlayer = players[1];
  const outgoingTargetPlayer = players[2];
  const benchPlayer = players[7];

  assert.equal(
    core.stageFieldPlayerInSlot(state, outgoingSourcePlayer.id, sourceSlot.id, targetSlot.id, options).ok,
    true,
  );
  assert.equal(core.stagePlayerInSlot(state, benchPlayer.id, sourceSlot.id, options).ok, true);

  assert.equal(state.stagedAssignments[sourceSlot.id], benchPlayer.id);
  assert.equal(state.stagedAssignments[targetSlot.id], outgoingSourcePlayer.id);
  assert.equal(core.getStagedPlayerIds(state).has(outgoingTargetPlayer.id), false);

  const pending = core.getPendingSubs(state);
  assert.equal(pending.length, 2);

  assert.deepEqual(
    pending.map((sub) => ({
      slot: sub.slot.id,
      incoming: sub.incoming?.id || null,
      outgoing: sub.outgoing?.id || null,
      outgoingDestination: sub.outgoingDestination?.id || null,
    })),
    [
      {
        slot: sourceSlot.id,
        incoming: benchPlayer.id,
        outgoing: outgoingSourcePlayer.id,
        outgoingDestination: targetSlot.id,
      },
      {
        slot: targetSlot.id,
        incoming: outgoingSourcePlayer.id,
        outgoing: outgoingTargetPlayer.id,
        outgoingDestination: null,
      },
    ],
  );
});

test("runs a full roster, lineup, clock, substitution, swap, period, and reset workflow", () => {
  const harness = createHarness();
  const { state, options } = harness;
  const players = addPlayers(
    state,
    ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indigo"],
    options,
  );

  assert.equal(core.applyFormation(state, "G-2-3-1", options).ok, true);
  const slots = fillStagedLineup(state, players, options);
  assert.equal(core.isStagedFormationFilled(state), true);

  let result = core.commitSnapshot(state, options);
  assert.equal(result.ok, true);
  assert.equal(core.hasCompleteLiveLineup(state), true);
  assert.equal(Object.keys(state.openStints).length, slots.length);
  assert.equal(state.events[0].title, "Lineup set");

  result = core.toggleClock(state, options);
  assert.equal(result.ok, true);
  assert.equal(state.clock.running, true);

  harness.advance(65);
  core.accrueTime(state, options);
  assert.equal(state.clock.elapsedSeconds, 65);
  assert.equal(players[0].totalSeconds, 65);
  assert.equal(players[0].positionSeconds.GK, 65);
  assert.equal(players[7].benchSeconds, 65);
  assert.equal(players[8].benchSeconds, 65);

  const substitutionSlot = slots[3];
  result = core.stagePlayerInSlot(state, players[7].id, substitutionSlot.id, options);
  assert.equal(result.ok, true);

  let pending = core.getPendingSubs(state);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].slot.id, substitutionSlot.id);
  assert.equal(pending[0].incoming.name, "Harper");
  assert.equal(pending[0].outgoing.name, "Drew");

  harness.advance(30);
  result = core.commitSnapshot(state, options);
  assert.equal(result.ok, true);
  assert.equal(state.liveAssignments[substitutionSlot.id], players[7].id);
  assert.deepEqual(players[3].history.at(-1), {
    position: substitutionSlot.label,
    startedAt: 0,
    endedAt: 95,
    period: 1,
  });
  assert.equal(state.openStints[substitutionSlot.id].playerId, players[7].id);
  assert.equal(state.openStints[substitutionSlot.id].startedAt, 95);

  const leftBackSlot = slots[1];
  const rightBackSlot = slots[2];
  harness.advance(20);
  result = core.stageFieldPlayerInSlot(
    state,
    state.liveAssignments[rightBackSlot.id],
    rightBackSlot.id,
    leftBackSlot.id,
    options,
  );
  assert.equal(result.ok, true);

  pending = core.getPendingSubs(state);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].slot.id, rightBackSlot.id);
  assert.equal(pending[0].pairedSlot.id, leftBackSlot.id);

  harness.advance(10);
  result = core.commitSnapshot(state, options);
  assert.equal(result.ok, true);
  assert.equal(state.liveAssignments[leftBackSlot.id], players[2].id);
  assert.equal(state.liveAssignments[rightBackSlot.id], players[1].id);
  assert.deepEqual(players[1].history.at(-1), {
    position: leftBackSlot.label,
    startedAt: 0,
    endedAt: 125,
    period: 1,
  });
  assert.deepEqual(players[2].history.at(-1), {
    position: rightBackSlot.label,
    startedAt: 0,
    endedAt: 125,
    period: 1,
  });

  const forwardSlot = slots.at(-1);
  result = core.stageSlotToBench(state, forwardSlot.id, players[6].id, options);
  assert.equal(result.ok, true);
  assert.equal(state.stagedAssignments[forwardSlot.id], null);
  assert.equal(core.commitSnapshot(state, options).ok, false);

  result = core.stagePlayerInSlot(state, players[8].id, forwardSlot.id, options);
  assert.equal(result.ok, true);
  pending = core.getPendingSubs(state);
  assert.equal(pending.some((sub) => sub.slot.id === forwardSlot.id && sub.incoming.name === "Indigo"), true);

  harness.advance(5);
  result = core.commitSnapshot(state, options);
  assert.equal(result.ok, true);
  assert.equal(state.liveAssignments[forwardSlot.id], players[8].id);
  assert.equal(players[6].history.at(-1).endedAt, 130);

  harness.advance(40);
  result = core.nextPeriod(state, options);
  assert.equal(result.ok, true);
  assert.equal(state.clock.running, false);
  assert.equal(state.clock.period, 2);
  assert.equal(state.clock.elapsedSeconds, 170);
  assert.equal(state.events[0].title, "Period advanced");
  assert.equal(state.events[0].detail, "Period 2");

  result = core.resetForNewGame(state);
  assert.equal(result.ok, true);
  assert.equal(state.players.length, 9);
  assert.equal(state.clock.elapsedSeconds, 0);
  assert.equal(state.clock.period, 1);
  assert.deepEqual(state.liveAssignments, {});
  assert.deepEqual(state.stagedAssignments, {});
  assert.deepEqual(state.openStints, {});
  assert.deepEqual(state.events, []);
  assert.equal(state.players.every((player) => player.totalSeconds === 0), true);
  assert.equal(state.players.every((player) => player.benchSeconds === 0), true);
  assert.equal(state.players.every((player) => player.history.length === 0), true);
});

test("normalizes saved state and assignment invariants", () => {
  const saved = {
    rosterSort: "name",
    players: [{ id: "player-a", name: "Zoe", active: false, totalSeconds: "12" }],
    events: Array.from({ length: 35 }, (_, index) => ({ id: `event-${index}` })),
    clock: { running: true, elapsedSeconds: "45", period: "3", lastTickAt: "5000" },
    liveAssignments: { obsolete: "player-a" },
    stagedAssignments: null,
    openStints: { obsolete: { playerId: "player-a" } },
  };

  const normalized = core.normalizeSavedState(saved);
  assert.equal(normalized.rosterSort, "playtime");
  assert.equal(normalized.rosterSortDirection, "asc");
  assert.equal(normalized.rosterSortDefaultVersion, 2);
  assert.equal(normalized.events.length, 30);
  assert.equal(normalized.clock.elapsedSeconds, 45);
  assert.equal(normalized.clock.period, 3);
  assert.equal(normalized.players[0].totalSeconds, 12);
  assert.deepEqual(normalized.stagedAssignments, {});

  assert.equal(core.ensureAssignmentKeys(normalized), true);
  assert.equal(Object.hasOwn(normalized.liveAssignments, "obsolete"), false);
  assert.equal(Object.hasOwn(normalized.openStints, "obsolete"), false);
});

test("removes duplicate and missing assignments while preserving valid players", () => {
  const state = core.createState();
  state.players = [
    { id: "player-a", name: "Alex", number: "", active: true, totalSeconds: 0, benchSeconds: 0, positionSeconds: {}, history: [] },
    { id: "player-b", name: "Blair", number: "", active: true, totalSeconds: 0, benchSeconds: 0, positionSeconds: {}, history: [] },
  ];
  state.liveAssignments = {
    "slot-1": "player-a",
    "slot-2": "player-a",
    "slot-3": "missing-player",
  };

  assert.equal(core.ensureAssignmentKeys(state), true);
  assert.equal(state.liveAssignments["slot-1"], "player-a");
  assert.equal(state.liveAssignments["slot-2"], null);
  assert.equal(state.liveAssignments["slot-3"], null);
  assert.equal(state.stagedAssignments["slot-1"], "player-a");
});
