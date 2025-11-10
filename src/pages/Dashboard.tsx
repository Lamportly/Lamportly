import React, { useEffect, useState, useCallback } from "react";
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

const RPC = import.meta.env.VITE_RPC_URL || "https://api.mainnet-beta.solana.com";

const Dashboard: React.FC = () => {
  const wallet = useWallet();
  const [connection] = useState(new Connection(RPC));
  const [balance, setBalance] = useState<number>(0);
  const [tokens, setTokens] = useState<any[]>([]);
  const [destSOL, setDestSOL] = useState("");
  const [destToken, setDestToken] = useState("");
  const [status, setStatus] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [choices, setChoices] = useState<Record<string, { transfer: boolean; burn: boolean; close: boolean }>>({});

  // --- Load wallet info ---
  useEffect(() => {
    if (!wallet.publicKey) return;
    (async () => {
      try {
        setStatus("Loading balances...");
        const lamports = await connection.getBalance(wallet.publicKey);
        setBalance(lamports / LAMPORTS_PER_SOL);

        const parsedAccounts = await connection.getParsedTokenAccountsByOwner(
          wallet.publicKey,
          { programId: TOKEN_PROGRAM_ID }
        );

        const list = parsedAccounts.value.map((acc) => {
          const info = acc.account.data.parsed.info;
          const tokenAmount = info.tokenAmount;
          return {
            address: info.address,
            mint: info.mint,
            amount: Number(tokenAmount.uiAmount || 0),
            rawAmount: tokenAmount.amount,
            decimals: tokenAmount.decimals,
          };
        });

        setTokens(list);
        setStatus(`Loaded ${list.length} token accounts.`);
      } catch (err: any) {
        setStatus(`Error loading balances: ${err.message}`);
      }
    })();
  }, [wallet.publicKey]);

  const handleChoice = (mint: string, field: "transfer" | "burn" | "close") => {
    setChoices((prev) => ({
      ...prev,
      [mint]: {
        ...prev[mint],
        [field]: !prev[mint]?.[field],
      },
    }));
  };

  // --- Build full cleanup transaction ---
  const buildAndSend = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    if (!destSOL || !destToken) {
      alert("Enter destination addresses first.");
      return;
    }

    try {
      setShowConfirm(false);
      setStatus("Building cleanup transaction...");

      const tx = new Transaction();
      const destinationSOL = new PublicKey(destSOL);
      const tokenOwner = new PublicKey(destToken);

      // STEP 1: Transfer all SOL (minus rent)
      const lamports = await connection.getBalance(wallet.publicKey);
      const feeBuffer = 5000;
      const sendLamports = Math.max(lamports - feeBuffer, 0);
      if (sendLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: destinationSOL,
            lamports: sendLamports,
          })
        );
      }

      // STEP 2: Token actions
      for (const t of tokens) {
        const mint = new PublicKey(t.mint);
        const src = new PublicKey(t.address);
        const raw = BigInt(t.rawAmount);
        const choice = choices[t.mint] || {};
        const close = choice.close || cleanupMode;

        if (t.amount === 0 && close) {
          // Empty account → close it
          tx.add(createCloseAccountInstruction(src, destinationSOL, wallet.publicKey));
          continue;
        }

        // Burn tokens if chosen
        if (choice.burn && raw > 0n) {
          tx.add(createBurnInstruction(src, mint, wallet.publicKey, raw));
        }

        // Transfer tokens if chosen
        if (choice.transfer && raw > 0n) {
          const destAta = await getAssociatedTokenAddress(
            mint,
            tokenOwner,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          const ataInfo = await connection.getAccountInfo(destAta);
          if (!ataInfo) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                destAta,
                tokenOwner,
                mint,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            );
          }
          tx.add(createTransferInstruction(src, destAta, wallet.publicKey, raw));
        }

        if (close) {
          tx.add(createCloseAccountInstruction(src, destinationSOL, wallet.publicKey));
        }
      }

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      setStatus("Awaiting wallet signature...");
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setStatus(`✅ Transaction sent: ${sig}`);
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    }
  }, [wallet.publicKey, tokens, destSOL, destToken, choices, cleanupMode]);

  if (!wallet.connected)
    return <div className="text-gray-400 mt-10">Connect your wallet to continue.</div>;

  return (
    <div className="p-6 bg-neutral-900 rounded-2xl mt-10 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Connected</h2>
      <div className="text-sm text-gray-300 mb-4">
        <div>Address: {wallet.publicKey?.toBase58()}</div>
        <div>SOL balance: {balance.toFixed(4)} SOL</div>
      </div>

      <div className="space-y-3">
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

      <div className="mt-6 flex items-center gap-2">
        <input
          type="checkbox"
          checked={cleanupMode}
          onChange={() => setCleanupMode(!cleanupMode)}
        />
        <label className="text-sm text-gray-300">
          Auto-close all empty token accounts (Cleanup Mode)
        </label>
      </div>

      <div className="mt-5 text-sm">
        {tokens.length === 0 ? (
          <div className="text-gray-500">No SPL token accounts found.</div>
        ) : (
          tokens.map((t) => (
            <div
              key={t.mint}
              className="bg-neutral-800 p-3 rounded-lg mb-2 border border-neutral-700"
            >
              <div className="text-white text-sm">
                <b>{t.mint}</b>
                <div className="text-xs text-gray-400">
                  Balance: {t.amount} | Raw: {t.rawAmount}
                </div>
              </div>
              <div className="mt-2 flex gap-3 text-sm text-gray-300">
                <label>
                  <input
                    type="checkbox"
                    checked={!!choices[t.mint]?.transfer}
                    onChange={() => handleChoice(t.mint, "transfer")}
                  />{" "}
                  Transfer
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!choices[t.mint]?.burn}
                    onChange={() => handleChoice(t.mint, "burn")}
                  />{" "}
                  Burn
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!choices[t.mint]?.close}
                    onChange={() => handleChoice(t.mint, "close")}
                  />{" "}
                  Close
                </label>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6">
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
            <h3 className="text-xl font-bold mb-3">Confirm Cleanup</h3>
            <p className="text-sm text-gray-400 mb-3">
              You’re about to:
            </p>
            <ul className="list-disc pl-5 text-sm space-y-1 mb-3">
              <li>Transfer all SOL (minus fee) to {destSOL}</li>
              <li>Transfer or burn selected tokens to {destToken}</li>
              {cleanupMode && <li>Auto-close empty token accounts</li>}
            </ul>
            <div className="text-xs text-red-400 mb-3">
              This will permanently affect your wallet state. Proceed only if you understand.
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1 bg-neutral-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={buildAndSend}
                className="px-4 py-1 bg-amber-500 text-black rounded font-semibold"
              >
                Confirm & Sign
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400">Status: {status}</div>
    </div>
  );
};

export default Dashboard;
