// The client's mirror of a deck table: the same shape as the server's `state.game` snapshot,
// advanced one message at a time. Pure, so the director can keep two cursors over the stream
// (what has arrived, and what has been shown) and rebuild the table from either.

/** Applies one server message to a snapshot-shaped game. Returns the game (mutated in place). */
export function reduceDeck(game, msg, me) {
  switch (msg.type) {
    case 'round':
      game.round = msg.round; game.tableRank = msg.tableRank; game.starter = msg.starter;
      game.hand = msg.hand.slice(); game.handCounts = msg.handCounts.slice();
      game.plays = []; game.reveal = null;
      break;
    case 'played':
      game.plays.push({ seat: msg.seat, claim: msg.claim, tokens: msg.tokens.slice() });
      game.handCounts = msg.handCounts.slice();
      if (msg.seat === me) game.hand = game.hand.filter((c) => !msg.tokens.includes(c.token));
      break;
    case 'challenge':
      game.reveal = structuredClone(msg);
      break;
    case 'shot':
      game.pulls[msg.seat] = msg.pulls;
      if (msg.fired) {
        game.alive[msg.seat] = false;
        game.handCounts[msg.seat] = 0;
        if (msg.seat === me) game.hand = [];
      }
      break;
  }
  return game;
}

export const pileCount = (game) => game.plays.reduce((n, p) => n + p.claim, 0);
export const lastPlay = (game) => game.plays[game.plays.length - 1] || null;
