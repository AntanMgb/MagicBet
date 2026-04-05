'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { BN } from '@coral-xyz/anchor';
import { SystemProgram } from '@solana/web3.js';
import {
  fetchAllMarkets, fetchAllUserBets, getProgram, getMarketPda,
  getBetRecordPda, getClaimRecordPda, lamportsToSol, isExpired,
} from '@/lib/program';
import { Connection } from '@solana/web3.js';
const DEVNET_RPC = 'https://api.devnet.solana.com';
import type { MarketAccount, BetAccount } from '@/types';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false }
);

type BetStatus = 'active' | 'pending_resolution' | 'won' | 'lost' | 'unknown' | 'claimed';

interface BetWithMarket extends BetAccount {
  market: MarketAccount | null;
  status: BetStatus;
}

export default function ProfilePage() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  const [bets, setBets] = useState<BetWithMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    console.log('[profile] load called, publicKey:', publicKey?.toString() ?? 'null');
    if (!publicKey) { setLoading(false); return; }
    setLoading(true);
    try {
      const conn = new Connection(DEVNET_RPC, 'confirmed');

      // Fetch bets and markets independently so one failure doesn't kill the other
      const [rawBets, allMarkets] = await Promise.all([
        fetchAllUserBets(conn, publicKey).catch((e) => { console.error('[profile] fetchAllUserBets:', e); return []; }),
        fetchAllMarkets(conn).catch((e) => { console.error('[profile] fetchAllMarkets:', e); return []; }),
      ]);

      console.log('[profile] rawBets:', rawBets.length, 'markets:', allMarkets.length);

      const marketMap = new Map(allMarkets.map(m => [m.marketId, m]));

      const enriched: BetWithMarket[] = rawBets.map(b => {
        const market = marketMap.get(b.marketId) ?? null;
        let status: BetStatus = 'unknown';
        if (market) {
          if (market.resolved) {
            status = b.outcome === market.winningOutcome ? 'won' : 'lost';
          } else if (isExpired(market.deadline)) {
            status = 'pending_resolution';
          } else {
            status = 'active';
          }
        }
        return { ...b, market, status };
      });

      // Batch-check ClaimRecord PDAs for won bets to detect already-claimed
      const wonEnriched = enriched.filter(b => b.status === 'won');
      if (wonEnriched.length > 0) {
        const claimPdas = wonEnriched.map(b =>
          getClaimRecordPda(BigInt(b.marketId), publicKey, BigInt(b.betIndex ?? 0))
        );
        const claimInfos = await conn.getMultipleAccountsInfo(claimPdas);
        wonEnriched.forEach((b, i) => { if (claimInfos[i] !== null) b.status = 'claimed'; });
      }

      setBets(enriched.sort((a, b) => Number(b.betIndex ?? 0) - Number(a.betIndex ?? 0)));
    } catch (e) { console.error('[profile] load error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [publicKey]);

  const claimWinnings = async (bet: BetWithMarket) => {
    if (!anchorWallet || !publicKey || !bet.market) return;
    const key = `${bet.marketId}-${bet.betIndex}`;
    setClaimingKey(key);
    try {
      const freshConn     = new Connection(DEVNET_RPC, 'confirmed');
      const marketId_n    = BigInt(bet.marketId);
      const betIndex_n    = BigInt(bet.betIndex ?? 0);
      const marketPda     = getMarketPda(marketId_n);
      const betRecordPda  = getBetRecordPda(marketId_n, publicKey, betIndex_n);
      const claimRecordPda = getClaimRecordPda(marketId_n, publicKey, betIndex_n);

      const marketInfo = await freshConn.getAccountInfo(marketPda, 'confirmed');
      if (!marketInfo) { setMsg('❌ Market was closed on-chain.'); return; }

      const program = getProgram(anchorWallet, freshConn);
      const tx = await (program.methods as any)
        .claimWinnings(new BN(bet.marketId), new BN(bet.betIndex ?? 0))
        .accounts({ user: publicKey, market: marketPda, betRecord: betRecordPda, claimRecord: claimRecordPda, systemProgram: SystemProgram.programId })
        .transaction();
      const { blockhash, lastValidBlockHeight } = await freshConn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await anchorWallet.signTransaction(tx);
      const sig    = await freshConn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      const result = await freshConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (result.value.err) throw new Error(JSON.stringify(result.value.err));
      setMsg('💰 Claimed!');
      await load();
    } catch (e: any) {
      setMsg(`❌ ${e?.message?.slice(0, 120) ?? 'Claim failed'}`);
    } finally { setClaimingKey(null); }
  };

  const wonBets    = bets.filter(b => b.status === 'won');
  const activeBets = bets.filter(b => b.status === 'active');
  const lostBets   = bets.filter(b => b.status === 'lost');
  const totalWagered = bets.reduce((s, b) => s + lamportsToSol(b.amount), 0);

  const claimAll = async () => {
    for (const bet of wonBets) {
      await claimWinnings(bet).catch(() => {});
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#050508' }}>
      <div className="aurora" />

      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5,5,8,0.88)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 16, textDecoration: 'none' }}>
            <span className="grad-text">MAGIC</span><span style={{ color: '#fff' }}>BET</span>
          </Link>
          <Link href="/" style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>
            ← MARKETS
          </Link>
          <div style={{ marginLeft: 'auto' }}>
            <WalletMultiButton style={{ fontSize: 12, height: 34, borderRadius: 8, fontFamily: 'var(--font-fira)' }} />
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>

        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.3)' }}>MY PROFILE</div>
            <button onClick={load} disabled={loading} style={{
              fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em',
              color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none',
              cursor: 'pointer', opacity: loading ? 0.4 : 1,
            }}>↻ REFRESH</button>
          </div>
          <h1 style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 28, color: '#fff', margin: '0 0 20px' }}>
            <span className="grad-text">My Bets</span>
          </h1>

          {!loading && bets.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'TOTAL BETS', value: String(bets.length),              color: '#a78bfa' },
                { label: 'ACTIVE',     value: String(activeBets.length),         color: '#59e09d' },
                { label: 'WON',        value: String(wonBets.length),            color: '#f59e0b' },
                { label: 'LOST',       value: String(lostBets.length),           color: '#de3fbc' },
                { label: 'WAGERED',    value: `${totalWagered.toFixed(3)} SOL`,  color: '#6633ff' },
              ].map(s => (
                <div key={s.label} className="glass" style={{ borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: s.color }}>{s.value}</div>
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {msg && (
          <div style={{
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            background: msg.startsWith('❌') ? 'rgba(222,63,188,0.08)' : 'rgba(89,224,157,0.08)',
            border: `1px solid ${msg.startsWith('❌') ? 'rgba(222,63,188,0.25)' : 'rgba(89,224,157,0.25)'}`,
            fontFamily: 'var(--font-fira)', fontSize: 12,
            color: msg.startsWith('❌') ? '#de3fbc' : '#59e09d',
          }}>{msg}</div>
        )}

        {!publicKey && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>CONNECT WALLET TO SEE YOUR BETS</div>
          </div>
        )}

        {publicKey && loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
            LOADING...
          </div>
        )}

        {publicKey && !loading && bets.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>NO BETS YET</div>
            <Link href="/" style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: '#6633ff', letterSpacing: '0.1em' }}>BROWSE MARKETS →</Link>
          </div>
        )}

        {!loading && wonBets.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={claimAll}
              disabled={claimingKey !== null}
              style={{
                fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.08em',
                padding: '8px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg,#f59e0b,#de3fbc)',
                color: '#fff', fontWeight: 600, opacity: claimingKey !== null ? 0.6 : 1,
              }}
            >
              {claimingKey !== null ? '...' : `💰 CLAIM ALL (${wonBets.length})`}
            </button>
          </div>
        )}

        {!loading && bets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bets.map((b) => {
              const STATUS_META: Record<BetStatus, { label: string; color: string; bg: string }> = {
                active:             { label: '● ACTIVE',    color: '#59e09d', bg: 'rgba(89,224,157,0.08)' },
                pending_resolution: { label: '⏳ RESOLVING', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
                won:                { label: '🏆 WON',      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
                lost:               { label: '✕ LOST',      color: 'rgba(255,255,255,0.2)', bg: 'rgba(255,255,255,0.03)' },
                claimed:            { label: '✓ CLAIMED',   color: '#59e09d', bg: 'rgba(89,224,157,0.05)' },
                unknown:            { label: '? UNKNOWN',   color: 'rgba(255,255,255,0.2)', bg: 'transparent' },
              };
              const meta       = STATUS_META[b.status];
              const pool       = b.market ? Number(b.market.totalYes) + Number(b.market.totalNo) : 0;
              const winSide    = b.market?.resolved ? (b.outcome === 1 ? Number(b.market.totalYes) : Number(b.market.totalNo)) : 0;
              const betLamports = Number(b.amount);
              const payout     = winSide > 0 ? (betLamports / winSide) * pool / 1e9 : 0;
              const claimKey   = `${b.marketId}-${b.betIndex}`;

              return (
                <div key={claimKey} className="glass" style={{ borderRadius: 14, padding: '16px 20px', background: meta.bg, border: `1px solid ${meta.color}20` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: b.outcome === 1 ? 'rgba(89,224,157,0.12)' : 'rgba(222,63,188,0.12)',
                      border: `1px solid ${b.outcome === 1 ? 'rgba(89,224,157,0.3)' : 'rgba(222,63,188,0.3)'}`,
                      fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 11,
                      color: b.outcome === 1 ? '#59e09d' : '#de3fbc',
                    }}>
                      {b.outcome === 1 ? 'YES' : 'NO'}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link href={`/market/${b.marketId}`} style={{ textDecoration: 'none' }}>
                        <div style={{ fontFamily: 'var(--font-lexend)', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 6, lineHeight: 1.4 }}>
                          {b.market?.question ?? `Market ${b.marketId}`}
                        </div>
                      </Link>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.1em', color: meta.color }}>{meta.label}</span>
                        <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>🔒 IN TEE</span>
                        {b.betIndex !== undefined && (
                          <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>BET #{b.betIndex + 1}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 15, color: '#fff' }}>
                        {lamportsToSol(b.amount).toFixed(3)} SOL
                      </div>
                      {b.status === 'won' && payout > 0 && (
                        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: '#f59e0b', marginTop: 2 }}>
                          ~{payout.toFixed(3)} SOL payout
                        </div>
                      )}
                      {b.status === 'won' && (
                        <button
                          onClick={() => claimWinnings(b)}
                          disabled={claimingKey === claimKey}
                          style={{
                            marginTop: 8, fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em',
                            padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                            background: 'linear-gradient(135deg,#f59e0b,#de3fbc)',
                            color: '#fff', fontWeight: 600,
                          }}
                        >
                          {claimingKey === claimKey ? '...' : '💰 CLAIM'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
