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
    // bucket=N processes only templates [N*10 .. N*10+9] to fit within 10s on Hobby plan
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

    const allAccounts = await (program.account as any).market.all();
    const now = Math.floor(Date.now() / 1000);

    const activeQuestions = new Set<string>();
    for (const { account } of allAccounts) {
      if (account.resolved || Number(account.deadline) <= now) continue;
      if (SHORT_TERM.some(t => t.q === account.question)) {
        activeQuestions.add(account.question);
      }
    }

    let missing = SHORT_TERM.filter(t => !activeQuestions.has(t.q));
    if (bucket !== null) missing = missing.slice(bucket * 10, bucket * 10 + 10);

    let created = 0;
    const errors: string[] = [];

    for (const tmpl of missing) {
      try {
        const marketId = BigInt(now) * BigInt(100000) + BigInt(Math.floor(Math.random() * 99999));
        const deadline = now + tmpl.mins * 60;
        await (program.methods as any)
          .createMarket(new BN(marketId.toString()), tmpl.q, new BN(deadline), null, null, 2)
          .accounts({ creator: payer.publicKey, market: getMarketPda(marketId), systemProgram: SystemProgram.programId })
          .rpc();
        created++;
      } catch (e: any) {
        errors.push(`${tmpl.q.slice(0, 40)}: ${e?.message?.slice(0, 60)}`);
      }
    }

    return NextResponse.json({ created, skipped: SHORT_TERM.length - missing.length, errors });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
