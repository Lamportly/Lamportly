const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export type TokenForPrice = { mint: string; decimals: number };

function oneTokenRaw(decimals: number) { return "1" + "0".repeat(Math.max(0, decimals)); }
async function safeJson<T>(r: Response): Promise<T | null> { try { return await r.json(); } catch { return null; } }

// Birdeye via proxy
async function birdeyePriceUSD(mint: string): Promise<number> {
  try {
    const r = await fetch(`/__birdeye/defi/price?address=${encodeURIComponent(mint)}`);
    if (!r.ok) return 0;
    const j = await safeJson<{ data?: { value?: number } }>(r);
    const p = Number(j?.data?.value ?? 0);
    return Number.isFinite(p) ? p : 0;
  } catch { return 0; }
}

// Jupiter via proxy
async function jupV4Price(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  try {
    const r = await fetch(`/__jup_price/v4/price?ids=${encodeURIComponent(ids.join(","))}`);
    if (!r.ok) return {};
    const j = await safeJson<{ data?: Record<string, { price?: number }> }>(r);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(j?.data ?? {})) {
      const p = Number(v?.price ?? 0);
      if (p > 0) out[k] = p;
    }
    return out;
  } catch { return {}; }
}

async function jupV6Quote1TokenUSD(mint: string, decimals: number): Promise<number> {
  try {
    const amount = oneTokenRaw(decimals);
    const r = await fetch(`/__jup_quote/v6/quote?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50`);
    if (!r.ok) return 0;
    const j = await safeJson<{ data?: Array<{ outAmount?: string }> }>(r);
    const route = (j?.data && j.data[0]) || null;
    if (!route?.outAmount) return 0;
    const usd = Number(route.outAmount) / 1_000_000; // USDC 6dp
    return Number.isFinite(usd) ? usd : 0;
  } catch { return 0; }
}

export async function fetchTokenPrices(tokens: TokenForPrice[], includeSOL = true) {
  const out: Record<string, number> = {};

  // A) Birdeye first
  await Promise.all(tokens.map(async (t) => {
    const p = await birdeyePriceUSD(t.mint);
    if (p > 0) out[t.mint] = p;
  }));

  // B) SOL via Jupiter v4 symbol (if still missing)
  if (includeSOL && !("SOL" in out)) {
    const v4sol = await jupV4Price(["SOL"]);
    if (v4sol["SOL"] && v4sol["SOL"] > 0) out["SOL"] = v4sol["SOL"];
  }

  // C) Missing → Jupiter v4 by mint
  const missing = tokens.filter(t => !(t.mint in out));
  if (missing.length) Object.assign(out, await jupV4Price(missing.map(t => t.mint)));

  // D) Still missing → Jupiter v6 quote (1 token → USDC)
  for (const t of tokens) {
    if (t.mint in out) continue;
    const p = await jupV6Quote1TokenUSD(t.mint, t.decimals);
    if (p > 0) out[t.mint] = p;
  }

  return out;
}
