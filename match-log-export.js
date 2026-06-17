(function initMatchLogExport(global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(global);
    return;
  }

  global.MatchLogExport = factory(global);
})(typeof globalThis !== "undefined" ? globalThis : this, function createMatchLogExport(global) {
  "use strict";

  function exportMatchLog(state, options = {}) {
    if (!state?.events?.length) return { ok: false, reason: "empty-log" };

    return downloadTextFile(
      buildMatchLogFilename(options),
      formatMatchLogExport(state, options),
      options,
    );
  }

  function formatMatchLogExport(state, options = {}) {
    const events = Array.isArray(state.events) ? state.events.slice().reverse() : [];
    const lines = [
      "Lineup Match Log",
      `Generated: ${formatExportTimestamp(optionNowIso(options))}`,
      `Formation: ${state.formation || "Unknown"}`,
      `Entries: ${events.length}`,
      "",
    ];

    if (!events.length) {
      lines.push("No match log entries.");
      return `${lines.join("\n")}\n`;
    }

    for (const event of events) {
      lines.push(`P${event.period || 1} ${formatDuration(event.clock)} - ${event.title || "Event"}`);
      const detail = String(event.detail ?? "").trim();
      if (detail) lines.push(`  ${detail}`);
      if (event.at) lines.push(`  Logged: ${formatExportTimestamp(event.at)}`);
      lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  function buildMatchLogFilename(options = {}) {
    const stamp = optionDate(options).toISOString().slice(0, 10);
    return `lineup-match-log-${stamp}.txt`;
  }

  function downloadTextFile(filename, contents, options = {}) {
    const doc = options.document || global.document;
    const urlApi = options.URL || global.URL;
    const BlobCtor = options.Blob || global.Blob;
    if (!doc || !urlApi || !BlobCtor) return { ok: false, reason: "missing-browser-apis" };

    const blob = new BlobCtor([contents], { type: "text/plain;charset=utf-8" });
    const url = urlApi.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    doc.body.append(link);
    link.click();
    link.remove();
    const schedule = options.setTimeout || global.setTimeout || ((callback) => callback());
    schedule(() => urlApi.revokeObjectURL(url), 0);
    return { ok: true, filename };
  }

  function optionNowIso(options) {
    if (typeof options.nowIso === "function") return options.nowIso();
    return optionDate(options).toISOString();
  }

  function optionDate(options) {
    const value = typeof options.now === "function" ? options.now() : Date.now();
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function formatExportTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value || "");

    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remaining = safeSeconds % 60;

    return `${minutes}:${String(remaining).padStart(2, "0")}`;
  }

  return {
    exportMatchLog,
    formatMatchLogExport,
    buildMatchLogFilename,
    downloadTextFile,
    formatExportTimestamp,
    formatDuration,
  };
});
