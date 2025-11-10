import type { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Return a simplified list of parsed token accounts
export async function fetchParsedTokenAccounts(
  connection: Connection,
  owner: PublicKey
) {
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  // Map to a lighter structure
  const out = resp.value
    .map(({ pubkey, account }) => {
      const data: any = account.data;
      const info = data?.parsed?.info;
      const mint = info?.mint as string | undefined;
      const tokenAmount = info?.tokenAmount;
      const decimals = Number(tokenAmount?.decimals ?? 0);
      const uiAmount = Number(tokenAmount?.uiAmount ?? 0);
      const rawAmount = String(tokenAmount?.amount ?? "0");
      return {
        tokenAccount: pubkey.toBase58(),
        mint: mint || "",
        decimals,
        uiAmount,
        rawAmount,
      };
    })
    // keep even zero-balance accounts, user might want to close them
    .sort((a, b) => Number(b.uiAmount) - Number(a.uiAmount));

  return out;
}
