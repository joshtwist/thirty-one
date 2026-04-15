# Thirty-One

Multiplayer Thirty-One card game (a.k.a. Scat, Blitz, Ride the Bus).
Real-time, 2–4 players, runs entirely on Cloudflare Workers + Durable
Objects.

## Stack

- **Frontend** — React 19, Vite, Tailwind CSS, Framer Motion
- **Backend** — Cloudflare Workers with a `GameRoom` Durable Object per
  game (holds state, brokers WebSockets, uses the Hibernation API so
  idle games cost nothing)
- **Transport** — WebSockets for game state; HTTP only for the initial
  asset load
- **Tests** — Playwright (desktop Chrome + iPhone viewport)

One Worker serves both the SPA (via the `[assets]` binding) and the
game API. No separate frontend host.

## How the game works

Each player is dealt **3 cards**. On your turn you either draw from the
deck or the discard pile, then discard one card — exactly like Rummy.

### Scoring

A hand is scored as the **max sum over any single suit**:

- Ace = 11, face cards = 10, others face value
- `A♠ K♠ Q♠` → spades = 31 (a perfect hand — "Thirty-One")
- `A♥ K♥ 2♣` → hearts = 21, clubs = 2 → score 21

### Stop the Bus

At the start of your turn (draw phase), press **Stop the Bus** to
commit to your current hand. You skip drawing/discarding for this
turn. Every other player gets one more normal turn, and when the turn
rotation would come back to you, the game ends and scores are
revealed. Highest score wins; ties go against the stopper.

## Local development

```bash
pnpm install
pnpm start     # runs Vite (:5173) + wrangler dev (:8787) concurrently
```

Open `http://localhost:5173`. Vite proxies `/api/*` and WebSocket
upgrades to the Worker on 8787, mirroring the production routing.

### Dev env vars

Put dev-only variables in `.dev.vars` (gitignored, loaded by
`wrangler dev`, never deployed). The project uses one:

```
TEST_HOOKS=1
```

This gates a server-side `_test_force_hand` WebSocket message that the
Playwright suite uses to deal a known hand (e.g. a perfect 31). With
`TEST_HOOKS` unset (i.e. production), the hook is inert.

### Useful scripts

| Command              | What it does                                              |
|----------------------|-----------------------------------------------------------|
| `pnpm start`         | Vite + wrangler dev in parallel                           |
| `pnpm dev`           | Vite only                                                 |
| `pnpm dev:worker`    | `wrangler dev` only                                       |
| `pnpm build`         | Build the SPA into `dist/`                                |
| `pnpm typecheck`     | TypeScript check for both client and Worker configs       |
| `pnpm types`         | Regenerate `worker-configuration.d.ts` from `wrangler.toml` |
| `pnpm test`          | Playwright end-to-end suite                               |
| `pnpm test:ui`       | Playwright interactive UI                                 |
| `pnpm deploy`        | `pnpm build && wrangler deploy`                           |

After cloning, run `pnpm types` once to regenerate the Worker types
file that's gitignored.

## Tests

```bash
pnpm test
```

Covers the full game loop end-to-end: create room, join, start, deal,
draw, discard, reconnect under WebSocket drops, force a perfect-31
hand, press Stop the Bus, second player takes their final turn, see
the GameComplete screen on both clients, create a rematch, join it
from the other client.

Two Playwright projects run the same specs: one desktop viewport, one
iPhone 14 Pro viewport with touch events and a mobile UA — the game is
phone-first, so mobile layout + touch drag are first-class in CI.

## Deployment (Cloudflare Workers)

One command does everything:

```bash
pnpm deploy
```

That builds the SPA, uploads the Worker + static assets, and runs the
Durable Object migration declared in `wrangler.toml`. First deploy
gives you a free `*.workers.dev` URL. A custom domain can be attached
in the Cloudflare dashboard afterwards.

First-time setup:

```bash
pnpm wrangler login
```

### Automatic deploys

`.github/workflows/deploy.yml` deploys on every push to `main`. It
also exposes a `workflow_dispatch` trigger so you can deploy any
branch manually from the Actions tab.

To enable it, add two repo secrets under Settings → Secrets and
variables → Actions:

- `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → My Profile
  → API Tokens → **Create Token** → use the **Edit Cloudflare Workers**
  template → optionally narrow the Account Resources to just this
  account → Continue → Create. That scoped token covers Workers,
  Durable Objects, and static assets.
- `CLOUDFLARE_ACCOUNT_ID` — shown on the right column of any
  Workers & Pages page in the dashboard, or at the bottom of the
  account home page.

## Project layout

```
src/
  client/              React SPA
    components/        Game UI (PlayerHand, GameComplete, etc.)
    hooks/             useWebSocket, useGameState
    lib/               icons, haptics, storage, celebrations
  server/
    index.ts           Worker entry — routes /api/* to the DO
    game-room.ts       GameRoom DO (state + WS broker)
    game-engine.ts     Pure game state reducers
    deck.ts            Deck, shuffle, deal, scoring
  shared/              Types + wire protocol shared by client & server

e2e/                   Playwright specs and helpers
wrangler.toml          Worker + DO + assets binding
```

Server state is pure: `game-engine.ts` exports reducer-shaped functions
(`addPlayer`, `drawCard`, `discardCard`, `stopTheBus`, …) that take a
`GameState` and return the next one. The DO owns the only mutable
instance and handles WebSockets + persistence. This makes the engine
trivially unit-testable and keeps WS/storage plumbing out of the game
rules.
