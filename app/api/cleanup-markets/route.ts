import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import idl from '@/lib/magicbet-idl.json';

function loadKeypair(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error('SOLANA_KEYPAIR env variable not set');
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

export const maxDuration = 60;

// Close up to N expired empty markets per call to stay within rate limits
const MAX_PER_RUN = 30;

export async function GET() {
  try {
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
    const all = await (program.account as any).market.all();

    const closeable = all
      .filter((m: any) =>
        m.account.deadline.toNumber() < now &&
        m.account.totalYes.toNumber() === 0 &&
        m.account.totalNo.toNumber() === 0 &&
        m.account.creator.equals(payer.publicKey)
      )
      .slice(0, MAX_PER_RUN);

    let closed = 0;
    for (const m of closeable) {
      try {
        await (program.methods as any)
          .closeMarket(m.account.marketId)
          .accounts({ creator: payer.publicKey, market: m.publicKey })
          .rpc();
        closed++;
      } catch {
        // skip if not closeable
      }
    }

    const remaining = all.filter((m: any) =>
      m.account.deadline.toNumber() < now &&
      m.account.totalYes.toNumber() === 0 &&
      m.account.totalNo.toNumber() === 0
    ).length - closed;

    return NextResponse.json({ ok: true, closed, remaining: Math.max(0, remaining) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
