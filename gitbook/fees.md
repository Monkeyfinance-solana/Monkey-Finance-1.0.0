# Fees & Where They Go

| Fee | Charged on | Current rate |
|---|---|---|
| Wrap fee | TKN → bTKN | 0.75% |
| Unwrap fee | bTKN → TKN | 1.25% |
| Burn split | share of each fee that's burned outright | 20% |
| Protocol split | share of each fee sent to the vault's protocol wallet | 10% |
| bTKN staker share | share of each fee that goes to bTKN stakers | 50% |
| LP staker share | remainder, share of each fee that goes to bTKN/SOL LP stakers | 20% |

Every fee splits into four flat pieces on-chain, each a direct % of the fee itself (not nested/sequential): 20% is burned outright (permanently destroyed, shrinking TKN's total supply), 10% goes to the vault's protocol wallet as revenue (see [Project Revenue](revenue.md)), 50% goes to bTKN stakers, and the remaining 20% goes to bTKN/SOL LP stakers.

If nobody is currently staked in a given pool when a fee comes in, that pool's earmarked share is burned instead of sitting unclaimable forever — each pool tops up independently, so an empty LP pool doesn't block bTKN stakers from getting paid, and vice versa. The protocol-revenue share has no such fallback, since it's a fixed wallet rather than a pool of stakers.

### Room to adjust

The rates above are the current settings, not hard-coded constants. The protocol can raise wrap/unwrap fees up to a 3% cap, and can change the burn/protocol/bTKN-staker/LP-staker split at any time — this gives the team flexibility to respond to changing market conditions and community feedback rather than being locked into one fee structure forever.

### What this doesn't cover

This only covers wrap/unwrap fees. Ordinary buy/sell activity on the external bTKN/SOL pool pays a separate 1% AMM swap fee to that pool's liquidity providers directly — those don't flow back into the vault's reward pot, since the pool lives outside this program. That's actually a benefit for LP stakers: on top of their share of wrap/unwrap fees above, they also earn ordinary swap-fee yield just from providing liquidity.

As the project grows, different or new LP pools may carry a different swap fee than this 1% — each pool sets its own rate independently. The initial MONKEY pool on pump.fun, for example, follows pump.fun's own fee structure rather than the 1% used by the bTKN/SOL Meteora pool.
