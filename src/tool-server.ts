import { createInterface } from "node:readline";
import { TarotToolRuntime } from "./tool-runtime.ts";
import { tarotToolDefinitions } from "./tool-definitions.ts";

if (process.argv.includes("--describe")) {
  console.log(JSON.stringify(tarotToolDefinitions, null, 2));
} else {
  const runtime = new TarotToolRuntime();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  lines.on("line", (line) => {
    if (!line.trim()) return;
    let request: Record<string, unknown> = {};
    try {
      request = JSON.parse(line);
      const rawArguments = typeof request.arguments === "string" ? JSON.parse(request.arguments) : request.arguments;
      const result = runtime.execute(String(request.name ?? ""), rawArguments);
      process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) })}\n`);
    }
  });
}

