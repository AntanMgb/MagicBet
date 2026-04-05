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

function endOfDay(daysFromNow: number): number {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

function endOfWeek(): number {
  const d = new Date();
  const daysUntilSunday = 7 - d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

function endOfMonth(): number {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 0); // last day of current month
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

function endOfQuarter(): number {
  const d = new Date();
  const month = d.getUTCMonth();
  const quarterEndMonth = Math.floor(month / 3) * 3 + 2; // 2, 5, 8, 11
  d.setUTCMonth(quarterEndMonth + 1, 0);
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

function endOfYear(): number {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear(), 11, 31);
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

// Fixed IDs in range 500_000_000_000_000+ to avoid collision with short-term markets
// Each template has a unique stable ID so we don't recreate on every call
const templates: { id: bigint; q: string; deadline: () => number }[] = [
  // ── BTC weekly price targets ──────────────────────────────────────────
  { id: BigInt(500_001), q: 'Will BTC hit $70,000 this week?',   deadline: endOfWeek },
  { id: BigInt(500_002), q: 'Will BTC hit $75,000 this week?',   deadline: endOfWeek },
  { id: BigInt(500_003), q: 'Will BTC hit $80,000 this week?',   deadline: endOfWeek },
  { id: BigInt(500_004), q: 'Will BTC dip below $60,000 this week?', deadline: endOfWeek },
  { id: BigInt(500_005), q: 'Will BTC dip below $55,000 this week?', deadline: endOfWeek },

  // ── BTC monthly price targets ─────────────────────────────────────────
  { id: BigInt(501_001), q: 'Will BTC hit $75,000 this month?',  deadline: endOfMonth },
  { id: BigInt(501_002), q: 'Will BTC hit $80,000 this month?',  deadline: endOfMonth },
  { id: BigInt(501_003), q: 'Will BTC hit $85,000 this month?',  deadline: endOfMonth },
  { id: BigInt(501_004), q: 'Will BTC hit $90,000 this month?',  deadline: endOfMonth },
  { id: BigInt(501_005), q: 'Will BTC hit $100,000 this month?', deadline: endOfMonth },
  { id: BigInt(501_006), q: 'Will BTC dip below $60,000 this month?', deadline: endOfMonth },
  { id: BigInt(501_007), q: 'Will BTC dip below $50,000 this month?', deadline: endOfMonth },

  // ── BTC end-of-year milestone ─────────────────────────────────────────
  { id: BigInt(502_001), q: 'Will BTC hit all-time high ($109k) by June 30?',   deadline: () => Math.floor(new Date('2026-06-30T23:59:59Z').getTime() / 1000) },
  { id: BigInt(502_002), q: 'Will BTC hit $150,000 by December 31, 2026?',      deadline: endOfYear },
  { id: BigInt(502_003), q: 'Will BTC hit $100,000 by December 31, 2026?',      deadline: endOfYear },
  { id: BigInt(502_004), q: 'Will BTC dip below $40,000 by December 31, 2026?', deadline: endOfYear },

  // ── ETH weekly price targets ──────────────────────────────────────────
  { id: BigInt(510_001), q: 'Will ETH hit $2,000 this week?',    deadline: endOfWeek },
  { id: BigInt(510_002), q: 'Will ETH hit $2,500 this week?',    deadline: endOfWeek },
  { id: BigInt(510_003), q: 'Will ETH dip below $1,200 this week?', deadline: endOfWeek },

  // ── ETH monthly price targets ─────────────────────────────────────────
  { id: BigInt(511_001), q: 'Will ETH hit $2,000 this month?',   deadline: endOfMonth },
  { id: BigInt(511_002), q: 'Will ETH hit $2,500 this month?',   deadline: endOfMonth },
  { id: BigInt(511_003), q: 'Will ETH hit $3,000 this month?',   deadline: endOfMonth },
  { id: BigInt(511_004), q: 'Will ETH hit $3,500 this month?',   deadline: endOfMonth },
  { id: BigInt(511_005), q: 'Will ETH dip below $1,200 this month?', deadline: endOfMonth },
  { id: BigInt(511_006), q: 'Will ETH reach $5,000 by December 31, 2026?',     deadline: endOfYear },
  { id: BigInt(511_007), q: 'Will ETH dip to $1,000 by December 31, 2026?',    deadline: endOfYear },

  // ── SOL weekly/monthly price targets ─────────────────────────────────
  { id: BigInt(520_001), q: 'Will SOL hit $180 this week?',      deadline: endOfWeek },
  { id: BigInt(520_002), q: 'Will SOL hit $200 this week?',      deadline: endOfWeek },
  { id: BigInt(520_003), q: 'Will SOL dip below $100 this week?', deadline: endOfWeek },
  { id: BigInt(521_001), q: 'Will SOL hit $200 this month?',     deadline: endOfMonth },
  { id: BigInt(521_002), q: 'Will SOL hit $250 this month?',     deadline: endOfMonth },
  { id: BigInt(521_003), q: 'Will SOL hit $300 this month?',     deadline: endOfMonth },
  { id: BigInt(521_004), q: 'Will SOL dip below $80 this month?', deadline: endOfMonth },
  { id: BigInt(521_005), q: 'Will SOL hit $160 by December 31, 2026?',          deadline: endOfYear },
  { id: BigInt(521_006), q: 'Will SOL dip to $40 by December 31, 2026?',        deadline: endOfYear },

  // ── XRP weekly/monthly ────────────────────────────────────────────────
  { id: BigInt(530_001), q: 'Will XRP hit $2.00 this week?',     deadline: endOfWeek },
  { id: BigInt(530_002), q: 'Will XRP dip below $1.00 this week?', deadline: endOfWeek },
  { id: BigInt(531_001), q: 'Will XRP hit $2.00 this month?',    deadline: endOfMonth },
  { id: BigInt(531_002), q: 'Will XRP hit $3.00 this month?',    deadline: endOfMonth },
  { id: BigInt(531_003), q: 'Will XRP reach $5.00 by December 31, 2026?',       deadline: endOfYear },
  { id: BigInt(531_004), q: 'Will XRP dip to $0.60 by December 31, 2026?',      deadline: endOfYear },

  // ── BNB weekly/monthly ────────────────────────────────────────────────
  { id: BigInt(540_001), q: 'Will BNB hit $700 this week?',      deadline: endOfWeek },
  { id: BigInt(540_002), q: 'Will BNB hit $800 this month?',     deadline: endOfMonth },
  { id: BigInt(540_003), q: 'Will BNB dip below $400 this month?', deadline: endOfMonth },

  // ── Memecoins weekly ──────────────────────────────────────────────────
  { id: BigInt(550_001), q: 'Will DOGE hit $0.30 this week?',    deadline: endOfWeek },
  { id: BigInt(550_002), q: 'Will DOGE hit $0.40 this month?',   deadline: endOfMonth },
  { id: BigInt(550_003), q: 'Will PEPE hit ATH this month?',     deadline: endOfMonth },
  { id: BigInt(550_004), q: 'Will WIF hit $3.00 this month?',    deadline: endOfMonth },

  // ── Weekly directional (longer) ───────────────────────────────────────
  { id: BigInt(560_001), q: 'Will BTC close this week higher than last week?',    deadline: endOfWeek },
  { id: BigInt(560_002), q: 'Will ETH close this week higher than last week?',    deadline: endOfWeek },
  { id: BigInt(560_003), q: 'Will SOL close this week higher than last week?',    deadline: endOfWeek },
  { id: BigInt(560_004), q: 'Will the crypto market (BTC) end this month higher?', deadline: endOfMonth },

  // ── Institutional / event markets (manual resolve) ───────────────────
  { id: BigInt(570_001), q: 'Will another S&P 500 company buy BTC by June 30?',  deadline: () => Math.floor(new Date('2026-06-30T23:59:59Z').getTime() / 1000) },
  { id: BigInt(570_002), q: 'Will MicroStrategy sell any BTC by June 30?',        deadline: () => Math.floor(new Date('2026-06-30T23:59:59Z').getTime() / 1000) },
  { id: BigInt(570_003), q: 'Will there be a major crypto hack (>$100M) this month?', deadline: endOfMonth },
  { id: BigInt(570_004), q: 'Will Kraken IPO by December 31, 2026?',              deadline: endOfYear },
  { id: BigInt(570_005), q: 'Will a new country add BTC to its reserves by June 30?', deadline: () => Math.floor(new Date('2026-06-30T23:59:59Z').getTime() / 1000) },

  // ── Crypto dominance & market structure ──────────────────────────────
  { id: BigInt(580_001), q: 'Will BTC dominance stay above 50% this month?',     deadline: endOfMonth },
  { id: BigInt(580_002), q: 'Will total crypto market cap hit $4T this month?',  deadline: endOfMonth },
  { id: BigInt(580_003), q: 'Will BTC dominance hit 60% by December 31, 2026?',  deadline: endOfYear },
];

export const maxDuration = 60;

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
    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 50_000_000) {
      return NextResponse.json({ ok: false, error: 'Low balance', balance: balance / 1e9 }, { status: 503 });
    }

    let created = 0;
    let skipped = 0;
    let expired = 0;

    for (const tmpl of templates) {
      const deadline = tmpl.deadline();

      // Skip if deadline already passed
      if (deadline <= now) { expired++; continue; }

      const marketPda = getMarketPda(tmpl.id);

      // Check if already exists
      const info = await connection.getAccountInfo(marketPda);
      if (info !== null) { skipped++; continue; }

      try {
        await (program.methods as any)
          .createMarket(new BN(tmpl.id.toString()), tmpl.q, new BN(deadline), null, null, 2)
          .accounts({ creator: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
          .rpc();
        created++;
      } catch (e: any) {
        // Already exists or other error — skip
        skipped++;
      }
    }

    return NextResponse.json({ ok: true, created, skipped, expired, total: templates.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
