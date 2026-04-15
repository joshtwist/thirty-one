import { test, expect } from "@playwright/test";
import {
  createGame,
  joinAs,
  findActivePage,
  setupTwoPlayers,
  dragFirstCardToDiscard,
} from "./helpers.ts";
import type { Card } from "../src/shared/types.ts";

/**
 * End-to-end exercise of the full game-end state machine for Thirty-One:
 *
 *   lobby → dealing → playing → (Stop the Bus) → complete → rematch
 *
 * We force the active player's hand to a perfect 31 so they're guaranteed
 * to win, then press Stop the Bus. The remaining player gets one more
 * turn, then the game ends and scores are revealed.
 *
 * After the win, we verify:
 *   - Both clients see the GameComplete screen with all hands.
 *   - Winner banner shows the correct name.
 *   - Final-scores panel lists both players with their scores.
 *   - Winner clicks "Create New Game" and is auto-navigated.
 *   - Other player sees a "Join {winner}'s New Game" CTA.
 *   - Both end up in the new lobby.
 */
test("Stop the Bus ends the game; highest score wins; rematch works", async ({
  browser,
}) => {
  const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);

  try {
    const { gameUrl: oldGameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(oldGameUrl);
    await joinAs(page2, "Bob", "dog");
    await page1.getByTestId("start-game-btn").click();

    // Wait for deal animation to settle into the playing phase
    await expect(page1.getByTestId("status-bar")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("status-bar")).toBeVisible({
      timeout: 10_000,
    });
    await page1.waitForTimeout(600);

    // Whoever's turn it is goes first. We give that player a perfect 31.
    const { active, waiting } = await findActivePage(page1, page2);
    const winnerName = active === page1 ? "Alice" : "Bob";
    const loserName = active === page1 ? "Bob" : "Alice";

    // Force a perfect 31 hand (A♠ K♠ Q♠ = 11+10+10 = 31 in spades).
    const perfectHand: Card[] = [
      { suit: "spades", rank: "A" },
      { suit: "spades", rank: "K" },
      { suit: "spades", rank: "Q" },
    ];
    await active.evaluate((hand) => {
      const ws = (window as unknown as { __ws?: WebSocket }).__ws;
      if (!ws) throw new Error("dev __ws hook missing — TEST_HOOKS not enabled?");
      ws.send(JSON.stringify({ type: "_test_force_hand", hand }));
    }, perfectHand);

    // Wait for the forced A♠ to actually appear in the active hand
    await expect(active.getByTestId("hand-card-spades-A")).toBeVisible({
      timeout: 5_000,
    });
    await active.waitForTimeout(300);

    // Stop the Bus button is visible on the active player's draw phase.
    await expect(active.getByTestId("stop-bus-btn")).toBeVisible();
    await active.getByTestId("stop-bus-btn").click();

    // Turn now belongs to the other player; stopper badge is visible
    await expect(waiting.getByTestId("status-bar")).toHaveText(/your turn/i, {
      timeout: 5_000,
    });
    // The stop-the-bus button should NOT be available to the second player
    // — only one stop per game, and they're not the one who stopped.
    // (Actually: they CAN see the button, but pressing it should fail.
    //  We just verify the button is gone once somebody has stopped.)
    await expect(waiting.getByTestId("stop-bus-btn")).toHaveCount(0);

    // Second player plays their final turn: draw + discard.
    await waiting.getByTestId("deck").click();
    await expect(
      waiting.locator('[data-testid^="hand-card-"]'),
    ).toHaveCount(4, { timeout: 5_000 });
    await dragFirstCardToDiscard(waiting);

    // Both clients see GameComplete with the winner banner
    await expect(active.getByTestId("winner-banner")).toBeVisible({
      timeout: 8_000,
    });
    await expect(waiting.getByTestId("winner-banner")).toBeVisible({
      timeout: 8_000,
    });
    await expect(active.getByTestId("winner-banner")).toContainText(
      /you won/i,
    );
    await expect(waiting.getByTestId("winner-banner")).toContainText(
      new RegExp(`${winnerName} wins`, "i"),
    );

    // Both should see the final hands panel
    await expect(active.getByTestId("final-scores")).toBeVisible();
    await expect(waiting.getByTestId("final-scores")).toBeVisible();
    await expect(
      waiting.getByTestId(`score-row-${winnerName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`score-row-${loserName}`),
    ).toBeVisible();

    // The winner's row should show 31 points
    await expect(
      waiting.getByTestId(`score-row-${winnerName}`),
    ).toContainText("31 points");

    // Winner clicks "Create New Game"; auto-navigates to the new lobby
    await active.getByTestId("create-rematch-btn").click();
    await active.waitForURL(
      (u) => u.pathname !== new URL(oldGameUrl).pathname,
      { timeout: 8_000 },
    );
    await expect(active.getByText("Lobby")).toBeVisible({ timeout: 8_000 });
    await expect(
      active.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();

    // Loser sees the "Join X's New Game" button (no auto-redirect)
    await expect(waiting.getByTestId("join-rematch-btn")).toBeVisible({
      timeout: 5_000,
    });
    await expect(waiting.getByTestId("join-rematch-btn")).toContainText(
      new RegExp(winnerName, "i"),
    );
    expect(waiting.url()).toBe(oldGameUrl);

    // Loser clicks join; ends up in the new lobby too
    await waiting.getByTestId("join-rematch-btn").click();
    await waiting.waitForURL(
      (u) => u.pathname !== new URL(oldGameUrl).pathname,
      { timeout: 8_000 },
    );
    await expect(waiting.getByText("Lobby")).toBeVisible({ timeout: 8_000 });

    // Both players should now be visible in the new lobby on both pages
    await expect(
      active.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();
    await expect(
      active.getByTestId(`lobby-player-${loserName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`lobby-player-${loserName}`),
    ).toBeVisible();
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
