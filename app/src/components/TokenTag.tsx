import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";

// A token symbol (TKN, bTKN, ...) that shows its mint address on hover and
// copies the full address to the clipboard on click. Used anywhere a token
// symbol appears so people can grab the real mint address without having to
// go dig through the vault stats or their wallet.
export function TokenTag({ label, mint }: { label: string; mint: PublicKey | string | null }) {
  const [copied, setCopied] = useState(false);
  const address = mint ? (typeof mint === "string" ? mint : mint.toBase58()) : null;

  if (!address) return <span>{label}</span>;

  function handleClick() {
    navigator.clipboard?.writeText(address!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <span className="token-tag" onClick={handleClick} title={copied ? "Copied!" : address}>
      {label}
      <span className="token-tag-tooltip">{copied ? "Copied!" : address}</span>
    </span>
  );
}
