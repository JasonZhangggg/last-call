# Last Call: rules spec

These are the game's rules. The mechanics follow the genre's reference game. Characters, art, names and
music are original. Each rule is tagged **[ref]** when public sources confirm it for the reference game,
**[ref?]** when sources are thin or conflict, and **[ours]** where we chose because sources were silent.
The model code (`src/model/`) must implement exactly this, and the tests must pin it.

## Table

- 2 to 4 seats. [ref] Bots fill empty seats and take over disconnected players. [ours]
- The host picks a **mode** and a **variant** in the lobby. [ref]
- The turn timer is 30 s. When it expires, the bot policy acts for that seat. [ref?] [ours]
- Turn order goes left around the table from the player's view (seat 0 → 1 → 2 → 3). [ours]

## Mode: Deck

**Deck.** 6 Kings, 6 Queens, 6 Aces and 2 Jokers (20 cards). [ref]
**Round start.** Shuffle, deal 5 to each living seat, and draw the table rank uniformly from King, Queen and Ace. [ref]
**Turn.** The seat to act either plays 1 to 3 cards from its hand face down (an implicit claim that every one
is the table rank), or calls Liar on the previous play. Nobody can call on the first play of a round. [ref]
**Truth.** A card is truthful if it is the table rank or a Joker. [ref]
**Challenge.** Reveal the last play only. If any card is untruthful, the accused shoots. Otherwise the caller shoots. [ref]
**Empty hands.** A seat with no cards is skipped. If the seat to act is the only one still holding cards,
it must call Liar on the last play. [ref]
**Revolver.** Each seat has its own six-chamber revolver with one live round. It is never re-spun, so a
survived pull leaves one fewer empty chamber (1/6, then 1/5, and so on). [ref?]
**After a shot.** The round ends whatever the outcome. If the shooter survived, the shooter starts the
next round. If they died, the next living seat starts. [ref?] [ours]
**Win.** The last seat alive wins. [ref]

### Variant: Devil (Deck)

- One **Devil** card is added to the deck (21 cards). [ref]
- The Devil may only be played on its own, as a 1-card play. [ref]
- It is untruthful (it is never the table rank).
- If a challenge reveals the Devil while 3 or more seats are alive, **every living seat except the accused**
  pulls their own trigger, in seat order starting after the accused. [ref?]
- With only 2 seats alive, the Devil behaves like any other lie card. [ref?]
- The round ends after the shots resolve. The next round starts with the first survivor after the accused. [ours]

## Mode: Dice

**Dice.** Each living seat holds 5 six-sided dice under a cup. Everyone rolls at round start. [ref?] [ours: 5]
**Bid.** The seat to act either raises the bid or calls Liar on the previous bid. A bid is
(quantity, face) with face 2 to 6, meaning "at least *quantity* dice on the table show *face*". [ref]
**Wilds.** 1s are wild. They count toward any face. [ref]
**Raise.** A new bid must have a higher quantity, or the same quantity with a higher face. The opening bid
of a round is any quantity of at least 1. [ours]
**Challenge.** Reveal every cup. Count the dice showing the bid face, plus the 1s. If the count is at least
the quantity, the bid stands and the caller loses. Otherwise the bidder loses. [ref]
**Penalty: the poison tray.** Each seat has a tray of six glasses, and exactly one is poisoned. The loser
drinks the next glass. Like the revolver, the tray is never reshuffled, so odds rise: 1/6, then 1/5, and so
on. Drinking the poisoned glass eliminates the seat. [ref?: the reference uses poison; we mirror the
revolver's escalation so the risk feels identical across modes]
**Next round.** All living seats reroll. The loser opens the bidding if alive, otherwise the next living seat does. [ours]

### Variant: Traditional (Dice)

- Adds **Spot On**. Instead of raising or calling Liar, a seat may claim the last bid is exactly right. [ref?]
- If the exact count equals the quantity, every living seat except the caller drinks. Otherwise the caller drinks. [ref?]

## Not included in this release

Card-mode follow-up variants (larger hands, kept hands, special deals), the shoot-a-target variant, and
the poker-style mode. Public rules for these are too thin or conflicting to build faithfully, and they'd
each need their own UI. Revisit with better sources.
