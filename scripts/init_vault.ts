// Run with: npx ts-node scripts/init_vault.ts <TKN_MINT_ADDRESS> [PROTOCOL_WALLET_ADDRESS]
// (place this file at pod_vault/scripts/init_vault.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Requires the program to already be deployed to that cluster (anchor deploy).
//
// Pass the TKN mint as a command-line argument, e.g.:
//   npx ts-node scripts/init_vault.ts CvyXuddN7sqigum5cE1WDZCJRYrTKwhBUu42Gc5Zr35J
// Falls back to a hardcoded default if you don't pass one.
//
// Optionally pass a second argument: the wallet that should receive the
// protocol-revenue share of fees (see PROTOCOL_BPS below). Defaults to your
// own ANCHOR_WALLET if omitted. Either way, this script creates that
// wallet's TKN ATA for you if it doesn't already exist -- initialize_vault
// requires the account to already exist.
//
// bTKN metadata: this script fetches TKN's existing Metaplex metadata
// off-chain (if any) and forwards its image (`uri`) straight through to
// bTKN, so bTKN shows the same logo as TKN from the moment it's minted --
// see fetchExistingMetadata() below. `initialize_vault` creates bTKN's
// metadata on-chain via CPI in the same transaction (no separate metadata
// step needed). We deliberately don't pull in the full Metaplex JS SDK
// (it's umi-based now and would be a heavier, less consistent dependency
// than this project's existing plain @solana/web3.js scripts) -- instead we
// hand-parse the handful of fields we need directly out of the raw
// Metadata account, which has used this exact layout since Token Metadata's
// very first version and is used for fungible tokens like TKN/bTKN too.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// Metaplex's on-chain hard caps (Metadata::MAX_NAME_LENGTH etc.) -- must
// match the mirrors in initialize.rs, since the program rejects oversized
// fields with MetadataFieldTooLong.
const MPL_MAX_NAME_LENGTH = 32;
const MPL_MAX_SYMBOL_LENGTH = 10;
const MPL_MAX_URI_LENGTH = 200;

interface ExistingMetadata {
  name: string;
  symbol: string;
  uri: string;
}

/** Reads a single Borsh-encoded String (u32 LE length prefix + UTF-8 bytes)
 * starting at `offset`, trimming the trailing null-byte padding Metaplex
 * pads name/symbol/uri out to their max length with. Returns the decoded
 * string plus the offset just past it. */
function readBorshString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const strBuf = buf.subarray(offset + 4, offset + 4 + len);
  const str = strBuf.toString("utf8").replace(/\0+$/g, "");
  return [str, offset + 4 + len];
}

/** Fetches TKN's existing Metaplex metadata (name/symbol/uri) directly off
 * the raw account, if one exists. Returns null if TKN has no metadata
 * account at all (e.g. a bare SPL mint with no Metaplex metadata) -- the
 * caller falls back to sensible defaults in that case. */
async function fetchExistingMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<ExistingMetadata | null> {
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(metadataPda);
  if (!info) return null;

  // Layout: key (u8) + update_authority (32) + mint (32), then Borsh
  // strings name / symbol / uri in that order.
  let offset = 1 + 32 + 32;
  const [name, o1] = readBorshString(info.data, offset);
  const [symbol, o2] = readBorshString(info.data, o1);
  const [uri] = readBorshString(info.data, o2);
  return { name, symbol, uri };
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const WRAP_FEE_BPS = 75; // 0.75%
  const UNWRAP_FEE_BPS = 125; // 1.25%
  // Every one of these three is a flat % *of the fee itself* (not nested) --
  // their sum must be <= 10_000 (100%). Whatever's left implicitly goes to
  // LP stakers. Set to your real split so you don't need a follow-up
  // update_fees call: 20% burn / 10% protocol / 50% bTKN stakers / 20% LP
  // stakers (implied remainder).
  const BURN_BPS = 2000; // 20% burned
  const PROTOCOL_BPS = 1000; // 10% to the protocol wallet (below)
  const BTKN_SHARE_BPS = 5000; // 50% to bTKN stakers -- remaining 20% goes to LP stakers

  const tknMintArg = process.argv[2];
  const tknMint = new PublicKey(tknMintArg ?? "Cwzq2X7ra1S8ryjQGdPeuJ74HMxDtAnpWfvAbw2JVoct");

  const protocolWalletArg = process.argv[3];
  const protocolWallet = protocolWalletArg ? new PublicKey(protocolWalletArg) : authority.publicKey;
  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      protocolWallet
    )
  ).address;

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
  const [stakedBtknVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("staked_btkn"), tknMint.toBuffer()],
    program.programId
  );
  const [btknMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), btknMint.toBuffer()],
    METADATA_PROGRAM_ID
  );

  // Capture TKN's existing metadata (name/symbol/image) so bTKN can mirror
  // it. The uri is copied verbatim -- that's what carries the actual image,
  // since the off-chain JSON it points to has the image field. Name/symbol
  // get a light "wrapped" treatment so the two aren't visually identical in
  // wallets, truncated to Metaplex's hard length caps.
  const tknMetadata = await fetchExistingMetadata(provider.connection, tknMint);
  let btknName: string;
  let btknSymbol: string;
  let btknUri: string;
  if (tknMetadata) {
    btknName = `Banana ${tknMetadata.name}`.slice(0, MPL_MAX_NAME_LENGTH);
    btknSymbol = `b${tknMetadata.symbol}`.slice(0, MPL_MAX_SYMBOL_LENGTH);
    btknUri = tknMetadata.uri.slice(0, MPL_MAX_URI_LENGTH);
  } else {
    console.log(
      "\nWarning: TKN has no existing Metaplex metadata -- bTKN will be created"
    );
    console.log(
      "with placeholder name/symbol and no image. Update it later via"
    );
    console.log("Metaplex's update instruction if you add TKN metadata afterward.\n");
    btknName = "Banana Token";
    btknSymbol = "bTKN";
    btknUri = "";
  }

  console.log("Program ID:               ", program.programId.toBase58());
  console.log("TKN mint:                 ", tknMint.toBase58());
  console.log("Vault config PDA:         ", vaultConfig.toBase58());
  console.log("bTKN mint PDA:            ", btknMint.toBase58());
  console.log("bTKN metadata PDA:        ", btknMetadata.toBase58());
  console.log("Vault token acct:         ", vaultTokenAccount.toBase58());
  console.log("Reward vault token acct:  ", rewardVaultTokenAccount.toBase58());
  console.log("Staked bTKN vault acct:   ", stakedBtknVault.toBase58());
  console.log("Protocol wallet:          ", protocolWallet.toBase58());
  console.log("Protocol token acct:      ", protocolTokenAccount.toBase58());
  console.log("bTKN name/symbol/uri:     ", btknName, "/", btknSymbol, "/", btknUri || "(none)");

  const sig = await program.methods
    .initializeVault(
      WRAP_FEE_BPS,
      UNWRAP_FEE_BPS,
      BURN_BPS,
      PROTOCOL_BPS,
      BTKN_SHARE_BPS,
      btknName,
      btknSymbol,
      btknUri
    )
    .accountsPartial({
      authority: authority.publicKey,
      tknMint,
      protocolTokenAccount,
      vaultConfig,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      stakedBtknVault,
      btknMetadata,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
      sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nVault initialized. Tx signature:", sig);
  console.log(
    `\nFee split set at init: ${BURN_BPS / 100}% burn / ${PROTOCOL_BPS / 100}% protocol / ` +
      `${BTKN_SHARE_BPS / 100}% bTKN stakers / ${(10_000 - BURN_BPS - PROTOCOL_BPS - BTKN_SHARE_BPS) / 100}% LP stakers.`
  );
  console.log(
    "No update_fees call needed unless you want to change this later."
  );
  console.log(
    "\nbTKN staking works immediately (stake_btkn/unstake_btkn/claim_btkn_rewards)"
  );
  console.log(
    "-- no bootstrap step needed, since bTKN's mint is already known here."
  );
  console.log(
    "\nLP staking still needs set_lp_mint once a pool exists. Until then, the"
  );
  console.log(
    "20% LP-staker share of each fee gets redirected to burn instead (no one"
  );
  console.log(
    "to credit it to yet) -- the protocol and bTKN-staker shares are unaffected."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
