// Game modes a Room can run, keyed by options.mode. A new mode registers here; Room stays as is.
import { deckEngine } from './engine-deck.js';

export const ENGINES = { [deckEngine.mode]: deckEngine };
