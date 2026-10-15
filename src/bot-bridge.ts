import { createInterface } from "node:readline";
import type { DeckId } from "./decks.ts";
import { createSpreadReading, type SpreadId as EngineSpreadId } from "./spreads.ts";

type SpreadId =
  | "specific_5"
  | "yes_no_1"
  | "yes_no_3"
  | "past_present_future_7"
  | "relationship_9"
  | "celtic_cross_10";

interface Request {
  question: string;
  spread: SpreadId;
  deck?: DeckId;
  seed?: string;
  reversals?: boolean;
}

const spreadAliases: Record<SpreadId, EngineSpreadId> = {
  specific_5: "question-5",
  yes_no_1: "yes-no-1",
  yes_no_3: "yes-no-3",
  past_present_future_7: "timeline-7",
  relationship_9: "love-9",
  celtic_cross_10: "celtic-cross",
};

function validate(raw: unknown): Request {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("request must be an object");
  const request = raw as Partial<Request>;
  if (typeof request.question !== "string" || !request.question.trim()) throw new Error("question is required");
  if (typeof request.spread !== "string" || !(request.spread in spreadAliases)) {
    throw new Error("unsupported spread");
  }
  if (request.deck !== undefined && request.deck !== "rider-waite-smith" && request.deck !== "full-moon-oracle") {
    throw new Error("unsupported deck");
  }
  if (request.seed !== undefined && typeof request.seed !== "string") throw new Error("seed must be a string");
  if (request.reversals !== undefined && typeof request.reversals !== "boolean") throw new Error("reversals must be a boolean");
  return request as Request;
}

function run(raw: unknown) {
  const request = validate(raw);
  const options = {
    deckId: request.deck ?? "rider-waite-smith" as DeckId,
    seed: request.seed,
    useReversals: request.reversals ?? true,
  };
  const reading = createSpreadReading(request.question.trim(), spreadAliases[request.spread], options);
  const layoutStatus = "layoutStatus" in reading.spread ? reading.spread.layoutStatus : "stable";
  const verdict = "yesNo" in reading && reading.yesNo
    ? [reading.yesNo.answer, reading.yesNo.confidence, reading.yesNo.score]
    : undefined;
  return {
    question: reading.question,
    spread: request.spread,
    spreadNameRu: reading.spread.nameRu,
    provisional: layoutStatus === "working-needs-approval",
    deck: reading.spread.deck.id,
    seed: reading.seed,
    cards: reading.cards.map((item) => [
      item.position.id,
      item.position.titleRu,
      item.card.nameRu,
      item.orientation === "reversed" ? "r" : "u",
      item.coreMeaning,
    ]),
    signals: reading.combinationSignals.map((item) => [item.positions ?? [], item.titleRu, item.interpretation]),
    ...(verdict ? { verdict } : {}),
  };
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    process.stdout.write(`${JSON.stringify({ result: run(JSON.parse(line)) })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  }
});
