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

// Coin name → CoinGecko ID
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

/** Returns positive (price went up) or negative (price went down) change */
async function getPriceDirection(coinId: string): Promise<number> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();
  // Use 1h change for short-term markets, 24h as fallback
  return data.market_data?.price_change_percentage_1h_in_currency?.usd
    ?? data.market_data?.price_change_percentage_24h
    ?? 0;
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

    // Fetch market from chain
    const marketAccount = await (program.account as any).market.fetch(marketPda);
    if (marketAccount.resolved) return NextResponse.json({ ok: true, already: true });

    const now = Math.floor(Date.now() / 1000);
    if (Number(marketAccount.deadline) > now) {
      return NextResponse.json({ error: 'Market not expired yet' }, { status: 400 });
    }

    let outcome: number;

    if (marketAccount.marketType === 2) {
      // Manual/UP-DOWN market: determine from price direction
      const coinId = detectCoin(marketAccount.question);
      if (!coinId) return NextResponse.json({ error: 'Cannot detect coin' }, { status: 400 });

      const change = await getPriceDirection(coinId);
      outcome = change >= 0 ? 1 : 2; // 1=YES(Up), 2=NO(Down)
    } else {
      // Price market: compare targetPrice vs currentPrice from CoinGecko
      const coinId = detectCoin(marketAccount.question) ?? 'bitcoin';
      const change = await getPriceDirection(coinId);
      outcome = change >= 0 ? 1 : 2;
    }

    await (program.methods as any)
      .resolveMarket(new BN(marketId), null, new BN(outcome))
      .accounts({ resolver: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
      .rpc();

    return NextResponse.json({ ok: true, outcome, direction: outcome === 1 ? 'UP' : 'DOWN' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
