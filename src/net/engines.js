// Game modes a Room can run, keyed by options.mode. A new mode registers here; Room stays as is.
import { deckEngine } from './engine-deck.js';
import { diceEngine } from './engine-dice.js';
import { auctionEngine } from './engine-auction.js';

export const ENGINES = Object.fromEntries([deckEngine, diceEngine, auctionEngine].map((e) => [e.mode, e]));
