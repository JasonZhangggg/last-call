// The Dice mode as a Room engine (contract in engine-deck.js): src/model/dice.js for the rules,
// src/model/dice-ai.js for bots. Dice need no tokens: a seat's own dice go only to that seat,
// and every cup is shown at once when a call reveals them. The poisoned glass never leaves.
import * as D from '../model/dice.js';
import * as DAI from '../model/dice-ai.js';
import { PERSONAS } from '../model/ai.js';

const absentSeats = (g) => g.players.map((p) => !!p.absent);
const between = (rng, lo, hi) => lo + Math.round(rng() * (hi - lo));
const diceCounts = (g) => g.players.map((p) => p.dice.length);

export const diceEngine = {
  mode: 'dice',
  variants: D.VARIANTS,
  minPlayers: 2,
  ranks: [],
  messageKeys: {
    round: ['round', 'starter', 'dice', 'diceCounts'],
    bid: ['seat', 'quantity', 'face'],
    challenge: ['caller', 'bidder', 'call', 'forced', 'quantity', 'face', 'cups', 'count', 'callerRight', 'drinkers'],
    drink: ['seat', 'poisoned', 'drinks'],
  },
  bots: [
    { persona: 'brass', name: 'Brass' },
    { persona: 'noctua', name: 'Madame Noctua' },
    { persona: 'gristle', name: 'Captain Gristle' },
  ],

  newGame({ seats, rng, options, absent = [] }) {
    return { g: D.newGame({ seats, rng, variant: options?.variant ?? 'basic', absent }), reveal: null };
  },

  stage(S) {
    const g = S.g;
    if (g.phase === 'between') return { kind: 'deal' };
    if (g.phase === 'turn') {
      const o = D.turnOptions(g);
      return { kind: 'turn', seat: g.turn, forced: o.mustChallenge && !o.canSpotOn };
    }
    if (g.phase === 'drink') return { kind: 'roulette', seat: g.pending.seat, forced: false };
    return { kind: 'over', winner: D.winner(g) };
  },

  startRound(S, rng) {
    const r = D.startRound(S.g, rng);
    S.reveal = null;
    return { type: 'round', round: r.round, starter: r.starter, cups: r.dice, diceCounts: diceCounts(S.g) };
  },

  applyAction(S, seat, action) {
    const g = S.g;
    if (action.type === 'bid') {
      const b = D.bid(g, seat, action.quantity, action.face);
      return { type: 'bid', seat, quantity: b.quantity, face: b.face };
    }
    if (action.type === 'challenge' || action.type === 'spotOn') {
      const forced = !!D.turnOptions(g)?.mustChallenge;
      const res = action.type === 'spotOn' ? D.spotOn(g, seat) : D.challenge(g, seat);
      const ev = {
        type: 'challenge', caller: res.caller, bidder: res.bidder, call: res.call, forced, quantity: res.quantity, face: res.face,
        cups: res.cups, count: res.count, callerRight: res.callerRight, drinkers: res.drinkers,
      };
      S.reveal = ev;
      return ev;
    }
    if (action.type === 'pull') {
      const d = D.drink(g, seat);
      return { type: 'drink', seat, poisoned: d.poisoned, drinks: d.drinks };
    }
    throw new Error(`unknown action ${action.type}`);
  },

  turnOptions(S, seat) {
    const o = D.turnOptions(S.g);
    if (!o || o.seat !== seat) return null;
    const { canBid, canChallenge, canSpotOn, mustChallenge, maxQuantity, raises } = o;
    return { canBid, canChallenge, canSpotOn, mustChallenge, maxQuantity, raises };
  },

  botDecide(S, seat, persona, memory, rng) {
    if (S.g.phase === 'drink') return { type: 'pull' };
    return DAI.decide(D.publicView(S.g, seat), PERSONAS[persona] || PERSONAS.player, memory, rng);
  },

  observe(memory, ev) {
    if (ev.type === 'challenge') DAI.observeReveal(memory, ev);
  },

  redact(ev, seat) {
    if (ev.type === 'round') {
      const { cups, ...pub } = ev;
      return { ...pub, dice: seat == null ? [] : cups[seat].slice() };
    }
    return ev;
  },

  snapshot(S, seat) {
    const g = S.g;
    return {
      variant: g.variant, absent: absentSeats(g), round: g.round, starter: g.starter,
      dice: g.players[seat].dice.slice(),
      diceCounts: diceCounts(g),
      bids: g.bids.map((b) => ({ seat: b.seat, quantity: b.quantity, face: b.face })),
      alive: g.players.map((p) => p.alive),
      drinks: g.players.map((p) => p.drinks),
      reveal: S.reveal,
    };
  },

  results(S) {
    return S.g.players.map((p) => ({ alive: p.alive, drinks: p.drinks }));
  },

  // Cups rattle and slam, a bid is spoken, a call lifts every cup and counts, a glass is drunk.
  pace(ev, rng) {
    if (ev.type === 'round') return 2800;
    if (ev.type === 'bid') return 1100;
    if (ev.type === 'challenge') return 4200;
    if (ev.type === 'drink') return ev.poisoned ? 3000 : 2200;
    return between(rng, 500, 800);
  },

  thinkMs(stage, rng) {
    if (stage.kind === 'roulette') return between(rng, 2500, 3500);
    return stage.forced ? 1400 : between(rng, 1100, 2200);
  },
};
