// Mode renderers the director can play, keyed by options.mode. A mode without a renderer here can be
// picked in the lobby but not started ("coming in the next update").
//
// A mode is two files: src/modes/<mode>-state.js (pure, node-testable) and src/modes/<mode>.js (the
// renderer). The renderer exports one object; the director calls it with T, its table context
// (src/director.js), and never looks inside. Every field below is required unless marked optional.
//
//   mode, ready: true
//   reduce(game, msg, me)        the pure mirror: applies one server message to a game shaped like
//                                the engine's `state.game` snapshot (mutate and return it). Run twice:
//                                at receipt (D.latest, for rebuilds) and at play time (T.game).
//   newRecap() -> {}             optional; per-game stats object, read back as T.recap
//   enter(T) / exit(T)           show / hide this mode's table pieces and bind its DOM controls once
//   rebuild(T, { fresh })        place everything from T.game at once. fresh: a new game (round 0)
//   on: { [msgType]: async (T, msg) }
//                                one handler per game message type, awaited in order. Also 'turn' and
//                                the penalty prompt 'roulette'. T.game already includes msg. Await
//                                T.step(ms) / T.landed(mover) for every pause, so a rebuild cancels.
//   clearPrompt(T)               the prompt ended (hide your controls, clear statuses)
//   reprompt(T, msg)             optional; the same prompt re-sent with a fresh clock
//   refused(T, msg)              optional; the server refused what you sent: re-enable controls
//   isOut(T, seat) -> bool       the seat is eliminated
//   seatHud(T) -> [{ alive, cards, pulls }] by view (0 = you), for the name tags and your card
//   auto(T, promptMsg) -> action the #autoplay test player's move for your own prompt, or null
//   summary(T, overMsg, stats) -> { rounds, survivors: [names], recap: [[value, label] x3] }
//   pointerEnabled() -> bool, pick(raycaster, current) -> id | null, hover(id), select(T, id)
//                                3D picking of your pieces (cards, dice, ...)
//   keydown(T, event) -> bool    keyboard shortcuts while no menu is open
//   frame(T, reservePx)          per-frame layout (no allocations); reservePx is the HUD's bottom band
//
// T gives: me, game, prompt, recap, viewChars, view(seat), seatAt(view), isMe, name, char(seat),
// design(seat), pan(seat), step, landed, token() (changes when a rebuild cancels the flow), send(action), setActor,
// setWatch, focusSeat, refresh() (redraws the seat HUD), eliminated() (offers Watch or Leave).
import { deckMode } from './deck.js';

export const MODES = { deck: deckMode };
export const isPlayable = (mode) => !!MODES[mode]?.ready;
