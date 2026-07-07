# Staking & Rewards

There are two separate staking pools, each funded by its own share of collected fees (see [Fees & Where They Go](fees.md)), and each accounted for with its own independent accumulator — staking in one has no effect on the other. You can participate in either, both, or neither.

### bTKN staking

The option for holders who don't want to provide liquidity at all: stake bTKN directly to earn a share of the bTKN-staker reward pot, proportional to your share of total staked bTKN. It works from the moment the vault exists — no external pool required, since bTKN's mint is already known when the vault is created.

### LP staking

Once a vault's authority points it at a live bTKN/SOL LP mint, anyone holding that LP token can stake it to start earning a share of the LP-staker reward pot instead, proportional to their share of total staked LP.

### Auto-settle on stake/unstake

Both pools use the same standard accumulator-based accounting model (rewards proportional to share of the pool, counted only from the moment you stake onward), so claiming is O(1) regardless of how many stakers there are or how long they've been staked.

Staking and unstaking both automatically settle (pay out) whatever reward has accrued so far in that pool, so you never lose a pending reward by adjusting your position. `claim_rewards` / `claim_btkn_rewards` let you collect without touching your stake at all.

Each account tracks its own lifetime total claimed, so "how much have I earned" is always a direct on-chain read, not something you have to reconstruct from history.
