'use client';

import { useState, useEffect } from 'react';
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { Connection, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getProgram, getMarketPda, getBetPda, solToLamports, DEVNET_RPC, PROGRAM_ID, DELEGATION_PROGRAM, MAGIC_ROUTER } from '@/lib/program';
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { PublicKey } from '@solana/web3.js';

const ER_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');
import type { MarketAccount } from '@/types';

type Step = 'idle' | 'init' | 'delegate' | 'bet' | 'done' | 'error';

interface Props {
  market: MarketAccount;
  onSuccess?: () => void;
}

export function PlaceBetForm({ market, onSuccess }: Props) {
  const { publicKey }  = useWallet();
  const anchorWallet   = useAnchorWallet();

  const [outcome,      setOutcome]      = useState<1 | 2>(1);
  const [amount,       setAmount]       = useState('0.1');
  const [loading,      setLoading]      = useState(false);
  const [step,         setStep]         = useState<Step>('idle');
  const [error,        setError]        = useState('');
  const [betInTee,     setBetInTee]     = useState(false);
  const [existingBet,  setExistingBet]  = useState<{ outcome: 1|2; amount: number } | null>(null);

  // Check on mount: is bet delegated to TEE + load from localStorage
  useEffect(() => {
    if (!publicKey) return;
    const betPda = getBetPda(BigInt(market.marketId), publicKey);
    const conn = new Connection(DEVNET_RPC, 'processed');
    conn.getAccountInfo(betPda).then(info => {
      if (info?.owner.equals(DELEGATION_PROGRAM)) setBetInTee(true);
    }).catch(() => {});
    try {
      const key = `magicbet_bets_${publicKey.toString()}`;
      const bets: any[] = JSON.parse(localStorage.getItem(key) || '[]');
      const mine = bets.find(b => b.marketId === market.marketId);
      if (mine) setExistingBet({ outcome: mine.outcome, amount: mine.amount });
    } catch {}
  }, [publicKey, market.marketId]);

  const handlePlaceBet = async () => {
    if (!publicKey || !anchorWallet) return;
    setLoading(true);
    setError('');

    try {
      // Guard: market must be live
      if (market.resolved) throw new Error('Market is already resolved');
      if (Math.floor(Date.now() / 1000) >= market.deadline) throw new Error('Market deadline has passed — choose an active market');

      const marketId  = BigInt(market.marketId);
      const lamports  = solToLamports(parseFloat(amount));
      const marketPda = getMarketPda(marketId);
      const betPda    = getBetPda(marketId, publicKey);

      const l1Conn = new Connection(DEVNET_RPC, 'processed');
      const l1Prog = getProgram(anchorWallet, l1Conn);

      // Check balance: bet amount + Bet PDA rent (~0.00112 SOL) + wallet min rent (~0.00089 SOL) + fees
      const balance     = await l1Conn.getBalance(publicKey);
      const betPdaRent  = await l1Conn.getMinimumBalanceForRentExemption(59); // Bet::LEN
      const walletMin   = await l1Conn.getMinimumBalanceForRentExemption(0);
      const needed      = lamports.toNumber() + betPdaRent + walletMin + 15_000; // fees+ephemeral
      if (balance < needed) {
        throw new Error(
          `Insufficient balance: have ${(balance / 1e9).toFixed(4)} SOL, need ${(needed / 1e9).toFixed(4)} SOL (bet + rent + fees)`
        );
      }

      // Detect current state of bet PDA
      const betAccountInfo = await l1Conn.getAccountInfo(betPda);
      const isOwnedByDelegation = betAccountInfo?.owner.equals(DELEGATION_PROGRAM) ?? false;
      const isOwnedByUs         = betAccountInfo?.owner.equals(PROGRAM_ID) ?? false;
      const betNotExists        = betAccountInfo === null;

      // Already fully placed — can't bet twice on same market
      if (isOwnedByDelegation) {
        throw new Error('You have already placed a bet on this market. Each wallet can bet once per market.');
      }

      // ── Step 1: init_bet on L1 ───────────────────────────────────
      if (betNotExists || isOwnedByUs) {
        setStep('init');
        // Combine: fund ephemeral + init_bet in one tx → one Phantom popup
        const initTx = await (l1Prog.methods as any)
          .initBet(new BN(marketId.toString()), lamports, outcome)
          .accounts({
            user:          publicKey,
            market:        marketPda,
            bet:           betPda,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        const { blockhash: bh1, lastValidBlockHeight: lbh1 } = await l1Conn.getLatestBlockhash('confirmed');
        initTx.recentBlockhash = bh1;
        initTx.feePayer = publicKey;
        const signed1 = await anchorWallet.signTransaction(initTx);
        const sig1 = await l1Conn.sendRawTransaction(signed1.serialize(), { skipPreflight: false });
        const result1 = await l1Conn.confirmTransaction({ signature: sig1, blockhash: bh1, lastValidBlockHeight: lbh1 }, 'confirmed');
        if (result1.value.err) throw new Error(`init_bet failed: ${JSON.stringify(result1.value.err)}`);
      }

      // ── Step 2: delegate_bet on L1 → TEE ────────────────────────
      setStep('delegate');
      const bufferPda          = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(betPda, PROGRAM_ID);
      const delegationRecord   = delegationRecordPdaFromDelegatedAccount(betPda);
      const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(betPda);

      const delTx = await (l1Prog.methods as any)
        .delegateBet(new BN(marketId.toString()))
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

      setStep('bet');

      // Save bet to localStorage for "My Bets" display
      try {
        const key = `magicbet_bets_${publicKey.toString()}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        const entry = {
          marketId:  market.marketId,
          question:  market.question,
          outcome,
          amount:    parseFloat(amount),
          timestamp: Date.now(),
        };
        // Replace if same market exists
        const filtered = existing.filter((b: any) => b.marketId !== market.marketId);
        localStorage.setItem(key, JSON.stringify([entry, ...filtered]));
      } catch {}

      setStep('done');
      onSuccess?.();
    } catch (e: any) {
      const msg = e?.message || e?.toString?.() || JSON.stringify(e) || 'Unknown error';
      setError(msg);
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // ── If bet is in TEE, show locked state (can't bet again on same market)
  if (betInTee) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {existingBet && (
          <div style={{
            borderRadius: 14, padding: '16px 20px',
            background: existingBet.outcome === 1 ? 'rgba(89,224,157,0.08)' : 'rgba(222,63,188,0.08)',
            border: `1px solid ${existingBet.outcome === 1 ? 'rgba(89,224,157,0.25)' : 'rgba(222,63,188,0.25)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>YOUR BET</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 18, color: existingBet.outcome === 1 ? '#59e09d' : '#de3fbc' }}>
                {existingBet.outcome === 1 ? 'YES' : 'NO'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>AMOUNT</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: '#fff' }}>{existingBet.amount} SOL</div>
            </div>
          </div>
        )}
        <div style={{
          borderRadius: 14, padding: '16px 20px', textAlign: 'center',
          background: 'rgba(102,51,255,0.06)', border: '1px solid rgba(102,51,255,0.2)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
          <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 13, color: '#a78bfa', marginBottom: 6 }}>
            LOCKED IN TEE
          </div>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 10 }}>
            Encrypted inside MagicBlock Intel TDX.<br />One bet per wallet per market.
          </div>
          {publicKey && (() => {
            const betPda = getBetPda(BigInt(market.marketId), publicKey);
            const explorerUrl = `https://explorer.solana.com/address/${betPda.toString()}?cluster=devnet`;
            return (
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-block',
                fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em',
                color: '#6633ff', textDecoration: 'none',
                border: '1px solid rgba(102,51,255,0.3)', borderRadius: 6,
                padding: '5px 12px',
              }}>
                VIEW ON EXPLORER ↗
              </a>
            );
          })()}
        </div>
      </div>
    );
  }

  // ── Not connected ────────────────────────────────────────────────
  if (!publicKey) {
    return (
      <div className="glass" style={{ borderRadius: 16, padding: '28px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 6 }}>
          CONNECT WALLET
        </div>
        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          to place a private bet
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          borderRadius: 14, padding: '16px 20px',
          background: outcome === 1 ? 'rgba(89,224,157,0.08)' : 'rgba(222,63,188,0.08)',
          border: `1px solid ${outcome === 1 ? 'rgba(89,224,157,0.25)' : 'rgba(222,63,188,0.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>YOUR BET</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 22, color: outcome === 1 ? '#59e09d' : '#de3fbc' }}>
              {outcome === 1 ? 'YES' : 'NO'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>AMOUNT</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 18, color: '#fff' }}>{amount} SOL</div>
          </div>
        </div>
        <div style={{
          borderRadius: 14, padding: '16px 20px', textAlign: 'center',
          background: 'rgba(102,51,255,0.06)', border: '1px solid rgba(102,51,255,0.2)',
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
          <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 13, color: '#a78bfa', marginBottom: 6 }}>
            LOCKED IN TEE
          </div>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 10 }}>
            Encrypted inside MagicBlock Intel TDX.<br />Nobody can see your position until resolution.
          </div>
          {publicKey && (() => {
            const betPda = getBetPda(BigInt(market.marketId), publicKey);
            const explorerUrl = `https://explorer.solana.com/address/${betPda.toString()}?cluster=devnet`;
            return (
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-block',
                fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em',
                color: '#6633ff', textDecoration: 'none',
                border: '1px solid rgba(102,51,255,0.3)', borderRadius: 6,
                padding: '5px 12px',
              }}>
                VIEW ON EXPLORER ↗
              </a>
            );
          })()}
        </div>
      </div>
    );
  }

  const btnStyle = (active: boolean, yes: boolean): React.CSSProperties => ({
    flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 13, letterSpacing: '0.05em',
    transition: 'all 0.15s',
    background: active
      ? yes ? 'linear-gradient(135deg,#059669,#59e09d)' : 'linear-gradient(135deg,#9d174d,#de3fbc)'
      : 'rgba(255,255,255,0.04)',
    color: active ? '#fff' : 'rgba(255,255,255,0.35)',
    outline: active ? 'none' : '1px solid rgba(255,255,255,0.08)',
    boxShadow: active
      ? yes ? '0 0 20px rgba(89,224,157,0.25)' : '0 0 20px rgba(222,63,188,0.25)'
      : 'none',
  });

  const stepDone  = (s: Step) => ['init','delegate','bet','done'].indexOf(s) > ['init','delegate','bet','done'].indexOf(step);
  const stepColor = (s: Step) => step === s ? '#6633ff' : stepDone(s) ? 'rgba(89,224,157,0.7)' : 'rgba(255,255,255,0.15)';
  const stepIcon  = (s: Step) => stepDone(s) ? '✓' : step === s ? '⏳' : '○';

  return (
    <div className="glass" style={{ borderRadius: 16, padding: '24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Existing bet banner */}
      {existingBet && (
        <div style={{
          borderRadius: 12, padding: '12px 16px',
          background: existingBet.outcome === 1 ? 'rgba(89,224,157,0.08)' : 'rgba(222,63,188,0.08)',
          border: `1px solid ${existingBet.outcome === 1 ? 'rgba(89,224,157,0.2)' : 'rgba(222,63,188,0.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            Your bet: <span style={{ color: existingBet.outcome === 1 ? '#59e09d' : '#de3fbc', fontWeight: 700 }}>
              {existingBet.outcome === 1 ? 'YES' : 'NO'}
            </span> · {existingBet.amount} SOL
          </div>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
            BET AGAIN ↓
          </div>
        </div>
      )}
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(102,51,255,0.15)', border: '1px solid rgba(102,51,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
        }}>🔒</div>
        <div>
          <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 13, color: '#fff' }}>PLACE PRIVATE BET</div>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em', color: '#6633ff' }}>MAGICBLOCK PER · INTEL TDX</div>
        </div>
      </div>

      {/* YES / NO */}
      <div>
        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.28)', marginBottom: 8 }}>YOUR PREDICTION</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setOutcome(1)} style={btnStyle(outcome === 1, true)}>✓ YES</button>
          <button onClick={() => setOutcome(2)} style={btnStyle(outcome === 2, false)}>✕ NO</button>
        </div>
      </div>

      {/* Amount */}
      <div>
        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.28)', marginBottom: 8 }}>AMOUNT (SOL)</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['0.05', '0.1', '0.5', '1'].map((v) => (
            <button key={v} onClick={() => setAmount(v)} style={{
              flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.05em',
              background: amount === v ? 'rgba(102,51,255,0.25)' : 'rgba(255,255,255,0.04)',
              color: amount === v ? '#a78bfa' : 'rgba(255,255,255,0.35)',
              outline: amount === v ? '1px solid rgba(102,51,255,0.4)' : '1px solid rgba(255,255,255,0.07)',
            }}>{v}</button>
          ))}
        </div>
        <input
          type="number" min="0.01" step="0.01" value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
            color: '#fff', fontSize: 16, padding: '12px 14px', outline: 'none',
            fontFamily: 'var(--font-unbounded)', fontWeight: 700,
          }}
        />
      </div>

      {/* Step indicator */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            ['init',     '1/3', 'FUNDING BET ON SOLANA L1...'],
            ['delegate', '2/3', 'DELEGATING TO INTEL TDX TEE...'],
            ['bet',      '3/3', 'SETTING PRIVATE OUTCOME IN ER...'],
          ] as [Step, string, string][]).map(([s, num, label]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em', color: stepColor(s) }}>
              <span style={{ width: 14 }}>{stepIcon(s)}</span>
              <span>STEP {num} — {label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {(error || step === 'error') && (
        <div style={{ borderRadius: 10, padding: '10px 14px', background: 'rgba(222,63,188,0.08)', border: '1px solid rgba(222,63,188,0.25)', fontFamily: 'var(--font-fira)', fontSize: 11, color: '#de3fbc', wordBreak: 'break-word' }}>
          {(error || 'Transaction failed').slice(0, 240)}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handlePlaceBet}
        disabled={loading || !amount || parseFloat(amount) <= 0}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 13, letterSpacing: '0.06em',
          background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#6633ff,#2545f6)',
          color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
          transition: 'all 0.15s',
          boxShadow: loading ? 'none' : '0 0 24px rgba(102,51,255,0.35)',
        }}
      >
        {loading ? 'PROCESSING...' : `🔒 BET ${outcome === 1 ? 'YES' : 'NO'} — ${amount} SOL`}
      </button>

      {/* Privacy note */}
      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: 1.6 }}>
        3-step PER flow: fund on L1 → delegate to TEE → set private outcome.<br />
        Your bet is encrypted in Intel TDX. Invisible until resolution.
      </div>
    </div>
  );
}
