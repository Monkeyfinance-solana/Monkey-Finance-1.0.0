# Glossary

| Term | Meaning |
|---|---|
| TKN | The underlying token a vault wraps — currently MONKEY itself, with other tokens planned for the future. |
| bTKN / Banana | The vault's synthetic derivative, minted 1:1 against TKN held in the vault, minus fees. No lock-up — unwrap back to TKN any time. |
| LP token | The Meteora liquidity-pool token for the bTKN/SOL pair — what you actually stake. |
| Reward pot | The vault's TKN balance set aside from fees, split between the bTKN-staker pool and the LP-staker pool, paid out over time. |
| Burn split | The % of each fee permanently destroyed rather than routed anywhere else. |
| Protocol split | The % of each fee sent directly to the vault's protocol wallet. |
| bTKN staker share | The % of each fee that goes to the bTKN-staker pool instead of the LP-staker pool. Whatever's left after burn/protocol/bTKN shares are taken out automatically goes to LP stakers. |
| Authority | The keypair allowed to change fees, pause the vault, or set/reset its LP mint. |
