import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
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
      }
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
