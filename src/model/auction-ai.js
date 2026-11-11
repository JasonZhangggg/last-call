// Bot policy for The Gilded Bid. Reads only an auction publicView: its own hand and the table.
// Opponents' purses are worked out from the public discards, as a careful player would.
//
// A bot turns the card into status points (what it adds to, or costs, its projected final
// status), then into crowns: its spendable money split between this card and its fair share of
// the cards still to come. Spendable money is what it holds above a reserve set by the poorest
// rival's purse: well under it early, while rivals still have auctions to spend in, and one
// crown over it by the end. It never bids a total that would leave it tied with that purse.
import { DEBT_PENALTY, MONEY, isGilded, statusDeck, sum } from './auction.js';

const PURSE = sum(MONEY);

// greed: how hard it chases what it wants; risk: how far below the poorest rival it dares to
// dip while rivals still have auctions to spend in; dodge: how much a disgrace scares it;
// favour: its taste for the doubling cards; jump: chance of a jump bid; noise: how loosely it
// values things.
export const PERSONAS = {
  brass: { greed: 1.0, risk: 1.0, dodge: 1.0, favour: 1.0, jump: 0.05, noise: 0.08 },
  noctua: { greed: 0.95, risk: 0.9, dodge: 1.25, favour: 1.25, jump: 0.2, noise: 0.2 },
  gristle: { greed: 1.15, risk: 0.8, dodge: 0.85, favour: 0.9, jump: 0.2, noise: 0.25 },
  player: { greed: 1.0, risk: 1.0, dodge: 1.0, favour: 1.0, jump: 0.1, noise: 0.15 },
};

export const newMemory = () => ({});

const PASS = Object.freeze({ type: 'pass' });
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** The face-down cards: the full deck minus every card turned so far. */
function unseenCards(turned) {
  const left = statusDeck();
  for (const c of turned) left.splice(left.findIndex((x) => x.kind === c.kind && x.value === c.value), 1);
  return left;
}

/**
 * What is still to come. The game ends on the last gilded card, so a face-down plain card is
 * auctioned with chance G/(G+1) and a face-down gilded one with (G-1)/G, for G gilded unseen.
 */
export function outlook(view) {
  const unseen = unseenCards(view.turned);
  const G = unseen.filter(isGilded).length;
  const pPlain = G / (G + 1), pGilded = G ? (G - 1) / G : 0;
  const curios = unseen.filter((c) => c.kind === 'curio').map((c) => c.value);
  return {
    auctionsLeft: G ? (G * (unseen.length + 1)) / (G + 1) - 1 : 0,
    curios: sum(curios) * pPlain,
    meanCurio: curios.length ? sum(curios) / curios.length : 0,
    favours: unseen.filter((c) => c.kind === 'favour').length * pGilded,
    seats: view.players.length,
  };
}

/** A seat's projected final base (curios less debt) and multiplier, with a fair share of what is to come. */
function projection(player, look) {
  const curios = player.won.filter((c) => c.kind === 'curio');
  const favours = player.won.filter((c) => c.kind === 'favour').length;
  const has = (kind) => player.won.some((c) => c.kind === kind);
  const base = sum(curios.map((c) => c.value)) + look.curios / look.seats - (has('debt') ? DEBT_PENALTY : 0);
  const mult = 2 ** favours * (has('scandal') ? 0.5 : 1) * (1 + look.favours / look.seats);
  return { base, mult, lowestCurio: curios.length ? Math.min(...curios.map((c) => c.value)) : null };
}

/** The card's worth to this seat in status points: positive to want, negative to dodge. */
function cardValue(card, player, look, persona) {
  const { base, mult, lowestCurio } = projection(player, look);
  switch (card.kind) {
    case 'curio': return player.aleOwed ? 0 : card.value * mult;
    case 'favour': return base * mult * persona.favour;
    case 'debt': return -DEBT_PENALTY * mult;
    case 'ale': return -(lowestCurio ?? look.meanCurio) * mult;
    case 'scandal': return -(base * mult) / 2;
  }
  throw new Error(`unknown card ${card.kind}`);
}

const purse = (p) => PURSE - sum(p.spent);

/**
 * The most this seat should have in front of it this auction, and the one total it must not
 * bid: the one that would leave it tied with the poorest rival, since a tie for the least is
 * cast out too.
 */
function budget(view, persona, rng) {
  const o = view.options, me = view.players[view.seat], look = outlook(view);
  const mine = sum(view.hand) + o.ownBid;
  const others = view.players.filter((p) => p.seat !== view.seat).map(purse);
  const poorest = Math.min(...others);
  const tie = mine - poorest;
  // Rivals still have auctions to spend in, so early on the reserve sits well under the poorest;
  // by the end it is one crown above them.
  const ahead = clamp(look.auctionsLeft / 10, 0, 1);
  const spendable = mine - (poorest * (1 - 0.5 * persona.risk * ahead) + 1);
  const value = cardValue(view.card, me, look, persona);
  if (spendable <= 0 || (o.disgrace ? value >= 0 : value <= 0)) return { limit: 0, tie };
  const { base, mult } = projection(me, look);
  const toCome = ((look.curios + look.favours * Math.max(base, 1)) * mult) / look.seats;
  const share = Math.abs(value) / (Math.abs(value) + toCome);
  const mood = 1 + persona.noise * (rng() - 0.5) * 2;
  const rich = clamp(mine / (sum(others) / others.length), 0.7, 1.4);
  const drive = o.disgrace ? persona.dodge * rich : persona.greed;
  return { limit: Math.min(spendable, spendable * share * drive * mood), tie };
}

/** For every total the hand can make, the fewest cards that make it. */
function totals(hand) {
  const best = [[]];
  for (const v of hand) {
    for (let s = best.length - 1; s >= 0; s--) {
      if (!best[s]) continue;
      const t = s + v;
      if (!best[t] || best[s].length + 1 < best[t].length) best[t] = [...best[s], v];
    }
  }
  return best;
}

export function decide(view, persona, memory, rng) {
  const o = view.options;
  if (!o) throw new Error('decide() called off-turn');
  if (!o.canRaise) return PASS;
  const { limit, tie } = budget(view, persona, rng);
  const least = o.highBid + 1;
  if (limit < least) return PASS;
  const made = totals(view.hand);
  const cheapest = (from) => {
    for (let bid = from; bid <= limit; bid++) if (bid !== tie && made[bid - o.ownBid]) return made[bid - o.ownBid];
    return null;
  };
  const jump = rng() < persona.jump ? cheapest(Math.round(least + (limit - least) * (0.15 + 0.3 * rng()))) : null;
  const cards = jump || cheapest(least);
  return cards ? { type: 'raise', cards } : PASS;
}
