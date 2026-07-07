# Safety & Admin Controls

Every admin action is gated to the vault's authority and enforced entirely on-chain — fee changes can never exceed the caps described in [Fees & Where They Go](fees.md), no matter what the authority sets.

`set_paused` is an emergency switch that blocks wrap/unwrap only; staking, unstaking, and claiming keep working even mid-incident, since letting people access their own funds is always safe.

The LP mint can only be set once (`set_lp_mint`), but if it was set to the wrong address before anyone staked, `reset_lp_mint` allows a one-time correction — it's blocked entirely once `total_staked > 0`, so it can never be used to strand anyone's stake.

Authority transfer is two-step, so a mistyped address can never permanently lock the vault: `propose_authority` nominates a new key, and control only actually changes hands once that key signs `accept_authority` itself. The current authority can `cancel_authority_transfer` at any point before that happens.
