import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

const Landing = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center">
      <h1 className="text-4xl font-bold mb-6">Lamportly</h1>
      <p className="text-gray-400 mb-8">
        Recover your SOL balance and close unused token accounts safely.
      </p>
      <WalletMultiButton />
    </div>
  );
};

export default Landing;
