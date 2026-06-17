const assert = require("node:assert/strict");
const test = require("node:test");

const matchLogExport = require("../match-log-export.js");

test("formats a user-friendly match log export", () => {
  const state = {
    formation: "G-2-3-1",
    events: [
      {
        id: "event-2",
        title: "Period advanced",
        detail: "Period 2",
        period: 2,
        clock: 125,
        at: "2026-06-16T23:15:00.000Z",
      },
      {
        id: "event-1",
        title: "Lineup set",
        detail: "GK: Alex to Blair, LB: Casey to Drew",
        period: 1,
        clock: 0,
        at: "2026-06-16T23:00:00.000Z",
      },
    ],
  };

  assert.equal(
    matchLogExport.formatMatchLogExport(state, { nowIso: () => "2026-06-16T23:20:00.000Z" }),
    [
      "Lineup Match Log",
      "Generated: 2026-06-16 23:20 UTC",
      "Formation: G-2-3-1",
      "Entries: 2",
      "",
      "P1 0:00 - Lineup set",
      "  GK: Alex to Blair, LB: Casey to Drew",
      "  Logged: 2026-06-16 23:00 UTC",
      "",
      "P2 2:05 - Period advanced",
      "  Period 2",
      "  Logged: 2026-06-16 23:15 UTC",
      "",
    ].join("\n"),
  );

  state.events = [];
  assert.match(matchLogExport.formatMatchLogExport(state), /No match log entries\./);
});

test("builds dated match log filenames", () => {
  assert.equal(
    matchLogExport.buildMatchLogFilename({ now: () => Date.parse("2026-06-16T23:20:00.000Z") }),
    "lineup-match-log-2026-06-16.txt",
  );
});

test("exports match logs through browser download APIs", () => {
  const clicked = [];
  const appended = [];
  const revoked = [];
  const urls = [];
  const blobs = [];
  const links = [];
  const document = {
    body: {
      append(link) {
        appended.push(link);
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      const link = {
        href: "",
        download: "",
        click() {
          clicked.push(this.download);
        },
        remove() {
          links.push(this);
        },
      };
      return link;
    },
  };
  class BlobFake {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
      blobs.push(this);
    }
  }
  const URL = {
    createObjectURL(blob) {
      urls.push(blob);
      return "blob:match-log";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };

  const result = matchLogExport.exportMatchLog(
    {
      formation: "2-3-1",
      events: [{ title: "Lineup set", detail: "CM: Open to Alex", period: 1, clock: 0 }],
    },
    {
      Blob: BlobFake,
      document,
      URL,
      now: () => Date.parse("2026-06-16T23:20:00.000Z"),
      nowIso: () => "2026-06-16T23:20:00.000Z",
      setTimeout: (callback) => callback(),
    },
  );

  assert.deepEqual(result, { ok: true, filename: "lineup-match-log-2026-06-16.txt" });
  assert.equal(blobs.length, 1);
  assert.match(blobs[0].parts[0], /Lineup Match Log/);
  assert.equal(blobs[0].options.type, "text/plain;charset=utf-8");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].href, "blob:match-log");
  assert.equal(clicked[0], "lineup-match-log-2026-06-16.txt");
  assert.equal(links[0], appended[0]);
  assert.equal(urls[0], blobs[0]);
  assert.deepEqual(revoked, ["blob:match-log"]);

  assert.deepEqual(matchLogExport.exportMatchLog({ events: [] }), { ok: false, reason: "empty-log" });
});
