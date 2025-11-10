import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/__birdeye": {
        target: "https://bds.birdeye.so",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__birdeye/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Inject your API key + chain header into the outgoing request
            proxyReq.setHeader("X-API-KEY", process.env.VITE_BIRDEYE_API_KEY || "");
            proxyReq.setHeader("x-chain", "solana");
            proxyReq.setHeader("accept", "application/json");
          });
        },
      },
      "/__jup_price": {
        target: "https://price.jup.ag",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__jup_price/, ""),
      },
      "/__jup_quote": {
        target: "https://quote-api.jup.ag",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__jup_quote/, ""),
      },
      "/__jup_token": {
        target: "https://token.jup.ag",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__jup_token/, ""),
      },
    },
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
