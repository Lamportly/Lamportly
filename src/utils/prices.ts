// src/utils/prices.ts
// Birdeye-first pricing (works in Codespaces). Falls back to Jupiter (v4 + v6 quote) if reachable.

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type TokenForPrice = { mint: string; decimals: number };

const BIRDEYE_API_KEY = import.meta.env.VITE_BIRDEYE_API_KEY as string | undefined;
const BIRDEYE_BASE = (import.meta.env.VITE_BIRDEYE_BASE || "https://bds.birdeye.so") as string;

// ---------- helpers ----------
function oneTokenRaw(decimals: number): string {
  return "1" + "0".repeat(Math.max(0, decimals));
}

async function safeJson<T = any>(r: Response): Promise<T | null> {
  try {
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ---------- Birdeye (primary) ----------
async function birdeyePriceUSD(mint: string): Promise<number> {
  if (!BIRDEYE_API_KEY) return 0;
  try {
    const url = `${BIRDEYE_BASE}/defi/price?address=${encodeURIComponent(mint)}`;
    const r = await fetch(url, {
      headers: {
        "X-API-KEY": BIRDEYE_API_KEY,
        "x-chain": "solana",
        accept: "application/json",
      },
    });
    if (!r.ok) return 0;
    const j = await safeJson<{ data?: { value?: number } }>(r);
    const p = Number(j?.data?.value ?? 0);
    return Number.isFinite(p) ? p : 0;
  } catch {
    return 0;
  }
}

// ---------- Jupiter (fallback) ----------
async function jupV4Price(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  try {
    const url = `https://price.jup.ag/v4/price?ids=${encodeURIComponent(ids.join(","))}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = await safeJson<{ data?: Record<string, { price?: number }> }>(res);
    const map: Record<string, number> = {};
    for (const [k, v] of Object.entries(json?.data ?? {})) {
      const p = Number(v?.price ?? 0);
      if (p > 0) map[k] = p;
    }
    return map;
  } catch {
    return {};
  }
}

async function jupV6Quote1TokenUSD(mint: string, decimals: number): Promise<number> {
  try {
    const amount = oneTokenRaw(decimals);
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const json = await safeJson<{ data?: Array<{ outAmount?: string }> }>(res);
    const route = (json?.data && json.data[0]) || null;
    if (!route?.outAmount) return 0;
    const outRaw = String(route.outAmount); // USDC has 6 decimals
    const usd = Number(outRaw) / 1_000_000;
    return Number.isFinite(usd) ? usd : 0;
  } catch {
    return 0;
  }
}

// ---------- Public API ----------
export async function fetchTokenPrices(
  tokens: TokenForPrice[],
  includeSOL = true
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  // A) Birdeye first (per-mint)
  // (Birdeye has a multi endpoint too, but per-mint keeps it simple/reliable.)
  await Promise.all(
    tokens.map(async (t) => {
      const p = await birdeyePriceUSD(t.mint);
      if (p > 0) out[t.mint] = p;
    })
  );

  // B) If SOL requested and still missing, try Jupiter v4 by symbol
  if (includeSOL && !("SOL" in out)) {
    const v4sol = await jupV4Price(["SOL"]);
    if (v4sol["SOL"] && v4sol["SOL"] > 0) out["SOL"] = v4sol["SOL"];
  }

  // C) Any missing tokens → Jupiter v4 batch
  const missing = tokens.filter((t) => !(t.mint in out));
  if (missing.length) {
    const v4 = await jupV4Price(missing.map((t) => t.mint));
    Object.assign(out, v4);
  }

  // D) Still missing → Jupiter v6 quote(1 token → USDC)
  const missingAfterV4 = tokens.filter((t) => !(t.mint in out));
  for (const t of missingAfterV4) {
    const p = await jupV6Quote1TokenUSD(t.mint, t.decimals);
    if (p > 0) out[t.mint] = p;
  }

  return out;
}
