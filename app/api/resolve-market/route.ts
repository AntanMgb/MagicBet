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

export async function POST(req: Request) {
  try {
    const { marketId, outcome } = await req.json();
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
    const manualOutcome = outcome ? outcome : null; // 1=YES, 2=NO

    await (program.methods as any)
      .resolveMarket(new BN(marketId), null, manualOutcome ?? null)
      .accounts({ resolver: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
      .rpc();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
