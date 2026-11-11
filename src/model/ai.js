// AI policy. Reads only a publicView, never the hidden hands.
import { matchesTable, TRUE_CARDS_PER_RANK, shuffleInPlace, DEVIL, JOKER, DEVIL_VOLLEY_MIN_ALIVE } from './rules.js';

export const PERSONAS = {
  brass:   { bluff: 0.22, suspicion: 0.42, tell: 0.3, count: 1.0, greed: 0.35 },
  noctua:  { bluff: 0.6,  suspicion: 0.55, tell: 0.45, count: 0.65, greed: 0.55 },
  gristle: { bluff: 0.48, suspicion: 0.72, tell: 0.6, count: 0.35, greed: 0.7 },
  player:  { bluff: 0.4,  suspicion: 0.5,  tell: 0, count: 0.8, greed: 0.5 },
};

export const newMemory = () => ({});
export function observeReveal(memory, accusedSeat, lie) {
  const m = (memory[accusedSeat] ||= { lies: 0, truths: 0 });
  lie ? m.lies++ : m.truths++;
}
const liarRate = (memory, seat) => { const m = memory[seat] || { lies: 0, truths: 0 }; return (m.lies + 1.2) / (m.lies + m.truths + 3); };

/** Probability this seat should call the last play a lie. Exposed for tests. */
export function suspicionOf(view, persona, memory) {
  const lp = view.plays[view.plays.length - 1];
  if (!lp || lp.seat === view.seat) return 0;
  const T = view.tableRank;
  const myTrue = view.hand.filter((c) => matchesTable(c, T)).length;
  let myPlayedTrue = 0, othersClaimed = 0;
  for (const pl of view.plays) {
    if (pl.seat === view.seat) myPlayedTrue += pl.own.filter((c) => matchesTable(c, T)).length;
    else othersClaimed += pl.claim;
  }
  const unseen = TRUE_CARDS_PER_RANK - myTrue - myPlayedTrue;
  if (othersClaimed > unseen) return 0.55 + 0.45 * persona.count;
  const accused = view.players[lp.seat];
  let p = 0.1 + 0.11 * (lp.claim - 1);
  p += 0.5 * persona.count * Math.pow(othersClaimed / Math.max(1, unseen), 2);
  p += (liarRate(memory, lp.seat) - 0.4) * 0.6;
  if (accused.handCount === 0) p += 0.12;
  if (myTrue === 0) p += 0.18;
  // A lone card might be the Devil: calling it makes the caller shoot as surely as being wrong.
  if (lp.claim === 1 && devilVolleyLive(view) && !view.hand.some((c) => c.rank === DEVIL)) p -= 0.1;
  p += (persona.suspicion - 0.5) * 0.3;
  return Math.min(0.95, Math.max(0.03, p));
}

const devilVolleyLive = (view) => view.variant === 'devil' && view.players.filter((p) => p.alive).length >= DEVIL_VOLLEY_MIN_ALIVE;

export function choosePlay(view, persona, rng) {
  const T = view.tableRank;
  const devil = view.hand.find((c) => c.rank === DEVIL);
  const real = view.hand.filter((c) => c.rank === T);
  const jokers = view.hand.filter((c) => c.rank === JOKER);
  const lies = shuffleInPlace(view.hand.filter((c) => !matchesTable(c, T) && c.rank !== DEVIL), rng);
  const trues = [...real, ...jokers];
  const max = view.options.maxCards;
  if (devil) {
    const eager = devilVolleyLive(view) ? 0.3 + persona.bluff * 0.4 + (trues.length ? 0 : 0.3) : 0;
    if ((!trues.length && !lies.length) || rng() < eager) return [devil.id];
  }
  if (!trues.length) {
    const n = Math.min(max, lies.length >= 2 && rng() < 0.2 + persona.bluff * 0.3 ? 2 : 1);
    return lies.slice(0, n).map((c) => c.id);
  }
  let n = rng() < 0.55 - persona.greed * 0.2 ? 1 : rng() < 0.75 ? 2 : 3;
  if (!lies.length) n = 3;
  const out = trues.slice(0, Math.min(n, trues.length, max));
  if (lies.length && out.length < max && rng() < persona.bluff * 0.45) out.push(lies[0]);
  return out.map((c) => c.id);
}

export function decide(view, persona, memory, rng) {
  const o = view.options;
  if (!o) throw new Error('decide() called off-turn');
  if (o.mustChallenge || !o.canPlay) return { type: 'challenge' };
  if (o.canChallenge && rng() < suspicionOf(view, persona, memory)) return { type: 'challenge' };
  return { type: 'play', cardIds: choosePlay(view, persona, rng) };
}

/** Whether an AI visibly "tells" after a play. False tells keep it honest. */
export const showsTell = (persona, lied, rng) => (lied ? rng() < persona.tell : rng() < 0.12);
