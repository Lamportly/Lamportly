export type TokenForPrice = { mint: string; decimals: number };
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function oneTokenRaw(decimals: number) { return "1" + "0".repeat(Math.max(0, decimals)); }
async function safeJson<T>(r: Response): Promise<T | null> { try { return await r.json(); } catch { return null; } }

async function birdeyePriceUSD(mint: string): Promise<number> {
  try {
    const r = await fetch(`/__birdeye/defi/price?address=${encodeURIComponent(mint)}`);
    if (!r.ok) {
      console.warn("Birdeye price non-200:", r.status, await r.text());
      return 0;
    }
    const j = await safeJson<{ data?: { value?: number } }>(r);
    const p = Number(j?.data?.value ?? 0);
    return Number.isFinite(p) ? p : 0;
  } catch (e) {
    console.warn("Birdeye price error:", e);
    return 0;
  }
}

export async function fetchTokenPrices(tokens: TokenForPrice[], includeSOL = true) {
  const out: Record<string, number> = {};
  // Birdeye for all mints (incl. SOL mint)
  await Promise.all(tokens.map(async (t) => {
    const p = await birdeyePriceUSD(t.mint);
    if (p > 0) out[t.mint] = p;
  }));
  // If you want SOL via symbol too, you can special-case it here later.
  return out;
}
