import {
  celticCrossPositions,
  createCelticCrossReading,
  DEFAULT_REVERSAL_RATE,
  drawTarotCards,
  type CelticCrossReading,
  type CombinationSignal,
  type ReadingCard,
  type ReadingOptions,
} from "./engine.ts";
import { getDeck, type DeckId } from "./decks.ts";
import { tarotReaderSystemInstruction } from "./llm-instructions.ts";
import { tarotToolDefinitions } from "./tool-definitions.ts";

export type SpreadId = "celtic-cross" | "question-5" | "yes-no-1" | "yes-no-3" | "timeline-7" | "love-9";
type NonCelticSpreadId = Exclude<SpreadId, "celtic-cross">;

export interface YesNoVerdict {
  answer: "yes" | "no" | "unclear";
  confidence: "low" | "medium" | "high";
  score: number;
  votes: Array<{ position: number; answer: "yes" | "no" | "unclear"; score: number }>;
}

export interface GenericSpreadReading {
  schemaVersion: "1.0";
  spread: {
    id: NonCelticSpreadId;
    nameRu: string;
    tradition: string;
    layoutStatus: "stable" | "working-needs-approval";
    deck: { id: DeckId; nameRu: string; system: "tarot" | "oracle" };
  };
  question: string;
  seed: string;
  options: { deckId: DeckId; useReversals: boolean; reversalRate: number };
  disclaimerRu: string;
  cards: ReadingCard[];
  combinationSignals: CombinationSignal[];
  yesNo?: YesNoVerdict;
  llmHandoff: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    tools: typeof tarotToolDefinitions;
  };
}

export type AnySpreadReading = CelticCrossReading | GenericSpreadReading;

interface PositionSeed {
  key: string;
  titleRu: string;
  meaningRu: string;
}

interface SpreadDefinition {
  id: NonCelticSpreadId;
  nameRu: string;
  layoutStatus: "stable" | "working-needs-approval";
  positions: PositionSeed[];
  links: Array<{ positions: number[]; titleRu: string; instruction: string }>;
}

export const spreadDefinitions: Record<NonCelticSpreadId, SpreadDefinition> = {
  "question-5": {
    id: "question-5",
    nameRu: "Конкретный вопрос",
    layoutStatus: "stable",
    positions: [
      { key: "situation", titleRu: "Суть вопроса", meaningRu: "Главная динамика конкретного вопроса сейчас." },
      { key: "hidden", titleRu: "Скрытый фактор", meaningRu: "То, что влияет на вопрос, но пока не вполне замечено." },
      { key: "obstacle", titleRu: "Препятствие", meaningRu: "Главное затруднение или противоречие." },
      { key: "action", titleRu: "Полезное действие", meaningRu: "Наиболее конструктивный следующий шаг." },
      { key: "outcome", titleRu: "Вероятный результат", meaningRu: "Направление при сохранении текущих условий." },
    ],
    links: [
      { positions: [1, 2], titleRu: "Видимое и скрытое", instruction: "Сопоставить явную ситуацию со скрытым фактором." },
      { positions: [3, 4], titleRu: "Препятствие и действие", instruction: "Показать, как действие отвечает на препятствие." },
      { positions: [4, 5], titleRu: "Действие и результат", instruction: "Проследить условный переход от совета к результату." },
    ],
  },
  "yes-no-1": {
    id: "yes-no-1",
    nameRu: "Да или нет — одна карта",
    layoutStatus: "stable",
    positions: [
      { key: "answer", titleRu: "Ответ и условие", meaningRu: "Символический склон ответа и главное условие." },
    ],
    links: [],
  },
  "yes-no-3": {
    id: "yes-no-3",
    nameRu: "Да или нет — три карты",
    layoutStatus: "stable",
    positions: [
      { key: "main", titleRu: "Основная тенденция", meaningRu: "Главный склон ответа." },
      { key: "modifier", titleRu: "Что меняет ответ", meaningRu: "Условие, способное усилить или изменить тенденцию." },
      { key: "result", titleRu: "Итоговый вектор", meaningRu: "Суммарное направление при текущих условиях." },
    ],
    links: [
      { positions: [1, 2, 3], titleRu: "Суммарный ответ", instruction: "Сопоставить три голоса и назвать условие, меняющее результат." },
    ],
  },
  "timeline-7": {
    id: "timeline-7",
    nameRu: "Прошлое — настоящее — будущее",
    layoutStatus: "working-needs-approval",
    positions: [
      { key: "past-root", titleRu: "Корень прошлого", meaningRu: "Исходная причина или старый фундамент ситуации." },
      { key: "past-event", titleRu: "Ключевое событие прошлого", meaningRu: "Событие или выбор, изменившие ход истории." },
      { key: "past-legacy", titleRu: "Наследие прошлого", meaningRu: "То, что прошлое принесло в настоящее." },
      { key: "present", titleRu: "Настоящее", meaningRu: "Центральное состояние ситуации сейчас." },
      { key: "near-future", titleRu: "Ближайшее развитие", meaningRu: "Первый вероятный шаг будущей динамики." },
      { key: "later-future", titleRu: "Дальнейшая тенденция", meaningRu: "Как может продолжиться развитие после ближайшего шага." },
      { key: "direction", titleRu: "Итоговое направление", meaningRu: "Главный урок или направление всей временной линии." },
    ],
    links: [
      { positions: [1, 2, 3], titleRu: "Линия прошлого", instruction: "Связать причину, событие и оставленное наследие." },
      { positions: [3, 4, 5], titleRu: "Переход через настоящее", instruction: "Показать, как прошлое входит в настоящее и ближайшее будущее." },
      { positions: [5, 6, 7], titleRu: "Линия будущего", instruction: "Прочитать будущие карты как условную последовательность, не как неизбежность." },
    ],
  },
  "love-9": {
    id: "love-9",
    nameRu: "Любовь и отношения",
    layoutStatus: "working-needs-approval",
    positions: [
      { key: "self", titleRu: "Вопрошающий", meaningRu: "Позиция, границы и способ участия вопрошающего." },
      { key: "other", titleRu: "Другой человек", meaningRu: "Наблюдаемое поведение и роль другой стороны, без чтения скрытых мыслей как факта." },
      { key: "foundation", titleRu: "Основание связи", meaningRu: "На чём фактически держатся отношения." },
      { key: "self-needs", titleRu: "Потребности вопрошающего", meaningRu: "Что вопрошающий ищет или защищает в этой связи." },
      { key: "other-stance", titleRu: "Наблюдаемая позиция другого", meaningRu: "Как позиция другой стороны проявляется в действиях и доступных сигналах." },
      { key: "bond", titleRu: "Что объединяет", meaningRu: "Общая ценность, притяжение или совместный ресурс." },
      { key: "tension", titleRu: "Главное напряжение", meaningRu: "Конфликт, несовпадение или уязвимое место связи." },
      { key: "advice", titleRu: "Полезный подход", meaningRu: "Действие или граница, которые проясняют отношения." },
      { key: "direction", titleRu: "Вероятное направление", meaningRu: "Куда движется связь при сохранении текущей динамики." },
    ],
    links: [
      { positions: [1, 2], titleRu: "Две позиции", instruction: "Сопоставить участие сторон без приписывания скрытых мыслей." },
      { positions: [3, 6], titleRu: "Основание и связь", instruction: "Показать, совпадает ли основание отношений с тем, что объединяет." },
      { positions: [4, 5], titleRu: "Потребности и наблюдаемая позиция", instruction: "Сравнить потребности вопрошающего с доступными проявлениями другой стороны." },
      { positions: [7, 8, 9], titleRu: "Напряжение, подход и направление", instruction: "Связать проблему, полезный ответ на неё и условный результат." },
    ],
  },
};

const positiveMarkers = ["успех", "возможност", "поддерж", "ясн", "рост", "надежд", "радост", "гармон", "любов", "восстанов", "освобожд", "решени", "достиж", "удач", "признан", "обновлен", "открыва", "помощ", "устойчив", "созид", "довер"];
const negativeMarkers = ["страх", "потер", "конфликт", "задерж", "истощ", "разруш", "кризис", "блок", "боль", "обман", "зависим", "огранич", "тревог", "нестабил", "разрыв", "утрат", "наказ", "тупик", "дефицит", "нехват", "угроз", "застой"];

function yesNoScore(card: ReadingCard): number {
  const text = `${card.keywords.join(" ")} ${card.coreMeaning}`.toLowerCase();
  const positive = positiveMarkers.filter((marker) => text.includes(marker)).length;
  const negative = negativeMarkers.filter((marker) => text.includes(marker)).length;
  return Math.max(-3, Math.min(3, positive - negative));
}

function answerForScore(score: number): "yes" | "no" | "unclear" {
  return score > 0 ? "yes" : score < 0 ? "no" : "unclear";
}

function buildVerdict(cards: ReadingCard[]): YesNoVerdict {
  const votes = cards.map((card) => {
    const score = yesNoScore(card);
    return { position: card.position.id, answer: answerForScore(score), score };
  });
  const score = votes.reduce((sum, vote) => sum + vote.score, 0);
  const answer = answerForScore(score);
  const agreement = votes.filter((vote) => vote.answer === answer).length;
  const confidence = answer === "unclear" || Math.abs(score) === 1 ? "low" : Math.abs(score) >= 4 || agreement === cards.length ? "high" : "medium";
  return { answer, confidence, score, votes };
}

function buildSignals(definition: SpreadDefinition, cards: ReadingCard[]): CombinationSignal[] {
  return definition.links.map((link) => ({
    kind: "position-pair",
    positions: link.positions,
    titleRu: link.titleRu,
    interpretation: `${link.instruction} Карты: ${link.positions.map((position) => cards[position - 1].card.nameRu).join(" → ")}.`,
  }));
}

function buildHandoff(reading: Omit<GenericSpreadReading, "llmHandoff">) {
  const rows = reading.cards.map((item) => `${item.position.id}. ${item.position.titleRu}: ${item.card.nameRu}, ${item.orientation}; ${item.coreMeaning}`);
  const verdict = reading.yesNo ? `Symbolic yes/no verdict: ${reading.yesNo.answer}, confidence ${reading.yesNo.confidence}, score ${reading.yesNo.score}.` : "";
  return {
    messages: [
      { role: "system" as const, content: tarotReaderSystemInstruction },
      { role: "user" as const, content: [`Question: ${reading.question}`, `Deck: ${reading.spread.deck.nameRu}`, `Spread: ${reading.spread.nameRu}`, verdict, ...rows].filter(Boolean).join("\n") },
    ],
    tools: tarotToolDefinitions,
  };
}

function createGenericSpreadReading(question: string, spreadId: NonCelticSpreadId, options: ReadingOptions = {}): GenericSpreadReading {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new Error("Question must not be empty.");
  const definition = spreadDefinitions[spreadId];
  const deck = getDeck(options.deckId);
  const useReversals = options.useReversals ?? true;
  const reversalRate = options.reversalRate ?? DEFAULT_REVERSAL_RATE;
  const draw = drawTarotCards(definition.positions.length, options);
  const cards: ReadingCard[] = draw.cards.map((drawnCard, index) => {
    const seed = definition.positions[index];
    const position = { id: index + 1, ...seed, layout: { x: index, y: 0, rotationDegrees: 0 } };
    return {
      ...drawnCard,
      position,
      positionalReading: `В позиции «${position.titleRu}»: ${drawnCard.coreMeaning} Фокус позиции: ${position.meaningRu}`,
    };
  });
  const partial = {
    schemaVersion: "1.0" as const,
    spread: {
      id: definition.id,
      nameRu: definition.nameRu,
      tradition: "Project-defined reflective spread.",
      layoutStatus: definition.layoutStatus,
      deck: { id: deck.id, nameRu: deck.nameRu, system: deck.system },
    },
    question: normalizedQuestion,
    seed: draw.seed,
    options: { deckId: deck.id, useReversals, reversalRate },
    disclaimerRu: "Расклад предназначен для символической рефлексии и развлечения; он не устанавливает факты и не заменяет профессиональную помощь.",
    cards,
    combinationSignals: buildSignals(definition, cards),
    ...((spreadId === "yes-no-1" || spreadId === "yes-no-3") ? { yesNo: buildVerdict(cards) } : {}),
  };
  return { ...partial, llmHandoff: buildHandoff(partial) };
}

export function createSpreadReading(question: string, spreadId: SpreadId = "celtic-cross", options: ReadingOptions = {}): AnySpreadReading {
  if (spreadId === "celtic-cross") return createCelticCrossReading(question, options);
  const definition = spreadDefinitions[spreadId];
  if (!definition) throw new Error(`Unknown spread: ${spreadId}`);
  return createGenericSpreadReading(question, spreadId, options);
}

export const availableSpreads = ["question-5", "yes-no-1", "yes-no-3", "timeline-7", "love-9", "celtic-cross"] as const;

if (celticCrossPositions.length !== 10) throw new Error("Celtic Cross must contain ten positions.");
