import { randomUUID } from "node:crypto";
import { drawTarotCards, type DrawnTarotCard } from "./engine.ts";
import type { TarotToolName } from "./tool-definitions.ts";
import type { DeckId } from "./decks.ts";
import { createSpreadReading, type AnySpreadReading, type SpreadId } from "./spreads.ts";

type JsonObject = Record<string, unknown>;

interface SessionState {
  reading: AnySpreadReading;
  usedCardIds: Set<string>;
  actionIndex: number;
  expanded: boolean;
}

interface SupplementaryPosition {
  id: number;
  titleRu: string;
}

const threeCardLayouts: Record<string, SupplementaryPosition[]> = {
  clarity: [
    { id: 1, titleRu: "Что уже известно" },
    { id: 2, titleRu: "Что скрыто или упущено" },
    { id: 3, titleRu: "Полезный следующий шаг" },
  ],
  decision: [
    { id: 1, titleRu: "Вариант A" },
    { id: 2, titleRu: "Вариант B" },
    { id: 3, titleRu: "Критерий решения" },
  ],
  relationship: [
    { id: 1, titleRu: "Позиция вопрошающего" },
    { id: 2, titleRu: "Другой человек или среда" },
    { id: 3, titleRu: "Общая динамика" },
  ],
  progression: [
    { id: 1, titleRu: "Источник" },
    { id: 2, titleRu: "Текущая фаза" },
    { id: 3, titleRu: "Ближайшее направление" },
  ],
};

const expansionRules: Record<SpreadId, { defaultPosition: number; childSpread: SpreadId }> = {
  "question-5": { defaultPosition: 5, childSpread: "question-5" },
  "yes-no-1": { defaultPosition: 1, childSpread: "yes-no-3" },
  "yes-no-3": { defaultPosition: 3, childSpread: "yes-no-3" },
  "timeline-7": { defaultPosition: 7, childSpread: "timeline-7" },
  "love-9": { defaultPosition: 9, childSpread: "love-9" },
  "celtic-cross": { defaultPosition: 10, childSpread: "celtic-cross" },
};

function objectArg(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  return value as JsonObject;
}

function stringArg(args: JsonObject, key: string, required = true): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string.`);
  return value.trim();
}

function booleanArg(args: JsonObject, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

function numberArg(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
  return value;
}

function integerArg(args: JsonObject, key: string, minimum: number, maximum: number, fallback?: number): number {
  const value = args[key] ?? fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

type CompactCard = [position: number, role: string, card: string, orientation: "u" | "r", meaning: string];

function orientationCode(card: DrawnTarotCard): "u" | "r" {
  return card.orientation === "reversed" ? "r" : "u";
}

function compactDraw(card: DrawnTarotCard, position: SupplementaryPosition): CompactCard {
  return [position.id, position.titleRu, card.card.nameRu, orientationCode(card), card.coreMeaning];
}

function compactReadingCard(item: AnySpreadReading["cards"][number]): CompactCard {
  return [item.position.id, item.position.titleRu, item.card.nameRu, orientationCode(item), item.coreMeaning];
}

function compactReading(reading: AnySpreadReading) {
  const layoutStatus = "layoutStatus" in reading.spread ? reading.spread.layoutStatus : undefined;
  const verdict = "yesNo" in reading && reading.yesNo
    ? [reading.yesNo.answer, reading.yesNo.confidence, reading.yesNo.score]
    : undefined;
  return {
    question: reading.question,
    deck: reading.spread.deck.id,
    spread: reading.spread.id,
    ...(layoutStatus === "working-needs-approval" ? { layoutStatus } : {}),
    cards: reading.cards.map(compactReadingCard),
    signals: reading.combinationSignals.map((signal) => [signal.positions ?? [], signal.titleRu, signal.interpretation]),
    ...(verdict ? { verdict } : {}),
  };
}

export class TarotToolRuntime {
  private readonly sessions = new Map<string, SessionState>();

  execute(name: TarotToolName | string, rawArguments: unknown): unknown {
    const args = objectArg(rawArguments);
    switch (name) {
      case "tarot_read":
      case "tarot_create_celtic_cross": return this.createReading(args);
      case "tarot_clarify":
      case "tarot_draw_clarifiers": return this.drawClarifiers(args);
      case "tarot_followup":
      case "tarot_draw_three_card_follow_up": return this.drawThreeCardFollowUp(args);
      case "tarot_expand":
      case "tarot_expand_outcome": return this.expandReading(args);
      default: throw new Error(`Unknown tarot tool: ${name}`);
    }
  }

  private createReading(args: JsonObject) {
    const deckId = stringArg(args, "deck", false) ?? stringArg(args, "deckId", false);
    const useReversals = booleanArg(args, "reversals") ?? booleanArg(args, "useReversals");
    const spread = (stringArg(args, "spread", false) ?? "celtic-cross") as SpreadId;
    const reading = createSpreadReading(stringArg(args, "question")!, spread, {
      deckId: deckId as DeckId | undefined,
      seed: stringArg(args, "seed", false),
      useReversals,
      reversalRate: numberArg(args, "reversalRate"),
    });
    const readingId = randomUUID();
    this.sessions.set(readingId, {
      reading,
      usedCardIds: new Set(reading.cards.map(({ card }) => card.id)),
      actionIndex: 0,
      expanded: false,
    });
    return { action: "read", readingId, ...compactReading(reading) };
  }

  private session(args: JsonObject): { readingId: string; state: SessionState } {
    const readingId = stringArg(args, "readingId")!;
    const state = this.sessions.get(readingId);
    if (!state) throw new Error(`Unknown or expired readingId: ${readingId}`);
    return { readingId, state };
  }

  private drawFromSession(state: SessionState, count: number, action: string): DrawnTarotCard[] {
    state.actionIndex += 1;
    const draw = drawTarotCards(count, {
      seed: `${state.reading.seed}:${state.actionIndex}:${action}`,
      deckId: state.reading.options.deckId,
      useReversals: state.reading.options.useReversals,
      reversalRate: state.reading.options.reversalRate,
      excludeCardIds: [...state.usedCardIds],
    });
    for (const { card } of draw.cards) state.usedCardIds.add(card.id);
    return draw.cards;
  }

  private drawClarifiers(args: JsonObject) {
    const { readingId, state } = this.session(args);
    const positionId = integerArg(args, "position", 1, state.reading.cards.length);
    const count = integerArg(args, "count", 1, 3, 1);
    const target = state.reading.cards[positionId - 1];
    const question = stringArg(args, "question", false) ?? `Что важно дополнительно понять о позиции «${target.position.titleRu}»?`;
    const cards = this.drawFromSession(state, count, `clarify-${positionId}`).map((card, index) => compactDraw(card, {
      id: index + 1,
      titleRu: `Уточнение ${index + 1}`,
    }));
    return {
      action: "clarify",
      readingId,
      question,
      target: compactReadingCard(target),
      cards,
    };
  }

  private drawThreeCardFollowUp(args: JsonObject) {
    const { readingId, state } = this.session(args);
    const question = stringArg(args, "question")!;
    const spread = stringArg(args, "spread")!;
    const layout = threeCardLayouts[spread];
    if (!layout) throw new Error(`Unknown three-card spread: ${spread}`);
    const cards = this.drawFromSession(state, 3, `follow-up-${spread}`).map((card, index) => compactDraw(card, layout[index]));
    return {
      action: "followup",
      readingId,
      question,
      spread,
      cards,
    };
  }

  private expandReading(args: JsonObject) {
    const { readingId: parentReadingId, state } = this.session(args);
    if (state.expanded) throw new Error("This reading has already been expanded.");
    const rule = expansionRules[state.reading.spread.id];
    const positionId = integerArg(args, "position", 1, state.reading.cards.length, rule.defaultPosition);
    const anchor = state.reading.cards[positionId - 1];
    const question = stringArg(args, "question", false) ?? `Что важно глубже понять о позиции «${anchor.position.titleRu}» и карте «${anchor.card.nameRu}» в исходном вопросе: ${state.reading.question}`;
    state.actionIndex += 1;
    const reading = createSpreadReading(question, rule.childSpread, {
      seed: `${state.reading.seed}:${state.actionIndex}:expand-${positionId}-${rule.childSpread}`,
      deckId: state.reading.options.deckId,
      useReversals: state.reading.options.useReversals,
      reversalRate: state.reading.options.reversalRate,
      excludeCardIds: [...state.usedCardIds],
    });
    state.expanded = true;
    for (const { card } of reading.cards) state.usedCardIds.add(card.id);

    const readingId = randomUUID();
    this.sessions.set(readingId, {
      reading,
      usedCardIds: state.usedCardIds,
      actionIndex: 0,
      expanded: false,
    });
    return {
      action: "expand",
      readingId,
      parentReadingId,
      anchor: compactReadingCard(anchor),
      ...compactReading(reading),
    };
  }
}
