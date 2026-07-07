# Contract Addresses

{% hint style="warning" %}
These are the current **local test-validator** deployment addresses, not a mainnet deployment. Replace this page's contents once the real vault goes live.
{% endhint %}

**Program ID**

```
2A2iyfJ7Fr1PzQiz8crgmGn5MdBcyXaGrffppSz4C5ZD
```

**TKN / bTKN vault**

| Account | Address |
|---|---|
| TKN mint | `5MpU39kmgdq3h6yT6vprKK71ynAUowDct3CpTJPfFmHG` |
| Meteora bTKN/SOL pool | `FhAZR48YCjV9SPsU7hPYuohfeZC7DF2jDrFLv8DxqnFw` |
| LP mint | `3EquqoDL3rjD9JeXhHyAJe4c2qDXKq1KySN9bEK62p4z` |

bTKN mint, vault config PDA, and other derived addresses are computed from the TKN mint and program ID (seeds `vault`, `btkn_mint`, `vault_tkn`, `reward_vault`, `staked_lp`) — see the app's live "Contract addresses" section on the in-app Documentation page for these, since they stay correct automatically as vaults are added or redeployed.
