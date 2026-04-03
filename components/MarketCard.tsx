'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import type { MarketAccount } from '@/types';
import { lamportsToSol, isExpired } from '@/lib/program';

interface Props { market: MarketAccount }

// ── Asset meta ────────────────────────────────────────────────────────────────
const COIN_LOGOS: Record<string, string> = {
  BTC:   'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH:   'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  SOL:   'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP:   'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  BNB:   'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  BONK:  'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  WIF:   'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  DOGE:  'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  PEPE:  'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  LINK:  'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  AVAX:  'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  SUI:   'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  APT:   'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  JUP:   'https://assets.coingecko.com/coins/images/34188/small/jup.png',
  TRX:   'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  RENDER:'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  INJ:   'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
};

function assetMeta(q: string) {
  const s = q.toLowerCase();
  if (s.includes('btc') || s.includes('bitcoin'))     return { symbol:'BTC',  color:'#f59e0b', glow:'rgba(245,158,11,0.2)' };
  if (s.includes('eth') || s.includes('ethereum') || s.includes('pectra'))
                                                        return { symbol:'ETH',  color:'#627eea', glow:'rgba(98,126,234,0.2)'  };
  if (s.includes('sol') || s.includes('solana') || s.includes('firedancer'))
                                                        return { symbol:'SOL',  color:'#9945ff', glow:'rgba(153,69,255,0.2)'  };
  if (s.includes('xrp') || s.includes('ripple'))       return { symbol:'XRP',  color:'#00aae4', glow:'rgba(0,170,228,0.2)'   };
  if (s.includes('bnb') || s.includes('binance'))      return { symbol:'BNB',  color:'#f3ba2f', glow:'rgba(243,186,47,0.2)'  };
  if (s.includes('bonk'))                              return { symbol:'BONK', color:'#e8730a', glow:'rgba(232,115,10,0.2)'  };
  if (s.includes('wif') || s.includes('dogwifhat'))    return { symbol:'WIF',  color:'#d946ef', glow:'rgba(217,70,239,0.2)'  };
  if (s.includes('doge'))                              return { symbol:'DOGE', color:'#c2a633', glow:'rgba(194,166,51,0.2)'  };
  if (s.includes('pepe'))                              return { symbol:'PEPE', color:'#4ade80', glow:'rgba(74,222,128,0.2)'  };
  if (s.includes('link') || s.includes('chainlink'))  return { symbol:'LINK', color:'#2a5ada', glow:'rgba(42,90,218,0.2)'   };
  if (s.includes('avax') || s.includes('avalanche'))  return { symbol:'AVAX', color:'#e84142', glow:'rgba(232,65,66,0.2)'   };
  if (s.includes('sui'))                               return { symbol:'SUI',  color:'#4da2ff', glow:'rgba(77,162,255,0.2)'  };
  if (s.includes('apt') || s.includes('aptos'))       return { symbol:'APT',  color:'#18b2a0', glow:'rgba(24,178,160,0.2)'  };
  if (s.includes('jup') || s.includes('jupiter'))     return { symbol:'JUP',  color:'#c7a55a', glow:'rgba(199,165,90,0.2)'  };
  if (s.includes('trx') || s.includes('tron'))        return { symbol:'TRX',  color:'#ef0027', glow:'rgba(239,0,39,0.2)'    };
  if (s.includes('render') || s.includes('rndr'))     return { symbol:'RENDER',color:'#e8430a',glow:'rgba(232,67,10,0.2)'   };
  if (s.includes('inj') || s.includes('injective'))   return { symbol:'INJ',  color:'#00b2ff', glow:'rgba(0,178,255,0.2)'   };
  return { symbol:'CRYPTO', color:'#6633ff', glow:'rgba(102,51,255,0.2)' };
}

function formatCountdown(diff: number): string {
  if (diff <= 0) return 'CLOSED';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,'0')}h`;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function useCountdown(deadline: number) {
  const [diff, setDiff] = useState(() => deadline - Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setDiff(deadline - Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return diff;
}

function subtypeLabel(q: string) {
  const s = q.toLowerCase();
  if (s.includes('up (yes) or down (no)') || s.includes('up or down')) return { label:'UP/DOWN', color:'#59e09d' };
  if (s.includes('above') || s.includes('over ') || s.includes('exceed')) return { label:'ABOVE',    color:'#59e09d' };
  if (s.includes('below') || s.includes('drop below'))                    return { label:'BELOW',    color:'#de3fbc' };
  if (s.includes(' hit ') || s.includes('reach'))                         return { label:'HIT PRICE',color:'#2545f6' };
  return { label:'EVENT', color:'#6633ff' };
}

function tfLabel(q: string) {
  const s = q.toLowerCase();
  if (s.includes('15 minutes')) return '15M';
  if (s.includes('5 minutes'))  return '5M';
  if (s.includes('4 hours'))    return '4H';
  if (s.includes('1 hour'))     return '1H';
  if (s.startsWith('etf') || s.includes(' etf')) return 'ETF';
  if (s.startsWith('pre-market') || s.includes('ido') || s.includes('tge')) return 'PRE';
  if (s.includes('april 4') || s.includes('today')) return 'DAILY';
  if (s.includes('this week') || s.includes('april 10') || s.includes('april 5') || s.includes('april 6') || s.includes('april 7') || s.includes('april 8') || s.includes('april 9')) return 'WEEKLY';
  if (s.includes('april 30') || s.includes('in april') || s.includes('this month')) return 'MONTHLY';
  if (s.includes('end of 2026') || s.includes('in 2026') || s.includes('by 2026') || s.includes('by 2027') || s.includes('end of q')) return 'YEARLY';
  return 'MONTHLY';
}

export function MarketCard({ market }: Props) {
  const totalYes  = Number(market.totalYes);
  const totalNo   = Number(market.totalNo);
  const totalPool = totalYes + totalNo;
  const yesPercent = totalPool > 0 ? Math.round((totalYes / totalPool) * 100) : 50;
  const noPercent  = 100 - yesPercent;
  const expired = isExpired(market.deadline);
  const live    = !expired && !market.resolved;
  const asset   = assetMeta(market.question);
  const sub     = subtypeLabel(market.question);
  const tf      = tfLabel(market.question);
  const isUpDown = sub.label === 'UP/DOWN';
  const countdown = useCountdown(market.deadline);

  return (
    <Link href={`/market/${market.marketId}`} style={{ display: 'block', textDecoration: 'none' }}>
      <div
        className="glass"
        style={{
          borderRadius: 16,
          padding: '18px 18px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          height: '100%',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle asset color glow at top-right */}
        <div style={{
          position: 'absolute', top: -20, right: -20,
          width: 80, height: 80, borderRadius: '50%',
          background: asset.glow, filter: 'blur(20px)',
          pointerEvents: 'none',
        }} />

        {/* ── Header: asset icon + badges ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Asset circle */}
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: `${asset.color}22`, border: `1px solid ${asset.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {COIN_LOGOS[asset.symbol] ? (
              <img src={COIN_LOGOS[asset.symbol]} alt={asset.symbol} width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 15, fontWeight: 700, color: asset.color, fontFamily: 'var(--font-unbounded)' }}>
                {asset.symbol.slice(0, 2)}
              </span>
            )}
          </div>

          {/* Symbol + timeframe */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 12, color: asset.color }}>
                {asset.symbol}
              </span>
              <span style={{
                fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em',
                padding: '2px 7px', borderRadius: 4,
                background: `${sub.color}18`, color: sub.color, border: `1px solid ${sub.color}30`,
              }}>
                {sub.label}
              </span>
              <span style={{
                fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em',
                padding: '2px 7px', borderRadius: 4,
                background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                {tf}
              </span>
            </div>
          </div>

          {/* Live / status */}
          {live ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <div className="live-dot" />
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em', color: '#59e09d' }}>LIVE</span>
            </div>
          ) : (
            <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
              {market.resolved ? 'RESOLVED' : 'EXPIRED'}
            </span>
          )}
        </div>

        {/* ── Question ── */}
        <p style={{
          fontFamily: 'var(--font-lexend)', fontWeight: 400, fontSize: 13,
          color: 'rgba(255,255,255,0.88)', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', margin: 0, flex: 1,
        }}>
          {market.question}
        </p>

        {/* ── Odds ── */}
        {isUpDown ? (
          /* Up/Down split */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{
              background: 'rgba(89,224,157,0.07)', border: '1px solid rgba(89,224,157,0.2)',
              borderRadius: 10, padding: '8px 0', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 18, color: '#59e09d' }}>{yesPercent}%</div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em', color: 'rgba(89,224,157,0.6)' }}>UP</div>
            </div>
            <div style={{
              background: 'rgba(222,63,188,0.07)', border: '1px solid rgba(222,63,188,0.2)',
              borderRadius: 10, padding: '8px 0', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 18, color: '#de3fbc' }}>{noPercent}%</div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em', color: 'rgba(222,63,188,0.6)' }}>DOWN</div>
            </div>
          </div>
        ) : (
          /* YES/NO bar */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 22, color: '#59e09d' }}>
                  {yesPercent}%
                </span>
                <span style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.28)' }}>
                  YES
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.28)' }}>
                  NO
                </span>
                <span style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 14, color: 'rgba(222,63,188,0.8)' }}>
                  {noPercent}%
                </span>
              </div>
            </div>
            {/* Gradient bar */}
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${yesPercent}%`,
                background: 'linear-gradient(90deg, #6633ff, #59e09d)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10,
        }}>
          <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.2)' }}>
            🔒 MAGICBLOCK TEE
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            {totalPool > 0 && (
              <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
                {lamportsToSol(totalPool).toFixed(2)} SOL
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
              {formatCountdown(countdown)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
