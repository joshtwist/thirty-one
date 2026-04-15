import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hand } from "lucide-react";
import type { StateMessage, ClientMessage } from "../../shared/protocol.ts";
import type { Card as CardType } from "../../shared/types.ts";
import { vibrateAction } from "../lib/haptics.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";
import { PlayerBar } from "./PlayerBar.tsx";
import { CenterArea } from "./CenterArea.tsx";
import { PlayerHand } from "./PlayerHand.tsx";

interface GameBoardProps {
  state: StateMessage;
  send: (msg: ClientMessage) => void;
}

/**
 * The main game screen on a felt-green table.
 *
 * Layout (top → bottom):
 *   1. Opponents bar
 *   2. "Your Turn" / "Waiting for ..." pill
 *   3. Centre area (deck + discard)
 *   4. Instruction line + optional "Stop the Bus" button
 *   5. Your hand (drag any card; drop on discard during your turn)
 *   6. Footer: your avatar + card count
 *
 * The GameBoard owns the shared `discardRef` + drag state so PlayerHand and
 * CenterArea coordinate (the discard pile lights up while a card is being
 * dragged).
 */
export function GameBoard({ state, send }: GameBoardProps) {
  const {
    you,
    players,
    currentPlayerId,
    turnPhase,
    discardTop,
    deckCount,
    stoppedByPlayerId,
  } = state;

  const isMyTurn = currentPlayerId === you.playerId;
  const canDraw = isMyTurn && turnPhase === "draw";
  const canDiscard = isMyTurn && turnPhase === "discard";
  // You can stop the bus at the start of your turn (draw phase), only
  // if nobody else has stopped yet.
  const canStopTheBus = canDraw && stoppedByPlayerId == null;

  const activePlayer = players.find((p) => p.playerId === currentPlayerId);
  const activeName = activePlayer?.name ?? "";

  const stopper = stoppedByPlayerId
    ? players.find((p) => p.playerId === stoppedByPlayerId)
    : null;

  // Self colour index from the canonical players list (so opponent + footer agree)
  const selfIndex = players.findIndex((p) => p.playerId === you.playerId);
  const selfColor =
    ICON_COLORS[(selfIndex >= 0 ? selfIndex : 0) % ICON_COLORS.length];
  const SelfIcon = ICON_MAP[you.icon];

  // Shared drag state between hand + centre
  const discardRef = useRef<HTMLDivElement>(null);
  const [draggedCard, setDraggedCard] = useState<CardType | null>(null);
  const [dragOverDiscard, setDragOverDiscard] = useState(false);

  // Haptic when own hand size changes (draw/discard confirm)
  const lastHandSizeRef = useRef(you.hand.length);
  useEffect(() => {
    if (you.hand.length !== lastHandSizeRef.current) {
      vibrateAction();
      lastHandSizeRef.current = you.hand.length;
    }
  }, [you.hand.length]);

  function handleDrawDeck() {
    if (canDraw) send({ type: "draw", source: "deck" });
  }

  function handleDrawDiscard() {
    if (canDraw) send({ type: "draw", source: "discard" });
  }

  function handleDiscard(card: CardType) {
    if (canDiscard) send({ type: "discard", card });
  }

  function handleStopTheBus() {
    if (canStopTheBus) send({ type: "stop_the_bus" });
  }

  // Status pill text
  const statusText = isMyTurn ? "Your Turn" : `${activeName}'s turn`;

  // Instruction line (smaller, contextual)
  let instruction: string | null = null;
  if (isMyTurn && turnPhase === "draw") {
    instruction = "Draw a card or Stop the Bus";
  } else if (isMyTurn && turnPhase === "discard") {
    instruction = "Drag a card to the discard pile";
  } else if (stopper) {
    instruction = `${stopper.name} stopped the bus — last round!`;
  }

  return (
    <div
      className={`flex flex-1 flex-col min-h-0 transition-colors duration-500 ${
        stopper ? "bg-felt-stopped" : "bg-felt"
      }`}
    >
      {/* Stop-the-bus banner — bright red, pulsing, full width.
          Visible to everyone the moment someone stops, so opponents
          can't miss it. */}
      <AnimatePresence>
        {stopper && (
          <motion.div
            data-testid="stop-bus-banner"
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
            className="flex-shrink-0 bg-red-600 text-white text-center py-2 px-4 font-bold text-sm shadow-lg flex items-center justify-center gap-2"
          >
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              <Hand className="w-5 h-5" />
            </motion.div>
            <span>
              {stopper.playerId === you.playerId
                ? "You stopped the bus — last round!"
                : `${stopper.name} stopped the bus — last round!`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. Opponents */}
      <div className="flex-shrink-0">
        <PlayerBar
          players={players}
          currentPlayerId={currentPlayerId}
          selfId={you.playerId}
          stoppedByPlayerId={stoppedByPlayerId}
        />
      </div>

      {/* 2. Status pill */}
      <div className="flex-shrink-0 flex justify-center pt-1 pb-2">
        <div
          data-testid="status-bar"
          className={`px-4 py-1 rounded-full text-sm font-semibold ${
            isMyTurn
              ? "bg-gold/15 text-gold border border-gold/40"
              : "bg-slate-800/40 text-slate-300"
          }`}
        >
          {statusText}
        </div>
      </div>

      {/* 3. Centre area (flex-1 swallows leftover space) */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <CenterArea
          discardRef={discardRef}
          discardTop={discardTop}
          deckCount={deckCount}
          canDraw={canDraw}
          canDiscard={canDiscard}
          isDraggingCard={draggedCard !== null}
          isDragOverDiscard={dragOverDiscard}
          onDrawDeck={handleDrawDeck}
          onDrawDiscard={handleDrawDiscard}
        />

        {/* 4. Instruction (always reserve a line so layout doesn't shift) */}
        <div className="h-5 mt-3 text-xs text-slate-400/90 text-center px-4">
          {instruction ?? ""}
        </div>

        {/* Stop the Bus button — visible only on your turn, draw phase,
            and only if nobody has already stopped. */}
        {canStopTheBus && (
          <button
            data-testid="stop-bus-btn"
            onClick={handleStopTheBus}
            className="mt-3 px-5 py-2 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-sm font-bold shadow-md transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Hand className="w-4 h-4" />
            Stop the Bus
          </button>
        )}
      </div>

      {/* 5. Your hand */}
      <div className="flex-shrink-0">
        <PlayerHand
          hand={you.hand}
          canDiscard={canDiscard}
          onDiscard={handleDiscard}
          discardRef={discardRef}
          onDraggingChange={setDraggedCard}
          onDragOverDiscardChange={setDragOverDiscard}
        />
      </div>

      {/* 6. Footer: self badge */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t border-white/5">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center ${selfColor}`}
          >
            <SelfIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-white">You</div>
            <div className="text-[10px] text-slate-400">
              {you.hand.length} cards
            </div>
          </div>
        </div>
        {stopper && (
          <div className="text-xs px-3 py-1 rounded-full bg-red-600/80 text-white font-semibold">
            {stopper.playerId === you.playerId
              ? "You stopped the bus"
              : `${stopper.name} stopped`}
          </div>
        )}
      </div>
    </div>
  );
}
