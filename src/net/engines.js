// Game modes a Room can run, keyed by options.mode. A new mode registers here; Room stays as is.
import { deckEngine } from './engine-deck.js';
import { diceEngine } from './engine-dice.js';

export const ENGINES = { [deckEngine.mode]: deckEngine, [diceEngine.mode]: diceEngine };
