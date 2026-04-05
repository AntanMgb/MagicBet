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

const COIN_ID: Record<string, string> = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  bnb: 'binancecoin',
  xrp: 'ripple',
  bonk: 'bonk',
  wif: 'dogwifhat', dogwifhat: 'dogwifhat',
  doge: 'dogecoin',
  pepe: 'pepe',
  link: 'chainlink',
  avax: 'avalanche-2',
  sui: 'sui',
  apt: 'aptos',
  jup: 'jupiter-exchange-solana',
  trx: 'tron',
  render: 'render-token', rndr: 'render-token',
  inj: 'injective-protocol',
};

function detectCoin(question: string): string | null {
  const s = question.toLowerCase();
  for (const [key, id] of Object.entries(COIN_ID)) {
    if (s.includes(key)) return id;
  }
  return null;
}

/** Parse a dollar target from question: "$75k", "$75,000", "$1,500" */
function parseTargetPrice(question: string): number | null {
  const match = question.match(/\$([\d,]+\.?\d*)\s*(k|K)?/);
  if (!match) return null;
  let num = parseFloat(match[1].replace(/,/g, ''));
  if (match[2]) num *= 1000;
  return num;
}

/** Returns current price in USD from CoinGecko */
async function getCurrentPrice(coinId: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 0 } } as any);
    if (!res.ok) return null;
    const data = await res.json();
    return data[coinId]?.usd ?? null;
  } catch { return null; }
}

/** Returns 1h price change % */
async function getPriceChange1h(coinId: string): Promise<number> {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 0 } } as any);
    if (!res.ok) return (Math.floor(Date.now() / 60000) % 2 === 0) ? 1 : -1;
    const data = await res.json();
    return data.market_data?.price_change_percentage_1h_in_currency?.usd
      ?? data.market_data?.price_change_percentage_24h
      ?? 0;
  } catch { return 0; }
}

function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

export async function POST(req: Request) {
  try {
    const { marketId } = await req.json();
    if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 });

    const payer = loadKeypair();
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(payer)); return txs; },
    };
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(idl as never, provider);
    const marketPda = getMarketPda(BigInt(marketId));

    const marketAccount = await (program.account as any).market.fetch(marketPda);
    if (marketAccount.resolved) return NextResponse.json({ ok: true, already: true });

    const now = Math.floor(Date.now() / 1000);
    if (Number(marketAccount.deadline) > now) {
      return NextResponse.json({ error: 'Market not expired yet' }, { status: 400 });
    }

    const question = marketAccount.question as string;
    const coinId = detectCoin(question);
    if (!coinId) return NextResponse.json({ error: 'Cannot detect coin' }, { status: 400 });

    let outcome: number;

    // Check if this is a price-target market ("hit $X", "above $X", "reach $X", "below $X")
    const targetPrice = parseTargetPrice(question);
    const isAboveTarget = /hit|above|reach|exceed|surpass|over/i.test(question);
    const isBelowTarget = /below|dip|drop|under|fall/i.test(question) && !isAboveTarget;

    if (targetPrice !== null && (isAboveTarget || isBelowTarget)) {
      const currentPrice = await getCurrentPrice(coinId);
      if (currentPrice === null) {
        return NextResponse.json({ error: 'Cannot fetch current price' }, { status: 500 });
      }
      if (isAboveTarget) {
        outcome = currentPrice >= targetPrice ? 1 : 2; // YES if price >= target
      } else {
        outcome = currentPrice <= targetPrice ? 1 : 2; // YES if price <= target
      }
    } else {
      // Up/Down market — use price direction
      const change = await getPriceChange1h(coinId);
      outcome = change >= 0 ? 1 : 2;
    }

    await (program.methods as any)
      .resolveMarket(new BN(marketId), null, outcome)
      .accounts({ resolver: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
      .rpc();

    return NextResponse.json({ ok: true, outcome, question, targetPrice, coinId });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error('[auto-resolve] ERROR:', msg, e?.logs);
    return NextResponse.json({ error: msg, logs: e?.logs ?? [] }, { status: 500 });
  }
}
