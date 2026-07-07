# Overview

Monkey Finance is a wrap vault protocol on Solana. For now, wrapping is scoped to Monkey Finance's own token (MONKEY) — not an open, permissionless "wrap anything" protocol yet — though support for other tokens is on the roadmap. Wrapping deposits TKN and mints a synthetic, vault-backed derivative called a **banana** (bTKN), 1:1 against what's deposited, minus fees. There's no lock-up: you can unwrap back to TKN whenever you like.

There are two independent ways to earn a share of every fee the vault collects: stake bTKN directly (works the moment you've wrapped, no pool required), or stake the bTKN/SOL liquidity pool's LP token instead — that pool already exists by the time you land on the app, so this isn't a "coming later" option. You can do either, both, or neither.

### Why it works this way

Most DeFi yield comes from emissions: new tokens minted and handed out as rewards, which dilutes supply and eventually stops working. Monkey Finance's reward pot is instead funded entirely by wrap and unwrap fees paid by people moving between TKN and bTKN — real activity, not inflation.

Nothing here depends on a separate indexer either: every wrap, unwrap, stake, unstake, claim, and admin action is emitted as an on-chain event and reflected directly in the running totals shown on each vault's page.
