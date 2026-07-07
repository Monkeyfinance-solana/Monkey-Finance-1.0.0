# Overview

Monkey Finance is a permissionless wrap vault protocol for Solana tokens. Anyone can wrap an existing token (TKN, e.g. a pump.fun launch) into a "pod" that mints a synthetic, vault-backed derivative called bTKN. There are two independent ways to earn a share of every fee the vault collects: stake bTKN directly (works the moment you've wrapped, no pool required), or, once a bTKN/SOL liquidity pool exists, stake that pool's LP token instead. You can do either, both, or neither.

### Why it works this way

Most DeFi yield comes from emissions: new tokens minted and handed out as rewards, which dilutes supply and eventually stops working. Monkey Finance's reward pot is instead funded entirely by wrap and unwrap fees paid by people moving between TKN and bTKN — real activity, not inflation.

Nothing here depends on a separate indexer either: every wrap, unwrap, stake, unstake, claim, and admin action is emitted as an on-chain event and reflected directly in the running totals shown on each vault's page.
