import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Landing() {
  return (
    <section className="card">
      <h1 style={{ margin: 0, fontSize: 28 }}>Lamportly</h1>
      <p className="small mt-2">
        Safely consolidate your own Solana wallet: transfer remaining SOL, close empty SPL token accounts, and reclaim rent.
        You connect your wallet and <strong>you sign</strong> — Lamportly never holds keys.
      </p>
      <div className="row mt-3">
        <div className="col">
          <ul className="small" style={{ lineHeight: 1.8 }}>
            <li>Connect Phantom, Solflare, or Coinbase Wallet</li>
            <li>See all SPL token accounts and SOL balance</li>
            <li>Transfer tokens to your destination &amp; close zeroed accounts</li>
            <li>Send remaining SOL to a nominated address</li>
          </ul>
        </div>
        <div className="col center">
          <WalletMultiButton />
          <div className="small mt-2">Use Devnet for testing first.</div>
        </div>
      </div>
    </section>
  );
}
