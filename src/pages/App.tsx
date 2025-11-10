import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter, CoinbaseWalletAdapter } from "@solana/wallet-adapter-wallets";
import Landing from "./Landing";
import Dashboard from "./Dashboard";

// Wallet adapter UI styles
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC = import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com";

export default function App() {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new CoinbaseWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="container">
            <Landing />
            <div className="mt-5" />
            <Dashboard />
            <div className="mt-4 center small">
              <span className="badge info">Non-custodial • User-signed only</span>
              <div className="mt-2">RPC: {RPC.includes("devnet") ? "Devnet" : RPC}</div>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
