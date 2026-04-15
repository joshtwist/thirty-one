import type {
  Card,
  GamePhase,
  TurnPhase,
  PlayerIcon,
} from "../shared/types.ts";
import { HAND_SIZE, MAX_PLAYERS } from "../shared/types.ts";
import type {
  StateMessage,
  DealingMessage,
  PlayerView,
  SelfView,
} from "../shared/protocol.ts";
import { createDeck, shuffle, deal, scoreHand } from "./deck.ts";

// ── State types ────────────────────────────────────────────────────

export interface Player {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  connected: boolean;
}

export interface RematchInfo {
  gameId: string;
  creatorId: string;
  creatorName: string;
}

export interface GameState {
  gameId: string;
  phase: GamePhase;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  hands: Record<string, Card[]>;
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  creatorId: string;
  /**
   * The player who pressed "Stop the Bus", committing to their current
   * hand. Once set, every OTHER player takes one more normal turn; when
   * the turn rotation would return to this player, the game transitions
   * to "complete". Null before any stop has been called.
   */
  stoppedByPlayerId: string | null;
  /**
   * Set after the game completes when someone opens a rematch. Other
   * players see this and can choose to hop into the new game at their
   * leisure. Null while the game is running or before anyone creates
   * a rematch. Once set, it sticks — the completed game acts as a
   * lobby pointer to the new one.
   */
  rematch: RematchInfo | null;
  /**
   * Picked by the DO when the game transitions to complete. Stored on
   * state so a player who reconnects after the win still sees the same
   * celebration GIF.
   */
  celebrationGif: string | null;
  /**
   * The player with the highest scoring hand at game end. Computed
   * once at the transition to "complete" (see `finaliseGame`) and
   * frozen from that point on.
   */
  winnerId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function getPlayerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.playerId === playerId);
}

function assertPlayer(state: GameState, playerId: string): void {
  if (getPlayerIndex(state, playerId) === -1) {
    throw new Error("You are not in this game");
  }
}

/**
 * Pick a winner given the current hands + who (if anyone) stopped the
 * bus. Highest score wins. Ties go to the non-stopper; further ties are
 * broken by earliest position in the player list (standard deterministic
 * tiebreak).
 */
function pickWinner(state: GameState): string {
  let bestId = state.players[0].playerId;
  let bestScore = scoreHand(state.hands[bestId] ?? []);

  for (let i = 1; i < state.players.length; i++) {
    const pid = state.players[i].playerId;
    const score = scoreHand(state.hands[pid] ?? []);

    if (score > bestScore) {
      bestId = pid;
      bestScore = score;
      continue;
    }
    if (score === bestScore) {
      // Tiebreak: the stopper loses ties (they committed to their hand).
      if (bestId === state.stoppedByPlayerId) {
        bestId = pid;
        bestScore = score;
      }
      // Otherwise keep the earlier player (bestId unchanged).
    }
  }

  return bestId;
}

function finaliseGame(state: GameState): GameState {
  const winnerId = pickWinner(state);
  return {
    ...state,
    phase: "complete",
    winnerId,
  };
}

// ── Public API (all pure) ──────────────────────────────────────────

/** Create a fresh game in lobby phase. No creator yet -- they join like everyone else. */
export function createGame(gameId: string): GameState {
  return {
    gameId,
    phase: "lobby",
    players: [],
    deck: [],
    discardPile: [],
    hands: {},
    currentPlayerIndex: 0,
    turnPhase: "draw",
    creatorId: "",
    stoppedByPlayerId: null,
    rematch: null,
    celebrationGif: null,
    winnerId: null,
  };
}

/** Add a player to the lobby. The first player to join becomes the creator. */
export function addPlayer(
  state: GameState,
  playerId: string,
  name: string,
  icon: PlayerIcon,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Cannot join: the game has already started");
  }
  if (state.players.length >= MAX_PLAYERS) {
    throw new Error(`Cannot join: the game is full (max ${MAX_PLAYERS} players)`);
  }
  if (state.players.some((p) => p.playerId === playerId)) {
    throw new Error("You have already joined this game");
  }

  const newPlayers = [
    ...state.players,
    { playerId, name, icon, connected: true },
  ];
  const creatorId = state.creatorId || playerId;

  return { ...state, players: newPlayers, creatorId };
}

/** Remove a player from the lobby. Only allowed before the game starts. */
export function removePlayer(
  state: GameState,
  playerId: string,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Cannot leave: the game has already started");
  }
  assertPlayer(state, playerId);

  const newPlayers = state.players.filter((p) => p.playerId !== playerId);

  // If the creator left, assign the next player (or clear if nobody remains)
  let { creatorId } = state;
  if (creatorId === playerId) {
    creatorId = newPlayers.length > 0 ? newPlayers[0].playerId : "";
  }

  return { ...state, players: newPlayers, creatorId };
}

/**
 * Start the game. Only the creator may call this.
 * Shuffles the deck, deals 3 cards per player, flips the first discard.
 * Sets phase to "dealing" -- the DO will transition to "playing" after a delay.
 */
export function startGame(
  state: GameState,
  playerId: string,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Game has already started");
  }
  if (state.creatorId !== playerId) {
    throw new Error("Only the game creator can start the game");
  }
  if (state.players.length < 2) {
    throw new Error("Need at least 2 players to start");
  }

  const shuffled = shuffle(createDeck());
  const playerIds = state.players.map((p) => p.playerId);
  const { hands, remaining } = deal(shuffled, playerIds, HAND_SIZE);

  // Flip the top card of the remaining deck onto the discard pile
  const firstDiscard = remaining.shift()!;

  return {
    ...state,
    phase: "dealing",
    deck: remaining,
    discardPile: [firstDiscard],
    hands,
    currentPlayerIndex: 0,
    turnPhase: "draw",
  };
}

/**
 * Active player draws a card from the deck or the discard pile.
 * If the deck is empty, the discard pile (minus its top card) is reshuffled
 * into the deck before drawing.
 */
export function drawCard(
  state: GameState,
  playerId: string,
  source: "deck" | "discard",
): GameState {
  if (state.phase !== "playing") {
    throw new Error("Cannot draw: the game is not in progress");
  }
  if (state.turnPhase !== "draw") {
    throw new Error("Cannot draw: it is the discard phase");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) {
    throw new Error("It is not your turn");
  }

  let deck = [...state.deck];
  let discardPile = [...state.discardPile];
  let drawn: Card;

  if (source === "discard") {
    if (discardPile.length === 0) {
      throw new Error("The discard pile is empty");
    }
    drawn = discardPile.pop()!;
  } else {
    // source === "deck"
    if (deck.length === 0) {
      // Reshuffle: keep the top discard, shuffle the rest back into the deck
      if (discardPile.length <= 1) {
        throw new Error("No cards left to draw");
      }
      const topDiscard = discardPile.pop()!;
      deck = shuffle(discardPile);
      discardPile = [topDiscard];
    }
    drawn = deck.shift()!;
  }

  const hand = [...(state.hands[playerId] ?? []), drawn];

  return {
    ...state,
    deck,
    discardPile,
    hands: { ...state.hands, [playerId]: hand },
    turnPhase: "discard",
  };
}

/**
 * Active player discards a card from their hand. Advances to the next
 * player in "draw" phase — unless someone has already stopped the bus
 * and the next player would be that stopper, in which case the game
 * transitions to "complete" with the highest-scoring hand as winner.
 */
export function discardCard(
  state: GameState,
  playerId: string,
  card: Card,
): GameState {
  if (state.phase !== "playing") {
    throw new Error("Cannot discard: the game is not in progress");
  }
  if (state.turnPhase !== "discard") {
    throw new Error("Cannot discard: you must draw first");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) {
    throw new Error("It is not your turn");
  }

  const hand = state.hands[playerId] ?? [];
  const idx = hand.findIndex((c) => cardsEqual(c, card));
  if (idx === -1) {
    throw new Error("That card is not in your hand");
  }

  const newHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  const newDiscardPile = [...state.discardPile, card];
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  const base: GameState = {
    ...state,
    hands: { ...state.hands, [playerId]: newHand },
    discardPile: newDiscardPile,
    currentPlayerIndex: nextIndex,
    turnPhase: "draw",
  };

  // If a stopper is waiting and the next turn would return to them,
  // the game is over. Everyone has had their last turn; compute scores.
  if (
    state.stoppedByPlayerId != null &&
    state.players[nextIndex].playerId === state.stoppedByPlayerId
  ) {
    return finaliseGame(base);
  }

  return base;
}

/**
 * Active player presses "Stop the Bus" during the draw phase — they
 * commit to their current 3-card hand. Their turn ends (no draw, no
 * discard). Play advances to the next player; each other player takes
 * one normal turn, and the game ends when the rotation would return to
 * the stopper.
 *
 * Only one stop is allowed per game — calling this a second time
 * throws.
 */
export function stopTheBus(
  state: GameState,
  playerId: string,
): GameState {
  if (state.phase !== "playing") {
    throw new Error("Cannot stop the bus: the game is not in progress");
  }
  if (state.turnPhase !== "draw") {
    throw new Error("You can only stop the bus at the start of your turn");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) {
    throw new Error("It is not your turn");
  }
  if (state.stoppedByPlayerId != null) {
    throw new Error("Someone has already stopped the bus");
  }

  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  return {
    ...state,
    stoppedByPlayerId: playerId,
    currentPlayerIndex: nextIndex,
    turnPhase: "draw",
  };
}

/**
 * Attach a rematch pointer to a completed game. After this, every
 * connected client sees the rematch info in their state and can choose
 * to join the new game at their leisure (the UI surfaces a "Join X's
 * New Game" button).
 *
 * First caller wins: if a rematch is already set, this throws. That
 * keeps the state machine simple — there's exactly one rematch per
 * completed game.
 */
export function createRematch(
  state: GameState,
  playerId: string,
  newGameId: string,
): GameState {
  if (state.phase !== "complete") {
    throw new Error("Can only create a rematch after the game ends");
  }
  if (state.rematch) {
    throw new Error("A rematch has already been created for this game");
  }
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) {
    throw new Error("You are not in this game");
  }
  return {
    ...state,
    rematch: {
      gameId: newGameId,
      creatorId: playerId,
      creatorName: player.name,
    },
  };
}

/** Build the personalised StateMessage that one specific player should receive. */
export function getPlayerView(
  state: GameState,
  playerId: string,
): StateMessage {
  const selfPlayer = state.players.find((p) => p.playerId === playerId);
  if (!selfPlayer) {
    throw new Error("Player not found in game");
  }

  const you: SelfView = {
    playerId: selfPlayer.playerId,
    name: selfPlayer.name,
    icon: selfPlayer.icon,
    hand: state.hands[playerId] ?? [],
    isCreator: state.creatorId === playerId,
  };

  const players: PlayerView[] = state.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    icon: p.icon,
    cardCount: (state.hands[p.playerId] ?? []).length,
    connected: p.connected,
  }));

  const currentPlayerId =
    state.phase === "playing"
      ? state.players[state.currentPlayerIndex]?.playerId ?? null
      : null;

  const discardTop =
    state.discardPile.length > 0
      ? state.discardPile[state.discardPile.length - 1]
      : null;

  return {
    type: "state",
    phase: state.phase,
    turnPhase: state.phase === "playing" ? state.turnPhase : null,
    you,
    players,
    currentPlayerId,
    discardTop,
    deckCount: state.deck.length,
    stoppedByPlayerId: state.stoppedByPlayerId,
    rematch: state.rematch,
  };
}

/** Build the personalised DealingMessage for the dealing animation phase. */
export function getDealingView(
  state: GameState,
  playerId: string,
): DealingMessage {
  const discardTop =
    state.discardPile.length > 0
      ? state.discardPile[state.discardPile.length - 1]
      : null;

  if (!discardTop) {
    throw new Error("No discard card available for dealing view");
  }

  return {
    type: "dealing",
    playerOrder: state.players.map((p) => p.playerId),
    hand: state.hands[playerId] ?? [],
    discardTop,
    deckCount: state.deck.length,
  };
}

/**
 * Build the game-complete result including scores. The winner is stored
 * on state by `finaliseGame`; we just build the per-player breakdown.
 * Hands are included so everyone can see the final cards.
 */
export function getGameCompleteResult(state: GameState): {
  winnerId: string;
  winnerName: string;
  stoppedByPlayerId: string | null;
  scores: {
    playerId: string;
    name: string;
    icon: PlayerIcon;
    score: number;
    hand: Card[];
  }[];
} {
  const winner = state.winnerId
    ? state.players.find((p) => p.playerId === state.winnerId)
    : null;
  if (!winner) {
    throw new Error("No winner recorded for completed game");
  }

  const scores = state.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    icon: p.icon,
    score: scoreHand(state.hands[p.playerId] ?? []),
    hand: state.hands[p.playerId] ?? [],
  }));

  // Sort: winner first, then everyone else by descending score (higher is
  // better in Thirty-One).
  scores.sort((a, b) => {
    if (a.playerId === winner.playerId) return -1;
    if (b.playerId === winner.playerId) return 1;
    return b.score - a.score;
  });

  return {
    winnerId: winner.playerId,
    winnerName: winner.name,
    stoppedByPlayerId: state.stoppedByPlayerId,
    scores,
  };
}

/**
 * Mark a player as connected or disconnected.
 * Used by the DO when WebSocket connections open/close.
 */
export function setPlayerConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  const newPlayers = state.players.map((p) =>
    p.playerId === playerId ? { ...p, connected } : p,
  );
  return { ...state, players: newPlayers };
}

/** Transition from dealing to playing phase. Called by the DO alarm after the dealing delay. */
export function finishDealing(state: GameState): GameState {
  if (state.phase !== "dealing") {
    throw new Error("Game is not in the dealing phase");
  }
  return { ...state, phase: "playing" };
}
