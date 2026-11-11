// The client's mirror of a dice table: the same shape as the dice engine's `state.game` snapshot,
// advanced one message at a time. Your own dice arrive with each round; everyone's arrive with a call.
import { WILD } from '../model/dice.js';

/** Applies one server message to a snapshot-shaped game. Returns the game (mutated in place). */
export function reduceDice(game, msg, me) {
  switch (msg.type) {
    case 'round':
      game.round = msg.round; game.starter = msg.starter;
      game.dice = msg.dice.slice(); game.diceCounts = msg.diceCounts.slice();
      game.bids = []; game.reveal = null;
      break;
    case 'bid':
      game.bids.push({ seat: msg.seat, quantity: msg.quantity, face: msg.face });
      break;
    case 'challenge':
      game.reveal = structuredClone(msg);
      break;
    case 'drink':
      game.drinks[msg.seat] = msg.drinks;
      if (msg.poisoned) {
        game.alive[msg.seat] = false;
        game.diceCounts[msg.seat] = 0;
        if (msg.seat === me) game.dice = [];
      }
      break;
  }
  return game;
}

export const lastBid = (game) => game.bids[game.bids.length - 1] || null;
export const totalDice = (game) => game.diceCounts.reduce((n, c) => n + c, 0);
export const matches = (die, face) => die === face || die === WILD;
