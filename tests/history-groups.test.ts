import { test } from "node:test";
import assert from "node:assert/strict";
import { historyPeriod } from "../src/web/history-groups";

test("history periods use Shanghai calendar boundaries, including month/year and leap-day transitions", () => {
  const now = Date.parse("2026-10-18T00:05:00+08:00");
  assert.equal(historyPeriod(Date.parse("2026-10-17T16:00:00Z"), now), "today");
  assert.equal(historyPeriod(Date.parse("2026-10-17T15:59:59.999Z"), now), "yesterday");
  assert.equal(historyPeriod(Date.parse("2026-10-16T15:59:59Z"), now), "history");
  assert.equal(
    historyPeriod(Date.parse("2026-10-17T00:10:00+08:00"), Date.parse("2026-10-18T23:50:00+08:00")),
    "yesterday",
  );
  assert.equal(
    historyPeriod(Date.parse("2025-12-31T01:00:00+08:00"), Date.parse("2026-01-01T00:01:00+08:00")),
    "yesterday",
  );
  assert.equal(
    historyPeriod(Date.parse("2024-02-29T01:00:00+08:00"), Date.parse("2024-03-01T00:01:00+08:00")),
    "yesterday",
  );
});
