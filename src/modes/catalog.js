// What the lobby calls each mode and variant. The variant lists themselves come from the server's
// engines (ENGINES[mode].variants), so a label missing here falls back to the raw name.
export const CATALOG = {
  deck: {
    label: 'Cards',
    variants: {
      basic: { label: 'Classic', note: 'Twenty cards: six Kings, six Queens, six Aces and two Jokers. Jokers match any table card.' },
      devil: { label: 'Devil', note: 'Adds the Devil card, played alone. Caught with it and every other player pulls their trigger.' },
    },
  },
  dice: {
    label: 'Dice',
    variants: {
      basic: { label: 'Classic', note: 'Five dice under each cup. Raise the bid or call Liar. Ones are wild.' },
      traditional: { label: 'Traditional', note: 'Adds Spot On: claim the last bid is exactly right.' },
    },
  },
  auction: {
    label: 'Gilded Bid',
    variants: { classic: { label: 'Classic', note: 'Bid hidden money on curios, favours and disgraces. The poorest can never win.' } },
  },
};
export const modeLabel = (mode) => CATALOG[mode]?.label || mode;
export const variantLabel = (mode, variant) => CATALOG[mode]?.variants[variant]?.label || variant;
export const variantNote = (mode, variant) => CATALOG[mode]?.variants[variant]?.note || '';
