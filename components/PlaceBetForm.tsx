'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false }
);
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { Connection, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  getProgram, getMarketPda, getBetPda, getBetRecordPda, getBetCounterPda,
  fetchUserBetRecords, solToLamports, lamportsToSol, DEVNET_RPC, PROGRAM_ID, DELEGATION_PROGRAM,
} from '@/lib/program';
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { PublicKey } from '@solana/web3.js';
import type { MarketAccount, BetAccount } from '@/types';

const ER_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');

type Step = 'idle' | 'init' | 'delegate' | 'bet' | 'done' | 'error';

interface Props {
  market: MarketAccount;
  onSuccess?: () => void;
}

export function PlaceBetForm({ market, onSuccess }: Props) {
  const { publicKey }  = useWallet();
  const anchorWallet   = useAnchorWallet();

  const [outcome,    setOutcome]    = useState<1 | 2>(1);
  const [amount,     setAmount]     = useState('0.1');
  const [loading,    setLoading]    = useState(false);
  const [step,       setStep]       = useState<Step>('idle');
  const [error,      setError]      = useState('');
  const [userBets,   setUserBets]   = useState<BetAccount[]>([]);
  const [loadingBets, setLoadingBets] = useState(false);
  const [txToast,    setTxToast]    = useState<string | null>(null);

  const loadBets = async () => {
    if (!publicKey) return;
    setLoadingBets(true);
    try {
      const conn = new Connection(DEVNET_RPC, 'confirmed');
      const bets = await fetchUserBetRecords(conn, BigInt(market.marketId), publicKey);
      setUserBets(bets);
    } catch {}
    finally { setLoadingBets(false); }
  };

  useEffect(() => { loadBets(); }, [publicKey, market.marketId]);

  const handlePlaceBet = async () => {
    if (!publicKey || !anchorWallet) return;
    setLoading(true);
    setError('');

    try {
      if (market.resolved) throw new Error('Market is already resolved');
      if (Math.floor(Date.now() / 1000) >= market.deadline) throw new Error('Market deadline has passed');

      const marketId  = BigInt(market.marketId);
      const lamports  = solToLamports(parseFloat(amount));
      const marketPda = getMarketPda(marketId);

      const l1Conn = new Connection(DEVNET_RPC, 'processed');
      const l1Prog = getProgram(anchorWallet, l1Conn);

      // Fetch current bet index from counter
      const counterPda = getBetCounterPda(marketId, publicKey);
      let betIndex = BigInt(0);
      try {
        const counterInfo = await (l1Prog.account as any).betCounter.fetch(counterPda);
        betIndex = BigInt(counterInfo.count.toString());
      } catch {}

      const betPda       = getBetPda(marketId, publicKey, betIndex);
      const betRecordPda = getBetRecordPda(marketId, publicKey, betIndex);

      // Check balance
      const balance    = await l1Conn.getBalance(publicKey);
      const betPdaRent = await l1Conn.getMinimumBalanceForRentExemption(59);
      const walletMin  = await l1Conn.getMinimumBalanceForRentExemption(0);
      const needed     = lamports.toNumber() + betPdaRent * 2 + walletMin + 20_000;
      if (balance < needed) {
        throw new Error(
          `Insufficient balance: have ${(balance / 1e9).toFixed(4)} SOL, need ${(needed / 1e9).toFixed(4)} SOL`
        );
      }

      // ── Step 1: init_bet on L1 ─────────────────────────────────────
      setStep('init');
      const initTx = await (l1Prog.methods as any)
        .initBet(new BN(marketId.toString()), new BN(betIndex.toString()), lamports, outcome)
        .accounts({
          user:          publicKey,
          market:        marketPda,
          bet:           betPda,
          betRecord:     betRecordPda,
          betCounter:    counterPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const { blockhash: bh1, lastValidBlockHeight: lbh1 } = await l1Conn.getLatestBlockhash('confirmed');
      initTx.recentBlockhash = bh1;
      initTx.feePayer = publicKey;
      const signed1 = await anchorWallet.signTransaction(initTx);
      const sig1 = await l1Conn.sendRawTransaction(signed1.serialize(), { skipPreflight: false });
      const res1 = await l1Conn.confirmTransaction({ signature: sig1, blockhash: bh1, lastValidBlockHeight: lbh1 }, 'confirmed');
      if (res1.value.err) throw new Error(`init_bet failed: ${JSON.stringify(res1.value.err)}`);

      // ── Step 2: delegate_bet on L1 → TEE ──────────────────────────
      setStep('delegate');
      const bufferPda          = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(betPda, PROGRAM_ID);
      const delegationRecord   = delegationRecordPdaFromDelegatedAccount(betPda);
      const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(betPda);

      const delTx = await (l1Prog.methods as any)
        .delegateBet(new BN(marketId.toString()), new BN(betIndex.toString()))
        .accounts({
          user:               publicKey,
          bet:                betPda,
          bufferPda,
          delegationRecord,
          delegationMetadata,
          delegationProgram:  DELEGATION_PROGRAM,
          ownerProgram:       PROGRAM_ID,
          validator:          ER_VALIDATOR,
          systemProgram:      SystemProgram.programId,
        })
        .transaction();

      const { blockhash: bh2, lastValidBlockHeight: lbh2 } = await l1Conn.getLatestBlockhash('confirmed');
      delTx.recentBlockhash = bh2;
      delTx.feePayer = publicKey;
      const signed2 = await anchorWallet.signTransaction(delTx);
      const sig2 = await l1Conn.sendRawTransaction(signed2.serialize(), { skipPreflight: true });
      await l1Conn.confirmTransaction({ signature: sig2, blockhash: bh2, lastValidBlockHeight: lbh2 }, 'confirmed');

      setStep('done');
      setTxToast(sig2);
      setTimeout(() => setTxToast(null), 10_000);
      await loadBets();
      onSuccess?.();
    } catch (e: any) {
      const msg = e?.message || e?.toString?.() || JSON.stringify(e) || 'Unknown error';
      setError(msg);
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // ── TX Toast ───────────────────────────────────────────────────────
  const toast = txToast && (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: 'rgba(10,10,18,0.96)', border: '1px solid rgba(102,51,255,0.5)',
      borderRadius: 14, padding: '14px 18px', maxWidth: 340,
      boxShadow: '0 8px 32px rgba(102,51,255,0.25)',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 18 }}>🔒</div>
        <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 11, color: '#a78bfa' }}>
          BET LOCKED IN TEE
        </div>
        <button onClick={() => setTxToast(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 10, lineHeight: 1.5 }}>
        Encrypted inside MagicBlock Intel TDX.<br/>Your position is invisible on-chain.
      </div>
      <a
        href={`https://explorer.solana.com/tx/${txToast}?cluster=devnet`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', fontFamily: 'var(--font-fira)', fontSize: 9,
          letterSpacing: '0.1em', color: '#6633ff', textDecoration: 'none',
          border: '1px solid rgba(102,51,255,0.3)', borderRadius: 6,
          padding: '6px 10px', textAlign: 'center',
          wordBreak: 'break-all',
        }}
      >
        VIEW TX ON EXPLORER ↗
      </a>
    </div>
  );

  // ── Not connected ──────────────────────────────────────────────────
  if (!publicKey) {
    return (
      <div className="glass" style={{ borderRadius: 16, padding: '28px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 12 }}>
          CONNECT WALLET
        </div>
        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
          to place a private bet
        </div>
        <WalletMultiButton style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #9945FF, #14F195)', border: 'none', borderRadius: 8, fontFamily: 'var(--font-unbounded)', fontSize: 12 }} />
      </div>
    );
  }

  const isResolved = market.resolved;
  const isExpired  = Math.floor(Date.now() / 1000) >= market.deadline;

  return (
    <>
      {toast}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Existing bets */}
      {loadingBets && (
        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>Loading bets...</div>
      )}
      {userBets.map((bet, i) => (
        <div key={i} style={{
          borderRadius: 14, padding: '14px 18px',
          background: bet.outcome === 1 ? 'rgba(89,224,157,0.08)' : 'rgba(222,63,188,0.08)',
          border: `1px solid ${bet.outcome === 1 ? 'rgba(89,224,157,0.25)' : 'rgba(222,63,188,0.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
              BET #{(bet.betIndex ?? i) + 1}
            </div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 16, color: bet.outcome === 1 ? '#59e09d' : '#de3fbc' }}>
              {bet.outcome === 1 ? 'YES' : 'NO'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>AMOUNT</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 14, color: '#fff' }}>
              {lamportsToSol(bet.amount).toFixed(3)} SOL
            </div>
          </div>
        </div>
      ))}

      {/* TEE lock indicator if any bets */}
      {userBets.length > 0 && (
        <div style={{
          borderRadius: 14, padding: '12px 18px', textAlign: 'center',
          background: 'rgba(102,51,255,0.06)', border: '1px solid rgba(102,51,255,0.2)',
        }}>
          <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 11, color: '#a78bfa', marginBottom: 4 }}>
            🔒 LOCKED IN TEE
          </div>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
            Encrypted inside MagicBlock Intel TDX. Nobody can see your positions.
          </div>
        </div>
      )}

      {/* Place new bet form */}
      {!isResolved && !isExpired && (
        <div className="glass" style={{ borderRadius: 16, padding: '20px' }}>
          {userBets.length > 0 && (
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 12, letterSpacing: '0.1em' }}>
              PLACE ANOTHER BET
            </div>
          )}
          {/* Yes / No */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {([1, 2] as const).map(o => (
              <button key={o} onClick={() => setOutcome(o)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 13,
                background: outcome === o ? (o === 1 ? '#59e09d' : '#de3fbc') : 'rgba(255,255,255,0.06)',
                color: outcome === o ? '#000' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.15s',
              }}>
                {o === 1 ? 'YES' : 'NO'}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>AMOUNT (SOL)</div>
            <input
              type="number" min="0.01" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#fff', fontFamily: 'var(--font-fira)', fontSize: 14,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <button onClick={handlePlaceBet} disabled={loading} style={{
            width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: loading ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #9945FF, #14F195)',
            color: '#fff', fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em',
            transition: 'opacity 0.15s', opacity: loading ? 0.6 : 1,
          }}>
            {loading
              ? step === 'init'     ? 'INITIALIZING...'
              : step === 'delegate' ? 'DELEGATING TO TEE...'
              : 'PROCESSING...'
              : '🔒 PLACE PRIVATE BET'}
          </button>

          {error && (
            <div style={{ marginTop: 10, fontFamily: 'var(--font-fira)', fontSize: 10, color: '#ff6b6b', lineHeight: 1.5 }}>
              ✗ {error}
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}
