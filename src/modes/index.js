// Mode renderers the director can play, keyed by options.mode. A mode without a renderer here can be
// picked in the lobby but not started ("coming in the next update").
import { deckMode } from './deck.js';

export const MODES = { deck: deckMode };
export const isPlayable = (mode) => !!MODES[mode]?.ready;
