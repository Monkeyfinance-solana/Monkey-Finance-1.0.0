# Liquidity & Arbitrage

Because bTKN always redeems 1:1 for TKN through the vault, that redemption value acts as a natural anchor for whatever price bTKN trades at on its external bTKN/SOL pool. If the two drift apart, arbitrage pulls them back together.

**bTKN trading below TKN:**

1. Buy the discounted bTKN on the bTKN/SOL pool.
2. Unwrap that bTKN for TKN at full 1:1 value through the vault (minus the unwrap fee).
3. Sell the resulting TKN elsewhere at its full price.
4. Pocket the difference between what the discounted bTKN cost and what the redeemed TKN sold for.

**bTKN trading above TKN:**

1. Buy TKN on the open market at its normal price.
2. Wrap that TKN into bTKN at 1:1 through the vault (minus the wrap fee).
3. Sell the newly minted bTKN into the pool at its inflated price.
4. Pocket the difference between what the TKN cost and what the bTKN sold for.

Both routes pay a wrap or unwrap fee into the protocol on the way through, so every arbitrage cycle that corrects the price also feeds the reward pot and TKN's burn.

### Pool depth matters

A shallow pool means small trades swing the price a lot, which invites more (and rougher) arbitrage than a deep one. Adding liquidity (or removing it) is available directly in the app's "Add LP" / "Remove LP" tabs, which deposit into or withdraw from the pool's live reserves.
