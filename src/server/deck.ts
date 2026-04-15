import type { Card, Suit, Rank } from "../shared/types.ts";
import { CARD_VALUES } from "../shared/types.ts";

const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
const RANKS: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** Returns a standard 52-card deck in canonical order. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate the input. */
export function shuffle(deck: Card[]): Card[] {
  const out = [...deck];
  const buf = new Uint32Array(out.length);
  crypto.getRandomValues(buf);
  for (let i = out.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Deals cards round-robin from the top of the deck.
 * Returns each player's hand and the remaining deck.
 */
export function deal(
  deck: Card[],
  playerIds: string[],
  cardsPerPlayer: number,
): { hands: Record<string, Card[]>; remaining: Card[] } {
  const totalNeeded = playerIds.length * cardsPerPlayer;
  if (deck.length < totalNeeded) {
    throw new Error(
      `Not enough cards to deal: need ${totalNeeded}, have ${deck.length}`,
    );
  }

  const hands: Record<string, Card[]> = {};
  for (const id of playerIds) {
    hands[id] = [];
  }

  const remaining = [...deck];
  for (let round = 0; round < cardsPerPlayer; round++) {
    for (const id of playerIds) {
      hands[id].push(remaining.shift()!);
    }
  }

  return { hands, remaining };
}

/**
 * Thirty-One hand score: the MAX sum over any single suit.
 *
 *   A♥ K♥ 2♣ → hearts=21, clubs=2 → 21
 *   A♠ K♠ Q♠ → spades=31 → 31
 *   7♥ 8♣ 9♦ → 9 (each suit has one card; pick the highest)
 */
export function scoreHand(hand: Card[]): number {
  const totals: Record<Suit, number> = {
    hearts: 0,
    diamonds: 0,
    clubs: 0,
    spades: 0,
  };
  for (const card of hand) {
    totals[card.suit] += CARD_VALUES[card.rank];
  }
  return Math.max(totals.hearts, totals.diamonds, totals.clubs, totals.spades);
}
