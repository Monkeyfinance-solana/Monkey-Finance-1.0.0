# Fees & Where They Go

| Fee | Charged on | Cap |
|---|---|---|
| Wrap fee | TKN → bTKN | 3% max |
| Unwrap fee | bTKN → TKN | 3% max |
| Burn split | share of each fee that's burned outright | 0-100% of the fee |
| Protocol split | share of each fee sent to the vault's protocol wallet | 0-100% of the fee |
| bTKN staker share | share of each fee that goes to bTKN stakers (vs. LP stakers) | 0-100% of the fee |

Every fee splits into up to four flat pieces on-chain, each a direct % of the fee itself (not nested/sequential): a burn portion (permanently destroyed, shrinking TKN's total supply), a protocol-revenue portion (sent straight to the vault's protocol wallet), a reward portion for bTKN stakers, and a reward portion for LP stakers. The burn, protocol, and bTKN-staker shares are each set independently by the authority — their sum can never exceed 100% of the fee — and whatever's left over automatically goes to LP stakers.

If nobody is currently staked in a given pool when a fee comes in, that pool's earmarked share is burned instead of sitting unclaimable forever — each pool tops up independently, so an empty LP pool doesn't block bTKN stakers from getting paid, and vice versa. The protocol-revenue share has no such fallback, since it's a fixed wallet rather than a pool of stakers.

### What this doesn't cover

This only covers wrap/unwrap fees. Ordinary buy/sell activity on the external bTKN/SOL pool pays a separate 1% AMM swap fee to that pool's liquidity providers directly — those don't flow back into the vault's reward pot, since the pool lives outside this program.
