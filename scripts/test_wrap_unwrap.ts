// Run with: npx ts-node scripts/test_wrap_unwrap.ts
// (place this file at pod_vault/scripts/test_wrap_unwrap.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Requires the vault to already be initialized (scripts/init_vault.ts).
//
// Does a real wrap (TKN -> bTKN) followed by a real unwrap (bTKN -> TKN).
// Since this script doesn't set up LP staking, every fee collected here
// gets fully burned (there's no staker to credit the LP-reward share to) --
// that's expected, not a bug. Use scripts/stake_and_earn.ts to see the
// LP-reward path instead of the full-burn fallback.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const DECIMALS = 6;
const WRAP_AMOUNT = 1_000 * 10 ** DECIMALS; // 1,000 TKN

function fmt(rawAmount: bigint | number): string {
  return (Number(rawAmount) / 10 ** DECIMALS).toLocaleString();
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const tknMint = new PublicKey("Cwzq2X7ra1S8ryjQGdPeuJ74HMxDtAnpWfvAbw2JVoct");

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

  const cfg = await program.account.vaultConfig.fetch(vaultConfig);

  const userTknAccount = getAssociatedTokenAddressSync(tknMint, authority.publicKey);
  const userBtknAccount = getAssociatedTokenAddressSync(btknMint, authority.publicKey);

  console.log("Wrap fee (bps):      ", cfg.wrapFeeBps);
  console.log("Unwrap fee (bps):    ", cfg.unwrapFeeBps);
  console.log("Burn share of fee:   ", cfg.burnBps, "bps");
  console.log("Total staked:        ", cfg.totalStaked.toString());
  console.log();

  async function printBalances(label: string) {
    const [tknBal, vaultBal, rewardBal, supply] = await Promise.all([
      getAccount(provider.connection, userTknAccount).catch(() => null),
      getAccount(provider.connection, vaultTokenAccount).catch(() => null),
      getAccount(provider.connection, rewardVaultTokenAccount).catch(() => null),
      provider.connection.getTokenSupply(tknMint),
    ]);
    let btknBal: Awaited<ReturnType<typeof getAccount>> | null = null;
    try {
      btknBal = await getAccount(provider.connection, userBtknAccount);
    } catch {
      btknBal = null;
    }

    console.log(`-- ${label} --`);
    console.log("  your TKN:        ", tknBal ? fmt(tknBal.amount) : "(account not found)");
    console.log("  your bTKN:       ", btknBal ? fmt(btknBal.amount) : "(none yet)");
    console.log("  vault TKN:       ", vaultBal ? fmt(vaultBal.amount) : "(account not found)");
    console.log("  reward pot:      ", rewardBal ? fmt(rewardBal.amount) : "(account not found)");
    console.log("  TKN total supply:", fmt(supply.value.amount));
    console.log();
  }

  await printBalances("before wrap");

  console.log(`Wrapping ${fmt(WRAP_AMOUNT)} TKN...`);
  const wrapSig = await program.methods
    .wrap(new anchor.BN(WRAP_AMOUNT))
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
  console.log("Wrap tx:", wrapSig);
  console.log();

  await printBalances("after wrap");

  const btknAfterWrap = await getAccount(provider.connection, userBtknAccount);
  const unwrapAmount = btknAfterWrap.amount;

  console.log(`Unwrapping ${fmt(unwrapAmount)} bTKN...`);
  const unwrapSig = await program.methods
    .unwrap(new anchor.BN(unwrapAmount.toString()))
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
    })
    .rpc();
  console.log("Unwrap tx:", unwrapSig);
  console.log();

  await printBalances("after unwrap");

  console.log(
    "TKN total supply should have dropped twice (once on wrap, once on\n" +
      "unwrap) -- that's the burn working. Reward pot should still read 0\n" +
      "since nobody's staked an LP token yet (call set_lp_mint + stake_lp\n" +
      "first to see the LP-reward path instead of the full-burn fallback)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
