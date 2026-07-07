// Run with: npx ts-node scripts/send_test_tkn.ts <TKN_MINT> <RECIPIENT_PUBKEY> [amount]
// (place this file at pod_vault/scripts/send_test_tkn.ts)
//
// Transfers test TKN you already hold in your CLI wallet (ANCHOR_WALLET --
// e.g. from create_local_test_token.ts, which mints there by default) over
// to another wallet, typically your Phantom address so you can test the
// app connected with Phantom instead of the CLI keypair. Unlike
// create_local_test_token.ts, this does NOT create a new mint -- it moves
// existing supply of the mint your vault is already initialized for.
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json

import * as anchor from "@anchor-lang/core";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, transfer, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

const DEFAULT_AMOUNT = 1_000_000; // whole TKN units, only used if no [amount] arg given
const AIRDROP_SOL = 5; // only used if recipient != the CLI wallet and has ~0 balance

async function main() {
  const tknMintArg = process.argv[2];
  const recipientArg = process.argv[3];
  const amountArg = process.argv[4];
  if (!tknMintArg || !recipientArg) {
    console.error("Usage: npx ts-node scripts/send_test_tkn.ts <TKN_MINT> <RECIPIENT_PUBKEY> [amount]");
    process.exit(1);
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet as anchor.Wallet;

  const tknMint = new PublicKey(tknMintArg);
  const recipient = new PublicKey(recipientArg);
  const amount = Number(amountArg ?? DEFAULT_AMOUNT);

  const mintInfo = await getMint(provider.connection, tknMint);

  const senderTknAccount = await getAssociatedTokenAddress(tknMint, authority.publicKey);

  console.log(`Sending ${amount.toLocaleString()} TKN to ${recipient.toBase58()}...`);

  const recipientTknAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    tknMint,
    recipient
  );

  await transfer(
    provider.connection,
    authority.payer,
    senderTknAccount,
    recipientTknAccount.address,
    authority.publicKey,
    amount * 10 ** mintInfo.decimals
  );

  const recipientBalance = await provider.connection.getBalance(recipient);
  if (!recipient.equals(authority.publicKey) && recipientBalance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log(`Recipient has ~0 SOL -- airdropping ${AIRDROP_SOL} SOL for fees...`);
    const sig = await provider.connection.requestAirdrop(recipient, AIRDROP_SOL * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  console.log(`\nDone. ${recipient.toBase58()}'s TKN account:`, recipientTknAccount.address.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
