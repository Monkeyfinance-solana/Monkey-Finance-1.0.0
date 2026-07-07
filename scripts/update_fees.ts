// Run with: npx ts-node scripts/update_fees.ts <TKN_MINT_ADDRESS>
// (place this file at pod_vault/scripts/update_fees.ts)
//
// Authority-only: updates a vault's wrap fee, unwrap fee, and how each fee is
// split between burn / protocol revenue / bTKN stakers / LP stakers. Edit the
// constants below, then run against whichever mint you want to update. Must
// be signed by the vault's current authority (ANCHOR_WALLET).
//
// BURN_BPS + PROTOCOL_BPS + BTKN_SHARE_BPS must be <= 10_000 (100%) -- each
// is a flat % *of the fee itself*, not nested. Whatever's left over
// implicitly goes to LP stakers. PROTOCOL_BPS > 0 requires the vault to
// already have a protocol wallet set (it does, from initialize_vault --
// use set_protocol_wallet.ts if you need to change the destination).
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import { PublicKey } from "@solana/web3.js";

// Edit these before running. Example: 20% burn / 10% protocol / 50% bTKN
// stakers / 20% LP stakers (implied remainder).
const WRAP_FEE_BPS = 75; // 0.75%
const UNWRAP_FEE_BPS = 125; // 1.25%
const BURN_BPS = 2000; // 20% burned
const PROTOCOL_BPS = 1000; // 10% to the protocol wallet
const BTKN_SHARE_BPS = 5000; // 50% to bTKN stakers (remaining 20% goes to LP stakers)

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const tknMintArg = process.argv[2];
  if (!tknMintArg) {
    console.error("Usage: npx ts-node scripts/update_fees.ts <TKN_MINT_ADDRESS>");
    process.exit(1);
  }
  const tknMint = new PublicKey(tknMintArg);

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    program.programId
  );

  console.log("Vault config PDA:", vaultConfig.toBase58());
  console.log(
    `Setting wrap=${WRAP_FEE_BPS}bps unwrap=${UNWRAP_FEE_BPS}bps burn=${BURN_BPS}bps protocol=${PROTOCOL_BPS}bps btknShare=${BTKN_SHARE_BPS}bps ...`
  );

  const sig = await program.methods
    .updateFees(WRAP_FEE_BPS, UNWRAP_FEE_BPS, BURN_BPS, PROTOCOL_BPS, BTKN_SHARE_BPS)
    .accountsPartial({
      authority: authority.publicKey,
      vaultConfig,
    })
    .rpc();

  console.log("\nFees updated. Tx signature:", sig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
