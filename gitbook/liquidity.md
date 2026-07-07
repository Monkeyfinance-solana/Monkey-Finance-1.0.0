# Liquidity & Arbitrage

Because bTKN always redeems 1:1 for TKN through the vault, that redemption value acts as a natural anchor for whatever price bTKN trades at on its external bTKN/SOL pool. If the two drift apart, arbitrage pulls them back together.

**bTKN trading below TKN:** buy the discounted bTKN on the pool, unwrap it for TKN at full value, and sell that TKN elsewhere — pocketing the difference (minus the unwrap fee).

**bTKN trading above TKN:** buy TKN on the open market, wrap it into bTKN at 1:1, and sell the newly minted bTKN into the pool at the inflated price (minus the wrap fee).

Both routes pay a wrap or unwrap fee into the protocol on the way through, so every arbitrage cycle that corrects the price also feeds the reward pot and TKN's burn.

### Pool depth matters

A shallow pool means small trades swing the price a lot, which invites more (and rougher) arbitrage than a deep one. Adding liquidity (or removing it) is available directly in the app's "Add LP" / "Remove LP" tabs, which deposit into or withdraw from the pool's live reserves.
