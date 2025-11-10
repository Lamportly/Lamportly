// src/utils/metadata.ts
type TokenMeta = {
  mint: string;
  name?: string;
  symbol?: string;
  logoURI?: string;
};

let jupIndex: Map<string, TokenMeta> | null = null;

async function loadJupiterIndex(): Promise<Map<string, TokenMeta>> {
  if (jupIndex) return jupIndex;
  const res = await fetch("https://token.jup.ag/all");
  const data = (await res.json()) as Array<{ address: string; name: string; symbol: string; logoURI?: string }>;
  jupIndex = new Map(
    data.map((t) => [
      t.address,
      { mint: t.address, name: t.name, symbol: t.symbol, logoURI: t.logoURI },
    ])
  );
  return jupIndex!;
}

// Helius JSON-RPC getAsset fallback
async function heliusGetAsset(mint: string): Promise<any | null> {
  const endpoint = import.meta.env.VITE_RPC_URL; // your Helius RPC (with ?api-key=...)
  if (!endpoint) return null;
  const body = {
    jsonrpc: "2.0",
    id: "get-asset",
    method: "getAsset",
    params: { id: mint },
  };
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.result ?? null;
  } catch {
    return null;
  }
}

export async function fetchTokenMetas(mints: string[]): Promise<Record<string, TokenMeta>> {
  const out: Record<string, TokenMeta> = {};
  const jup = await loadJupiterIndex().catch(() => null);

  // First pass: Jupiter hits
  if (jup) {
    for (const m of mints) {
      const hit = jup.get(m);
      if (hit) out[m] = hit;
    }
  }

  // Second pass: Helius getAsset + fetch json_uri for those still missing name/image
  const missing = mints.filter((m) => !out[m]?.name || !out[m]?.logoURI);
  for (const mint of missing) {
    try {
      const asset = await heliusGetAsset(mint);
      const nameFromAsset = asset?.content?.metadata?.name as string | undefined;
      const symbolFromAsset = asset?.content?.metadata?.symbol as string | undefined;
      let img: string | undefined = asset?.content?.links?.image;

      // If json_uri exists, fetch it for richer fields
      const uri = asset?.content?.json_uri as string | undefined;
      if (uri) {
        const metaRes = await fetch(uri);
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          img = img || metaJson?.image;
          out[mint] = {
            mint,
            name: nameFromAsset || metaJson?.name,
            symbol: symbolFromAsset || metaJson?.symbol,
            logoURI: img,
          };
          continue;
        }
      }

      // fallback if no json_uri
      if (!out[mint]) {
        out[mint] = {
          mint,
          name: nameFromAsset,
          symbol: symbolFromAsset,
          logoURI: img,
        };
      }
    } catch {
      // ignore, leave undefined => UI will show mint
    }
  }

  // Ensure at least a stub
  for (const m of mints) {
    if (!out[m]) out[m] = { mint: m };
  }
  return out;
}
