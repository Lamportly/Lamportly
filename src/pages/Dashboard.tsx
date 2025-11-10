import React, { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { fetchParsedTokenAccounts } from "@/utils/solana";

type ParsedToken = {
  tokenAccount: string;
  mint: string;
  decimals: number;
  uiAmount: number;
  rawAmount: string; // string u64
};

export default function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [solLamports, setSolLamports] = useState<number>(0);
  const [tokens, setTokens] = useState<ParsedToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [destSol, setDestSol] = useState<string>("");
  const [destOwner, setDestOwner] = useState<string>("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string>("");

  const isConnected = !!publicKey;

  // fetch balances
  useEffect(() => {
    (async () => {
      if (!isConnected || !publicKey) return;
      setLoading(true);
      try {
        const bal = await connection.getBalance(publicKey);
        setSolLamports(bal);
        const toks = await fetchParsedTokenAccounts(connection, publicKey);
        setTokens(toks);
      } catch (e: any) {
        console.error(e);
        setStatus(`Error loading balances: ${e?.message || e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [isConnected, publicKey, connection]);

  const selectedTokens = useMemo(
    () => tokens.filter(t => selected[t.tokenAccount]),
    [tokens, selected]
  );

  async function onBuildAndSign() {
    if (!publicKey || !signTransaction) return setStatus("Connect your wallet first.");
    try {
      setStatus("");
      // validate destination addresses
      const solDest = new PublicKey(destSol);
      const ownerDest = new PublicKey(destOwner); // this is the "owner" that will receive tokens (ATA auto-created if needed)

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight });

      // for each selected token account: transfer whole balance -> close account (rent to SOL dest)
      for (const t of selectedTokens) {
        const tokenAccPk = new PublicKey(t.tokenAccount);
        const mintPk = new PublicKey(t.mint);

        // Derive destination ATA for the nominated owner
        const destAta = await getAssociatedTokenAddress(mintPk, ownerDest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const destInfo = await connection.getAccountInfo(destAta);
        if (!destInfo) {
          // create ATA if missing (payer = connected wallet)
          tx.add(
            createAssociatedTokenAccountInstruction(
              publicKey,   // payer
              destAta,     // ata address
              ownerDest,   // owner of ATA
              mintPk,      // mint
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }

        // If there is a positive balance, transfer full balance to destAta
        if (BigInt(t.rawAmount) > 0n) {
          tx.add(
            createTransferInstruction(
              tokenAccPk,          // source token account
              destAta,             // destination ATA
              publicKey,           // owner/authority of source
              BigInt(t.rawAmount), // amount in raw units
              [],                  // multisig (not used)
              TOKEN_PROGRAM_ID
            )
          );
        }

        // Close the (now emptied) token account; reclaimed rent goes to SOL dest
        tx.add(
          createCloseAccountInstruction(
            tokenAccPk,
            solDest,     // rent destination in SOL
            publicKey,   // owner/authority
            [],          // multisig (not used)
            TOKEN_PROGRAM_ID
          )
        );
      }

      // Optional: also transfer SOL remainder (user can edit amount later; here we send "all minus fee" -> safer: let user specify)
      // For safety in this demo, we skip automatic "drain all". Provide a small field if you want a fixed amount transfer:
      // tx.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(destSol), lamports: 1000000 }));

      if (tx.instructions.length === 0) {
        return setStatus("No instructions prepared. Select at least one token account.");
      }

      // User signs
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Success! Signature: ${sig}`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Transaction failed: ${e?.message || e}`);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      {!isConnected ? (
        <p className="small">Connect your wallet to begin.</p>
      ) : (
        <>
          <div className="row">
            <div className="col">
              <div className="badge ok">Connected</div>
              <div className="mt-2 small">Your address: {publicKey?.toBase58()}</div>
              <div className="mt-2">SOL balance: <strong>{(solLamports / 1_000_000_000).toFixed(4)} SOL</strong></div>
            </div>
            <div className="col">
              <label className="small">Destination for recovered rent (SOL):</label>
              <input
                className="input"
                placeholder="Enter SOL destination address (PublicKey)"
                value={destSol}
                onChange={e => setDestSol(e.target.value.trim())}
              />
              <div className="mt-2 small">Tip: You can set this to your same wallet or a cold wallet.</div>
            </div>
            <div className="col">
              <label className="small">Owner address to receive tokens (ATA auto-created if needed):</label>
              <input
                className="input"
                placeholder="Enter owner address that should receive tokens"
                value={destOwner}
                onChange={e => setDestOwner(e.target.value.trim())}
              />
            </div>
          </div>

          <div className="mt-4">
            <h3 style={{ margin: 0 }}>SPL Token Accounts</h3>
            {loading ? (
              <p>Loading token accounts…</p>
            ) : tokens.length === 0 ? (
              <p className="small">No SPL token accounts found for this wallet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Mint</th>
                    <th>Token Account</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.tokenAccount}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selected[t.tokenAccount]}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [t.tokenAccount]: e.target.checked }))
                          }
                        />
                      </td>
                      <td className="small">{t.mint}</td>
                      <td className="small">{t.tokenAccount}</td>
                      <td>
                        {t.uiAmount} <span className="small">({t.decimals} dp)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row mt-3">
              <div className="col">
                <p className="small">
                  Actions per selected token account:
                  <br />1) Transfer entire token balance → your nominated owner’s ATA
                  <br />2) Close token account → recover rent to your SOL destination
                </p>
              </div>
              <div className="col center">
                <button className="btn" onClick={onBuildAndSign} disabled={!destSol || !destOwner || selectedTokens.length === 0}>
                  Build & Sign Transaction
                </button>
                <div className="small mt-2">
                  {(!destSol || !destOwner) && "Enter both destination addresses to continue."}
                </div>
              </div>
            </div>
          </div>

          {!!status && (
            <div className="mt-3">
              <div className="badge info">Status</div>
              <div className="mt-2 small">{status}</div>
              {status.startsWith("Success!") && (
                <div className="mt-2 small">
                  View on Solscan (mainnet) or SolanaFM for devnet with the above signature.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
