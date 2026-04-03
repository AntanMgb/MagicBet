'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet, useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false }
);
import { Connection, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { PlaceBetForm } from '@/components/PlaceBetForm';
import { fetchAllMarkets, getProgram, getMarketPda, getBetPda, lamportsToSol, formatDeadline, isExpired, undelegateBet, DELEGATION_PROGRAM, DEVNET_RPC } from '@/lib/program';
import { fetchPythPrice } from '@/lib/markets';
import type { MarketAccount } from '@/types';

const COIN_BY_FEED: Record<string, string> = {
  'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix': 'solana',
  'HovQMDrbAgAYPCmaTftQMjWUB5UEQLGVKXcp39HkrMoS': 'bitcoin',
  'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw': 'ethereum',
  'GwzBgrXb4PG59zjce24SF2b9JXbLEjJJTBkmytuEZj1b': 'binancecoin',
};

function assetColor(q: string) {
  const s = q.toLowerCase();
  if (s.includes('btc') || s.includes('bitcoin'))  return '#f59e0b';
  if (s.includes('eth') || s.includes('ethereum')) return '#627eea';
  if (s.includes('sol') || s.includes('solana'))   return '#9945ff';
  if (s.includes('bnb'))                           return '#f3ba2f';
  return '#6633ff';
}

export default function MarketPage() {
  const params  = useParams();
  const router  = useRouter();
  const { connection } = useConnection();
  const { publicKey }  = useWallet();
  const anchorWallet   = useAnchorWallet();

  const [market,       setMarket]       = useState<MarketAccount | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [resolving,    setResolving]    = useState(false);
  const [claiming,     setClaiming]     = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [msg,          setMsg]          = useState('');
  const [userBetOutcome, setUserBetOutcome] = useState<1 | 2 | null>(null);

  const marketId = params.id as string;
  const color = market ? assetColor(market.question) : '#6633ff';

  const load = async () => {
    try {
      const all   = await fetchAllMarkets(connection);
      const found = all.find((m) => m.marketId === marketId);
      if (!found) { router.push('/'); return; }
      setMarket(found);
      if (!found.resolved && isExpired(found.deadline)) tryAutoResolve(found);
      if (found.pythFeed) {
        const coinId = COIN_BY_FEED[found.pythFeed];
        if (coinId) setCurrentPrice(await fetchPythPrice(coinId));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Load user's bet from localStorage
  useEffect(() => {
    if (!publicKey) return;
    try {
      const key = `magicbet_bets_${publicKey.toString()}`;
      const bets: { marketId: string; outcome: 1 | 2 }[] = JSON.parse(localStorage.getItem(key) || '[]');
      const mine = bets.find(b => b.marketId === marketId);
      if (mine) setUserBetOutcome(mine.outcome);
    } catch {}
  }, [publicKey, marketId]);

  // Auto-resolve when market expires
  const tryAutoResolve = async (m: MarketAccount) => {
    if (m.resolved || !isExpired(m.deadline)) return;
    setResolving(true);
    try {
      await fetch('/api/auto-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: m.marketId }),
      });
      setTimeout(load, 2000);
    } catch {}
    finally { setResolving(false); }
  };

  useEffect(() => { load(); }, [marketId]);


  const handleClaim = async () => {
    if (!market || !anchorWallet || !publicKey) return;
    setClaiming(true); setMsg('');
    try {
      const betPda = getBetPda(BigInt(market.marketId), publicKey);

      // If bet is still delegated, undelegate first
      const freshConn = new Connection(DEVNET_RPC, 'confirmed');
      const betInfo = await freshConn.getAccountInfo(betPda);
      if (betInfo?.owner.equals(DELEGATION_PROGRAM)) {
        setMsg('⏳ Undelegating from TEE... (may take up to 30s)');
        await undelegateBet(anchorWallet, betPda);
        setMsg('✓ Undelegated. Claiming...');
        // Extra wait for L1 to finalize
        await new Promise(r => setTimeout(r, 2000));
      }

      const program   = getProgram(anchorWallet, connection);
      const marketPda = getMarketPda(BigInt(market.marketId));
      await (program.methods as any)
        .claimWinnings(new BN(market.marketId))
        .accounts({ user: publicKey, market: marketPda, systemProgram: SystemProgram.programId })
        .rpc();
      setMsg('💰 Winnings claimed!');
      await load();
    } catch (e: any) { setMsg(`❌ ${e?.message ?? 'Failed'}`); }
    finally { setClaiming(false); }
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#050508', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 12, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
        LOADING...
      </div>
    </div>
  );

  if (!market) return null;

  const totalYes   = Number(market.totalYes);
  const totalNo    = Number(market.totalNo);
  const totalPool  = totalYes + totalNo;
  const yesPct     = totalPool > 0 ? Math.round((totalYes / totalPool) * 100) : 50;
  const expired    = isExpired(market.deadline);
  const canResolve = !market.resolved && expired;
  const targetUsd  = market.targetPrice ? Number(market.targetPrice) / 1e6 : null;
  const currentUsd = currentPrice ? currentPrice / 1e6 : null;

  return (
    <div style={{ minHeight: '100vh', background: '#050508', position: 'relative' }}>
      {/* Aurora */}
      <div className="aurora" />

      {/* Nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(5,5,8,0.88)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 16, textDecoration: 'none' }}>
            <span className="grad-text">MAGIC</span><span style={{ color: '#fff' }}>BET</span>
          </Link>
          <Link href="/" style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textDecoration: 'none', marginLeft: 4 }}>
            ← ALL MARKETS
          </Link>
          <div style={{ marginLeft: 'auto' }}>
            <WalletMultiButton style={{ fontSize: 12, height: 34, borderRadius: 8, fontFamily: 'var(--font-fira)' }} />
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

        {/* ── LEFT: Market info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status badge */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {market.resolved ? (
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', padding: '4px 12px', borderRadius: 999, background: 'rgba(102,51,255,0.15)', color: '#a78bfa', border: '1px solid rgba(102,51,255,0.3)' }}>RESOLVED</span>
            ) : expired ? (
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', padding: '4px 12px', borderRadius: 999, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>⏰ AWAITING RESOLUTION</span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', padding: '4px 12px', borderRadius: 999, background: 'rgba(89,224,157,0.1)', color: '#59e09d', border: '1px solid rgba(89,224,157,0.25)' }}>
                <div className="live-dot" /> LIVE
              </span>
            )}
          </div>

          {/* Question */}
          <h1 style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 'clamp(18px, 2.5vw, 28px)', letterSpacing: '-0.02em', lineHeight: 1.3, color: '#fff', margin: 0 }}>
            {market.question}
          </h1>

          {/* Oracle info */}
          {market.marketType !== 2 && (
            <div className="glass" style={{ borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.28)', marginBottom: 12 }}>PYTH ORACLE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>TARGET PRICE</div>
                  <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 20, color: '#fff' }}>
                    {targetUsd ? `$${targetUsd.toLocaleString()}` : '—'}
                  </div>
                </div>
                {currentUsd !== null && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>CURRENT PRICE</div>
                    <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 20 }}>
                      <span className="grad-text-green">${currentUsd.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: color, marginTop: 10, opacity: 0.7 }}>
                {market.marketType === 0 ? '↑ YES if price goes ABOVE target at deadline' : '↓ YES if price goes BELOW target at deadline'}
              </div>
            </div>
          )}

          {/* YES/NO stats card */}
          <div className="glass" style={{ borderRadius: 14, padding: '20px 20px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 36, color: '#59e09d' }}>{yesPct}%</span>
                <span style={{ fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>CHANCE YES</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(222,63,188,0.8)' }}>{100 - yesPct}%</div>
                <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)' }}>NO</div>
              </div>
            </div>

            {/* Bar */}
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', borderRadius: 3, width: `${yesPct}%`, background: 'linear-gradient(90deg,#6633ff,#59e09d)', transition: 'width 0.4s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(89,224,157,0.5)' }}>{lamportsToSol(totalYes).toFixed(3)} SOL YES</span>
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(222,63,188,0.5)' }}>{lamportsToSol(totalNo).toFixed(3)} SOL NO</span>
            </div>
          </div>

          {/* Pool + Deadline */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'TOTAL POOL', value: `${lamportsToSol(totalPool).toFixed(3)} SOL` },
              { label: 'DEADLINE',   value: formatDeadline(market.deadline) },
            ].map((s) => (
              <div key={s.label} className="glass" style={{ borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 15, color: '#fff' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Resolution result */}
          {market.resolved && (() => {
            const userWon = userBetOutcome !== null && userBetOutcome === market.winningOutcome;
            const userLost = userBetOutcome !== null && userBetOutcome !== market.winningOutcome;
            const winColor = market.winningOutcome === 1 ? '#59e09d' : '#de3fbc';
            return (
              <div style={{
                borderRadius: 14, padding: '20px',
                background: market.winningOutcome === 1 ? 'rgba(89,224,157,0.07)' : 'rgba(222,63,188,0.07)',
                border: `1px solid ${market.winningOutcome === 1 ? 'rgba(89,224,157,0.25)' : 'rgba(222,63,188,0.25)'}`,
              }}>
                <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 24, color: winColor, marginBottom: 4 }}>
                  {market.winningOutcome === 1 ? '✓ YES WON' : '✕ NO WON'}
                </div>
                {userWon && (
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: '#59e09d', marginBottom: 14, letterSpacing: '0.08em' }}>
                    🎉 YOU BET CORRECTLY — CLAIM YOUR WINNINGS
                  </div>
                )}
                {userLost && (
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 14, letterSpacing: '0.08em' }}>
                    You bet on the losing side
                  </div>
                )}
                {!userBetOutcome && (
                  <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 14 }}>
                    Market resolved
                  </div>
                )}
                {userWon && publicKey && (
                  <button onClick={handleClaim} disabled={claiming} style={{
                    fontFamily: 'var(--font-fira)', fontSize: 12, letterSpacing: '0.1em',
                    padding: '12px 32px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg,#f59e0b,#de3fbc)',
                    color: '#fff', fontWeight: 600, width: '100%',
                  }}>
                    {claiming ? 'CLAIMING...' : '💰 CLAIM WINNINGS'}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Auto-resolving indicator */}
          {canResolve && (
            <div style={{ borderRadius: 14, padding: '16px 20px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1s ease-in-out infinite', flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.1em', color: '#f59e0b' }}>
                  {resolving ? 'DETERMINING RESULT...' : 'AWAITING RESOLUTION'}
                </div>
                <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>
                  System is fetching price data to determine winner
                </div>
              </div>
            </div>
          )}

          {/* Status message */}
          {msg && (
            <div style={{
              borderRadius: 10, padding: '12px 16px',
              background: msg.startsWith('❌') ? 'rgba(222,63,188,0.08)' : 'rgba(89,224,157,0.08)',
              border: `1px solid ${msg.startsWith('❌') ? 'rgba(222,63,188,0.25)' : 'rgba(89,224,157,0.25)'}`,
              fontFamily: 'var(--font-fira)', fontSize: 12,
              color: msg.startsWith('❌') ? '#de3fbc' : '#59e09d',
            }}>{msg}</div>
          )}

          {/* Privacy note */}
          <div style={{
            borderRadius: 12, padding: '12px 16px',
            background: 'rgba(102,51,255,0.06)', border: '1px solid rgba(102,51,255,0.15)',
            fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.06em',
            color: 'rgba(102,51,255,0.8)', lineHeight: 1.6,
          }}>
            🔒 PRIVATE BET TECHNOLOGY — Individual positions are encrypted inside Intel TDX TEE via MagicBlock Private Ephemeral Rollups. Only aggregated YES/NO totals are visible on-chain.
          </div>
        </div>

        {/* ── RIGHT: Bet form ── */}
        <div style={{ position: 'sticky', top: 72 }}>
          {market.resolved ? (
            <div className="glass" style={{ borderRadius: 16, padding: '28px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏁</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 6 }}>MARKET CLOSED</div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Betting has ended</div>
            </div>
          ) : expired ? (
            <div className="glass" style={{ borderRadius: 16, padding: '28px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏰</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: '#f59e0b', marginBottom: 6 }}>BETTING CLOSED</div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Deadline passed — awaiting resolution</div>
            </div>
          ) : (
            <PlaceBetForm market={market} onSuccess={() => setTimeout(load, 2500)} />
          )}
        </div>
      </div>
    </div>
  );
}
