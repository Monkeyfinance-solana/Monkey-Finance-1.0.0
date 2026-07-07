// Run with: npx ts-node scripts/set_lp_mint.ts <TKN_MINT_ADDRESS> <LP_MINT_ADDRESS>
// (place this file at pod_vault/scripts/set_lp_mint.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Tells the vault which mint to treat as "the LP token." In production this
// would be the LP mint Raydium creates when you set up the bTKN/SOL pool. For
// local testing (no real Raydium on your local validator), just create a
// plain SPL mint first to stand in for it:
//
//   spl-token create-token --decimals 6
//   spl-token create-account <THAT_MINT_ADDRESS>
//   spl-token mint <THAT_MINT_ADDRESS> 1000 <YOUR_TOKEN_ACCOUNT>
//
// Then pass that mint address as LP_MINT_ADDRESS here. Must be signed by the
// vault's authority (the same keypair that called initialize_vault). Can only
// be called once per vault -- if you need to change it later, use
// reset_lp_mint first (only allowed while total_staked == 0).

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const tknMintArg = process.argv[2];
  const lpMintArg = process.argv[3];
  if (!tknMintArg || !lpMintArg) {
    console.error("Usage: npx ts-node scripts/set_lp_mint.ts <TKN_MINT_ADDRESS> <LP_MINT_ADDRESS>");
    process.exit(1);
  }
  const tknMint = new PublicKey(tknMintArg);
  const lpMint = new PublicKey(lpMintArg);

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    program.programId
  );
  const [stakedLpVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("staked_lp"), vaultConfig.toBuffer()],
    program.programId
  );

  console.log("Vault config PDA:  ", vaultConfig.toBase58());
  console.log("LP mint:           ", lpMint.toBase58());
  console.log("Staked LP vault PDA:", stakedLpVault.toBase58());

  const sig = await program.methods
    .setLpMint()
    .accountsPartial({
      authority: authority.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nLP mint set. Tx signature:", sig);
  console.log("Stakers can now stake this LP token via the front end's Stake form.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
