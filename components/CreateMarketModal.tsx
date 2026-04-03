'use client';

import { useState } from 'react';
import { useWallet, useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { SystemProgram, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getProgram, getMarketPda } from '@/lib/program';
import { PYTH_FEEDS } from '@/types';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateMarketModal({ onClose, onSuccess }: Props) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();

  const [question, setQuestion] = useState('');
  const [marketType, setMarketType] = useState<0 | 1 | 2>(0);
  const [selectedFeed, setSelectedFeed] = useState<keyof typeof PYTH_FEEDS>('SOL/USD');
  const [targetPrice, setTargetPrice] = useState('');
  const [deadlineDays, setDeadlineDays] = useState('3');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!publicKey || !anchorWallet || !question.trim()) return;
    setLoading(true);
    setError('');

    try {
      const program = getProgram(anchorWallet, connection);
      const marketId = BigInt(Date.now());
      const deadline = Math.floor(Date.now() / 1000) + parseInt(deadlineDays) * 86400;
      const marketPda = getMarketPda(marketId);

      const pythFeed = marketType === 2 ? null : new PublicKey(PYTH_FEEDS[selectedFeed]);
      const targetPriceScaled = marketType === 2 || !targetPrice
        ? null
        : new BN(Math.round(parseFloat(targetPrice) * 1e6));

      await (program.methods as any)
        .createMarket(
          new BN(marketId.toString()),
          question,
          new BN(deadline),
          pythFeed,
          targetPriceScaled,
          marketType,
        )
        .accounts({
          creator: publicKey,
          market: marketPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create market');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex justify-between items-center">
          <h2 className="text-white font-bold text-lg">Create Market</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Market Type */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Market Type</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              [0, 'Price Above 📈'],
              [1, 'Price Below 📉'],
              [2, 'Manual 🤝'],
            ] as const).map(([type, label]) => (
              <button
                key={type}
                onClick={() => setMarketType(type)}
                className={`py-2 text-xs rounded-lg font-medium transition-colors ${
                  marketType === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Pyth Feed (for price markets) */}
        {marketType !== 2 && (
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Price Feed (Pyth)</label>
            <select
              value={selectedFeed}
              onChange={(e) => setSelectedFeed(e.target.value as keyof typeof PYTH_FEEDS)}
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none"
            >
              {Object.keys(PYTH_FEEDS).map((feed) => (
                <option key={feed} value={feed}>{feed}</option>
              ))}
            </select>
          </div>
        )}

        {/* Target Price */}
        {marketType !== 2 && (
          <div>
            <label className="text-gray-400 text-sm mb-2 block">
              Target Price (USD) — {marketType === 0 ? 'YES if price goes above' : 'YES if price goes below'}
            </label>
            <input
              type="number"
              placeholder="e.g. 200"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Question */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Question</label>
          <input
            type="text"
            placeholder="Will SOL be above $200 by Friday?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={200}
            className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Deadline */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Deadline (days from now)</label>
          <input
            type="number"
            min="1"
            max="30"
            value={deadlineDays}
            onChange={(e) => setDeadlineDays(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-900/30 rounded-lg p-3">{error}</div>
        )}

        <button
          onClick={handleCreate}
          disabled={loading || !question.trim() || (marketType !== 2 && !targetPrice)}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {loading ? 'Creating...' : 'Create Market'}
        </button>
      </div>
    </div>
  );
}
