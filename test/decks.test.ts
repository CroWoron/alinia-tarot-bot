import test from "node:test";
import assert from "node:assert/strict";
import { fullMoonOracleDeck } from "../src/full-moon-oracle.ts";
import { createCelticCrossReading, drawTarotCards } from "../src/engine.ts";
import { TarotToolRuntime } from "../src/tool-runtime.ts";

test("Full Moon Oracle has 108 unique, complete cards", () => {
  assert.equal(fullMoonOracleDeck.length, 108);
  assert.equal(new Set(fullMoonOracleDeck.map(({ id }) => id)).size, 108);
  assert.equal(fullMoonOracleDeck[0].nameRu, "Всадник");
  assert.equal(fullMoonOracleDeck[107].nameRu, "Ведьма");
  assert.ok(fullMoonOracleDeck.every((card) =>
    card.arcana === "oracle" &&
    card.upright.keywords.length > 0 && card.upright.text.length > 20 &&
    card.reversed.keywords.length > 0 && card.reversed.text.length > 20
  ));
});

test("Full Moon Oracle reading uses only the selected deck and omits tarot-only patterns", () => {
  const reading = createCelticCrossReading("Что скрыто в ситуации?", {
    deckId: "full-moon-oracle",
    seed: "full-moon-reading",
  });
  assert.equal(reading.spread.deck.id, "full-moon-oracle");
  assert.equal(reading.spread.deck.system, "oracle");
  assert.equal(reading.options.deckId, "full-moon-oracle");
  assert.ok(reading.cards.every(({ card }) => card.id.startsWith("full-moon-") && card.arcana === "oracle"));
  assert.ok(reading.combinationSignals.every(({ titleRu }) =>
    titleRu !== "Высокая доля Старших арканов" &&
    titleRu !== "Практический масштаб" &&
    titleRu !== "Доминирующая масть"
  ));
  assert.match(reading.llmHandoff.messages[1].content, /Оракул Полнолуния/);
});

test("deck-specific exclusions and unknown deck identifiers are validated", () => {
  assert.throws(
    () => drawTarotCards(1, { deckId: "full-moon-oracle", excludeCardIds: ["00-fool"] }),
    /Unknown card id/,
  );
  assert.throws(
    () => createCelticCrossReading("Вопрос", { deckId: "unknown" as any }),
    /Unknown deckId/,
  );
});

test("tool follow-ups remain in the Full Moon Oracle session", () => {
  const runtime = new TarotToolRuntime();
  const created = runtime.execute("tarot_read", {
    question: "Что требует внимания?",
    deck: "full-moon-oracle",
    seed: "oracle-session",
  }) as any;
  const originalCards = new Set(created.cards.map((item: any) => item[2]));
  const clarified = runtime.execute("tarot_clarify", {
    readingId: created.readingId,
    position: 4,
    count: 3,
  }) as any;
  assert.ok(clarified.cards.every((item: any) => !originalCards.has(item[2])));
  const expanded = runtime.execute("tarot_expand", { readingId: created.readingId }) as any;
  assert.equal(expanded.deck, "full-moon-oracle");
  assert.equal(expanded.cards.length, 10);
});

test("sensitive oracle symbols are framed without diagnosis or supernatural certainty", () => {
  const illness = fullMoonOracleDeck.find(({ nameRu }) => nameRu === "Болезни")!;
  const evilEye = fullMoonOracleDeck.find(({ nameRu }) => nameRu === "Сглаз")!;
  const witch = fullMoonOracleDeck.find(({ nameRu }) => nameRu === "Ведьма")!;
  assert.match(illness.upright.text, /не является диагнозом/);
  assert.match(evilEye.upright.text, /проверить обычные причины и факты/);
  assert.match(witch.reversed.text, /сверхъестественных возможностей как факта/);
});
