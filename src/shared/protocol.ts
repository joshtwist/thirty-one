import type {
  Card,
  GamePhase,
  PlayerIcon,
  TurnPhase,
} from "./types.ts";

// ── Client → Server ────────────────────────────────────────────────

export type ClientMessage =
  | JoinMessage
  | ReconnectMessage
  | StartGameMessage
  | DrawMessage
  | DiscardMessage
  | StopTheBusMessage
  | CreateRematchMessage
  | PingMessage
  | TestForceHandMessage;

export interface JoinMessage {
  type: "join";
  playerId: string;
  name: string;
  icon: PlayerIcon;
}

export interface ReconnectMessage {
  type: "reconnect";
  playerId: string;
}

export interface StartGameMessage {
  type: "start_game";
}

export interface DrawMessage {
  type: "draw";
  source: "deck" | "discard";
}

export interface DiscardMessage {
  type: "discard";
  card: Card;
}

/**
 * Sent during the draw phase of your turn. Declares that you're
 * committing to your current hand. You skip drawing/discarding on this
 * turn, and every other player gets one more normal turn before the
 * game ends and scores are revealed.
 */
export interface StopTheBusMessage {
  type: "stop_the_bus";
}

/**
 * Sent from the GameComplete screen when a player opens a rematch.
 * The server generates a new gameId and attaches it to the completed
 * game's state so all connected clients can see the rematch CTA.
 */
export interface CreateRematchMessage {
  type: "create_rematch";
}

export interface PingMessage {
  type: "ping";
}

/**
 * TEST-ONLY message. Overwrites the SENDER'S hand, used by the e2e
 * suite to set up specific 3-card hands (e.g. a perfect 31) without
 * relying on the shuffle. The playerId comes from the WebSocket tag.
 * Ignored unless TEST_HOOKS=1 in the worker env.
 */
export interface TestForceHandMessage {
  type: "_test_force_hand";
  hand: Card[];
}

// ── Server → Client ────────────────────────────────────────────────

export type ServerMessage =
  | StateMessage
  | DealingMessage
  | LobbyInfoMessage
  | ErrorMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerReconnectedMessage
  | PlayerDisconnectedMessage
  | GameCompleteMessage
  | PongMessage;

/**
 * Sent to any WebSocket whose playerId is NOT (yet) part of the game.
 * Lets the join form know which names/icons are already taken.
 */
export interface LobbyInfoMessage {
  type: "lobby_info";
  phase: GamePhase;
  players: {
    playerId: string;
    name: string;
    icon: PlayerIcon;
  }[];
}

export interface PlayerView {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  cardCount: number;
  connected: boolean;
}

export interface SelfView {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  hand: Card[];
  isCreator: boolean;
}

export interface RematchInfoView {
  gameId: string;
  creatorId: string;
  creatorName: string;
}

export interface StateMessage {
  type: "state";
  phase: GamePhase;
  turnPhase: TurnPhase | null;
  you: SelfView;
  players: PlayerView[];
  currentPlayerId: string | null;
  discardTop: Card | null;
  deckCount: number;
  /**
   * Set once someone presses "Stop the Bus". Other players still play
   * one normal turn each; the game ends when the turn rotation would
   * return to this player.
   */
  stoppedByPlayerId: string | null;
  /**
   * Present on completed games once any player has opened a rematch.
   * Every connected client watches this field — when it flips from
   * null to an object, the win screen swaps its CTA from "Create New
   * Game" to "Join {creatorName}'s New Game".
   */
  rematch: RematchInfoView | null;
}

export interface DealingMessage {
  type: "dealing";
  playerOrder: string[];
  hand: Card[];
  discardTop: Card;
  deckCount: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PlayerJoinedMessage {
  type: "player_joined";
  player: PlayerView;
}

export interface PlayerLeftMessage {
  type: "player_left";
  playerId: string;
}

export interface PlayerReconnectedMessage {
  type: "player_reconnected";
  playerId: string;
}

export interface PlayerDisconnectedMessage {
  type: "player_disconnected";
  playerId: string;
}

export interface ScoreEntry {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  score: number;
  hand: Card[];
}

export interface GameCompleteMessage {
  type: "game_complete";
  winnerId: string;
  winnerName: string;
  /** Player who pressed Stop the Bus (if any). */
  stoppedByPlayerId: string | null;
  scores: ScoreEntry[];
  celebrationGif: string;
}

export interface PongMessage {
  type: "pong";
}
