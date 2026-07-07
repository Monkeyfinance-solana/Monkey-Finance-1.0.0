import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import App from "./App";
import "./index.css";

// Set VITE_RPC_URL in app/.env to point at devnet/mainnet (e.g. your Helius
// URL) -- defaults to the local validator if unset, so nothing breaks for
// existing local-validator workflows.
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8899";

function Root() {
  // Empty wallets array + autoConnect relies on Wallet Standard
  // auto-detection -- any installed wallet extension (Phantom, Solflare,
  // Backpack, etc.) registers itself automatically and will show up in the
  // connect button without needing to import a specific adapter here.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App connectButton={<WalletMultiButton />} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
