import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import idl from '@/lib/magicbet-idl.json';

function loadKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error('SOLANA_KEYPAIR env variable not set');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

const DEVNET_RPC  = 'https://api.devnet.solana.com';
const PROGRAM_ID  = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

// Short-term market templates that auto-refresh when expired
const SHORT_TERM = [
  // 5 minutes
  { q: 'Will BTC be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will ETH be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will SOL be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will XRP be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will BNB be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will BONK be Up (YES) or Down (NO) in the next 5 minutes?',         mins: 5 },
  { q: 'Will WIF be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will DOGE be Up (YES) or Down (NO) in the next 5 minutes?',         mins: 5 },
  { q: 'Will PEPE be Up (YES) or Down (NO) in the next 5 minutes?',         mins: 5 },
  { q: 'Will LINK be Up (YES) or Down (NO) in the next 5 minutes?',         mins: 5 },
  { q: 'Will AVAX be Up (YES) or Down (NO) in the next 5 minutes?',         mins: 5 },
  { q: 'Will SUI be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will APT be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will JUP be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will TRX be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  { q: 'Will RENDER be Up (YES) or Down (NO) in the next 5 minutes?',       mins: 5 },
  { q: 'Will INJ be Up (YES) or Down (NO) in the next 5 minutes?',          mins: 5 },
  // 15 minutes
  { q: 'Will BTC be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will ETH be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will SOL be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will XRP be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will BNB be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will BONK be Up (YES) or Down (NO) in the next 15 minutes?',        mins: 15 },
  { q: 'Will DOGE be Up (YES) or Down (NO) in the next 15 minutes?',        mins: 15 },
  { q: 'Will PEPE be Up (YES) or Down (NO) in the next 15 minutes?',        mins: 15 },
  { q: 'Will WIF (dogwifhat) be Up (YES) or Down (NO) in the next 15 minutes?', mins: 15 },
  { q: 'Will SUI be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will LINK be Up (YES) or Down (NO) in the next 15 minutes?',        mins: 15 },
  { q: 'Will AVAX be Up (YES) or Down (NO) in the next 15 minutes?',        mins: 15 },
  { q: 'Will JUP be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will TRX be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will APT be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  { q: 'Will RENDER be Up (YES) or Down (NO) in the next 15 minutes?',      mins: 15 },
  { q: 'Will INJ be Up (YES) or Down (NO) in the next 15 minutes?',         mins: 15 },
  // 1 hour
  { q: 'Will BTC be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will ETH be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will SOL be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will BNB be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will XRP be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will BONK be Up (YES) or Down (NO) in the next 1 hour?',            mins: 60 },
  { q: 'Will WIF be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will DOGE be Up (YES) or Down (NO) in the next 1 hour?',            mins: 60 },
  { q: 'Will LINK be Up (YES) or Down (NO) in the next 1 hour?',            mins: 60 },
  { q: 'Will PEPE be Up (YES) or Down (NO) in the next 1 hour?',            mins: 60 },
  { q: 'Will AVAX be Up (YES) or Down (NO) in the next 1 hour?',            mins: 60 },
  { q: 'Will SUI be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will APT be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will JUP be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  { q: 'Will RENDER be Up (YES) or Down (NO) in the next 1 hour?',          mins: 60 },
  { q: 'Will INJ be Up (YES) or Down (NO) in the next 1 hour?',             mins: 60 },
  // 4 hours
  { q: 'Will BTC be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will ETH be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will SOL be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will BNB be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will XRP be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will BONK be Up (YES) or Down (NO) in the next 4 hours?',           mins: 240 },
  { q: 'Will WIF be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will DOGE be Up (YES) or Down (NO) in the next 4 hours?',           mins: 240 },
  { q: 'Will PEPE be Up (YES) or Down (NO) in the next 4 hours?',           mins: 240 },
  { q: 'Will SUI be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will AVAX be Up (YES) or Down (NO) in the next 4 hours?',           mins: 240 },
  { q: 'Will LINK be Up (YES) or Down (NO) in the next 4 hours?',           mins: 240 },
  { q: 'Will JUP be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will TRX be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will APT be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  { q: 'Will RENDER be Up (YES) or Down (NO) in the next 4 hours?',         mins: 240 },
  { q: 'Will INJ be Up (YES) or Down (NO) in the next 4 hours?',            mins: 240 },
  // 24 hours (today)
  { q: 'Will BTC be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will ETH be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will SOL be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will XRP be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will BNB be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will DOGE be Up (YES) or Down (NO) today?',                          mins: 1440 },
  { q: 'Will BONK be Up (YES) or Down (NO) today?',                          mins: 1440 },
  { q: 'Will WIF be Up (YES) or Down (NO) today?',                           mins: 1440 },
  { q: 'Will PEPE be Up (YES) or Down (NO) today?',                          mins: 1440 },
  { q: 'Will AVAX be Up (YES) or Down (NO) today?',                          mins: 1440 },
];

function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const bucket = url.searchParams.has('bucket') ? parseInt(url.searchParams.get('bucket')!) : null;

    const payer = loadKeypair();
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: any) => { tx.partialSign(payer); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(payer)); return txs; },
    };
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(idl as never, provider);

    const now = Math.floor(Date.now() / 1000);

    // Check creator balance — need at least 0.01 SOL per market
    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 10_000_000) {
      return NextResponse.json({
        ok: false,
        error: 'Creator wallet low on SOL',
        balance: balance / 1e9,
        address: payer.publicKey.toBase58(),
      }, { status: 503 });
    }

    const templates = bucket !== null
      ? SHORT_TERM.slice(bucket * 10, bucket * 10 + 10)
      : SHORT_TERM;

    let created = 0;
    let closed = 0;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      const templateIndex = bucket !== null ? bucket * 10 + i : i;
      const slotSecs = tmpl.mins * 60;
      const slot = Math.floor(now / slotSecs);
      const marketId = BigInt(templateIndex + 1) * BigInt(10 ** 12) + BigInt(slot);
      const deadline = (slot + 1) * slotSecs;

      // Close previous slot's market to reclaim rent (keeps wallet funded)
      const prevMarketId = BigInt(templateIndex + 1) * BigInt(10 ** 12) + BigInt(slot - 1);
      const prevPda = getMarketPda(prevMarketId);
      try {
        const prevInfo = await connection.getAccountInfo(prevPda);
        if (prevInfo !== null) {
          await (program.methods as any)
            .closeMarket(new BN(prevMarketId.toString()))
            .accounts({ creator: payer.publicKey, market: prevPda })
            .rpc();
          closed++;
        }
      } catch {
        // Not closeable yet or already closed — skip
      }

      // Create current slot's market
      try {
        await (program.methods as any)
          .createMarket(new BN(marketId.toString()), tmpl.q, new BN(deadline), null, null, 2)
          .accounts({ creator: payer.publicKey, market: getMarketPda(marketId), systemProgram: SystemProgram.programId })
          .rpc();
        created++;
      } catch {
        // Market already exists for this slot — skip silently
      }

      // Pre-create NEXT slot's market to eliminate the gap between slots
      const nextSlot = slot + 1;
      const nextMarketId = BigInt(templateIndex + 1) * BigInt(10 ** 12) + BigInt(nextSlot);
      const nextDeadline = (nextSlot + 1) * slotSecs;
      try {
        await (program.methods as any)
          .createMarket(new BN(nextMarketId.toString()), tmpl.q, new BN(nextDeadline), null, null, 2)
          .accounts({ creator: payer.publicKey, market: getMarketPda(nextMarketId), systemProgram: SystemProgram.programId })
          .rpc();
        created++;
      } catch {
        // Already exists — skip
      }
    }

    return NextResponse.json({ ok: true, created, closed, total: templates.length, balance: balance / 1e9 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
