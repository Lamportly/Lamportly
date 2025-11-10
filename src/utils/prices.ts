// src/utils/prices.ts
// Robust pricing: try Jupiter v4 price first; if missing, fall back to v6 quote (1 token -> USDC)

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type TokenForPrice = { mint: string; decimals: number };

function oneTokenRaw(decimals: number): string {
  // "1" followed by `decimals` zeros as a string (BigInt-safe)
  return "1" + "0".repeat(Math.max(0, decimals));
}

async function jupV4Price(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const url = `https://price.jup.ag/v4/price?ids=${encodeURIComponent(ids.join(","))}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const json = await res.json();
  const map: Record<string, number> = {};
  const data = (json?.data ?? {}) as Record<string, { price?: number }>;
  for (const [k, v] of Object.entries(data)) {
    const p = Number(v?.price ?? 0);
    if (p > 0) map[k] = p;
  }
  return map;
}

async function jupV6Quote1TokenUSD(mint: string, decimals: number): Promise<number> {
  // Price 1 token by quoting to USDC
  const amount = oneTokenRaw(decimals); // raw units for exactly 1 token
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50`;
  const res = await fetch(url);
  if (!res.ok) return 0;
  const json = await res.json();
  const route = (json?.data && json.data[0]) || null;
  if (!route?.outAmount) return 0;
  // USDC has 6 decimals
  const outRaw = String(route.outAmount);
  const usd = Number(outRaw) / 1_000_000;
  return Number.isFinite(usd) ? usd : 0;
}

/**
 * Fetch prices for tokens. Also returns SOL price (key: "SOL") if includeSOL=true.
 * Keys in the returned map are the token mints (and "SOL").
 */
export async function fetchTokenPrices(
  tokens: TokenForPrice[],
  includeSOL = true
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  // 1) Try v4 price first (fast) for all mints (+ optional SOL symbol)
  const ids = [...new Set(tokens.map((t) => t.mint))];
  if (includeSOL) ids.unshift("SOL");
  const v4 = await jupV4Price(ids).catch(() => ({} as Record<string, number>));
  Object.assign(out, v4);

  // 2) For any token still missing, fall back to v6 quote (1 token -> USDC)
  const missing = tokens.filter((t) => !(t.mint in out));
  if (missing.length) {
    const results = await Promise.all(
      missing.map(async (t) => {
        try {
          const p = await jupV6Quote1TokenUSD(t.mint, t.decimals);
          return [t.mint, p] as const;
        } catch {
          return [t.mint, 0] as const;
        }
      })
    );
    for (const [mint, p] of results) {
      if (p > 0) out[mint] = p;
    }
  }

  return out;
}
