'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet, useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { BN } from '@coral-xyz/anchor';
import { SystemProgram } from '@solana/web3.js';
import { fetchAllMarkets, getProgram, getMarketPda, isExpired } from '@/lib/program';
import type { MarketAccount } from '@/types';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false }
);

interface LocalBet {
  marketId: string;
  question: string;
  outcome: 1 | 2;
  amount: number;
  timestamp: number;
}

interface BetWithMarket extends LocalBet {
  market: MarketAccount | null;
  status: 'active' | 'pending_resolution' | 'won' | 'lost' | 'unknown';
}

export default function ProfilePage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [bets, setBets] = useState<BetWithMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingAll, setClaimingAll] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('magicbet_claimed') || '[]')); } catch { return new Set(); }
  });
  const [msg, setMsg] = useState('');

  const load = async () => {
    if (!publicKey) { setLoading(false); return; }
    setLoading(true);
    try {
      const key = `magicbet_bets_${publicKey.toString()}`;
      const stored: LocalBet[] = JSON.parse(localStorage.getItem(key) || '[]');
      if (stored.length === 0) { setBets([]); setLoading(false); return; }

      const allMarkets = await fetchAllMarkets(connection);
      const marketMap = new Map(allMarkets.map(m => [m.marketId, m]));

      const enriched: BetWithMarket[] = stored.map(b => {
        const market = marketMap.get(b.marketId) ?? null;
        let status: BetWithMarket['status'] = 'unknown';
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

      setBets(enriched.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [publicKey]);

  const claimWinnings = async (bet: BetWithMarket) => {
    if (!anchorWallet || !publicKey || !bet.market) return;
    setClaimingId(bet.marketId);
    try {
      const program = getProgram(anchorWallet, connection);
      const marketPda = getMarketPda(BigInt(bet.marketId));
      await (program.methods as any)
        .claimWinnings(new BN(bet.marketId))
        .accounts({ user: publicKey, market: marketPda, systemProgram: SystemProgram.programId })
        .rpc();
      setMsg(`💰 Claimed winnings for: ${bet.question.slice(0, 50)}...`);
      setClaimedIds(prev => {
        const next = new Set(prev).add(bet.marketId);
        try { localStorage.setItem('magicbet_claimed', JSON.stringify([...next])); } catch {}
        return next;
      });
      await load();
    } catch (e: any) {
      setMsg(`❌ ${e?.message?.slice(0, 80) ?? 'Claim failed'}`);
    } finally { setClaimingId(null); }
  };

  const claimAll = async () => {
    const winners = bets.filter(b => b.status === 'won');
    if (!winners.length) return;
    setClaimingAll(true);
    setMsg('');
    let claimed = 0;
    for (const bet of winners) {
      try {
        await claimWinnings(bet);
        claimed++;
      } catch {}
    }
    setMsg(`💰 Claimed ${claimed} of ${winners.length} winning bets`);
    setClaimingAll(false);
  };

  const wonBets    = bets.filter(b => b.status === 'won');
  const activeBets = bets.filter(b => b.status === 'active');
  const lostBets   = bets.filter(b => b.status === 'lost');
  const totalWagered = bets.reduce((s, b) => s + b.amount, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#050508' }}>
      <div className="aurora" />

      {/* Nav */}
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

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>MY PROFILE</div>
          <h1 style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 28, color: '#fff', margin: '0 0 20px' }}>
            <span className="grad-text">My Bets</span>
          </h1>

          {/* Stats row */}
          {!loading && bets.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'TOTAL BETS',   value: String(bets.length),          color: '#a78bfa' },
                { label: 'ACTIVE',       value: String(activeBets.length),     color: '#59e09d' },
                { label: 'WON',          value: String(wonBets.length),        color: '#f59e0b' },
                { label: 'LOST',         value: String(lostBets.length),       color: '#de3fbc' },
                { label: 'WAGERED',      value: `${totalWagered.toFixed(3)} SOL`, color: '#6633ff' },
              ].map(s => (
                <div key={s.label} className="glass" style={{ borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: s.color }}>{s.value}</div>
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Claim All button */}
          {wonBets.length > 0 && (
            <button onClick={claimAll} disabled={claimingAll} style={{
              fontFamily: 'var(--font-fira)', fontSize: 12, letterSpacing: '0.1em',
              padding: '10px 28px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#f59e0b,#de3fbc)',
              color: '#fff', fontWeight: 600,
              boxShadow: '0 0 24px rgba(245,158,11,0.3)',
            }}>
              {claimingAll ? 'CLAIMING...' : `💰 CLAIM ALL WINNINGS (${wonBets.length})`}
            </button>
          )}
        </div>

        {/* Status message */}
        {msg && (
          <div style={{
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            background: msg.startsWith('❌') ? 'rgba(222,63,188,0.08)' : 'rgba(89,224,157,0.08)',
            border: `1px solid ${msg.startsWith('❌') ? 'rgba(222,63,188,0.25)' : 'rgba(89,224,157,0.25)'}`,
            fontFamily: 'var(--font-fira)', fontSize: 12,
            color: msg.startsWith('❌') ? '#de3fbc' : '#59e09d',
          }}>{msg}</div>
        )}

        {/* Not connected */}
        {!publicKey && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>CONNECT WALLET TO SEE YOUR BETS</div>
          </div>
        )}

        {/* Loading */}
        {publicKey && loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
            LOADING...
          </div>
        )}

        {/* Empty */}
        {publicKey && !loading && bets.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
            <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>NO BETS YET</div>
            <Link href="/" style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: '#6633ff', letterSpacing: '0.1em' }}>BROWSE MARKETS →</Link>
          </div>
        )}

        {/* Bet list */}
        {!loading && bets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bets.map((b) => {
              const STATUS_META: Record<BetWithMarket['status'], { label: string; color: string; bg: string }> = {
                active:              { label: '● ACTIVE',    color: '#59e09d', bg: 'rgba(89,224,157,0.08)' },
                pending_resolution:  { label: '⏳ RESOLVING', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
                won:                 { label: '🏆 WON',      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
                lost:                { label: '✕ LOST',      color: 'rgba(255,255,255,0.2)', bg: 'rgba(255,255,255,0.03)' },
                unknown:             { label: '? UNKNOWN',   color: 'rgba(255,255,255,0.2)', bg: 'transparent' },
              };
              const meta = STATUS_META[b.status];
              const pool = b.market ? Number(b.market.totalYes) + Number(b.market.totalNo) : 0;
              const winSide = b.market?.resolved ? (b.outcome === 1 ? Number(b.market.totalYes) : Number(b.market.totalNo)) : 0;
              const payout = winSide > 0 ? (b.amount * 1e9 / winSide) * (pool) / 1e9 : 0;

              return (
                <div key={b.marketId} className="glass" style={{ borderRadius: 14, padding: '16px 20px', background: meta.bg, border: `1px solid ${meta.color}20` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    {/* Outcome badge */}
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

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link href={`/market/${b.marketId}`} style={{ textDecoration: 'none' }}>
                        <div style={{ fontFamily: 'var(--font-lexend)', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 6, lineHeight: 1.4 }}>
                          {b.question}
                        </div>
                      </Link>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.1em', color: meta.color }}>{meta.label}</span>
                        <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>🔒 IN TEE</span>
                        <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{new Date(b.timestamp).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Amount + claim */}
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 15, color: '#fff' }}>{b.amount} SOL</div>
                      {b.status === 'won' && payout > 0 && (
                        <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: '#f59e0b', marginTop: 2 }}>
                          ~{payout.toFixed(3)} SOL payout
                        </div>
                      )}
                      {b.status === 'won' && (
                        claimedIds.has(b.marketId) ? (
                          <div style={{
                            marginTop: 8, fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em',
                            padding: '6px 14px', borderRadius: 999,
                            background: 'rgba(89,224,157,0.1)', border: '1px solid rgba(89,224,157,0.25)',
                            color: '#59e09d', fontWeight: 600, textAlign: 'center',
                          }}>
                            ✓ CLAIMED
                          </div>
                        ) : (
                          <button
                            onClick={() => claimWinnings(b)}
                            disabled={claimingId === b.marketId}
                            style={{
                              marginTop: 8, fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em',
                              padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                              background: 'linear-gradient(135deg,#f59e0b,#de3fbc)',
                              color: '#fff', fontWeight: 600,
                            }}
                          >
                            {claimingId === b.marketId ? '...' : '💰 CLAIM'}
                          </button>
                        )
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
