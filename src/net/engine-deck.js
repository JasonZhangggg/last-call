// The card ("deck") mode as a Room engine: src/model/rules.js for the rules, src/model/ai.js for
// bots, plus everything mode-specific the Room must not know: card tokens, what each seat may
// see, and the rhythm of the table.
//
// Engine contract (a dice engine implements the same object):
//   mode, variants, ranks, messageKeys: { type: [keys] }, bots: [{ persona, name }]
//   newGame({ seats, rng, options }) -> state S (plain JSON, persisted by the Room)
//   stage(S) -> { kind: 'deal' } | { kind: 'turn'|'roulette', seat, forced } | { kind: 'over', winner }
//     'roulette' is the Room's penalty prompt, answered by the seat's 'pull' action. An event
//     may leave several seats to pay in turn: stage() names the next one each time.
//   startRound(S, rng, mintToken) -> event
//   applyAction(S, seat, action) -> event; throws Error(reason) when illegal, changing nothing.
//     action is { type, ...fields } for one of the protocol's GAME_ACTIONS.
//   turnOptions(S, seat) -> options for the acting seat's prompt (null for roulette)
//   botDecide(S, seat, persona | null, memory, rng) -> action
//   observe(memory, event)
//   redact(event, seat, S) -> the message that seat receives (the only path to the wire)
//   snapshot(S, seat) -> per-seat rebuild payload for `state`
//   results(S) -> [{ alive, pulls }]
//   pace(event, rng) / thinkMs(stage, rng) -> pacing in ms
import * as R from '../model/rules.js';
import * as AI from '../model/ai.js';

const DEAL_MS_PER_CARD = 65;

const handCounts = (g) => g.players.map((p) => p.hand.length);
const shown = (S, c) => ({ token: S.tokenOf[c.id], rank: c.rank });
const between = (rng, lo, hi) => lo + Math.round(rng() * (hi - lo));

export const deckEngine = {
  mode: 'deck',
  variants: R.VARIANTS,
  ranks: R.RANKS,
  messageKeys: {
    round: ['round', 'tableRank', 'starter', 'hand', 'handCounts'],
    played: ['seat', 'tokens', 'claim', 'handCounts'],
    challenge: ['caller', 'accused', 'forced', 'cards', 'lie', 'shooters'],
    shot: ['seat', 'fired', 'pulls'],
  },
  bots: [
    { persona: 'brass', name: 'Brass' },
    { persona: 'noctua', name: 'Madame Noctua' },
    { persona: 'gristle', name: 'Captain Gristle' },
  ],

  newGame({ seats, rng, options }) {
    return { g: R.newGame({ seats, rng, variant: options?.variant ?? 'basic' }), tokenOf: {}, reveal: null };
  },

  stage(S) {
    const g = S.g;
    if (g.phase === 'between') return { kind: 'deal' };
    if (g.phase === 'turn') return { kind: 'turn', seat: g.turn, forced: R.turnOptions(g).mustChallenge };
    if (g.phase === 'roulette') return { kind: 'roulette', seat: g.pending.seat, forced: false };
    return { kind: 'over', winner: R.winner(g) };
  },

  startRound(S, rng, mintToken) {
    const d = R.startRound(S.g, rng);
    // Fresh tokens every round: a token never outlives the round, so nothing links a card to an
    // earlier reveal, and model ids (which map to ranks) never reach the wire.
    S.tokenOf = {};
    for (const { card } of d.deal) S.tokenOf[card.id] = mintToken();
    S.reveal = null;
    return {
      type: 'round', round: S.g.round, tableRank: d.tableRank, starter: d.starter,
      hands: S.g.players.map((p) => p.hand.slice()), handCounts: handCounts(S.g),
    };
  },

  applyAction(S, seat, action) {
    const g = S.g;
    if (action.type === 'play') {
      const idOf = new Map(Object.entries(S.tokenOf).map(([id, t]) => [t, Number(id)]));
      const ids = action.tokens.map((t) => idOf.get(t));
      if (ids.some((id) => id === undefined)) throw new Error('card not in hand');
      const p = R.play(g, seat, ids);
      return { type: 'played', seat, tokens: p.cards.map((c) => S.tokenOf[c.id]), claim: p.claim, handCounts: handCounts(g) };
    }
    if (action.type === 'challenge') {
      const forced = !!R.turnOptions(g)?.mustChallenge;
      const res = R.challenge(g, seat);
      const ev = { type: 'challenge', caller: res.caller, accused: res.accused, forced, cards: res.cards.map((c) => shown(S, c)), lie: res.lie, shooters: res.shooters };
      S.reveal = ev;
      return ev;
    }
    if (action.type === 'pull') {
      const shot = R.pullTrigger(g, seat);
      return { type: 'shot', seat, fired: shot.fired, pulls: shot.pulls };
    }
    throw new Error(`unknown action ${action.type}`);
  },

  turnOptions(S, seat) {
    const o = R.turnOptions(S.g);
    if (!o || o.seat !== seat) return null;
    return { canPlay: o.canPlay, canChallenge: o.canChallenge, mustChallenge: o.mustChallenge, maxCards: o.maxCards };
  },

  botDecide(S, seat, persona, memory, rng) {
    if (S.g.phase === 'roulette') return { type: 'pull' };
    const act = AI.decide(R.publicView(S.g, seat), AI.PERSONAS[persona] || AI.PERSONAS.player, memory, rng);
    return act.type === 'play' ? { type: 'play', tokens: act.cardIds.map((id) => S.tokenOf[id]) } : { type: 'challenge' };
  },

  observe(memory, ev) {
    if (ev.type === 'challenge') AI.observeReveal(memory, ev.accused, ev.lie);
  },

  redact(ev, seat, S) {
    if (ev.type === 'round') {
      const { hands, ...pub } = ev;
      return { ...pub, hand: seat == null ? [] : hands[seat].map((c) => shown(S, c)) };
    }
    return ev;
  },

  snapshot(S, seat) {
    const g = S.g;
    return {
      variant: g.variant, round: g.round, tableRank: g.tableRank, starter: g.starter,
      hand: g.round ? g.players[seat].hand.map((c) => shown(S, c)) : [],
      handCounts: handCounts(g),
      plays: g.plays.map((p) => ({ seat: p.seat, claim: p.claim, tokens: p.cards.map((c) => S.tokenOf[c.id]) })),
      alive: g.players.map((p) => p.alive),
      pulls: g.players.map((p) => p.pulls),
      reveal: S.reveal,
    };
  },

  results(S) {
    return S.g.players.map((p) => ({ alive: p.alive, pulls: p.pulls }));
  },

  // Matches the single-player director: gather and shuffle, deal, then the table card beat.
  pace(ev, rng) {
    if (ev.type === 'round') return 1350 + ev.hands.flat().length * DEAL_MS_PER_CARD + 600 + 1500;
    if (ev.type === 'played') return 950;
    if (ev.type === 'challenge') return 3850;
    if (ev.type === 'shot') return ev.fired ? 3000 : 2200;
    return between(rng, 500, 800);
  },

  thinkMs(stage, rng) {
    if (stage.kind === 'roulette') return between(rng, 3000, 4000);
    return stage.forced ? 1400 : between(rng, 900, 1800);
  },
};
