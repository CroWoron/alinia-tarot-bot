import { createSpreadReading, type SpreadId } from "./spreads.ts";
import { DEFAULT_REVERSAL_RATE } from "./engine.ts";

const help = `Использование:
  npm.cmd start -- --question "Что мне важно понять о смене работы?"

Параметры:
  -q, --question <текст>  Конкретный вопрос для расклада (обязательно)
  --deck <идентификатор>  rider-waite-smith (по умолчанию) или full-moon-oracle
  --spread <расклад>      question-5, yes-no-1, yes-no-3, timeline-7, love-9 или celtic-cross
  --seed <текст>          Повторяемый расклад для тестов и отладки
  --no-reversals          Не использовать перевёрнутые карты
  --reversal-rate <0..1>  Доля перевёрнутых карт в колоде (по умолчанию ${DEFAULT_REVERSAL_RATE})
  -h, --help              Показать справку

Результат выводится в stdout как JSON, включая готовые messages для LLM.`;

function valueAfter(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Для ${option} требуется значение.`);
  return value;
}

function parseArgs(args: string[]) {
  let question = "";
  let deckId: "rider-waite-smith" | "full-moon-oracle" | undefined;
  let spread: SpreadId = "celtic-cross";
  let seed: string | undefined;
  let useReversals = true;
  let reversalRate = DEFAULT_REVERSAL_RATE;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true } as const;
    if (arg === "-q" || arg === "--question") question = valueAfter(args, index++, arg);
    else if (arg === "--deck") {
      const value = valueAfter(args, index++, arg);
      if (value !== "rider-waite-smith" && value !== "full-moon-oracle") throw new Error(`Неизвестная колода: ${value}`);
      deckId = value;
    }
    else if (arg === "--spread") {
      const value = valueAfter(args, index++, arg);
      if (!["question-5", "yes-no-1", "yes-no-3", "timeline-7", "love-9", "celtic-cross"].includes(value)) throw new Error(`Неизвестный расклад: ${value}`);
      spread = value as SpreadId;
    }
    else if (arg === "--seed") seed = valueAfter(args, index++, arg);
    else if (arg === "--no-reversals") useReversals = false;
    else if (arg === "--reversal-rate") reversalRate = Number(valueAfter(args, index++, arg));
    else throw new Error(`Неизвестный параметр: ${arg}`);
  }
  return { help: false, question, deckId, spread, seed, useReversals, reversalRate } as const;
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(help);
  } else {
    if (!parsed.question.trim()) throw new Error("Укажите вопрос через --question.");
    const reading = createSpreadReading(parsed.question, parsed.spread, {
      deckId: parsed.deckId,
      seed: parsed.seed,
      useReversals: parsed.useReversals,
      reversalRate: parsed.reversalRate,
    });
    console.log(JSON.stringify(reading, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Используйте --help для справки.");
  process.exitCode = 1;
}
