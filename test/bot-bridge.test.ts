import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridge = fileURLToPath(new URL("../src/bot-bridge.ts", import.meta.url));

function draw(spread: string) {
  const result = spawnSync(
    process.execPath,
    [bridge],
    {
      input: `${JSON.stringify({ question: "Тестовый вопрос", spread, seed: `test-${spread}` })}\n`,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.error, undefined);
  return response.result;
}

for (const [spread, count] of [
  ["specific_5", 5],
  ["yes_no_1", 1],
  ["yes_no_3", 3],
  ["past_present_future_7", 7],
  ["relationship_9", 9],
  ["celtic_cross_10", 10],
] as const) {
  test(`${spread} draws ${count} unique cards`, () => {
    const reading = draw(spread);
    assert.equal(reading.cards.length, count);
    assert.equal(new Set(reading.cards.map((card: unknown[]) => card[2])).size, count);
    if (spread === "yes_no_1" || spread === "yes_no_3") {
      assert.ok(["yes", "no", "unclear"].includes(reading.verdict[0]));
    }
  });
}

test("working bridge layouts are marked provisional and contain combination signals", () => {
  for (const spread of ["past_present_future_7", "relationship_9"]) {
    const reading = draw(spread);
    assert.equal(reading.provisional, true);
    assert.ok(reading.signals.length > 0);
  }
});

test("bridge rejects broken request parameters", () => {
  for (const request of [
    { question: "Вопрос", spread: "invented" },
    { question: "Вопрос", spread: "specific_5", deck: "invented" },
    { question: "Вопрос", spread: "specific_5", reversals: "yes" },
  ]) {
    const result = spawnSync(process.execPath, [bridge], { input: `${JSON.stringify(request)}\n`, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout.trim()).error, /unsupported|must be/);
  }
});
