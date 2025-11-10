import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  createCloseAccountInstruction,
  createBurnInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { fetchTokenMetas } from "@/utils/metadata";
import { fetchTokenPrices } from "@/utils/prices";

const RPC = import.meta.env.VITE_RPC_URL || "https://api.mainnet-beta.solana.com";
// SPL USDC (canonical) on Solana
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

type RowChoice = { transfer: boolean; burn: boolean; close: boolean };
type TokenRow = {
  address: string;
  mint: string;
  amount: number;    // ui amount
  rawAmount: string; // raw u64
  decimals: number;
};

const Dashboard: React.FC = () => {
  const wallet = useWallet();
  const [connection] = useState(() => new Connection(RPC));
  const [balance, setBalance] = useState<number>(0);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [meta, setMeta] = useState<Record<string, { name?: string; symbol?: string; logoURI?: string }>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [solUsd, setSolUsd] = useState<number>(0);

  const [destSOL, setDestSOL] = useState("");
  const [destToken, setDestToken] = useState("");
  const [status, setStatus] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});

  // ------- Load balances, token accounts, metadata, prices -------
  useEffect(() => {
    (async () => {
      if (!wallet.publicKey) return;
      try {
        setStatus("Loading balances...");
        const lamports = await connection.getBalance(wallet.publicKey);
        setBalance(lamports / LAMPORTS_PER_SOL);

        const parsed = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
          programId: TOKEN_PROGRAM_ID,
        });

        const list: TokenRow[] = parsed.value.map((acc) => {
          const info = (acc.account.data as any).parsed.info;
          const tokenAmount = info.tokenAmount;
          return {
            address: info.address as string,
            mint: info.mint as string,
            amount: Number(tokenAmount.uiAmount || 0),
            rawAmount: tokenAmount.amount as string,
            decimals: tokenAmount.decimals as number,
          };
        });

        setTokens(list);
        setStatus(`Loaded ${list.length} token accounts.`);

    // Fetch metadata (name/symbol/logo)
const uniqMints = Array.from(new Set(list.map((t) => t.mint)));
if (uniqMints.length) {
  setStatus("Fetching token metadata...");
  const m = await fetchTokenMetas(uniqMints);
  setMeta(m);
}

// Robust USD pricing (v4 price + v6 quote fallback)
setStatus("Fetching USD prices...");
const priceMap = await fetchTokenPrices(
  list.map((t) => ({ mint: t.mint, decimals: t.decimals })),
  true // include SOL
);
setPrices(priceMap);
setSolUsd(priceMap["SOL"] || 0);

setStatus("Ready.");
      } catch (err: any) {
        setStatus(`Error loading balances: ${err.message}`);
      }
    })();
  }, [wallet.publicKey, connection]);

  // ------- UI helpers -------
  const handleChoice = (mint: string, field: keyof RowChoice) => {
    setChoices((prev) => ({
      ...prev,
      [mint]: { ...prev[mint], [field]: !prev[mint]?.[field] },
    }));
  };

  const tokenUsdValue = (mint: string, uiAmount: number) => {
    const p = prices[mint] ?? 0;
    return uiAmount * p;
  };

  const totals = useMemo(() => {
    const tokensUsd = tokens.reduce((acc, t) => acc + tokenUsdValue(t.mint, t.amount), 0);
    const solVal = balance * solUsd;
    return { tokensUsd, solVal, total: tokensUsd + solVal };
  }, [tokens, prices, balance, solUsd]);

  const selectedSummary = useMemo(() => {
    let burn = 0, transfer = 0, close = 0;
    for (const t of tokens) {
      const c = choices[t.mint] || {};
      if (c.burn && BigInt(t.rawAmount) > 0n) burn++;
      if (c.transfer && BigInt(t.rawAmount) > 0n) transfer++;
      if (c.close || cleanupMode) close++;
    }
    return { burn, transfer, close };
  }, [choices, tokens, cleanupMode]);

  const jupSellHref = (mint: string) =>
    `https://jup.ag/swap/${mint}-USDC?inputMint=${mint}&outputMint=${USDC_MINT}`;

  // ------- Build & Send Transaction -------
  const buildAndSend = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      alert("Wallet not connected.");
      return;
    }
    if (!destSOL || !destToken) {
      alert("Enter destination addresses first.");
      return;
    }
    const walletPubkey: PublicKey = wallet.publicKey;

    try {
      setShowConfirm(false);
      setStatus("Building cleanup transaction...");

      const tx = new Transaction();
      const destinationSOL = new PublicKey(destSOL);
      const tokenOwner = new PublicKey(destToken);

      // 1) Transfer almost-all SOL (leave small fee buffer)
      const lamports = await connection.getBalance(walletPubkey);
      const feeBuffer = 8_000;
      const sendLamports = Math.max(lamports - feeBuffer, 0);
      if (sendLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: walletPubkey,
            toPubkey: destinationSOL,
            lamports: sendLamports,
          })
        );
      }

      // 2) Token actions (per row choices or cleanup mode)
      for (const t of tokens) {
        const mintPk = new PublicKey(t.mint);
        const src = new PublicKey(t.address);
        const raw = BigInt(t.rawAmount);
        const c = choices[t.mint] || {};
        const shouldClose = c.close || cleanupMode;

        // Close empty accounts fast
        if (t.amount === 0 && shouldClose) {
          tx.add(createCloseAccountInstruction(src, destinationSOL, walletPubkey));
          continue;
        }

        // Burn (irreversible)
        if (c.burn && raw > 0n) {
          tx.add(createBurnInstruction(src, mintPk, walletPubkey, raw));
        }

        // Transfer tokens
        if (c.transfer && raw > 0n) {
          const destAta = await getAssociatedTokenAddress(
            mintPk,
            tokenOwner,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          const ataInfo = await connection.getAccountInfo(destAta);
          if (!ataInfo) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                walletPubkey,
                destAta,
                tokenOwner,
                mintPk,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            );
          }
          tx.add(createTransferInstruction(src, destAta, walletPubkey, raw));
        }

        // Close after action (if selected/cleanup)
        if (shouldClose) {
          tx.add(createCloseAccountInstruction(src, destinationSOL, walletPubkey));
        }
      }

      tx.feePayer = walletPubkey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      setStatus("Awaiting wallet signature...");
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setStatus(`✅ Transaction sent: ${sig}`);
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    }
  }, [wallet.publicKey, wallet.signTransaction, destSOL, destToken, tokens, choices, cleanupMode, connection]);

  if (!wallet.connected)
    return <div className="text-gray-400 mt-10">Connect your wallet to continue.</div>;

  return (
    <div className="p-6 bg-neutral-900 rounded-2xl mt-10 max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Connected</h2>
      <div className="text-sm text-gray-300 mb-4">
        <div>Address: {wallet.publicKey?.toBase58()}</div>
        <div>
          SOL balance: {balance.toFixed(4)} SOL{" "}
          {solUsd ? <span className="text-gray-400">(≈ ${ (balance * solUsd).toFixed(2) })</span> : null}
        </div>
        <div className="mt-1 text-gray-300">
          Tokens USD: ${totals.tokensUsd.toFixed(2)} • Total ≈ ${totals.total.toFixed(2)}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label>Destination for recovered rent (SOL):</label>
          <input
            className="w-full mt-1 p-2 rounded bg-neutral-800 border border-neutral-700"
            placeholder="Enter SOL destination address"
            value={destSOL}
            onChange={(e) => setDestSOL(e.target.value)}
          />
        </div>
        <div>
          <label>Owner address to receive tokens:</label>
          <input
            className="w-full mt-1 p-2 rounded bg-neutral-800 border border-neutral-700"
            placeholder="Enter token destination address"
            value={destToken}
            onChange={(e) => setDestToken(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input
          type="checkbox"
          checked={cleanupMode}
          onChange={() => setCleanupMode(!cleanupMode)}
        />
        <label className="text-sm text-gray-300">Auto-close all empty token accounts (Cleanup Mode)</label>
      </div>

      {/* Token table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="text-left p-2 border-b border-neutral-800">Token</th>
              <th className="text-left p-2 border-b border-neutral-800">Mint</th>
              <th className="text-right p-2 border-b border-neutral-800">Balance</th>
              <th className="text-right p-2 border-b border-neutral-800">USD</th>
              <th className="text-center p-2 border-b border-neutral-800">Transfer</th>
              <th className="text-center p-2 border-b border-neutral-800">Burn</th>
              <th className="text-center p-2 border-b border-neutral-800">Close</th>
              <th className="text-center p-2 border-b border-neutral-800">Sell</th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-center text-gray-500">
                  No SPL token accounts found.
                </td>
              </tr>
            ) : (
              tokens.map((t) => {
                const m = meta[t.mint] || {};
                const logo = m.logoURI;
                const displayName = m.name || t.mint.slice(0, 4) + "…" + t.mint.slice(-4);
                const sym = m.symbol ? ` (${m.symbol})` : "";
                const usd = tokenUsdValue(t.mint, t.amount);

                return (
                  <tr key={t.address} className="hover:bg-neutral-800/50">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {logo ? (
                          <img src={logo} alt={m.name || t.mint} width={24} height={24} style={{ borderRadius: 6 }} />
                        ) : (
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: "#222" }} />
                        )}
                        <div>{displayName}{sym}</div>
                      </div>
                    </td>
                    <td className="p-2 text-gray-400">{t.mint}</td>
                    <td className="p-2 text-right">
                      {t.amount} <span className="text-gray-500 text-xs">({t.rawAmount})</span>
                    </td>
                    <td className="p-2 text-right">
                      ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!choices[t.mint]?.transfer}
                        onChange={() => handleChoice(t.mint, "transfer")}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!choices[t.mint]?.burn}
                        onChange={() => handleChoice(t.mint, "burn")}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!choices[t.mint]?.close}
                        onChange={() => handleChoice(t.mint, "close")}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <a
                        href={jupSellHref(t.mint)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-400 hover:underline"
                        title="Sell via Jupiter"
                      >
                        Sell
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-400">
        Selected → Transfer: {selectedSummary.transfer} • Burn: {selectedSummary.burn} • Close: {selectedSummary.close}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!destSOL || !destToken}
          className="px-5 py-2 bg-amber-500 text-black font-semibold rounded disabled:opacity-40"
        >
          Review & Confirm
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-700 max-w-md w-full text-gray-200">
            <h3 className="text-xl font-bold mb-3">Confirm Actions</h3>
            <ul className="list-disc pl-5 text-sm space-y-1 mb-3">
              <li>Transfer all SOL (minus fee buffer) to {destSOL}</li>
              <li>Token destination owner: {destToken}</li>
              {cleanupMode && <li>Auto-close all empty token accounts</li>}
              {!!selectedSummary.transfer && <li>Transfer {selectedSummary.transfer} token account(s)</li>}
              {!!selectedSummary.burn && <li>Burn {selectedSummary.burn} token account(s)</li>}
              {!!selectedSummary.close && <li>Close {selectedSummary.close} token account(s)</li>}
            </ul>
            <div className="text-xs text-red-400 mb-3">
              Burning is irreversible. Review carefully before signing.
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} className="px-3 py-1 bg-neutral-700 rounded">
                Cancel
              </button>
              <button onClick={buildAndSend} className="px-4 py-1 bg-amber-500 text-black rounded font-semibold">
                Confirm & Sign
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400">Status: {status || "Idle"}</div>
    </div>
  );
};

export default Dashboard;
