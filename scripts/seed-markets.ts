/**
 * Seed script – creates 300+ crypto prediction markets on Solana devnet.
 * Run: npm run seed
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN, Wallet } from '@coral-xyz/anchor';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('4TcWHMB16WRQhG6ccTHdXUZdHthaQRXLWrhLdxbn825A');

const PYTH: Record<string, string> = {
  bitcoin:     'HovQMDrbAgAYPCmaTftQMjWUB5UEQLGVKXcp39HkrMoS',
  ethereum:    'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
  solana:      'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
  binancecoin: 'GwzBgrXb4PG59zjce24SF2b9JXbLEjJJTBkmytuEZj1b',
};

interface M {
  q: string;
  t: 0 | 1 | 2;
  coin?: string;
  price?: number;
  days: number;
}

const MARKETS: M[] = [

  // ══════════════════════════ 5 MINUTES (14) ══════════════════════════════════
  { q:'Will BTC be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will ETH be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will SOL be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will BNB be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will XRP be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will BONK be Up (YES) or Down (NO) in the next 5 minutes?',         t:2, days:5/1440 },
  { q:'Will WIF be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will DOGE be Up (YES) or Down (NO) in the next 5 minutes?',         t:2, days:5/1440 },
  { q:'Will PEPE be Up (YES) or Down (NO) in the next 5 minutes?',         t:2, days:5/1440 },
  { q:'Will LINK be Up (YES) or Down (NO) in the next 5 minutes?',         t:2, days:5/1440 },
  { q:'Will AVAX be Up (YES) or Down (NO) in the next 5 minutes?',         t:2, days:5/1440 },
  { q:'Will SUI be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will APT be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },
  { q:'Will JUP be Up (YES) or Down (NO) in the next 5 minutes?',          t:2, days:5/1440 },

  // ══════════════════════════ 15 MINUTES (14) ═════════════════════════════════
  { q:'Will BTC be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will ETH be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will SOL be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will BNB be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will XRP be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will BONK be Up (YES) or Down (NO) in the next 15 minutes?',        t:2, days:15/1440 },
  { q:'Will DOGE be Up (YES) or Down (NO) in the next 15 minutes?',        t:2, days:15/1440 },
  { q:'Will PEPE be Up (YES) or Down (NO) in the next 15 minutes?',        t:2, days:15/1440 },
  { q:'Will WIF (dogwifhat) be Up (YES) or Down (NO) in the next 15 minutes?', t:2, days:15/1440 },
  { q:'Will SUI be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will LINK be Up (YES) or Down (NO) in the next 15 minutes?',        t:2, days:15/1440 },
  { q:'Will AVAX be Up (YES) or Down (NO) in the next 15 minutes?',        t:2, days:15/1440 },
  { q:'Will JUP be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },
  { q:'Will TRX be Up (YES) or Down (NO) in the next 15 minutes?',         t:2, days:15/1440 },

  // ══════════════════════════ 1 HOUR (16) ═════════════════════════════════════
  { q:'Will BTC be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will ETH be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will SOL be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will BNB be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will XRP be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will BONK be Up (YES) or Down (NO) in the next 1 hour?',            t:2, days:1/24 },
  { q:'Will WIF be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will DOGE be Up (YES) or Down (NO) in the next 1 hour?',            t:2, days:1/24 },
  { q:'Will LINK be Up (YES) or Down (NO) in the next 1 hour?',            t:2, days:1/24 },
  { q:'Will PEPE be Up (YES) or Down (NO) in the next 1 hour?',            t:2, days:1/24 },
  { q:'Will AVAX be Up (YES) or Down (NO) in the next 1 hour?',            t:2, days:1/24 },
  { q:'Will SUI be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will APT be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will JUP be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },
  { q:'Will RENDER be Up (YES) or Down (NO) in the next 1 hour?',          t:2, days:1/24 },
  { q:'Will INJ be Up (YES) or Down (NO) in the next 1 hour?',             t:2, days:1/24 },

  // ══════════════════════════ 4 HOURS (14) ════════════════════════════════════
  { q:'Will BTC be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will ETH be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will SOL be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will BNB be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will XRP be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will BONK be Up (YES) or Down (NO) in the next 4 hours?',           t:2, days:4/24 },
  { q:'Will WIF be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will DOGE be Up (YES) or Down (NO) in the next 4 hours?',           t:2, days:4/24 },
  { q:'Will PEPE be Up (YES) or Down (NO) in the next 4 hours?',           t:2, days:4/24 },
  { q:'Will SUI be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:4/24 },
  { q:'Will AVAX be Up (YES) or Down (NO) in the next 4 hours?',           t:2, days:4/24 },
  { q:'Will LINK be Up (YES) or Down (NO) in the next 4 hours?',           t:2, days:4/24 },
  { q:'Will JUP be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:0.6 },
  { q:'Will TRX be Up (YES) or Down (NO) in the next 4 hours?',            t:2, days:0.6 },

  // ══════════════════════════ DAILY — April 4 (20) ════════════════════════════
  { q:'Bitcoin above $80,000 on April 4, 2026?',    t:0, coin:'bitcoin',     price:80_000,  days:1 },
  { q:'Bitcoin above $82,000 on April 4, 2026?',    t:0, coin:'bitcoin',     price:82_000,  days:1 },
  { q:'Bitcoin above $84,000 on April 4, 2026?',    t:0, coin:'bitcoin',     price:84_000,  days:1 },
  { q:'Bitcoin above $86,000 on April 4, 2026?',    t:0, coin:'bitcoin',     price:86_000,  days:1 },
  { q:'Bitcoin above $88,000 on April 4, 2026?',    t:0, coin:'bitcoin',     price:88_000,  days:1 },
  { q:'Ethereum above $1,600 on April 4, 2026?',    t:0, coin:'ethereum',    price:1_600,   days:1 },
  { q:'Ethereum above $1,700 on April 4, 2026?',    t:0, coin:'ethereum',    price:1_700,   days:1 },
  { q:'Ethereum above $1,800 on April 4, 2026?',    t:0, coin:'ethereum',    price:1_800,   days:1 },
  { q:'Solana above $110 on April 4, 2026?',        t:0, coin:'solana',      price:110,     days:1 },
  { q:'Solana above $120 on April 4, 2026?',        t:0, coin:'solana',      price:120,     days:1 },
  { q:'Solana above $130 on April 4, 2026?',        t:0, coin:'solana',      price:130,     days:1 },
  { q:'BNB above $580 on April 4, 2026?',           t:0, coin:'binancecoin', price:580,     days:1 },
  { q:'BNB above $600 on April 4, 2026?',           t:0, coin:'binancecoin', price:600,     days:1 },
  { q:'XRP above $2.00 today?',                     t:2,                                    days:1 },
  { q:'XRP above $2.50 today?',                     t:2,                                    days:1 },
  { q:'Will DOGE be above $0.15 today?',            t:2,                                    days:1 },
  { q:'Will BONK reach 0.00003 today?',             t:2,                                    days:1 },
  { q:'Will WIF (dogwifhat) hold above $1 today?',  t:2,                                    days:1 },
  { q:'Will Solana daily DEX volume exceed $2B today?', t:2,                                days:1 },
  { q:'Will Bitcoin spot ETF have positive inflows today?', t:2,                            days:1 },

  // ══════════════════════════ WEEKLY — by April 10 (28) ═══════════════════════
  { q:'Will BTC be above $85,000 by April 10, 2026?',    t:0, coin:'bitcoin',     price:85_000, days:7 },
  { q:'Will BTC be above $88,000 by April 10, 2026?',    t:0, coin:'bitcoin',     price:88_000, days:7 },
  { q:'Will BTC be above $90,000 by April 10, 2026?',    t:0, coin:'bitcoin',     price:90_000, days:7 },
  { q:'Will BTC be above $92,000 by April 10, 2026?',    t:0, coin:'bitcoin',     price:92_000, days:7 },
  { q:'Will BTC drop below $78,000 this week?',          t:1, coin:'bitcoin',     price:78_000, days:7 },
  { q:'Will BTC drop below $75,000 this week?',          t:1, coin:'bitcoin',     price:75_000, days:7 },
  { q:'Will ETH be above $1,800 by April 10, 2026?',    t:0, coin:'ethereum',    price:1_800,  days:7 },
  { q:'Will ETH be above $2,000 by April 10, 2026?',    t:0, coin:'ethereum',    price:2_000,  days:7 },
  { q:'Will ETH drop below $1,500 this week?',           t:1, coin:'ethereum',    price:1_500,  days:7 },
  { q:'Will ETH drop below $1,400 this week?',           t:1, coin:'ethereum',    price:1_400,  days:7 },
  { q:'Will SOL be above $130 by April 10, 2026?',      t:0, coin:'solana',      price:130,    days:7 },
  { q:'Will SOL be above $140 by April 10, 2026?',      t:0, coin:'solana',      price:140,    days:7 },
  { q:'Will SOL drop below $100 this week?',             t:1, coin:'solana',      price:100,    days:7 },
  { q:'Will BNB be above $600 by April 10, 2026?',      t:0, coin:'binancecoin', price:600,    days:7 },
  { q:'Will BNB be above $650 by April 10, 2026?',      t:0, coin:'binancecoin', price:650,    days:7 },
  { q:'Will XRP hold above $2.00 this week?',            t:2,                                   days:7 },
  { q:'Will XRP reach $3.00 this week?',                 t:2,                                   days:7 },
  { q:'Will BONK reach new ATH this week?',              t:2,                                   days:7 },
  { q:'Will WIF (dogwifhat) hit $2 this week?',          t:2,                                   days:7 },
  { q:'Will DOGE hold above $0.14 this week?',           t:2,                                   days:7 },
  { q:'Will PEPE hit a new ATH this week?',              t:2,                                   days:7 },
  { q:'Will total crypto market cap hold above $2.5T?',  t:2,                                   days:7 },
  { q:'Will Bitcoin spot ETFs have positive net inflows this week?', t:2,                       days:7 },
  { q:'Will any Solana memecoin 10x this week?',         t:2,                                   days:7 },
  { q:'Will Solana DEX volume beat Ethereum DEX this week?', t:2,                               days:7 },
  { q:'Will crypto total market cap be up this week?',   t:2,                                   days:7 },
  { q:'Will SUI flip AVAX by market cap this week?',     t:2,                                   days:7 },
  { q:'Will JUP (Jupiter) hold above $0.50 this week?',  t:2,                                   days:7 },

  // ══════════════════════════ MONTHLY — April 30 (35) ═════════════════════════
  { q:'Will BTC reach $95,000 by April 30, 2026?',      t:0, coin:'bitcoin',     price:95_000,  days:27 },
  { q:'Will BTC reach $100,000 by April 30, 2026?',     t:0, coin:'bitcoin',     price:100_000, days:27 },
  { q:'Will BTC reach $110,000 by April 30, 2026?',     t:0, coin:'bitcoin',     price:110_000, days:27 },
  { q:'Will BTC reach $120,000 by April 30, 2026?',     t:0, coin:'bitcoin',     price:120_000, days:27 },
  { q:'Will BTC beat its all-time high ($109k) in April 2026?', t:0, coin:'bitcoin', price:109_000, days:27 },
  { q:'Will BTC drop below $70,000 in April 2026?',     t:1, coin:'bitcoin',     price:70_000,  days:27 },
  { q:'Will BTC drop below $65,000 in April 2026?',     t:1, coin:'bitcoin',     price:65_000,  days:27 },
  { q:'Will ETH reach $2,000 by April 30, 2026?',       t:0, coin:'ethereum',    price:2_000,   days:27 },
  { q:'Will ETH reach $2,500 by April 30, 2026?',       t:0, coin:'ethereum',    price:2_500,   days:27 },
  { q:'Will ETH reach $3,000 by April 30, 2026?',       t:0, coin:'ethereum',    price:3_000,   days:27 },
  { q:'Will ETH drop below $1,400 in April 2026?',      t:1, coin:'ethereum',    price:1_400,   days:27 },
  { q:'Will SOL reach $150 by April 30, 2026?',         t:0, coin:'solana',      price:150,     days:27 },
  { q:'Will SOL reach $175 by April 30, 2026?',         t:0, coin:'solana',      price:175,     days:27 },
  { q:'Will SOL reach $200 by April 30, 2026?',         t:0, coin:'solana',      price:200,     days:27 },
  { q:'Will SOL drop below $90 in April 2026?',         t:1, coin:'solana',      price:90,      days:27 },
  { q:'Will BNB reach $700 by April 30, 2026?',         t:0, coin:'binancecoin', price:700,     days:27 },
  { q:'Will BNB reach $750 by April 30, 2026?',         t:0, coin:'binancecoin', price:750,     days:27 },
  { q:'Will XRP hit $3 by April 30, 2026?',             t:2,                                    days:27 },
  { q:'Will XRP hit $4 by April 30, 2026?',             t:2,                                    days:27 },
  { q:'Will BONK reach new ATH in April 2026?',         t:2,                                    days:27 },
  { q:'Will WIF hit $3 in April 2026?',                 t:2,                                    days:27 },
  { q:'Will DOGE reach $0.30 in April 2026?',           t:2,                                    days:27 },
  { q:'Will PEPE reach new ATH in April 2026?',         t:2,                                    days:27 },
  { q:'Will any memecoin flip DOGE by market cap in April?', t:2,                               days:27 },
  { q:'Will total DeFi TVL exceed $150B by April 30?',  t:2,                                    days:27 },
  { q:'Will Solana Firedancer launch on mainnet in April 2026?', t:2,                           days:27 },
  { q:'Will Solana maintain top-5 market cap through May 1?', t:2,                              days:27 },
  { q:'Will the Ethereum Pectra upgrade complete without a critical rollback?', t:2,            days:27 },
  { q:'Will total crypto market cap exceed $3 trillion by May 1, 2026?', t:2,                  days:27 },
  { q:'Will Coinbase list a Solana memecoin in April 2026?', t:2,                               days:27 },
  { q:'Will SUI flip Avalanche in market cap by May 2026?', t:2,                                days:27 },
  { q:'Will Bitcoin Lightning Network capacity exceed 6,000 BTC by May?', t:2,                 days:27 },
  { q:'Will Ethereum staking ratio exceed 30% by May 2026?', t:2,                               days:27 },
  { q:'Will Uniswap v4 launch on mainnet in April 2026?', t:2,                                  days:27 },
  { q:'Will Solana have zero network outages in April 2026?', t:2,                              days:27 },

  // ══════════════════════════ YEARLY — end of 2026 (25) ════════════════════════
  { q:'Will BTC reach $150,000 by end of 2026?',        t:0, coin:'bitcoin',  price:150_000, days:272 },
  { q:'Will BTC reach $200,000 by end of 2026?',        t:0, coin:'bitcoin',  price:200_000, days:272 },
  { q:'Will BTC reach $250,000 by end of 2026?',        t:0, coin:'bitcoin',  price:250_000, days:272 },
  { q:'Will BTC drop below $50,000 in 2026?',           t:1, coin:'bitcoin',  price:50_000,  days:272 },
  { q:'Will ETH reach $5,000 by end of 2026?',          t:0, coin:'ethereum', price:5_000,   days:272 },
  { q:'Will ETH reach $8,000 by end of 2026?',          t:0, coin:'ethereum', price:8_000,   days:272 },
  { q:'Will ETH reach $10,000 by end of 2026?',         t:0, coin:'ethereum', price:10_000,  days:272 },
  { q:'Will SOL reach $300 by end of 2026?',            t:0, coin:'solana',   price:300,     days:272 },
  { q:'Will SOL reach $500 by end of 2026?',            t:0, coin:'solana',   price:500,     days:272 },
  { q:'Will SOL flip ETH by market cap by end of 2026?', t:2,                                 days:272 },
  { q:'Will XRP reach $5 by end of 2026?',              t:2,                                  days:272 },
  { q:'Will XRP reach $10 by end of 2026?',             t:2,                                  days:272 },
  { q:'Will total crypto market cap exceed $5T by end of 2026?', t:2,                         days:272 },
  { q:'Will total crypto market cap exceed $10T by end of 2026?', t:2,                        days:272 },
  { q:'Will Bitcoin ETF AUM exceed $100B by end of 2026?', t:2,                               days:272 },
  { q:'Will a US Ethereum spot ETF be fully approved by end of 2026?', t:2,                   days:272 },
  { q:'Will Solana host a top-5 DeFi protocol by end of 2026?', t:2,                          days:272 },
  { q:'Will a central bank officially hold BTC in reserve by end of 2026?', t:2,              days:272 },
  { q:'Will there be a major crypto exchange hack >$500M in 2026?', t:2,                      days:272 },
  { q:'Will DOGE reach $1 by end of 2026?',             t:2,                                  days:272 },
  { q:'Will Cardano (ADA) reach $2 by end of 2026?',    t:2,                                  days:272 },
  { q:'Will Polkadot (DOT) reach $20 by end of 2026?',  t:2,                                  days:272 },
  { q:'Will Chainlink (LINK) reach $50 by end of 2026?', t:2,                                 days:272 },
  { q:'Will the US pass a comprehensive crypto regulation bill in 2026?', t:2,                 days:272 },
  { q:'Will crypto total market cap end 2026 higher than it started?', t:2,                   days:272 },

  // ══════════════════════════ PRE-MARKET / LAUNCHES (40) ══════════════════════
  { q:'Pre-Market: Will Kaito AI (KAITO) IDO launch above $1.00?',                t:2, days:7  },
  { q:'Pre-Market: Will MegaETH TGE price exceed $0.50 at launch?',               t:2, days:5  },
  { q:'Pre-Market: Will Movement (MOVE) token hold above $0.30 at launch?',       t:2, days:6  },
  { q:'Pre-Market: Will Monad (MON) TGE valuation exceed $5B FDV?',               t:2, days:14 },
  { q:'Pre-Market: Will Abstract (ABS) token reach $0.10 on day-1?',              t:2, days:4  },
  { q:'Pre-Market: Will Berachain (BERA) hold above $5 in first week?',           t:2, days:10 },
  { q:'Pre-Market: Will Story Protocol (IP) token hit $3 at launch?',             t:2, days:8  },
  { q:'Pre-Market: Will Initia (INIT) IDO exceed $200M raise?',                   t:2, days:12 },
  { q:'Pre-Market: Will Babylon (BABY) TGE market cap exceed $3B?',               t:2, days:9  },
  { q:'Pre-Market: Will Hyperliquid (HYPE) stay above $10 this month?',           t:2, days:27 },
  { q:'Pre-Market: Will any new L2 launch with $1B+ TVL in April 2026?',          t:2, days:27 },
  { q:'Pre-Market: Will the next Solana meme season start before May?',            t:2, days:27 },
  { q:'Pre-Market: Will Coinbase launch its own L2 in Q2 2026?',                  t:2, days:90 },
  { q:'Pre-Market: Will Solana DEX volume exceed Ethereum DEX this month?',       t:2, days:27 },
  { q:'Pre-Market: Will Jupiter (JUP) reach $2 before the next airdrop?',         t:2, days:30 },
  { q:'Pre-Market: Will Sui (SUI) flip Avalanche by market cap this month?',      t:2, days:27 },
  { q:'Pre-Market: Will Base chain TVL exceed $10B by May 2026?',                 t:2, days:28 },
  { q:'Pre-Market: Will the next Pump.fun competitor surpass it in April?',        t:2, days:27 },
  { q:'Pre-Market: Will a Solana NFT collection do $5M+ volume this week?',       t:2, days:7  },
  { q:'Pre-Market: Will Render (RNDR) surpass $10 this month?',                   t:2, days:27 },
  { q:'Pre-Market: Will WIF regain $3 before end of April?',                      t:2, days:27 },
  { q:'Pre-Market: Will Helium (HNT) reach $10 this month?',                      t:2, days:27 },
  { q:'Pre-Market: Will Drift (DRIFT) reach $1 before April 15?',                 t:2, days:12 },
  { q:'Pre-Market: Will Orca (ORCA) token launch in April 2026?',                 t:2, days:27 },
  { q:'Pre-Market: Will any meme coin from Pump.fun hit $100M market cap today?', t:2, days:1  },
  { q:'Pre-Market: Will Eigenlayer (EIGEN) airdrop season 2 launch in April?',    t:2, days:27 },
  { q:'Pre-Market: Will Pendle (PENDLE) reach $5 this month?',                    t:2, days:27 },
  { q:'Pre-Market: Will the Ethena (ENA) token reach $1.50 this month?',          t:2, days:27 },
  { q:'Pre-Market: Will zkSync Era have a new token launch this month?',           t:2, days:27 },
  { q:'Pre-Market: Will Aptos (APT) launch a major protocol in April?',           t:2, days:27 },
  { q:'Pre-Market: Will any Solana project raise $50M+ in April 2026?',           t:2, days:27 },
  { q:'Pre-Market: Will Celestia (TIA) reach $5 before May?',                     t:2, days:27 },
  { q:'Pre-Market: Will Pyth Network (PYTH) reach $0.50 this month?',             t:2, days:27 },
  { q:'Pre-Market: Will Jito (JTO) token reach $5 in April?',                     t:2, days:27 },
  { q:'Pre-Market: Will Raydium (RAY) reach $5 this month?',                      t:2, days:27 },
  { q:'Pre-Market: Will any new AI x crypto project 10x in April?',               t:2, days:27 },
  { q:'Pre-Market: Will Worldcoin (WLD) reach $3 this month?',                    t:2, days:27 },
  { q:'Pre-Market: Will Bittensor (TAO) reach $500 this month?',                  t:2, days:27 },
  { q:'Pre-Market: Will Fetch.ai (FET) reach $1.50 this month?',                  t:2, days:27 },
  { q:'Pre-Market: Will the next big memecoin be launched on Solana in April?',   t:2, days:27 },

  // ══════════════════════════ ETF (12) ═════════════════════════════════════════
  { q:'ETF: Will Bitcoin spot ETFs have positive net inflows today?',             t:2, days:1  },
  { q:'ETF: Will Bitcoin ETF AUM exceed $50B this week?',                         t:2, days:7  },
  { q:'ETF: Will total Bitcoin ETF inflows exceed $1B this week?',                t:2, days:7  },
  { q:'ETF: Will a US Ethereum spot ETF be approved before May 2026?',            t:2, days:28 },
  { q:'ETF: Will Bitcoin ETF daily volume exceed $3B this week?',                 t:2, days:7  },
  { q:'ETF: Will BlackRock IBIT ETF have its largest single-day inflow in April?',t:2, days:27 },
  { q:'ETF: Will total crypto ETF AUM exceed $100B by May 2026?',                 t:2, days:27 },
  { q:'ETF: Will a Solana spot ETF be filed with the SEC in April 2026?',         t:2, days:27 },
  { q:'ETF: Will an XRP spot ETF be approved in the US by end of Q2?',            t:2, days:90 },
  { q:'ETF: Will Bitcoin ETF net inflows exceed $5B in April 2026?',              t:2, days:27 },
  { q:'ETF: Will a DOGE spot ETF filing happen before May 2026?',                 t:2, days:27 },
  { q:'ETF: Will institutional Bitcoin holdings exceed 10% of supply by May?',   t:2, days:27 },

  // ══════════════════════════ EVENTS / MACRO (30) ══════════════════════════════
  { q:'Will the US Federal Reserve cut rates before June 2026?',                  t:2, days:60 },
  { q:'Will the US government sell any seized BTC in April 2026?',                t:2, days:27 },
  { q:'Will MicroStrategy (now Strategy) buy more BTC in April 2026?',           t:2, days:27 },
  { q:'Will Tether (USDT) market cap exceed $150B by May 2026?',                  t:2, days:27 },
  { q:'Will USDC market cap exceed $60B by May 2026?',                            t:2, days:27 },
  { q:'Will Binance be allowed back in the US market by end of 2026?',            t:2, days:272 },
  { q:'Will Ripple win its final appeal against the SEC by end of 2026?',         t:2, days:272 },
  { q:'Will the US pass a stablecoin regulation bill by June 2026?',              t:2, days:90 },
  { q:'Will total Solana validator count exceed 3,000 by May 2026?',              t:2, days:27 },
  { q:'Will Ethereum gas fees average below 5 gwei in April 2026?',               t:2, days:27 },
  { q:'Will Bitcoin hashrate reach 1 ZH/s by end of 2026?',                      t:2, days:272 },
  { q:'Will the next Bitcoin halving happen before 2029?',                        t:2, days:272 },
  { q:'Will Grayscale launch a new crypto product in Q2 2026?',                   t:2, days:90 },
  { q:'Will Coinbase stock (COIN) reach $400 by end of 2026?',                   t:2, days:272 },
  { q:'Will Trump mention Bitcoin in an official speech in April?',               t:2, days:27 },
  { q:'Will El Salvador keep BTC as legal tender through 2026?',                  t:2, days:272 },
  { q:'Will any G7 country adopt Bitcoin as legal tender by 2027?',               t:2, days:272 },
  { q:'Will on-chain BTC transactions exceed 500k/day in April?',                 t:2, days:27 },
  { q:'Will Ethereum layer-2 TVL exceed $50B by May 2026?',                       t:2, days:27 },
  { q:'Will total crypto stablecoin market cap exceed $300B by end of 2026?',     t:2, days:272 },
  { q:'Will DeFi total value locked exceed $200B by end of 2026?',                t:2, days:272 },
  { q:'Will NFT market volume recover to $1B/month by end of 2026?',              t:2, days:272 },
  { q:'Will Solana break 100,000 TPS in a public stress test by end of 2026?',   t:2, days:272 },
  { q:'Will a Layer-1 blockchain surpass Ethereum in monthly DEX volume in 2026?', t:2, days:272 },
  { q:'Will the crypto Fear & Greed index average above 60 in April?',            t:2, days:27 },
  { q:'Will Bitcoin dominance stay above 50% through April 2026?',                t:2, days:27 },
  { q:'Will any country ban crypto exchanges in April 2026?',                     t:2, days:27 },
  { q:'Will Ethereum burn rate exceed 1,000 ETH/day in April?',                  t:2, days:27 },
  { q:'Will BTC open interest in futures exceed $50B this month?',                t:2, days:27 },
  { q:'Will crypto VC funding exceed $2B in Q2 2026?',                            t:2, days:90 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMarketPda(marketId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new BN(marketId.toString()).toArrayLike(Buffer, 'le', 8))],
    PROGRAM_ID
  );
  return pda;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e: any) {
      const isTimeout = e?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || e?.message?.includes('timeout') || e?.message?.includes('ETIMEDOUT');
      if (attempt < retries && isTimeout) {
        console.warn(`    ⚠ Network timeout, retry ${attempt}/${retries - 1}...`);
        await sleep(delayMs * attempt);
      } else { throw e; }
    }
  }
  throw new Error('unreachable');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(keypairPath)) throw new Error(`Keypair not found: ${keypairPath}`);
  const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))));
  console.log('Payer:', payer.publicKey.toBase58());

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const balance = await withRetry(() => connection.getBalance(payer.publicKey));
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 2e9) console.warn('Low balance — may not complete all markets');

  const idlPath = path.join(__dirname, '../lib/magicbet-idl.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: 'confirmed' });
  const program = new Program(idl, provider);

  const now = Math.floor(Date.now() / 1000);
  let created = 0, skipped = 0, failed = 0;

  console.log(`\nSeeding ${MARKETS.length} markets...\n`);

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    const marketId = BigInt(now) * BigInt(10000) + BigInt(i);
    const deadline = now + Math.round(m.days * 86400);
    const marketPda = getMarketPda(marketId);

    try {
      const existing = await withRetry(() => connection.getAccountInfo(marketPda));
      if (existing) { skipped++; continue; }

      const pythFeed   = m.coin && PYTH[m.coin] ? new PublicKey(PYTH[m.coin]) : null;
      const targetPrice = m.price ? new BN(Math.round(m.price * 1e6)) : null;

      await withRetry(() => (program.methods as any)
        .createMarket(new BN(marketId.toString()), m.q, new BN(deadline), pythFeed, targetPrice, m.t)
        .accounts({ creator: payer.publicKey, market: marketPda, systemProgram: SystemProgram.programId })
        .rpc());

      console.log(`  [${String(i + 1).padStart(3)}/${MARKETS.length}] ${m.q.slice(0, 70)}`);
      created++;
    } catch (e: any) {
      console.error(`  ERR [${i + 1}] ${e?.message?.slice(0, 80)}`);
      failed++;
    }

    await sleep(300);
  }

  console.log(`\nDone! Created: ${created}  Skipped: ${skipped}  Failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
