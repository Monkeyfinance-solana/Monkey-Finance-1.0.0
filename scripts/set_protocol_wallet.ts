// Run with: npx ts-node scripts/set_protocol_wallet.ts <TKN_MINT_ADDRESS> <NEW_PROTOCOL_WALLET_ADDRESS>
// (place this file at pod_vault/scripts/set_protocol_wallet.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Authority-only: repoints the vault's protocol-revenue destination to a
// different wallet (e.g. if you want to route revenue somewhere new, or the
// original wallet was compromised). Creates the new wallet's TKN ATA for you
// if it doesn't already exist. Unlike set_lp_mint, this can be called as
// many times as you like -- there's no "already set" restriction.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const tknMintArg = process.argv[2];
  const newProtocolWalletArg = process.argv[3];
  if (!tknMintArg || !newProtocolWalletArg) {
    console.error(
      "Usage: npx ts-node scripts/set_protocol_wallet.ts <TKN_MINT_ADDRESS> <NEW_PROTOCOL_WALLET_ADDRESS>"
    );
    process.exit(1);
  }
  const tknMint = new PublicKey(tknMintArg);
  const newProtocolWallet = new PublicKey(newProtocolWalletArg);

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    program.programId
  );

  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      newProtocolWallet
    )
  ).address;

  console.log("Vault config PDA:      ", vaultConfig.toBase58());
  console.log("New protocol wallet:   ", newProtocolWallet.toBase58());
  console.log("New protocol token acct:", protocolTokenAccount.toBase58());

  const sig = await program.methods
    .setProtocolWallet()
    .accountsPartial({
      authority: authority.publicKey,
      vaultConfig,
      protocolTokenAccount,
    })
    .rpc();

  console.log("\nProtocol wallet updated. Tx signature:", sig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
