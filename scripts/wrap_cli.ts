// Run with: npx ts-node scripts/wrap_cli.ts <TKN_MINT> <AMOUNT>
// (place this file at pod_vault/scripts/wrap_cli.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Wraps TKN -> bTKN for whichever wallet ANCHOR_WALLET points at (your CLI
// keypair, not Phantom). Exists specifically so that wallet can hold bTKN
// to seed the Raydium pool with -- create_raydium_pool.ts needs the SAME
// wallet it runs as (the CLI one) to already hold bTKN, since it can't sign
// with your Phantom wallet's key.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  const tknMintArg = process.argv[2];
  const amountArg = process.argv[3];
  if (!tknMintArg || !amountArg) {
    console.error("Usage: npx ts-node scripts/wrap_cli.ts <TKN_MINT> <AMOUNT>");
    process.exit(1);
  }
  const tknMint = new PublicKey(tknMintArg);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const mintInfo = await getMint(provider.connection, tknMint);
  const decimals = mintInfo.decimals;
  const rawAmount = new anchor.BN(Number(amountArg) * 10 ** decimals);

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    program.programId
  );
  const [btknMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("btkn_mint"), tknMint.toBuffer()],
    program.programId
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tkn"), tknMint.toBuffer()],
    program.programId
  );
  const [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), tknMint.toBuffer()],
    program.programId
  );

  const userTknAccount = getAssociatedTokenAddressSync(tknMint, authority.publicKey);
  const userBtknAccount = getAssociatedTokenAddressSync(btknMint, authority.publicKey);
  const cfg = await program.account.vaultConfig.fetch(vaultConfig);

  const sig = await program.methods
    .wrap(rawAmount)
    .accountsPartial({
      user: authority.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount: cfg.protocolTokenAccount,
      userTknAccount,
      userBtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`Wrapped ${amountArg} TKN -> bTKN for ${authority.publicKey.toBase58()}`);
  console.log("Tx signature:", sig);
  console.log("bTKN account:", userBtknAccount.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
