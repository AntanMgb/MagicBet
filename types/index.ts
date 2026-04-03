export interface MarketAccount {
  marketId: string;
  creator: string;
  question: string;
  deadline: number;
  pythFeed: string | null;
  targetPrice: string | null;
  marketType: number; // 0=price_above, 1=price_below, 2=manual
  resolved: boolean;
  winningOutcome: number; // 0=unresolved, 1=Yes, 2=No
  totalYes: string; // lamports as string
  totalNo: string;
  publicKey: string;
}

export interface BetAccount {
  user: string;
  marketId: string;
  outcome: number;
  amount: string;
  claimed: boolean;
  publicKey: string;
}

export type MarketTypeLabel = 'Price Above' | 'Price Below' | 'Manual';

export const MARKET_TYPE_LABELS: Record<number, MarketTypeLabel> = {
  0: 'Price Above',
  1: 'Price Below',
  2: 'Manual',
};

// Known Pyth price feed IDs on devnet
export const PYTH_FEEDS = {
  'SOL/USD': 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
  'BTC/USD': 'HovQMDrbAgAYPCmaTftQMjWUB5UEQLGVKXcp39HkrMoS',
  'ETH/USD': 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
  'BNB/USD': 'GwzBgrXb4PG59zjce24SF2b9JXbLEjJJTBkmytuEZj1b',
} as const;
