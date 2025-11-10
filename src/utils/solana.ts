import type { Connection, PublicKey, ParsedAccountData } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export type ParsedToken = {
  tokenAccount: string;
  mint: string;
  decimals: number;
  uiAmount: number;
  rawAmount: string; // raw string (u64)
};

export async function fetchParsedTokenAccounts(
  connection: Connection,
  owner: PublicKey
): Promise<ParsedToken[]> {
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const out = resp.value
    .map(
      ({
        pubkey,
        account,
      }: {
        pubkey: PublicKey;
        account: { data: ParsedAccountData };
      }) => {
        const data = account.data;
        // Parsed layout: data.parsed.info.tokenAmount.{amount,decimals,uiAmount}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info: any = (data as ParsedAccountData)?.parsed?.info;
        const mint = (info?.mint as string) ?? "";
        const tokenAmount = info?.tokenAmount;
        const decimals = Number(tokenAmount?.decimals ?? 0);
        const uiAmount = Number(tokenAmount?.uiAmount ?? 0);
        const rawAmount = String(tokenAmount?.amount ?? "0");
        return {
          tokenAccount: pubkey.toBase58(),
          mint,
          decimals,
          uiAmount,
          rawAmount,
        } as ParsedToken;
      }
    )
    // keep even zero-balance accounts so the user can close them; sort by balance
    .sort((a: ParsedToken, b: ParsedToken) => Number(b.uiAmount) - Number(a.uiAmount));

  return out;
}
