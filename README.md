# Last Call

A three.js bluffing game set in The Crooked Lantern tavern. Play solo against Brass, Madame Noctua
and Captain Gristle, or open a table online and fill the empty seats with bots.

Live: https://last-call.jasonxyz.workers.dev

## Games

- **Cards.** Claim your cards match the table card, or call the last player a liar. The loser
  faces the revolver. Classic or Devil rules.
- **Dice.** Five dice under each cup, ones wild. Raise the bid, call Liar, or call Spot On
  (Traditional). The loser drinks from the poison tray.
- **The Gilded Bid.** An auction for curios, favours and disgraces with hidden money. The poorest
  player can never win.

Rules for all three are in `docs/RULES.md`.

## Run it

```bash
npm install
npm test            # rules, server room, and client mirror tests
npm run build       # bundles src/ into dist/index.html
npx wrangler dev    # local server with online rooms
```

## Layout

- `src/model/` holds the pure rules and bots for each game.
- `src/net/` holds the server: a Durable Object room, one engine per game, and the client transports.
- `src/modes/` holds the client table for each game, driven by server messages.
- `src/render/` holds the scene, characters, cards, revolver, camera and motion.
- `scripts/` holds the headless checks: `verify.mjs`, `e2e-online.mjs`, `motion-probe.mjs`,
  `shake-probe.mjs` and `perf-probe.mjs`.
