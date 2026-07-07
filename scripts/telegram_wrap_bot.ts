// Run with:
//   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat id> \
//     npx ts-node scripts/telegram_wrap_bot.ts <TKN_MINT> [more TKN mints...]
// (place this file at pod_vault/scripts/telegram_wrap_bot.ts)
//
// Optional: set TELEGRAM_GIF_URL to a direct .gif/.mp4 link (e.g. a monkey
// eating a banana) and every announcement is sent as an animation with the
// usual wrap details as the caption, instead of a plain text message. Must
// be a *direct* media URL, not a Giphy/Tenor page link -- e.g. from Giphy,
// right-click the gif itself -> "Copy image address", or grab the "Direct
// media URL" from the page's "Embed"/share panel; it should end in .gif or
// .mp4 and load as just the image/video if you paste it straight into a
// browser tab (not a whole webpage around it). If sending as an animation
// fails for any reason (bad/expired URL, network hiccup), this script falls
// back to a plain text message so an announcement never silently vanishes.
//
// Long-running process -- keep it running (pm2, systemd, a `screen`/`tmux`
// session, whatever you're comfortable with) and it announces every
// TKN->bTKN wrap to a Telegram chat, the moment it happens. Reuses the same
// program.addEventListener("wrapEvent", ...) live-subscription pattern
// already demonstrated in scripts/watch_events.ts -- no new on-chain
// mechanism needed, the program already emits everything this needs.
//
// Works against ANY cluster via the same ANCHOR_PROVIDER_URL / ANCHOR_WALLET
// env vars every other script here uses -- point it at your local validator
// to test now, and at mainnet later (once the vault is redeployed there)
// with zero code changes, just different env vars:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899   # local test
//   export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com  # mainnet
//   export ANCHOR_WALLET=~/.config/solana/id.json   # never signs anything --
//     addEventListener is read-only, but AnchorProvider.env() still wants a
//     keypair file to exist.
//
// Telegram setup (one-time, on your end):
//   1. Message @BotFather on Telegram, send /newbot, follow the prompts.
//      You'll get a bot token like 123456789:AAF...
//   2. Add the bot to your announcement channel/group.
//   3. Get the chat id: easiest way is to send any message in the chat,
//      then visit https://api.telegram.org/bot<TOKEN>/getUpdates in a
//      browser and read the "chat":{"id": ...} field from the JSON. For a
//      channel, the id is usually negative (e.g. -1001234567890) -- make
//      sure the bot is an admin of the channel if it's a channel, not a
//      group.
//
// Requires Node 18+ (uses global fetch -- no extra HTTP dependency).
//
// Runs against MULTIPLE vaults at once if you pass more than one TKN mint --
// handy since you said you want this on both localhost (now) and mainnet
// (once redeployed): just run two instances, one per ANCHOR_PROVIDER_URL,
// or extend this script to take a list of {rpcUrl, tknMints} if you want a
// single process watching both networks (not implemented here since a
// single Connection can only point at one RPC).

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GIF_URL = process.env.TELEGRAM_GIF_URL; // optional, see comment above

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars first (see comments at the top of this file).");
  process.exit(1);
}

const tknMintArgs = process.argv.slice(2);
if (tknMintArgs.length === 0) {
  console.error("Usage: npx ts-node scripts/telegram_wrap_bot.ts <TKN_MINT> [more TKN mints...]");
  process.exit(1);
}

function fmtAmount(raw: anchor.BN | string, decimals: number): string {
  const n = Number(raw.toString()) / 10 ** decimals;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function shortAddr(pubkey: PublicKey): string {
  const s = pubkey.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

// Best-effort explorer link -- skipped for localhost (not publicly
// resolvable, so a link there isn't useful to anyone reading the announcement).
function explorerLink(signature: string, rpcUrl: string): string | null {
  if (rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost")) return null;
  const cluster = rpcUrl.includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

async function sendPlainTextMessage(text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Telegram API error ${res.status}: ${body}`);
  }
}

async function sendAnimationMessage(text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAnimation`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      animation: TELEGRAM_GIF_URL,
      caption: text,
      parse_mode: "HTML",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Telegram sendAnimation error ${res.status}: ${body} -- falling back to plain text.`);
    await sendPlainTextMessage(text);
  }
}

// Sends the gif+caption if TELEGRAM_GIF_URL is set, otherwise a plain text
// message -- same call site either way so the event handler below doesn't
// need to know which mode it's in.
async function sendTelegramMessage(text: string) {
  if (TELEGRAM_GIF_URL) {
    await sendAnimationMessage(text);
  } else {
    await sendPlainTextMessage(text);
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PodVault as Program<PodVault>;
  const rpcUrl = provider.connection.rpcEndpoint;

  // Map vaultConfig PDA -> { name, decimals } so the live listener (which
  // fires for every wrap on this program, across all vaults) can label and
  // scale each event correctly, and ignore vaults you didn't ask to watch.
  const vaultsByConfig = new Map<string, { tknMint: PublicKey; decimals: number; name: string }>();
  for (const mintStr of tknMintArgs) {
    const tknMint = new PublicKey(mintStr);
    const [vaultConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tknMint.toBuffer()],
      program.programId
    );
    const mintInfo = await getMint(provider.connection, tknMint);
    vaultsByConfig.set(vaultConfig.toBase58(), {
      tknMint,
      decimals: mintInfo.decimals,
      name: `${shortAddr(tknMint)} vault`,
    });
    console.log(`Watching vault ${vaultConfig.toBase58()} (TKN mint ${tknMint.toBase58()})`);
  }

  console.log(`\nConnected to ${rpcUrl}. Waiting for wraps...\n`);

  program.addEventListener("wrapEvent", async (event: any, slot: number, signature?: string) => {
    const vaultConfigKey = event.vaultConfig.toBase58();
    const vault = vaultsByConfig.get(vaultConfigKey);
    if (!vault) return; // a wrap on a vault we weren't asked to watch -- ignore

    const { decimals, name } = vault;
    const amountIn = fmtAmount(event.amountIn, decimals);
    const btknMinted = fmtAmount(event.btknMinted, decimals);
    const fee = fmtAmount(event.fee, decimals);
    const burned = fmtAmount(event.burned, decimals);

    const link = signature ? explorerLink(signature, rpcUrl) : null;

    const lines = [
      `🎁 <b>New Wrap</b> -- ${name}`,
      `👤 <code>${shortAddr(event.user)}</code>`,
      `💰 ${amountIn} TKN → ${btknMinted} bTKN`,
      `   fee: ${fee} TKN (${burned} burned 🔥)`,
    ];
    if (link) lines.push(`🔗 <a href="${link}">view tx</a>`);

    const text = lines.join("\n");
    console.log(`[wrap @ slot ${slot}] ${name}: ${amountIn} TKN -> ${btknMinted} bTKN by ${shortAddr(event.user)}`);
    await sendTelegramMessage(text).catch((err) => console.error("Failed to send Telegram message:", err));
  });

  // Keep the process alive -- addEventListener's subscription runs on
  // Connection's websocket in the background, there's nothing to await.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
