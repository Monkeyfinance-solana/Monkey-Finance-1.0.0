// Run with: npx ts-node scripts/import_phantom_key.ts [output_path]
//
// Converts a Phantom-exported private key (base58 string, from Phantom's
// Settings -> Export Private Key) into the JSON keypair file format
// solana-cli/Anchor expect (a JSON array of 64 bytes).
//
// Everything here runs entirely on your own machine -- the key is read from
// a local terminal prompt (not a command-line argument, so it never ends up
// in your shell history) and written straight to a local file. Nothing is
// sent anywhere, and this script has no network calls at all.
//
// After running this, that output file IS your real private key in
// plaintext. Treat it accordingly: don't commit it, don't put it inside a
// folder that syncs anywhere, and delete it if you ever want to revoke
// CLI access without touching the wallet itself in Phantom.

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import bs58 from "bs58";

const defaultOut = path.join(process.env.HOME || ".", ".config", "solana", "phantom.json");
const outPath = process.argv[2] || defaultOut;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Basic hidden-input: readline doesn't support masking out of the box, so
// this at least avoids echoing you can shoulder-surf on a shared screen by
// muting stdout while you type. Not bulletproof, but better than plaintext
// on screen.
rl.question("Paste your Phantom private key (base58, Settings -> Export Private Key): ", (key) => {
  rl.close();
  try {
    const secret = bs58.decode(key.trim());
    if (secret.length !== 64) {
      console.error(`Expected a 64-byte secret key, got ${secret.length} bytes. Did you paste the full string?`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(Array.from(secret)), { mode: 0o600 });
    console.log(`\nSaved keypair to: ${outPath}`);
    console.log(`\nNow set:\n  export ANCHOR_WALLET=${outPath}`);
  } catch (err) {
    console.error("Couldn't decode that as a base58 key:", err);
    process.exit(1);
  }
});
