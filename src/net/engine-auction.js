// The Gilded Bid (auction mode) as a Room engine (contract in engine-deck.js): src/model/auction.js
// for the rules, src/model/auction-ai.js for bots. Every event is public: bids, returns and
// payments happen face up. A seat's hand reaches only that seat, through its snapshot, and the
// face-down deck never leaves. The Room's 'deal' stage is whatever the table does on its own:
// turn the next card, settle a decided auction, or count the purses at the end.
//
// The Room always fills its four seats (bots take every empty one), which covers the auction's
// minimum of three; the model refuses fewer.
import * as A from '../model/auction.js';
import * as AAI from '../model/auction-ai.js';

const between = (rng, lo, hi) => lo + Math.round(rng() * (hi - lo));
const handCounts = (g) => g.players.map((p) => p.hand.length);

const DEALER = {
  reveal: (g) => ({ type: 'reveal', ...A.reveal(g) }),
  settle: (g) => ({ type: 'taken', ...A.settle(g), handCounts: handCounts(g) }),
  scoring: (g) => ({ type: 'scoring', ...A.score(g) }),
};

export const auctionEngine = {
  mode: 'auction',
  variants: A.VARIANTS,
  ranks: [],
  messageKeys: {
    reveal: ['auction', 'card', 'starter', 'final', 'deckCount'],
    raise: ['seat', 'cards', 'bid', 'handCounts'],
    pass: ['seat', 'returned', 'handCounts'],
    taken: ['seat', 'card', 'paid', 'spilled', 'aleOwed', 'handCounts'],
    scoring: ['remaining', 'money', 'castOut', 'status', 'topCurio', 'place', 'winner'],
  },
  bots: [
    { persona: 'brass', name: 'Brass' },
    { persona: 'noctua', name: 'Madame Noctua' },
    { persona: 'gristle', name: 'Captain Gristle' },
  ],

  newGame({ seats, rng, options }) {
    return { g: A.newGame({ seats, rng, variant: options?.variant ?? 'classic' }) };
  },

  stage(S) {
    const g = S.g;
    if (g.phase === 'bidding') return { kind: 'turn', seat: g.turn, forced: !A.turnOptions(g).canRaise };
    if (g.phase === 'over') return { kind: 'over', winner: A.winner(g) };
    return { kind: 'deal' };
  },

  startRound(S) {
    return DEALER[S.g.phase](S.g);
  },

  applyAction(S, seat, action) {
    const g = S.g;
    if (action.type === 'raise') return { type: 'raise', ...A.raise(g, seat, action.cards), handCounts: handCounts(g) };
    if (action.type === 'pass') return { type: 'pass', ...A.pass(g, seat), handCounts: handCounts(g) };
    throw new Error(`unknown action ${action.type}`);
  },

  turnOptions(S, seat) {
    const o = A.turnOptions(S.g);
    if (!o || o.seat !== seat) return null;
    const { disgrace, highBid, ownBid, canRaise } = o;
    return { disgrace, highBid, ownBid, canRaise };
  },

  botDecide(S, seat, persona, memory, rng) {
    return AAI.decide(A.publicView(S.g, seat), AAI.PERSONAS[persona] || AAI.PERSONAS.player, memory, rng);
  },

  observe() {},

  redact(ev) {
    return ev;
  },

  snapshot(S, seat) {
    const g = S.g;
    return {
      variant: g.variant, auction: g.auction, card: g.card, final: g.final, starter: g.starter,
      deckCount: g.deck.length, turned: g.turned,
      hand: g.players[seat].hand.slice(),
      handCounts: handCounts(g),
      bids: g.players.map((p) => p.bid),
      passed: g.players.map((p) => p.passed),
      won: g.players.map((p) => p.won),
      spent: g.players.map((p) => p.spent),
      spilled: g.players.map((p) => p.spilled),
      aleOwed: g.players.map((p) => p.aleOwed),
      scoring: g.result,
    };
  },

  results(S) {
    const r = S.g.result;
    return S.g.players.map((p, s) => ({ castOut: r.castOut[s], money: r.money[s], status: r.status[s], place: r.place[s] }));
  },

  // A card turns over, a bid slides out, a pass pulls it back, the winner pays card by card, and
  // at the end each purse is opened in turn before the verdict.
  pace(ev, rng) {
    if (ev.type === 'reveal') return ev.final ? 3000 : 2200;
    if (ev.type === 'raise') return 800 + 150 * ev.cards.length;
    if (ev.type === 'pass') return 900;
    if (ev.type === 'taken') return 1600 + 220 * ev.paid.flat().length + (ev.spilled == null ? 0 : 1100);
    if (ev.type === 'scoring') return 3000 + 1200 * ev.money.length;
    return between(rng, 500, 800);
  },

  thinkMs(stage, rng) {
    return stage.forced ? 900 : between(rng, 1200, 2600);
  },
};
