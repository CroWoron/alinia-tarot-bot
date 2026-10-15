export const tarotToolDefinitions = [
  {
    type: "function",
    function: {
      name: "tarot_read",
      description: "Start a reading for a new question. Choose a spread; never reroll an unwanted answer.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "One concrete question." },
          deck: { type: "string", enum: ["rider-waite-smith", "full-moon-oracle"], description: "Default: rider-waite-smith." },
          spread: {
            type: "string",
            enum: ["question-5", "yes-no-1", "yes-no-3", "timeline-7", "love-9", "celtic-cross"],
            description: "Default: celtic-cross.",
          },
          reversals: { type: "boolean", description: "Allow reversals. Default: true, with 20% of the shuffled deck reversed." },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tarot_clarify",
      description: "Add 1-3 cards to one unclear position. They supplement, never replace, its card.",
      parameters: {
        type: "object",
        properties: {
          readingId: { type: "string" },
          position: { type: "integer", minimum: 1, maximum: 10, description: "1 through the current spread's card count." },
          question: { type: "string", description: "Optional narrow question." },
          count: { type: "integer", minimum: 1, maximum: 3, description: "Default: 1." },
        },
        required: ["readingId", "position"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tarot_followup",
      description: "Draw 3 cards for a focused follow-up broader than one position.",
      parameters: {
        type: "object",
        properties: {
          readingId: { type: "string" },
          question: { type: "string" },
          spread: {
            type: "string",
            enum: ["clarity", "decision", "relationship", "progression"],
            description: "known-hidden-step | A-B-criterion | self-other-dynamic | origin-now-next",
          },
        },
        required: ["readingId", "question", "spread"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tarot_expand",
      description: "Once per reading, deepen one position with an anchored child spread. It supplements, never replaces, the parent.",
      parameters: {
        type: "object",
        properties: {
          readingId: { type: "string" },
          position: { type: "integer", minimum: 1, maximum: 10, description: "Optional; defaults to the result/direction position." },
          question: { type: "string", description: "Optional narrow question." },
        },
        required: ["readingId"],
        additionalProperties: false,
      },
    },
  },
] as const;

export type TarotToolName = (typeof tarotToolDefinitions)[number]["function"]["name"];
