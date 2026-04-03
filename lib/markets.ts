// Auto-generates prediction market ideas from CoinGecko API

export interface MarketIdea {
  question: string;
  targetPrice: number; // in USD, scaled by 1e6
  marketType: 0 | 1;   // 0=above, 1=below
  pythFeedKey: string;
  deadline: number;     // unix timestamp
  coinId: string;
  currentPrice: number;
}

const PYTH_FEEDS: Record<string, string> = {
  solana: 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
  bitcoin: 'HovQMDrbAgAYPCmaTftQMjWUB5UEQLGVKXcp39HkrMoS',
  ethereum: 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
};

const SUPPORTED_COINS = ['solana', 'bitcoin', 'ethereum'];

// Fetch prices from CoinGecko free API
export async function fetchCoinGeckoPrices(): Promise<Record<string, number>> {
  const ids = SUPPORTED_COINS.join(',');
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    { next: { revalidate: 60 } }
  );
  if (!res.ok) throw new Error('CoinGecko API error');
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const id of SUPPORTED_COINS) {
    prices[id] = data[id]?.usd ?? 0;
  }
  return prices;
}

// Fetch trending coins from CoinGecko
export async function fetchTrending(): Promise<{ id: string; name: string; symbol: string }[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/search/trending',
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.coins ?? []).slice(0, 5).map((c: any) => ({
      id: c.item.id,
      name: c.item.name,
      symbol: c.item.symbol,
    }));
  } catch {
    return [];
  }
}

// Generate market ideas for supported coins
export async function generateMarketIdeas(): Promise<MarketIdea[]> {
  const prices = await fetchCoinGeckoPrices();
  const ideas: MarketIdea[] = [];

  const now = Math.floor(Date.now() / 1000);
  const oneDay = 86400;
  const threeDays = 3 * oneDay;

  for (const coinId of SUPPORTED_COINS) {
    const pythFeedKey = PYTH_FEEDS[coinId];
    if (!pythFeedKey) continue;

    const currentPrice = prices[coinId];
    if (!currentPrice) continue;

    const symbol = coinId === 'bitcoin' ? 'BTC' : coinId === 'ethereum' ? 'ETH' : 'SOL';

    // Market 1: Will price go UP 10% in 3 days?
    const upTarget = Math.round(currentPrice * 1.1 * 1e6);
    ideas.push({
      question: `Will ${symbol} be above $${(currentPrice * 1.1).toFixed(0)} in 3 days?`,
      targetPrice: upTarget,
      marketType: 0,
      pythFeedKey,
      deadline: now + threeDays,
      coinId,
      currentPrice,
    });

    // Market 2: Will price go DOWN 10% in 1 day?
    const downTarget = Math.round(currentPrice * 0.9 * 1e6);
    ideas.push({
      question: `Will ${symbol} drop below $${(currentPrice * 0.9).toFixed(0)} tomorrow?`,
      targetPrice: downTarget,
      marketType: 1,
      pythFeedKey,
      deadline: now + oneDay,
      coinId,
      currentPrice,
    });
  }

  return ideas;
}

// Fetch current Pyth price off-chain (for resolution)
export async function fetchPythPrice(coinId: string): Promise<number | null> {
  try {
    // Use CoinGecko as proxy for Pyth price (same underlying data)
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data[coinId]?.usd;
    if (!price) return null;
    // Scale to match on-chain format (multiply by 1e6)
    return Math.round(price * 1e6);
  } catch {
    return null;
  }
}
