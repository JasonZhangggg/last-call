// Dice bot policy. Reads only a dice publicView: its own dice, the bids and the dice counts.
// It weighs each option by the chance it ends up drinking, from the exact distribution of
// matches among the dice it cannot see.
import { BID_FACES, WILD, FACES } from './dice.js';

const P_MATCH = 2 / FACES;

export const newMemory = () => ({});

/** Remember whether a challenged bid was a bluff, so habitual bluffers get called more. */
export function observeReveal(memory, res) {
  const m = (memory[res.bidder] ||= { bluffs: 0, honest: 0 });
  res.count < res.quantity ? m.bluffs++ : m.honest++;
}
const bluffRate = (memory, seat) => { const m = memory[seat] || { bluffs: 0, honest: 0 }; return (m.bluffs + 1) / (m.bluffs + m.honest + 3); };

const ownMatches = (view, face) => view.dice.filter((d) => d === face || d === WILD).length;
const unknownDice = (view) => view.players.reduce((n, p) => n + (p.seat === view.seat ? 0 : p.diceCount), 0);

export const expectedCount = (view, face) => ownMatches(view, face) + unknownDice(view) * P_MATCH;

/** Distribution of matches among the unseen dice. `lean` gives one seat's dice a higher match chance. */
function unseenDistribution(view, lean) {
  let dist = [1];
  for (const p of view.players) {
    if (p.seat === view.seat) continue;
    const q = lean && lean.seat === p.seat ? lean.p : P_MATCH;
    for (let i = 0; i < p.diceCount; i++) {
      const next = new Array(dist.length + 1).fill(0);
      dist.forEach((x, k) => { next[k] += x * (1 - q); next[k + 1] += x * q; });
      dist = next;
    }
  }
  return dist;
}

export function probAtLeast(view, quantity, face, lean = null) {
  const need = quantity - ownMatches(view, face);
  if (need <= 0) return 1;
  const dist = unseenDistribution(view, lean);
  let s = 0;
  for (let k = need; k < dist.length; k++) s += dist[k];
  return s;
}

export function probExactly(view, quantity, face, lean = null) {
  const need = quantity - ownMatches(view, face);
  return need < 0 ? 0 : unseenDistribution(view, lean)[need] ?? 0;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function openingBid(view, persona, rng) {
  const best = Math.max(...BID_FACES.map((f) => ownMatches(view, f)));
  const strong = BID_FACES.filter((f) => ownMatches(view, f) === best);
  const face = rng() < persona.bluff * 0.3 ? BID_FACES[Math.floor(rng() * BID_FACES.length)] : strong[Math.floor(rng() * strong.length)];
  const target = 0.82 - 0.25 * persona.bluff + (rng() - 0.5) * 0.2;
  let quantity = 1;
  while (quantity < view.options.maxQuantity && probAtLeast(view, quantity + 1, face) >= target) quantity++;
  return { type: 'bid', quantity, face };
}

export function decide(view, persona, memory, rng) {
  const o = view.options;
  if (!o) throw new Error('decide() called off-turn');
  const last = view.bids[view.bids.length - 1];
  if (!last) return openingBid(view, persona, rng);

  const noise = () => (rng() - 0.5) * 0.3 * (1 - persona.count);
  // A bid hints at the bidder's own cup; a careful counter reads it, unless that seat bluffs a lot.
  const lean = { seat: last.seat, p: P_MATCH + 0.2 * persona.count * (1 - bluffRate(memory, last.seat)) };
  const pTrue = probAtLeast(view, last.quantity, last.face, lean);
  const risks = [];
  if (pTrue < 1) risks.push({ act: { type: 'challenge' }, risk: clamp01(pTrue + noise()) - (persona.suspicion - 0.5) * 0.25 });
  if (o.canSpotOn) {
    const pExact = probExactly(view, last.quantity, last.face, lean);
    // Being exactly right makes everyone else drink, which is worth taking a worse chance for.
    if (pExact > 0) risks.push({ act: { type: 'spotOn' }, risk: 1 - clamp01(pExact + noise()) - 0.25 - persona.bluff * 0.1 });
  }
  let best = null;
  for (const r of o.raises) for (const quantity of [r.minQuantity, r.minQuantity + 1]) {
    if (quantity > o.maxQuantity) continue;
    const p = probAtLeast(view, quantity, r.face);
    const score = p + persona.bluff * 0.25 * rng() + noise();
    if (!best || score > best.score) best = { quantity, face: r.face, p, score };
  }
  // Raising passes the risk on: it only costs a glass if the next seat calls and the bid falls.
  if (best) risks.push({ act: { type: 'bid', quantity: best.quantity, face: best.face }, risk: (1 - best.p) * (0.45 + 0.2 * persona.greed) });
  if (!risks.length) return { type: 'challenge' };
  return risks.reduce((a, b) => (b.risk < a.risk ? b : a)).act;
}
