'use client';

import { useEffect, useState, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton),
  { ssr: false }
);
import { MarketCard } from '@/components/MarketCard';
import { fetchAllMarkets, lamportsToSol, isExpired } from '@/lib/program';
import type { MarketAccount } from '@/types';

// ─── Detection ────────────────────────────────────────────────────────────────

type Timeframe = 'ALL'|'5M'|'15M'|'1H'|'4H'|'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY'|'PRE-MARKET'|'ETF';
type Subtype   = 'ALL'|'UP/DOWN'|'ABOVE'|'BELOW'|'HIT PRICE'|'EVENT';
type Asset     = 'ALL'|'BTC'|'ETH'|'SOL'|'XRP'|'BNB'|'BONK'|'WIF'|'DOGE';

export function detectTimeframe(q: string): Timeframe {
  const s = q.toLowerCase();
  if (s.startsWith('etf') || s.includes(' etf ') || s.includes(' etf?')) return 'ETF';
  if (s.startsWith('pre-market') || s.includes('ido') || s.includes('tge') || s.includes('before listing')) return 'PRE-MARKET';
  if (s.includes('15 minutes')) return '15M';
  if (s.includes('5 minutes'))  return '5M';
  if (s.includes('4 hours'))    return '4H';
  if (s.includes('1 hour'))     return '1H';
  if (s.includes('april 4') || s.includes('today') || s.includes('daily')) return 'DAILY';
  if (s.includes('end of 2026') || s.includes('by 2026') || s.includes('in 2026') || s.includes('by 2027') || s.includes('end of q')) return 'YEARLY';
  if (s.includes('april 30') || s.includes('this month') || s.includes('by end of april') || s.includes('in april')) return 'MONTHLY';
  if (s.includes('this week') || s.includes('april 10') || s.includes('april 5') || s.includes('april 6') || s.includes('april 7') || s.includes('april 8') || s.includes('april 9')) return 'WEEKLY';
  return 'MONTHLY';
}

export function detectSubtype(q: string): Subtype {
  const s = q.toLowerCase();
  if (s.includes('up (yes) or down (no)') || s.includes('up or down')) return 'UP/DOWN';
  if (s.includes('above') || s.includes('over ') || s.includes('exceed')) return 'ABOVE';
  if (s.includes('below') || s.includes('drop below') || s.includes('under ')) return 'BELOW';
  if (s.includes(' hit ') || s.includes('reach')) return 'HIT PRICE';
  return 'EVENT';
}

export function detectAsset(q: string): Asset {
  const s = q.toLowerCase();
  if (s.includes('btc') || s.includes('bitcoin')) return 'BTC';
  if (s.includes('eth') || s.includes('ethereum') || s.includes('pectra')) return 'ETH';
  if (s.includes('sol') || s.includes('solana') || s.includes('firedancer')) return 'SOL';
  if (s.includes('xrp') || s.includes('ripple')) return 'XRP';
  if (s.includes('bnb') || s.includes('binance')) return 'BNB';
  if (s.includes('bonk')) return 'BONK';
  if (s.includes('wif') || s.includes('dogwifhat')) return 'WIF';
  if (s.includes('doge')) return 'DOGE';
  return 'ALL';
}

// ─── Filter config ────────────────────────────────────────────────────────────

const TIMEFRAMES: { key: Timeframe; label: string; icon: string }[] = [
  { key:'ALL',        label:'All',        icon:'⊞'  },
  { key:'5M',         label:'5 Min',      icon:'⚡'  },
  { key:'15M',        label:'15 Min',     icon:'⏱'  },
  { key:'1H',         label:'1 Hour',     icon:'🕐'  },
  { key:'4H',         label:'4 Hours',    icon:'🕓'  },
  { key:'DAILY',      label:'Daily',      icon:'📅'  },
  { key:'WEEKLY',     label:'Weekly',     icon:'📆'  },
  { key:'MONTHLY',    label:'Monthly',    icon:'📈'  },
  { key:'YEARLY',     label:'Yearly',     icon:'🗓'  },
  { key:'PRE-MARKET', label:'Pre-Market', icon:'🔮'  },
  { key:'ETF',        label:'ETF',        icon:'🏦'  },
];

const COIN_LOGOS: Record<string, string> = {
  BTC:  'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH:  'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  SOL:  'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP:  'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  BNB:  'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  BONK: 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  WIF:  'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
};

const ASSETS: { key: Asset; color: string }[] = [
  { key:'ALL',  color:'#6633ff' },
  { key:'BTC',  color:'#f59e0b' },
  { key:'ETH',  color:'#627eea' },
  { key:'SOL',  color:'#9945ff' },
  { key:'XRP',  color:'#00aae4' },
  { key:'BNB',  color:'#f3ba2f' },
  { key:'BONK', color:'#e8730a' },
  { key:'WIF',  color:'#d946ef' },
  { key:'DOGE', color:'#c2a633' },
];

const SUBTYPES: { key: Subtype; label: string }[] = [
  { key:'ALL',       label:'All'       },
  { key:'UP/DOWN',   label:'Up / Down' },
  { key:'ABOVE',     label:'Above'     },
  { key:'BELOW',     label:'Below'     },
  { key:'HIT PRICE', label:'Hit Price' },
  { key:'EVENT',     label:'Event'     },
];

// Max allowed deadline (seconds from now) per short timeframe — filters out stale seeds
const TF_MAX_SECS: Partial<Record<Timeframe, number>> = {
  '5M':  10 * 60,
  '15M': 30 * 60,
  '1H':  130 * 60,
  '4H':  9 * 3600,
};

// ─── Component ────────────────────────────────────────────────────────────────

interface LocalBet {
  marketId:  string;
  question:  string;
  outcome:   1 | 2;
  amount:    number;
  timestamp: number;
}

export default function HomePage() {
  const { connection } = useConnection();
  const { publicKey }  = useWallet();
  const [markets,   setMarkets]   = useState<MarketAccount[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState<'markets' | 'mybets' | 'history'>('markets');
  const [myBets,    setMyBets]    = useState<LocalBet[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('ALL');
  const [subtype,   setSubtype]   = useState<Subtype>('ALL');
  const [asset,     setAsset]     = useState<Asset>('ALL');
  const [search,    setSearch]    = useState('');

  // Load My Bets from localStorage whenever wallet changes
  useEffect(() => {
    if (!publicKey) { setMyBets([]); return; }
    try {
      const key = `magicbet_bets_${publicKey.toString()}`;
      setMyBets(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch { setMyBets([]); }
  }, [publicKey]);

  const load = async () => {
    setLoading(true);
    try { setMarkets(await fetchAllMarkets(connection)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Auto-refresh short-term markets on load and every 60s
  useEffect(() => {
    const refresh = async () => {
      await fetch('/api/refresh-markets').catch(() => {});
      // Reload markets right after refresh so new short-term markets appear immediately
      load();
    };
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Per-timeframe counts (for badges)
  const tfCount = useMemo(() => {
    const c: Record<string, number> = { ALL: 0 };
    markets.forEach((m) => {
      if (m.resolved || isExpired(m.deadline)) return;
      const tf = detectTimeframe(m.question);
      c[tf] = (c[tf] ?? 0) + 1;
      c.ALL++;
    });
    return c;
  }, [markets]);

  const assetCount = useMemo(() => {
    const c: Record<string, number> = { ALL: 0 };
    markets.forEach((m) => {
      if (m.resolved || isExpired(m.deadline)) return;
      const a = detectAsset(m.question);
      c[a] = (c[a] ?? 0) + 1;
      c.ALL++;
    });
    return c;
  }, [markets]);

  const totalVol = markets.reduce((a, m) => a + Number(m.totalYes) + Number(m.totalNo), 0);

  const displayed = useMemo(() => {
    return markets.filter((m) => {
      if (m.resolved || isExpired(m.deadline)) return false;
      const tf = detectTimeframe(m.question);
      if (timeframe !== 'ALL' && tf !== timeframe) return false;
      if (subtype   !== 'ALL' && detectSubtype(m.question) !== subtype) return false;
      if (asset     !== 'ALL' && detectAsset(m.question)   !== asset)   return false;
      if (search.trim() && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [markets, timeframe, subtype, asset, search]);

  const history = useMemo(() =>
    markets.filter((m) => m.resolved || isExpired(m.deadline))
      .sort((a, b) => Number(b.deadline) - Number(a.deadline)),
    [markets]);

  return (
    <div style={{ minHeight: '100vh', background: '#050508', position: 'relative' }}>
      {/* Aurora background */}
      <div className="aurora" />

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(5,5,8,0.85)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Logo */}
          <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 18, letterSpacing: '-0.02em', flexShrink: 0 }}>
            <span className="grad-text">MAGIC</span>
            <span style={{ color: '#fff' }}>BET</span>
          </div>

          {/* Search */}
          <div style={{ flex: 1, maxWidth: 440, position: 'relative' }}>
            <svg style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', width:14, height:14, color:'rgba(255,255,255,0.3)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search predictions..."
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, color: '#fff', fontSize: 13, paddingLeft: 36, paddingRight: 16,
                paddingTop: 8, paddingBottom: 8, outline: 'none', fontFamily: 'var(--font-lexend)',
              }}
            />
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 24, marginLeft: 'auto', flexShrink: 0, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 20 }} className="hidden sm:flex">
              <Stat label="MARKETS" value={String(tfCount.ALL ?? 0)} />
              <Stat label="VOLUME" value={`${lamportsToSol(totalVol).toFixed(1)} SOL`} color="#59e09d" />
              <Stat label="NETWORK" value="DEVNET" color="#6633ff" />
            </div>
            {publicKey && (
              <a href="/profile" style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', textDecoration: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
                MY PROFILE
              </a>
            )}
            <WalletMultiButton style={{ fontSize: 12, height: 34, borderRadius: 8, fontFamily: 'var(--font-fira)', letterSpacing: '0.05em' }} />
          </div>
        </div>
      </nav>

      {/* ── HERO STRIP ───────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 20px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 12 }}>
            Powered by MagicBlock Private Ephemeral Rollups · Solana Devnet
          </div>
          <h1 style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 'clamp(28px, 4vw, 52px)', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
            <span className="grad-text">Predict Crypto.</span>
            <br />
            <span style={{ color: 'rgba(255,255,255,0.9)' }}>Stay Private.</span>
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontFamily: 'var(--font-lexend)', maxWidth: 480, margin: '0 auto 20px' }}>
            Your bets are encrypted in Intel TDX TEE — no whale tracking, no front-running.
          </p>
          {/* Stat pills */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { label: `${tfCount.ALL ?? 0} Active Markets`, color: '#6633ff' },
              { label: '🔒 Hidden Bets (TEE)',                color: '#de3fbc' },
              { label: '⚡ Zero Fees via MagicBlock ER',      color: '#2545f6' },
            ].map((p) => (
              <span key={p.label} style={{
                fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.06em',
                padding: '5px 14px', borderRadius: 999,
                background: `${p.color}18`, border: `1px solid ${p.color}40`,
                color: p.color,
              }}>
                {p.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── ASSET FILTER ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 8 }}>
            Asset
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {ASSETS.map((a) => {
              const cnt = assetCount[a.key] ?? 0;
              const active = asset === a.key;
              return (
                <button
                  key={a.key}
                  onClick={() => setAsset(a.key)}
                  style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                    border: active ? 'none' : `1px solid rgba(255,255,255,0.1)`,
                    background: active ? `linear-gradient(135deg, ${a.color}cc, ${a.color}66)` : 'rgba(255,255,255,0.03)',
                    color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                    fontFamily: 'var(--font-fira)', fontSize: 12, fontWeight: 500,
                    transition: 'all 0.15s',
                    boxShadow: active ? `0 0 16px ${a.color}50` : 'none',
                  }}
                >
                  {COIN_LOGOS[a.key] ? (
                    <img src={COIN_LOGOS[a.key]} alt={a.key} width={16} height={16} style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span style={{ fontSize: 13 }}>✦</span>
                  )}
                  <span>{a.key}</span>
                  {cnt > 0 && <span style={{ fontSize: 10, color: active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)', marginLeft: 2 }}>{cnt}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── TIMEFRAME + SUBTYPE FILTERS ──────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Timeframe */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 8 }}>
              Timeframe
            </div>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
              {TIMEFRAMES.map((tf) => {
                const cnt = tfCount[tf.key] ?? 0;
                const active = timeframe === tf.key;
                return (
                  <button
                    key={tf.key}
                    onClick={() => setTimeframe(tf.key)}
                    style={{
                      flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
                      border: active ? 'none' : '1px solid rgba(255,255,255,0.08)',
                      background: active ? 'linear-gradient(135deg,#6633ff,#2545f6)' : 'rgba(255,255,255,0.02)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                      fontFamily: 'var(--font-fira)', fontSize: 11,
                      transition: 'all 0.15s',
                      boxShadow: active ? '0 0 14px rgba(102,51,255,0.4)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{tf.icon}</span>
                    <span>{tf.label}</span>
                    {cnt > 0 && active && <span style={{ fontSize: 9, background: 'rgba(255,255,255,0.2)', padding: '1px 5px', borderRadius: 4 }}>{cnt}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtype */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 8 }}>
              Type
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {SUBTYPES.map((s) => {
                const active = subtype === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSubtype(s.key)}
                    style={{
                      flexShrink: 0, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                      border: active ? 'none' : '1px solid rgba(255,255,255,0.08)',
                      background: active ? 'linear-gradient(135deg,#de3fbc,#6633ff)' : 'rgba(255,255,255,0.02)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                      fontFamily: 'var(--font-fira)', fontSize: 11,
                      transition: 'all 0.15s',
                      boxShadow: active ? '0 0 14px rgba(222,63,188,0.35)' : 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── TABS + RESULTS HEADER ────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              { key: 'markets', label: loading ? 'LOADING...' : `ALL MARKETS (${displayed.length})` },
              { key: 'history', label: `HISTORY${history.length > 0 ? ` (${history.length})` : ''}` },
              { key: 'mybets',  label: `MY BETS${myBets.length > 0 ? ` (${myBets.length})` : ''}` },
            ] as const).map((t) => (
              <button key={t.key} onClick={() => {
                setTab(t.key);
                if (t.key === 'mybets' && publicKey) {
                  try {
                    const key = `magicbet_bets_${publicKey.toString()}`;
                    setMyBets(JSON.parse(localStorage.getItem(key) || '[]'));
                  } catch {}
                }
              }} style={{
                fontFamily: 'var(--font-fira)', fontSize: 11, letterSpacing: '0.1em',
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tab === t.key ? 'rgba(102,51,255,0.25)' : 'transparent',
                color: tab === t.key ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                outline: tab === t.key ? '1px solid rgba(102,51,255,0.4)' : 'none',
              }}>
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={load} style={{
            fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 8px', borderRadius: 6,
          }}>↻ REFRESH</button>
        </div>

        {/* ── MY BETS ──────────────────────────────────────────────────────── */}
        {tab === 'mybets' && (
          myBets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                {publicKey ? 'NO BETS YET' : 'CONNECT WALLET'}
              </div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
                {publicKey ? 'PLACE YOUR FIRST PRIVATE BET' : 'TO SEE YOUR BETS'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {myBets.map((b) => (
                <a key={b.marketId} href={`/market/${b.marketId}`} style={{ textDecoration: 'none' }}>
                  <div className="glass" style={{ borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: b.outcome === 1 ? 'rgba(89,224,157,0.1)' : 'rgba(222,63,188,0.1)',
                      border: `1px solid ${b.outcome === 1 ? 'rgba(89,224,157,0.3)' : 'rgba(222,63,188,0.3)'}`,
                      fontFamily: 'var(--font-unbounded)', fontWeight: 900, fontSize: 13,
                      color: b.outcome === 1 ? '#59e09d' : '#de3fbc',
                    }}>
                      {b.outcome === 1 ? 'YES' : 'NO'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-lexend)', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.question}
                      </div>
                      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
                        🔒 HIDDEN IN INTEL TDX TEE · {new Date(b.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 800, fontSize: 15, color: '#fff' }}>{b.amount} SOL</div>
                      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginTop: 2 }}>PRIVATE BET</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )
        )}

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        {tab === 'history' && (
          history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📜</div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                NO CLOSED MARKETS YET
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.map((m) => {
                const pool = Number(m.totalYes) + Number(m.totalNo);
                const status = m.resolved
                  ? (m.winningOutcome === 1 ? 'YES WON' : m.winningOutcome === 2 ? 'NO WON' : 'RESOLVED')
                  : 'EXPIRED';
                const statusColor = m.resolved
                  ? (m.winningOutcome === 1 ? '#59e09d' : m.winningOutcome === 2 ? '#de3fbc' : '#a78bfa')
                  : 'rgba(255,255,255,0.25)';
                return (
                  <a key={m.marketId} href={`/market/${m.marketId}`} style={{ textDecoration: 'none' }}>
                    <div className="glass" style={{
                      borderRadius: 12, padding: '12px 16px',
                      display: 'flex', alignItems: 'center', gap: 14,
                      opacity: 0.7, cursor: 'pointer',
                    }}>
                      <div style={{
                        flexShrink: 0, fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.1em',
                        padding: '3px 8px', borderRadius: 4,
                        background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
                        color: statusColor, minWidth: 72, textAlign: 'center',
                      }}>
                        {status}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-lexend)', fontSize: 13, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.question}
                      </div>
                      <div style={{ flexShrink: 0, fontFamily: 'var(--font-fira)', fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'right' }}>
                        {pool > 0 ? `${lamportsToSol(pool).toFixed(2)} SOL` : '—'}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )
        )}

        {/* ── MARKET GRID ──────────────────────────────────────────────────── */}
        {tab === 'markets' && (
          loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {[...Array(9)].map((_, i) => (
                <div key={i} className="glass" style={{ borderRadius: 16, height: 160, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>
                {markets.length === 0 ? '🔮' : '🔍'}
              </div>
              <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 18, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
                {markets.length === 0 ? 'No Markets Found' : 'No Results'}
              </div>
              <div style={{ fontFamily: 'var(--font-fira)', fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
                {markets.length === 0 ? 'RUN: npm run seed' : 'TRY CLEARING FILTERS'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {displayed.map((m) => <MarketCard key={m.marketId} market={m} />)}
            </div>
          )
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 64, paddingTop: 24, display: 'flex', justifyContent: 'center', gap: 32 }}>
          {[
            { label: 'MagicBlock PER', color: '#6633ff' },
            { label: 'Pyth Oracle',    color: '#de3fbc' },
            { label: 'Intel TDX TEE',  color: '#59e09d' },
            { label: 'Solana Devnet',  color: '#9945ff' },
          ].map((f) => (
            <span key={f.label} style={{ fontFamily: 'var(--font-fira)', fontSize: 10, letterSpacing: '0.12em', color: f.color, opacity: 0.6 }}>
              {f.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color = '#fff' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 700, fontSize: 14, color }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-fira)', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
