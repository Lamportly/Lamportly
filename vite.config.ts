// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // loads .env
  const BIRDEYE_KEY = env.VITE_BIRDEYE_API_KEY || "";

  return {
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
        },
      },

      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/__birdeye")) return next();

          // CORS / preflight
          if (req.method === "OPTIONS") {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-API-KEY");
            res.statusCode = 204;
            res.end();
            return;
          }

          if (!BIRDEYE_KEY) {
            res.statusCode = 500;
            res.end("Birdeye API key missing (VITE_BIRDEYE_API_KEY).");
            return;
          }

          try {
            const url = new URL(req.url, "http://localhost");
            const upstreamPath = url.pathname.replace(/^\/__birdeye/, "") + (url.search || "");

            // Collect body if present
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve) => {
              req.on("data", (c) => chunks.push(Buffer.from(c)));
              req.on("end", () => resolve());
            });
            const body = chunks.length ? Buffer.concat(chunks) : undefined;

            const upstream = await fetch("https://public-api.birdeye.so" + upstreamPath, {
              method: req.method,
              headers: {
                "X-API-KEY": BIRDEYE_KEY,
                "x-chain": "solana",
                "accept": "application/json",
                // Forward content-type if provided
                ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}),
              },
              body,
            });

            res.statusCode = upstream.status;
            upstream.headers.forEach((v, k) => {
              if (k.toLowerCase() === "access-control-allow-origin") return;
              res.setHeader(k, v);
            });
            res.setHeader("Access-Control-Allow-Origin", "*");

            const arr = await upstream.arrayBuffer();
            res.end(Buffer.from(arr));
          } catch (e: any) {
            res.statusCode = 502;
            res.end("Proxy error: " + (e?.message || e));
          }
        });
      },
    },
    resolve: {
      alias: { "@": "/src" },
    },
  };
});
