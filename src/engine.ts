import { randomBytes } from "node:crypto";
import { type Element, type Orientation, type TarotCard } from "./cards.ts";
import { getDeck, type DeckId } from "./decks.ts";
import { tarotReaderSystemInstruction } from "./llm-instructions.ts";
import { tarotToolDefinitions } from "./tool-definitions.ts";

export interface CelticCrossPosition {
  id: number;
  key: string;
  titleRu: string;
  meaningRu: string;
  layout: { x: number; y: number; rotationDegrees: number };
}

export interface DrawnTarotCard {
  card: Pick<TarotCard, "id" | "name" | "nameRu" | "arcana" | "element" | "suit" | "rank" | "court">;
  orientation: Orientation;
  keywords: string[];
  coreMeaning: string;
}

export interface ReadingCard extends DrawnTarotCard {
  position: CelticCrossPosition;
  positionalReading: string;
}

export interface CombinationSignal {
  kind: "position-pair" | "spread-pattern";
  positions?: number[];
  titleRu: string;
  interpretation: string;
}

export interface CelticCrossReading {
  schemaVersion: "1.0";
  spread: {
    id: "celtic-cross";
    nameRu: "Кельтский крест";
    tradition: string;
    deck: { id: DeckId; nameRu: string; system: "tarot" | "oracle" };
  };
  question: string;
  seed: string;
  options: { deckId: DeckId; useReversals: boolean; reversalRate: number };
  disclaimerRu: string;
  cards: ReadingCard[];
  combinationSignals: CombinationSignal[];
  llmHandoff: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    tools: typeof tarotToolDefinitions;
  };
}

export interface ReadingOptions {
  deckId?: DeckId;
  seed?: string;
  useReversals?: boolean;
  reversalRate?: number;
  excludeCardIds?: string[];
}

export interface DrawOptions extends ReadingOptions {
  seed?: string;
}

export const DEFAULT_REVERSAL_RATE = 0.2;

export const celticCrossPositions: CelticCrossPosition[] = [
  { id: 1, key: "present", titleRu: "Суть ситуации", meaningRu: "Общая атмосфера и то, что непосредственно окружает вопрос сейчас.", layout: { x: 0, y: 0, rotationDegrees: 0 } },
  { id: 2, key: "challenge", titleRu: "Пересекающая сила", meaningRu: "Главное препятствие, противоречие или сила, пересекающая текущую ситуацию.", layout: { x: 0, y: 0, rotationDegrees: 90 } },
  { id: 3, key: "crown", titleRu: "Корона", meaningRu: "Сознательная цель, идеал или лучшее, чего можно достичь при данных условиях.", layout: { x: 0, y: -2, rotationDegrees: 0 } },
  { id: 4, key: "foundation", titleRu: "Основание", meaningRu: "Корень вопроса, уже сложившаяся основа и глубинная причина.", layout: { x: 0, y: 2, rotationDegrees: 0 } },
  { id: 5, key: "past", titleRu: "Уходящее влияние", meaningRu: "Недавнее прошлое или влияние, которое сейчас теряет силу.", layout: { x: -2, y: 0, rotationDegrees: 0 } },
  { id: 6, key: "near-future", titleRu: "Ближайшее будущее", meaningRu: "Влияние, которое уже входит в действие в ближайшей перспективе.", layout: { x: 2, y: 0, rotationDegrees: 0 } },
  { id: 7, key: "self", titleRu: "Позиция вопрошающего", meaningRu: "Отношение человека к вопросу, его состояние и способ участия.", layout: { x: 4, y: 3, rotationDegrees: 0 } },
  { id: 8, key: "environment", titleRu: "Окружение", meaningRu: "Внешняя среда, другие люди и обстоятельства вокруг вопроса.", layout: { x: 4, y: 1, rotationDegrees: 0 } },
  { id: 9, key: "hopes-fears", titleRu: "Надежды и страхи", meaningRu: "Ожидания и опасения, которые могут быть двумя сторонами одного желания.", layout: { x: 4, y: -1, rotationDegrees: 0 } },
  { id: 10, key: "outcome", titleRu: "Вероятный итог", meaningRu: "Направление событий при сохранении текущей динамики, а не неизбежный приговор.", layout: { x: 4, y: -3, rotationDegrees: 0 } },
];

const relationSpecs = [
  { positions: [1, 2], titleRu: "Ядро и препятствие", lead: "Центральная ситуация встречается с пересекающей силой" },
  { positions: [3, 4], titleRu: "Цель и основание", lead: "Сознательная цель соотносится с глубинным основанием" },
  { positions: [5, 6], titleRu: "Переход от прошлого к ближайшему будущему", lead: "Уходящее влияние переходит в ближайшую динамику" },
  { positions: [7, 8], titleRu: "Человек и окружение", lead: "Внутренняя позиция взаимодействует с внешней средой" },
  { positions: [9, 10], titleRu: "Ожидания и итог", lead: "Надежды или страхи окрашивают восприятие вероятного итога" },
  { positions: [6, 10], titleRu: "Траектория", lead: "Ближайшее развитие задаёт путь к вероятному итогу" },
] as const;

const suitLabels: Record<string, string> = {
  wands: "Жезлы — действие, воля и творчество",
  cups: "Кубки — чувства, отношения и воображение",
  swords: "Мечи — мысли, решения и конфликты",
  pentacles: "Пентакли — ресурсы, тело и практические результаты",
};

const rankLabels: Record<string, string> = {
  ace: "Тузы", two: "Двойки", three: "Тройки", four: "Четвёрки", five: "Пятёрки",
  six: "Шестёрки", seven: "Семёрки", eight: "Восьмёрки", nine: "Девятки", ten: "Десятки",
  page: "Пажи", knight: "Рыцари", queen: "Королевы", king: "Короли",
};

const elementLabels: Record<Element, string> = {
  spirit: "архетипический уровень",
  fire: "действие и воля",
  water: "чувства и связь",
  air: "мысль и решение",
  earth: "практика и устойчивость",
};

function hashSeed(seed: string): () => number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed)();
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeckFrom(sourceDeck: TarotCard[], random: () => number): TarotCard[] {
  const deck = [...sourceDeck];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}

export function drawTarotCards(count: number, options: DrawOptions = {}): { seed: string; cards: DrawnTarotCard[] } {
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer.");
  const useReversals = options.useReversals ?? true;
  const reversalRate = options.reversalRate ?? DEFAULT_REVERSAL_RATE;
  if (!Number.isFinite(reversalRate) || reversalRate < 0 || reversalRate > 1) {
    throw new Error("reversalRate must be a number between 0 and 1.");
  }

  const deck = getDeck(options.deckId);
  const excludedIds = new Set(options.excludeCardIds ?? []);
  const knownIds = new Set(deck.cards.map((card) => card.id));
  for (const id of excludedIds) if (!knownIds.has(id)) throw new Error(`Unknown card id in exclusions: ${id}`);
  if (count > deck.cards.length - excludedIds.size) throw new Error("Not enough cards remain in the deck.");

  const seed = options.seed?.trim() || randomBytes(16).toString("hex");
  const random = seededRandom(seed);
  const availableCards = deck.cards.filter((card) => !excludedIds.has(card.id));
  const reversedCount = useReversals ? Math.round(availableCards.length * reversalRate) : 0;
  const reversedIds = new Set(
    shuffledDeckFrom(availableCards, random).slice(0, reversedCount).map((card) => card.id),
  );
  const cards = shuffledDeckFrom(availableCards, random)
    .slice(0, count)
    .map((card): DrawnTarotCard => {
      const orientation: Orientation = reversedIds.has(card.id) ? "reversed" : "upright";
      const selectedMeaning = card[orientation];
      return {
        card: {
          id: card.id, name: card.name, nameRu: card.nameRu, arcana: card.arcana,
          element: card.element, suit: card.suit, rank: card.rank, court: card.court,
        },
        orientation,
        keywords: selectedMeaning.keywords,
        coreMeaning: selectedMeaning.text,
      };
    });
  return { seed, cards };
}

function orientationPhrase(orientation: Orientation): string {
  return orientation === "reversed" ? "в перевёрнутом положении" : "в прямом положении";
}

function elementDynamic(first: ReadingCard, second: ReadingCard): string {
  if (first.card.arcana === "oracle" || second.card.arcana === "oracle") {
    return "Оракульные символы следует сопоставить напрямую: проверить, усиливают они одну тему или показывают её противоположные стороны.";
  }
  if (first.card.arcana === "major" && second.card.arcana === "major") {
    return "Обе карты — Старшие арканы, поэтому эта связь выглядит поворотной для всего вопроса.";
  }
  if (first.card.arcana === "major" || second.card.arcana === "major") {
    return "Старший аркан усиливает эту связь и выводит её за пределы бытовой детали.";
  }
  if (first.card.element === second.card.element) {
    return `Общая стихия усиливает тему «${elementLabels[first.card.element]}».`;
  }
  const pair = new Set([first.card.element, second.card.element]);
  if ((pair.has("fire") && pair.has("air")) || (pair.has("water") && pair.has("earth"))) {
    return "Стихии поддерживают друг друга, поэтому переход между картами может быть продуктивным.";
  }
  if ((pair.has("fire") && pair.has("water")) || (pair.has("air") && pair.has("earth"))) {
    return "Стихии создают трение: одна тенденция может ослаблять или корректировать другую.";
  }
  return "Стихии действуют по-разному и требуют сознательного согласования.";
}

function reversalDynamic(first: ReadingCard, second: ReadingCard): string {
  if (first.orientation === "reversed" && second.orientation === "reversed") {
    return "Обе темы проявляются скрыто, внутренне или через задержку.";
  }
  if (first.orientation !== second.orientation) {
    const reversed = first.orientation === "reversed" ? first : second;
    return `${reversed.card.nameRu} показывает заблокированную, внутреннюю или пересматриваемую часть этой пары.`;
  }
  return "Обе темы выражены достаточно прямо и заметно.";
}

function buildPositionPairs(cards: ReadingCard[]): CombinationSignal[] {
  return relationSpecs.map((spec) => {
    const first = cards[spec.positions[0] - 1];
    const second = cards[spec.positions[1] - 1];
    return {
      kind: "position-pair",
      positions: [...spec.positions],
      titleRu: spec.titleRu,
      interpretation: `${spec.lead}: ${first.card.nameRu} (${first.keywords.slice(0, 2).join(", ")}) → ${second.card.nameRu} (${second.keywords.slice(0, 2).join(", ")}). ${elementDynamic(first, second)} ${reversalDynamic(first, second)}`,
    };
  });
}

function buildSpreadPatterns(cards: ReadingCard[], deckId: DeckId): CombinationSignal[] {
  const signals: CombinationSignal[] = [];
  if (deckId === "rider-waite-smith") {
    const majorCount = cards.filter(({ card }) => card.arcana === "major").length;
    if (majorCount >= 4) {
      signals.push({ kind: "spread-pattern", titleRu: "Высокая доля Старших арканов", interpretation: `${majorCount} из 10 карт — Старшие арканы. Вопрос затрагивает крупный переход, ценности или устойчивый жизненный сценарий, а не только текущие обстоятельства.` });
    } else if (majorCount === 0) {
      signals.push({ kind: "spread-pattern", titleRu: "Практический масштаб", interpretation: "Старших арканов нет: динамика в большей степени зависит от повседневных решений, отношений и доступных ресурсов." });
    }
  }

  const reversedCount = cards.filter(({ orientation }) => orientation === "reversed").length;
  if (reversedCount >= 5) {
    signals.push({ kind: "spread-pattern", titleRu: "Много перевёрнутых карт", interpretation: `${reversedCount} из 10 карт перевёрнуты. Значительная часть процесса может быть внутренней, задержанной, подавленной или находиться на пересмотре.` });
  } else if (reversedCount === 0) {
    signals.push({ kind: "spread-pattern", titleRu: "Открытая динамика", interpretation: "Все карты прямые: основные тенденции проявляются относительно открыто и легче переводятся в наблюдаемые действия." });
  }

  if (deckId === "rider-waite-smith") {
    const suitCounts = Object.fromEntries(Object.keys(suitLabels).map((suit) => [suit, 0])) as Record<string, number>;
    for (const { card } of cards) if (card.suit) suitCounts[card.suit] += 1;
    const [dominantSuit, dominantCount] = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
    const tiedDominants = Object.values(suitCounts).filter((count) => count === dominantCount).length;
    if (dominantCount >= 3 && tiedDominants === 1) {
      signals.push({ kind: "spread-pattern", titleRu: "Доминирующая масть", interpretation: `${suitLabels[dominantSuit]} (${dominantCount} карт). Эта область задаёт основной язык расклада.` });
    }

    const ranks = new Map<string, number>();
    for (const { card } of cards) if (card.rank) ranks.set(card.rank, (ranks.get(card.rank) ?? 0) + 1);
    for (const [rank, count] of ranks) {
      if (count >= 2) signals.push({ kind: "spread-pattern", titleRu: `Повтор ранга: ${rankLabels[rank]}`, interpretation: `${rankLabels[rank]} встречаются ${count} раза, поэтому общий этап или способ действия этого ранга повторяется в разных областях вопроса.` });
    }

    const courtCards = cards.filter(({ card }) => card.court);
    if (courtCards.length >= 3) {
      signals.push({ kind: "spread-pattern", titleRu: "Много придворных карт", interpretation: `${courtCards.length} придворные карты подчёркивают влияние ролей, характеров и взаимодействия с конкретными людьми.` });
    }
    const outcome = cards[9];
    if (outcome.card.court) {
      signals.push({ kind: "spread-pattern", positions: [10], titleRu: "Придворная карта в итоге", interpretation: "По традиционной оговорке Уэйта итог заметно зависит от человека, роли или способа поведения, представленного этой придворной картой." });
    }
  }

  const keywordCounts = new Map<string, number>();
  for (const { keywords } of cards) {
    for (const keyword of keywords) keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
  }
  const recurringKeywords = [...keywordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (recurringKeywords.length) {
    signals.push({ kind: "spread-pattern", titleRu: "Повторяющиеся темы", interpretation: recurringKeywords.map(([keyword, count]) => `${keyword} (${count})`).join(", ") + ". Эти мотивы связывают несколько позиций расклада." });
  }
  return signals;
}

function buildLlmMessages(question: string, deckNameRu: string, cards: ReadingCard[], signals: CombinationSignal[]) {
  const cardLines = cards.map((item) =>
    `${item.position.id}. ${item.position.titleRu}: ${item.card.nameRu}, ${orientationPhrase(item.orientation)}. Keywords: ${item.keywords.join(", ")}. Meaning: ${item.coreMeaning}`,
  );
  const signalLines = signals.map((signal) => `- ${signal.titleRu}: ${signal.interpretation}`);
  const userContent = [
    `Question: ${question}`,
    `Deck: ${deckNameRu}.`,
    "Spread: Celtic Cross, ten-card Waite-derived modern form without a separate significator.",
    "Cards:",
    ...cardLines,
    "Combination signals:",
    ...signalLines,
    "Produce a cohesive, compassionate interpretation addressed to the person who asked the question.",
  ].join("\n");

  return [
    { role: "system" as const, content: tarotReaderSystemInstruction },
    { role: "user" as const, content: userContent },
  ];
}

export function createCelticCrossReading(question: string, options: ReadingOptions = {}): CelticCrossReading {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new Error("Question must not be empty.");

  const useReversals = options.useReversals ?? true;
  const reversalRate = options.reversalRate ?? DEFAULT_REVERSAL_RATE;
  const deck = getDeck(options.deckId);
  const draw = drawTarotCards(celticCrossPositions.length, options);
  const cards: ReadingCard[] = draw.cards.map((drawnCard, index) => {
    const position = celticCrossPositions[index];
    return {
      ...drawnCard,
      position,
      positionalReading: `В позиции «${position.titleRu}» карта ${drawnCard.card.nameRu} ${orientationPhrase(drawnCard.orientation)} указывает на следующее: ${drawnCard.coreMeaning} Фокус позиции: ${position.meaningRu}`,
    };
  });

  const combinationSignals = [...buildPositionPairs(cards), ...buildSpreadPatterns(cards, deck.id)];
  return {
    schemaVersion: "1.0",
    spread: {
      id: "celtic-cross",
      nameRu: "Кельтский крест",
      tradition: "A. E. Waite-derived ten-card form; separate significator omitted for API use.",
      deck: { id: deck.id, nameRu: deck.nameRu, system: deck.system },
    },
    question: normalizedQuestion,
    seed: draw.seed,
    options: { deckId: deck.id, useReversals, reversalRate },
    disclaimerRu: "Расклад предназначен для символической рефлексии и развлечения; он не устанавливает факты и не заменяет профессиональную помощь.",
    cards,
    combinationSignals,
    llmHandoff: {
      messages: buildLlmMessages(normalizedQuestion, deck.nameRu, cards, combinationSignals),
      tools: tarotToolDefinitions,
    },
  };
}
