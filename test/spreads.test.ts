import test from "node:test";
import assert from "node:assert/strict";
import { availableSpreads, createSpreadReading, spreadDefinitions } from "../src/spreads.ts";
import { TarotToolRuntime } from "../src/tool-runtime.ts";
import { DEFAULT_REVERSAL_RATE } from "../src/engine.ts";

const expectedCounts = {
  "question-5": 5,
  "yes-no-1": 1,
  "yes-no-3": 3,
  "timeline-7": 7,
  "love-9": 9,
  "celtic-cross": 10,
} as const;

test("every advertised spread draws the required number of unique cards", () => {
  assert.deepEqual(new Set(availableSpreads), new Set(Object.keys(expectedCounts)));
  for (const spread of availableSpreads) {
    const reading = createSpreadReading("Тестовый вопрос", spread, { seed: `spread-${spread}` });
    assert.equal(reading.cards.length, expectedCounts[spread], spread);
    assert.equal(reading.options.reversalRate, DEFAULT_REVERSAL_RATE, spread);
    assert.equal(new Set(reading.cards.map(({ card }) => card.id)).size, expectedCounts[spread], spread);
    assert.deepEqual(reading.cards.map(({ position }) => position.id), Array.from({ length: expectedCounts[spread] }, (_, index) => index + 1));
  }
});

test("working layouts are explicitly marked as awaiting approval", () => {
  assert.equal(spreadDefinitions["timeline-7"].layoutStatus, "working-needs-approval");
  assert.equal(spreadDefinitions["love-9"].layoutStatus, "working-needs-approval");
  assert.equal(spreadDefinitions["question-5"].layoutStatus, "stable");
});

test("yes/no spreads return a bounded, internally consistent symbolic verdict", () => {
  for (const spread of ["yes-no-1", "yes-no-3"] as const) {
    const reading = createSpreadReading("Получится ли завершить задачу?", spread, { seed: `verdict-${spread}` });
    assert.ok(reading.yesNo);
    assert.ok(["yes", "no", "unclear"].includes(reading.yesNo.answer));
    assert.ok(["low", "medium", "high"].includes(reading.yesNo.confidence));
    assert.equal(reading.yesNo.votes.length, expectedCounts[spread]);
    assert.equal(reading.yesNo.score, reading.yesNo.votes.reduce((sum, vote) => sum + vote.score, 0));
    assert.ok(reading.yesNo.votes.every(({ score }) => score >= -3 && score <= 3));
  }
});

test("new spreads work with both decks and remain deterministic", () => {
  for (const deckId of ["rider-waite-smith", "full-moon-oracle"] as const) {
    const first = createSpreadReading("Вопрос", "love-9", { deckId, seed: `deck-${deckId}` });
    const second = createSpreadReading("Вопрос", "love-9", { deckId, seed: `deck-${deckId}` });
    assert.deepEqual(first, second);
    assert.equal(first.spread.deck.id, deckId);
  }
});

test("unknown spread and empty question are rejected", () => {
  assert.throws(() => createSpreadReading("Вопрос", "invented" as any), /Unknown spread/);
  assert.throws(() => createSpreadReading("  ", "question-5"), /must not be empty/);
  const runtime = new TarotToolRuntime();
  assert.throws(() => runtime.execute("tarot_read", { question: "Вопрос", spread: "invented" }), /Unknown spread/);
});

test("tool runtime applies dynamic position bounds", () => {
  const runtime = new TarotToolRuntime();
  const reading = runtime.execute("tarot_read", { question: "Вопрос", spread: "question-5", seed: "bounds-5" }) as any;
  assert.equal(reading.spread, "question-5");
  assert.equal(reading.cards.length, 5);
  assert.doesNotThrow(() => runtime.execute("tarot_clarify", { readingId: reading.readingId, position: 5 }));
  assert.throws(
    () => runtime.execute("tarot_clarify", { readingId: reading.readingId, position: 6 }),
    /between 1 and 5/,
  );
});

test("every spread supports clarifiers, follow-ups, and one anchored expansion", () => {
  for (const spread of availableSpreads) {
    const runtime = new TarotToolRuntime();
    const reading = runtime.execute("tarot_read", { question: "Исходный вопрос", spread, seed: `actions-${spread}` }) as any;
    const originalCards = new Set(reading.cards.map((card: any[]) => card[2]));
    const clarified = runtime.execute("tarot_clarify", { readingId: reading.readingId, position: 1, count: 2 }) as any;
    const followup = runtime.execute("tarot_followup", {
      readingId: reading.readingId,
      question: "Что ещё важно учесть?",
      spread: "clarity",
    }) as any;
    const expanded = runtime.execute("tarot_expand", { readingId: reading.readingId }) as any;
    const extraCards = [...clarified.cards, ...followup.cards, ...expanded.cards].map((card: any[]) => card[2]);

    assert.equal(clarified.cards.length, 2, spread);
    assert.equal(followup.cards.length, 3, spread);
    assert.equal(expanded.spread, spread === "yes-no-1" ? "yes-no-3" : spread, spread);
    assert.equal(expanded.anchor[0], expectedCounts[spread], spread);
    assert.ok(extraCards.every((card) => !originalCards.has(card)), spread);
    assert.equal(new Set(extraCards).size, extraCards.length, spread);
    assert.throws(() => runtime.execute("tarot_expand", { readingId: reading.readingId }), /already been expanded/);
  }
});

test("expansion can target a selected position and validates its bounds", () => {
  const runtime = new TarotToolRuntime();
  const reading = runtime.execute("tarot_read", { question: "Вопрос", spread: "timeline-7", seed: "expand-position" }) as any;
  const expanded = runtime.execute("tarot_expand", { readingId: reading.readingId, position: 4 }) as any;
  assert.equal(expanded.anchor[0], 4);
  assert.equal(expanded.anchor[2], reading.cards[3][2]);

  const second = runtime.execute("tarot_read", { question: "Вопрос", spread: "yes-no-1", seed: "expand-bounds" }) as any;
  assert.throws(
    () => runtime.execute("tarot_expand", { readingId: second.readingId, position: 2 }),
    /between 1 and 1/,
  );
});

test("a seeded chain of supplementary actions stays deterministic", () => {
  function runChain() {
    const runtime = new TarotToolRuntime();
    const reading = runtime.execute("tarot_read", { question: "Вопрос", spread: "love-9", seed: "action-chain" }) as any;
    const clarified = runtime.execute("tarot_clarify", { readingId: reading.readingId, position: 7 }) as any;
    const followup = runtime.execute("tarot_followup", {
      readingId: reading.readingId,
      question: "Какой подход полезен?",
      spread: "relationship",
    }) as any;
    const expanded = runtime.execute("tarot_expand", { readingId: reading.readingId, position: 8 }) as any;
    return [reading.cards, clarified.cards, followup.cards, expanded.cards];
  }

  assert.deepEqual(runChain(), runChain());
});

test("parent and child continuations share one used-card history", () => {
  const runtime = new TarotToolRuntime();
  const parent = runtime.execute("tarot_read", { question: "Вопрос", spread: "question-5", seed: "shared-history" }) as any;
  const child = runtime.execute("tarot_expand", { readingId: parent.readingId }) as any;
  const parentExtra = runtime.execute("tarot_clarify", { readingId: parent.readingId, position: 1, count: 3 }) as any;
  const childExtra = runtime.execute("tarot_clarify", { readingId: child.readingId, position: 1, count: 3 }) as any;
  const names = [...parent.cards, ...child.cards, ...parentExtra.cards, ...childExtra.cards].map((card: any[]) => card[2]);
  assert.equal(new Set(names).size, names.length);
});
