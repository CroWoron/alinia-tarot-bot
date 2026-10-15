import test from "node:test";
import assert from "node:assert/strict";
import { TarotToolRuntime } from "../src/tool-runtime.ts";
import { tarotToolDefinitions } from "../src/tool-definitions.ts";

test("tool definitions expose four unique strict object schemas", () => {
  const names = tarotToolDefinitions.map((tool) => tool.function.name);
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, names.length);
  assert.ok(tarotToolDefinitions.every((tool) => tool.function.parameters.additionalProperties === false));
  const clarifiers = tarotToolDefinitions.find((tool) => tool.function.name === "tarot_clarify")!;
  assert.equal((clarifiers.function.parameters.properties.count as any).maximum, 3);
  const create = tarotToolDefinitions.find((tool) => tool.function.name === "tarot_read")!;
  assert.deepEqual((create.function.parameters.properties.deck as any).enum, ["rider-waite-smith", "full-moon-oracle"]);
  assert.deepEqual((create.function.parameters.properties.spread as any).enum, [
    "question-5", "yes-no-1", "yes-no-3", "timeline-7", "love-9", "celtic-cross",
  ]);
  const expand = tarotToolDefinitions.find((tool) => tool.function.name === "tarot_expand")!;
  assert.equal((expand.function.parameters.properties.position as any).maximum, 10);
});

test("tool runtime preserves session state and never repeats used cards", () => {
  const runtime = new TarotToolRuntime();
  const created = runtime.execute("tarot_read", {
    question: "Что мне важно понять?",
    seed: "tool-session",
  }) as any;
  const initialCards = new Set(created.cards.map((item: any) => item[2]));

  const clarified = runtime.execute("tarot_clarify", {
    readingId: created.readingId,
    position: 2,
    count: 2,
  }) as any;
  const clarificationCards = clarified.cards.map((item: any) => item[2]);
  assert.equal(clarificationCards.length, 2);
  assert.ok(clarificationCards.every((card: string) => !initialCards.has(card)));

  const followUp = runtime.execute("tarot_followup", {
    readingId: created.readingId,
    question: "Какой следующий шаг наиболее полезен?",
    spread: "clarity",
  }) as any;
  const followUpCards = followUp.cards.map((item: any) => item[2]);
  assert.ok(followUpCards.every((card: string) => !initialCards.has(card) && !clarificationCards.includes(card)));
});

test("outcome expansion creates a child reading and can happen only once", () => {
  const runtime = new TarotToolRuntime();
  const created = runtime.execute("tarot_read", { question: "Вопрос", seed: "outcome" }) as any;
  const expanded = runtime.execute("tarot_expand", { readingId: created.readingId }) as any;
  assert.equal(expanded.cards.length, 10);
  assert.notEqual(expanded.readingId, created.readingId);
  const parentCards = new Set(created.cards.map((item: any) => item[2]));
  assert.ok(expanded.cards.every((item: any) => !parentCards.has(item[2])));
  const childClarifier = runtime.execute("tarot_clarify", {
    readingId: expanded.readingId,
    position: 10,
  }) as any;
  assert.ok(!parentCards.has(childClarifier.cards[0][2]));
  assert.throws(
    () => runtime.execute("tarot_expand", { readingId: created.readingId }),
    /already been expanded/,
  );
});

test("tool input validation rejects invalid sessions and excessive clarifiers", () => {
  const runtime = new TarotToolRuntime();
  assert.throws(
    () => runtime.execute("tarot_clarify", { readingId: "missing", position: 1 }),
    /Unknown or expired/,
  );
  const created = runtime.execute("tarot_read", { question: "Вопрос" }) as any;
  assert.throws(
    () => runtime.execute("tarot_clarify", { readingId: created.readingId, position: 1, count: 4 }),
    /between 1 and 3/,
  );
});

test("tool runtime rejects malformed arguments and unknown actions", () => {
  const runtime = new TarotToolRuntime();
  assert.throws(() => runtime.execute("missing_tool", {}), /Unknown tarot tool/);
  assert.throws(() => runtime.execute("tarot_read", null), /must be an object/);
  assert.throws(
    () => runtime.execute("tarot_read", { question: "Вопрос", reversals: "yes" }),
    /must be a boolean/,
  );
  assert.throws(
    () => runtime.execute("tarot_create_celtic_cross", { question: "Вопрос", reversalRate: "often" }),
    /must be a finite number/,
  );
});

test("position and spread boundaries are enforced", () => {
  const runtime = new TarotToolRuntime();
  const created = runtime.execute("tarot_read", { question: "Вопрос", seed: "bounds" }) as any;
  for (const position of [0, 11, 1.5]) {
    assert.throws(
      () => runtime.execute("tarot_clarify", { readingId: created.readingId, position }),
      /between 1 and 10/,
    );
  }
  assert.throws(
    () => runtime.execute("tarot_followup", {
      readingId: created.readingId,
      question: "Уточнение",
      spread: "invented",
    }),
    /Unknown three-card spread/,
  );
});

test("clarifier result points to the requested original position", () => {
  const runtime = new TarotToolRuntime();
  const created = runtime.execute("tarot_read", { question: "Вопрос", seed: "target" }) as any;
  const clarified = runtime.execute("tarot_clarify", {
    readingId: created.readingId,
    position: 6,
    question: "Что именно приближается?",
  }) as any;
  assert.equal(clarified.target[0], 6);
  assert.equal(clarified.target[2], created.cards[5][2]);
  assert.equal(clarified.question, "Что именно приближается?");
  assert.equal(clarified.cards[0][1], "Уточнение 1");
});

test("compact tool result is much smaller than the full engine reading", () => {
  const runtime = new TarotToolRuntime();
  const compact = runtime.execute("tarot_read", { question: "Вопрос", deck: "full-moon-oracle" }) as any;
  assert.equal(compact.cards.length, 10);
  assert.equal(compact.cards[0].length, 5);
  assert.equal("llmHandoff" in compact, false);
  assert.ok(JSON.stringify(compact).length < 9000);
});

test("legacy tool names remain accepted but are not advertised", () => {
  const runtime = new TarotToolRuntime();
  const result = runtime.execute("tarot_create_celtic_cross", { question: "Вопрос", seed: "legacy" }) as any;
  assert.equal(result.action, "read");
  assert.ok(result.readingId);
  assert.ok(tarotToolDefinitions.every((tool) => tool.function.name !== "tarot_create_celtic_cross"));
});
