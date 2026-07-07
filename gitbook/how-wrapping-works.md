# How Wrapping Works

**Wrap:** deposit TKN, a wrap fee is taken, and bTKN is minted 1:1 against whatever's left.

**Unwrap:** burn bTKN, an unwrap fee is taken, and you receive TKN 1:1 against what's left.

### Always 1:1 — no rising collateral ratio

Unlike protocols where the wrapped token's backing ratio drifts upward over time, bTKN here is always exactly redeemable 1:1 against the vault's held TKN. The fee is paid on top by whoever is wrapping or unwrapping — it's never carved out of the vault's existing backing — so the peg never dilutes and never needs a separate "collateral ratio" to track.

What does change over time is TKN's own total supply: the burned portion of every fee permanently reduces it, which is deflationary pressure that benefits TKN and bTKN holders equally.
