import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import idl from '@/lib/magicbet-idl.json';

function loadKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error('SOLANA_KEYPAIR env variable not set');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

/** Format a price for use in market questions */
function fmtPrice(p: number): string {
  if (p >= 10000) return `$${Math.round(p).toLocaleString('en-US')}`;
  if (p >= 1000)  return `$${Math.round(p).toLocaleString('en-US')}`;
  if (p >= 100)   return `$${p.toFixed(1)}`;
  if (p >= 10)    return `$${p.toFixed(2)}`;
  if (p >= 1)     return `$${p.toFixed(3)}`;
  if (p >= 0.01)  return `$${p.toFixed(4)}`;
  return          `$${p.toFixed(6)}`;
}

// 17 coins × 7 targets = 119 price-target markets per timeframe
const COINS = [
  { symbol: 'BTC',    id: 'bitcoin' },
  { symbol: 'ETH',    id: 'ethereum' },
  { symbol: 'SOL',    id: 'solana' },
  { symbol: 'XRP',    id: 'ripple' },
  { symbol: 'BNB',    id: 'binancecoin' },
  { symbol: 'DOGE',   id: 'dogecoin' },
  { symbol: 'PEPE',   id: 'pepe' },
  { symbol: 'WIF',    id: 'dogwifhat' },
  { symbol: 'BONK',   id: 'bonk' },
  { symbol: 'LINK',   id: 'chainlink' },
  { symbol: 'AVAX',   id: 'avalanche-2' },
  { symbol: 'SUI',    id: 'sui' },
  { symbol: 'APT',    id: 'aptos' },
  { symbol: 'TRX',    id: 'tron' },
  { symbol: 'JUP',    id: 'jupiter-exchange-solana' },
  { symbol: 'RENDER', id: 'render-token' },
  { symbol: 'INJ',    id: 'injective-protocol' },
];

// ID scheme: 10^15 + tf_idx*10^12 + slot*1000 + coin_idx*10 + target_idx
// slot*1000 gives room for up to 999 sub-IDs (17 coins × 7 = 119 used)
// No collision with refresh-markets (template*10^12 + slot, max ~100*10^12 = 10^14)
const TIMEFRAMES = [
  {
    // Tight bands for 5-min — ±0.5%, ±1%, ±2%
    key: '5m',  label: '5 minutes', seconds: 5 * 60,
    tfIdx: 0,
    pcts: [0.5, 1, 2],
  },
  {
    // Slightly wider for 15-min — ±1%, ±2%, ±4%
    key: '15m', label: '15 minutes', seconds: 15 * 60,
    tfIdx: 1,
    pcts: [1, 2, 4],
  },
  {
    // 1-hour bands — ±2%, ±3%, ±6%
    key: '1h',  label: '1 hour', seconds: 60 * 60,
    tfIdx: 2,
    pcts: [2, 3, 6],
  },
  {
    key: '4h',  label: '4 hours', seconds: 4 * 60 * 60,
    tfIdx: 3,
    pcts: [5, 8, 15],
  },
  {
    key: '1d',  label: '24 hours', seconds: 24 * 60 * 60,
    tfIdx: 4,
    pcts: [8, 15, 25],
  },
];

const BASE = BigInt('1000000000000000'); // 10^15

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tfKey = searchParams.get('tf'); // optional: 5m | 15m | 1h | 4h | 1d

    const payer = loadKeypair();
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(payer)); return txs; },
    };
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(idl as never, provider);

    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 50_000_000) {
      return NextResponse.json({ ok: false, error: 'Low balance', balance: balance / 1e9 }, { status: 503 });
    }

    // Fetch all coin prices in one CoinGecko call
    const coinIds = COINS.map(c => c.id).join(',');
    const priceRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' } as any
    );
    if (!priceRes.ok) throw new Error(`CoinGecko failed: ${priceRes.status}`);
    const prices: Record<string, { usd: number }> = await priceRes.json();

    const now = Math.floor(Date.now() / 1000);
    let created = 0;
    let skipped = 0;

    const activeTfs = tfKey
      ? TIMEFRAMES.filter(tf => tf.key === tfKey)
      : TIMEFRAMES;

    for (const tf of activeTfs) {
      const slot = Math.floor(now / tf.seconds);
      // Build current + next slot markets for this timeframe
      for (const slotOffset of [0, 1]) {
        const s = slot + slotOffset;
        const deadline = (s + 1) * tf.seconds;
        if (deadline <= now) continue;

        const markets: { id: bigint; question: string }[] = [];

        for (let ci = 0; ci < COINS.length; ci++) {
          const coin = COINS[ci];
          const price = prices[coin.id]?.usd;
          if (!price) continue;

          const idBase = BASE
            + BigInt(tf.tfIdx) * BigInt('1000000000000')   // 10^12 per timeframe
            + BigInt(s) * BigInt(1000)
            + BigInt(ci * 10);

          // Target 0: directional — close above current price
          markets.push({
            id: idBase + BigInt(0),
            question: `Will ${coin.symbol} close above ${fmtPrice(price)} in the next ${tf.label}?`,
          });

          // Targets 1-3: bull (+pct%)
          tf.pcts.forEach((pct, pi) => {
            const target = price * (1 + pct / 100);
            markets.push({
              id: idBase + BigInt(1 + pi),
              question: `Will ${coin.symbol} hit ${fmtPrice(target)} (+${pct}%) in ${tf.label}?`,
            });
          });

          // Targets 4-6: bear (-pct%)
          tf.pcts.forEach((pct, pi) => {
            const target = price * (1 - pct / 100);
            markets.push({
              id: idBase + BigInt(4 + pi),
              question: `Will ${coin.symbol} drop below ${fmtPrice(target)} (-${pct}%) in ${tf.label}?`,
            });
          });
        }

        // Batch-check existence
        const pdas = markets.map(m => getMarketPda(m.id));
        const infos = await connection.getMultipleAccountsInfo(pdas);

        // Create missing markets
        for (let i = 0; i < markets.length; i++) {
          if (infos[i] !== null) { skipped++; continue; }

          const m = markets[i];
          try {
            await (program.methods as any)
              .createMarket(new BN(m.id.toString()), m.question, new BN(deadline), null, null, 2)
              .accounts({
                creator: payer.publicKey,
                market: pdas[i],
                systemProgram: SystemProgram.programId,
              })
              .rpc();
            created++;
          } catch {
            skipped++;
          }
        }

        // Close previous slot to reclaim rent (batch check, then close)
        if (slotOffset === 0) {
          const prevS = slot - 1;
          const prevIds: bigint[] = [];
          for (let ci = 0; ci < COINS.length; ci++) {
            const idBase = BASE
              + BigInt(tf.tfIdx) * BigInt('1000000000000')
              + BigInt(prevS) * BigInt(1000)
              + BigInt(ci * 10);
            for (let ti = 0; ti < 7; ti++) prevIds.push(idBase + BigInt(ti));
          }
          const prevPdas = prevIds.map(id => getMarketPda(id));
          const prevInfos = await connection.getMultipleAccountsInfo(prevPdas);
          for (let i = 0; i < prevIds.length; i++) {
            if (prevInfos[i] === null) continue;
            try {
              await (program.methods as any)
                .closeMarket(new BN(prevIds[i].toString()))
                .accounts({ creator: payer.publicKey, market: prevPdas[i] })
                .rpc();
            } catch { /* not closeable yet */ }
          }
        }
      }
    }

    return NextResponse.json({ ok: true, created, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
