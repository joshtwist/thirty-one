export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = "lobby" | "dealing" | "playing" | "complete";

export type TurnPhase = "draw" | "discard";

export const PLAYER_ICONS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "rabbit",
  "snail",
  "bug",
  "flame",
  "zap",
  "star",
  "moon",
  "sun",
  "heart",
  "skull",
  "ghost",
  "rocket",
  "crown",
  "gem",
  "anchor",
  "gamepad-2",
] as const;

export type PlayerIcon = (typeof PLAYER_ICONS)[number];

export const MAX_PLAYERS = 4;

/** Number of cards dealt to each player. Thirty-One is always 3 cards. */
export const HAND_SIZE = 3;

/**
 * Thirty-One card point values used for scoring.
 *
 *   Ace = 11 (high, counts toward the 31 target)
 *   2–10 = face value
 *   J/Q/K = 10
 *
 * A player's hand is scored as the MAX sum over any single suit:
 *   A♥ K♥ 2♣ → hearts = 11+10 = 21, clubs = 2 → score 21
 *   A♠ K♠ Q♠ → spades = 11+10+10 = 31 (perfect hand)
 */
export const CARD_VALUES: Record<Rank, number> = {
  A: 11,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
};
