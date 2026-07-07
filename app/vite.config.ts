import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @solana/web3.js and Anchor expect Node globals (Buffer, process) that
// don't exist in the browser by default -- this plugin polyfills them.
// Without it you'll hit a "Buffer is not defined" crash the moment any
// Solana code runs.
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  server: {
    port: 5173,
  },
});
