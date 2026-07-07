// Run with: npx ts-node scripts/create_local_test_token.ts [recipient pubkey]
// (place this file at pod_vault/scripts/create_local_test_token.ts)
//
// Creates a throwaway SPL mint standing in for a pump.fun TKN launch, mints
// a supply to a wallet, and prints the exact init_vault.ts command to run
// next. Free -- meant for local-validator / devnet testing, not mainnet.
//
// Pass a recipient pubkey to mint straight to e.g. your Phantom wallet
// instead of the CLI keypair (ANCHOR_WALLET) -- handy since you'll likely
// want to test the app connected with Phantom, not the CLI wallet. A
// mismatched recipient is also airdropped some SOL so it has fees to work
// with on the fresh local validator.
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json

import * as anchor from "@anchor-lang/core";
import { createMint, createAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

const DECIMALS = 6;
const SUPPLY = 1_000_000_000; // 1B TKN, in whole-token units (multiplied by 10**DECIMALS below)
const AIRDROP_SOL = 5; // only used if recipient != the CLI wallet

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet as anchor.Wallet;

  const recipientArg = process.argv[2];
  const recipient = recipientArg ? new PublicKey(recipientArg) : authority.publicKey;
  const recipientIsSelf = recipient.equals(authority.publicKey);

  console.log("Creating test TKN mint on", provider.connection.rpcEndpoint, "...");

  const tknMint = await createMint(
    provider.connection,
    authority.payer,
    authority.publicKey,
    null,
    DECIMALS
  );

  const recipientTknAccount = await createAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    tknMint,
    recipient
  );

  await mintTo(
    provider.connection,
    authority.payer,
    tknMint,
    recipientTknAccount,
    authority.publicKey,
    SUPPLY * 10 ** DECIMALS
  );

  if (!recipientIsSelf) {
    console.log(`Airdropping ${AIRDROP_SOL} SOL to ${recipient.toBase58()} for fees...`);
    const sig = await provider.connection.requestAirdrop(recipient, AIRDROP_SOL * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  console.log("\nTest TKN mint created:", tknMint.toBase58());
  console.log(
    `Minted ${SUPPLY.toLocaleString()} TKN to ${recipientIsSelf ? "your CLI wallet's" : recipient.toBase58() + "'s"} ATA:`,
    recipientTknAccount.toBase58()
  );
  console.log("\nNext step -- initialize the vault for this mint:");
  console.log(`  npx ts-node scripts/init_vault.ts ${tknMint.toBase58()}`);
  console.log("\nThen paste that same mint address into app/src/config.ts's \"tkn\" vault entry.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
