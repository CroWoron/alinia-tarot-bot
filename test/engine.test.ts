import test from "node:test";
import assert from "node:assert/strict";
import { tarotDeck } from "../src/cards.ts";
import { celticCrossPositions, createCelticCrossReading, DEFAULT_REVERSAL_RATE, drawTarotCards } from "../src/engine.ts";
import { fullMoonOracleDeck } from "../src/full-moon-oracle.ts";

test("deck has 78 unique cards", () => {
  assert.equal(tarotDeck.length, 78);
  assert.equal(new Set(tarotDeck.map((card) => card.id)).size, 78);
});

test("deck composition contains 22 majors and 14 cards in every suit", () => {
  assert.equal(tarotDeck.filter(({ arcana }) => arcana === "major").length, 22);
  for (const suit of ["wands", "cups", "swords", "pentacles"]) {
    assert.equal(tarotDeck.filter((card) => card.suit === suit).length, 14);
  }
});

test("Celtic Cross layout keeps canonical position order and crossing rotation", () => {
  assert.deepEqual(celticCrossPositions.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(celticCrossPositions[1].key, "challenge");
  assert.equal(celticCrossPositions[1].layout.rotationDegrees, 90);
  assert.ok(celticCrossPositions.filter(({ id }) => id !== 2).every(({ layout }) => layout.rotationDegrees === 0));
});

test("reading draws ten unique cards and six positional pairs", () => {
  const reading = createCelticCrossReading("What should I understand?", { seed: "test-seed" });
  assert.equal(reading.cards.length, 10);
  assert.equal(new Set(reading.cards.map(({ card }) => card.id)).size, 10);
  assert.equal(reading.combinationSignals.filter(({ kind }) => kind === "position-pair").length, 6);
});

test("same seed and options produce the same symbolic reading", () => {
  const first = createCelticCrossReading("Question", { seed: "repeatable" });
  const second = createCelticCrossReading("Question", { seed: "repeatable" });
  assert.deepEqual(first, second);
});

test("reversals can be disabled", () => {
  const reading = createCelticCrossReading("Question", { seed: "upright", useReversals: false });
  assert.ok(reading.cards.every(({ orientation }) => orientation === "upright"));
});

test("reversal rate boundaries are respected", () => {
  const upright = drawTarotCards(78, { seed: "rate-zero", reversalRate: 0 });
  const reversed = drawTarotCards(78, { seed: "rate-one", reversalRate: 1 });
  const disabled = drawTarotCards(78, { seed: "disabled", reversalRate: 1, useReversals: false });
  assert.ok(upright.cards.every(({ orientation }) => orientation === "upright"));
  assert.ok(reversed.cards.every(({ orientation }) => orientation === "reversed"));
  assert.ok(disabled.cards.every(({ orientation }) => orientation === "upright"));
});

test("default reversal model rotates one fifth of each physical-equivalent deck", () => {
  const tarot = drawTarotCards(tarotDeck.length, { seed: "default-rate-tarot" });
  const oracle = drawTarotCards(fullMoonOracleDeck.length, { deckId: "full-moon-oracle", seed: "default-rate-oracle" });
  assert.equal(DEFAULT_REVERSAL_RATE, 0.2);
  assert.equal(tarot.cards.filter(({ orientation }) => orientation === "reversed").length, 16);
  assert.equal(oracle.cards.filter(({ orientation }) => orientation === "reversed").length, 22);
});

test("custom reversal rate fixes the deck composition before drawing", () => {
  const draw = drawTarotCards(tarotDeck.length, { seed: "custom-rate", reversalRate: 1 / 3 });
  assert.equal(draw.cards.filter(({ orientation }) => orientation === "reversed").length, 26);
});

test("excluded cards are never drawn and insufficient deck space is rejected", () => {
  const allowedCard = tarotDeck[0];
  const excludedCardIds = tarotDeck.slice(1).map(({ id }) => id);
  const draw = drawTarotCards(1, { seed: "exclusions", excludeCardIds: excludedCardIds });
  assert.equal(draw.cards[0].card.id, allowedCard.id);
  assert.throws(
    () => drawTarotCards(2, { seed: "too-many", excludeCardIds: excludedCardIds }),
    /Not enough cards remain/,
  );
  assert.throws(() => drawTarotCards(1, { excludeCardIds: ["not-a-card"] }), /Unknown card id/);
});

test("draw count and reading input boundaries are validated", () => {
  assert.throws(() => drawTarotCards(0), /positive integer/);
  assert.throws(() => drawTarotCards(1.5), /positive integer/);
  assert.throws(() => drawTarotCards(1, { reversalRate: -0.01 }), /between 0 and 1/);
  const reading = createCelticCrossReading("  Конкретный вопрос?  ", { seed: "trim" });
  assert.equal(reading.question, "Конкретный вопрос?");
});

test("LLM handoff contains system constraints and the supplied question", () => {
  const reading = createCelticCrossReading("Стоит ли менять работу?", { seed: "handoff" });
  assert.equal(reading.llmHandoff.messages[0].role, "system");
  assert.match(reading.llmHandoff.messages[0].content, /orientation: "u"=upright/);
  assert.match(reading.llmHandoff.messages[0].content, /Reply in Russian/);
  assert.match(reading.llmHandoff.messages[0].content, /Общая картина/);
  assert.match(reading.llmHandoff.messages[1].content, /Стоит ли менять работу\?/);
  assert.equal(reading.llmHandoff.tools.length, 4);
});

test("invalid input is rejected", () => {
  assert.throws(() => createCelticCrossReading("  "), /must not be empty/);
  assert.throws(() => createCelticCrossReading("Question", { reversalRate: 2 }), /between 0 and 1/);
});
