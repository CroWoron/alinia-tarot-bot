import { riderWaiteSmithDeck, type TarotCard } from "./cards.ts";
import { fullMoonOracleDeck } from "./full-moon-oracle.ts";

export type DeckId = "rider-waite-smith" | "full-moon-oracle";

export interface DeckDefinition {
  id: DeckId;
  name: string;
  nameRu: string;
  system: "tarot" | "oracle";
  cards: TarotCard[];
}

export const decks: Record<DeckId, DeckDefinition> = {
  "rider-waite-smith": {
    id: "rider-waite-smith",
    name: "Rider-Waite-Smith Tarot",
    nameRu: "Таро Райдера—Уэйта—Смит",
    system: "tarot",
    cards: riderWaiteSmithDeck,
  },
  "full-moon-oracle": {
    id: "full-moon-oracle",
    name: "Full Moon Oracle",
    nameRu: "Оракул Полнолуния",
    system: "oracle",
    cards: fullMoonOracleDeck,
  },
};

export function getDeck(deckId: string = "rider-waite-smith"): DeckDefinition {
  const deck = decks[deckId as DeckId];
  if (!deck) throw new Error(`Unknown deckId: ${deckId}`);
  return deck;
}
