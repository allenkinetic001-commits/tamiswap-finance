import { ethers } from 'ethers';
import {
  DEFAULT_SWAP_TOKENS,
  SwapToken,
  USDT_ADDRESS,
  WBNB_ADDRESS,
} from '../data/swapTokens';

export interface TopTokenEntry {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isNative?: boolean;
  logoURI: string;
  priceUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  binancePair?: string;
  lastUpdated: number;
}

interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
}

interface TokenListEntry {
  chainId?: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface Binance24hrTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

const COINGECKO_BSC_MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=binance-smart-chain&order=volume_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h';
const PANCAKESWAP_LIST_URL =
  'https://tokens.pancakeswap.finance/pancakeswap-extended.json';
const COINGECKO_BSC_LIST_URL =
  'https://tokens.coingecko.com/binance-smart-chain/all.json';
const BINANCE_TICKER_URL = 'https://data-api.binance.vision/api/v3/ticker/24hr';

// Verified Binance spot pairs matching BSC ecosystem assets for sub-10s live price & 24h% ticks
const BINANCE_SPOT_PAIR_BY_ID: Record<string, string> = {
  binancecoin: 'BNBUSDT',
  wbnb: 'BNBUSDT',
  'usd1-wlfi': 'USD1USDT',
  uniswap: 'UNIUSDT',
  pepe: 'PEPEUSDT',
  chainlink: 'LINKUSDT',
  'wrapped-bitcoin': 'WBTCUSDT',
  aave: 'AAVEUSDT',
  'binance-bridged-usdc-bnb-smart-chain': 'USDCUSDT',
  'usd-coin': 'USDCUSDT',
  'injective-protocol': 'INJUSDT',
  'first-digital-usd': 'FDUSDUSDT',
  'binance-bitcoin': 'BTCUSDT',
  ethereum: 'ETHUSDT',
  pancakeswap: 'CAKEUSDT',
  'pancakeswap-token': 'CAKEUSDT',
  thena: 'THEUSDT',
};

const BINANCE_FALLBACK_CATALOG: Array<{
  pair: string;
  id: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isNative?: boolean;
  logoURI: string;
}> = [
  {
    pair: 'BNBUSDT',
    id: 'binancecoin',
    symbol: 'BNB',
    name: 'BNB',
    address: WBNB_ADDRESS,
    decimals: 18,
    isNative: true,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  },
  {
    pair: 'BTCUSDT',
    id: 'binance-bitcoin',
    symbol: 'BTCB',
    name: 'Bitcoin BEP20',
    address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c/logo.png',
  },
  {
    pair: 'ETHUSDT',
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum Token',
    address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x2170Ed0880ac9A755fd29B2688956BD959F933F8/logo.png',
  },
  {
    pair: 'UNIUSDT',
    id: 'uniswap',
    symbol: 'UNI',
    name: 'Uniswap',
    address: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/12504/large/uniswap-logo.png',
  },
  {
    pair: 'PEPEUSDT',
    id: 'pepe',
    symbol: 'PEPE',
    name: 'Pepe',
    address: '0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg',
  },
  {
    pair: 'LINKUSDT',
    id: 'chainlink',
    symbol: 'LINK',
    name: 'Chainlink',
    address: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
  },
  {
    pair: 'USD1USDT',
    id: 'usd1-wlfi',
    symbol: 'USD1',
    name: 'USD1',
    address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/54977/large/USD1_1000x1000_transparent.png',
  },
  {
    pair: 'USDCUSDT',
    id: 'binance-bridged-usdc-bnb-smart-chain',
    symbol: 'USDC',
    name: 'USD Coin (BSC)',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d/logo.png',
  },
  {
    pair: 'AAVEUSDT',
    id: 'aave',
    symbol: 'AAVE',
    name: 'Aave',
    address: '0xfb6115445Bff7b52FeB98650C87f44907E58f802',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/12645/large/aave-token-round.png',
  },
  {
    pair: 'FDUSDUSDT',
    id: 'first-digital-usd',
    symbol: 'FDUSD',
    name: 'First Digital USD',
    address: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/31079/large/FDUSD_icon_black.png',
  },
  {
    pair: 'INJUSDT',
    id: 'injective-protocol',
    symbol: 'INJ',
    name: 'Injective',
    address: '0xa2B726B1145A4773F68593CF171187d8EBe4d495',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/12882/large/Other_200x200.png',
  },
  {
    pair: 'CAKEUSDT',
    id: 'pancakeswap-token',
    symbol: 'CAKE',
    name: 'PancakeSwap Token',
    address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png',
  },
];

let cachedTokenListPromise: Promise<Map<string, TokenListEntry>> | null = null;

async function getBscTokenDirectory(): Promise<Map<string, TokenListEntry>> {
  if (cachedTokenListPromise) return cachedTokenListPromise;

  cachedTokenListPromise = (async () => {
    const map = new Map<string, TokenListEntry>();

    const register = (entry: TokenListEntry, overwrite = false) => {
      if (entry.chainId !== undefined && entry.chainId !== 56) return;
      if (!ethers.isAddress(entry.address)) return;
      const key = entry.symbol.trim().toLowerCase();
      if (!key) return;
      if (!map.has(key) || overwrite) {
        map.set(key, {
          ...entry,
          address: ethers.getAddress(entry.address),
        });
      }
    };

    try {
      const pcsRes = await fetch(PANCAKESWAP_LIST_URL);
      if (pcsRes.ok) {
        const data = (await pcsRes.json()) as { tokens?: TokenListEntry[] };
        for (const t of data.tokens || []) register(t, false);
      }
    } catch {
      // fall through to CoinGecko BSC list
    }

    try {
      const cgRes = await fetch(COINGECKO_BSC_LIST_URL);
      if (cgRes.ok) {
        const data = (await cgRes.json()) as { tokens?: TokenListEntry[] };
        for (const t of data.tokens || []) register(t, false);
      }
    } catch {
      // ignore if secondary list unreachable
    }

    // Default canonical BSC assets take final priority for safety & router accuracy
    for (const dt of DEFAULT_SWAP_TOKENS) {
      if (!dt.isNative) {
        register(
          {
            chainId: 56,
            address: dt.address,
            symbol: dt.symbol,
            name: dt.name,
            decimals: dt.decimals,
            logoURI: dt.logoURI,
          },
          true
        );
      }
    }

    return map;
  })();

  return cachedTokenListPromise;
}

function normalizeMarketSymbol(item: CoinGeckoMarketItem): string {
  const sym = item.symbol.trim().toUpperCase();
  if (item.id === 'binance-bridged-usdt-bnb-smart-chain' || sym === 'BSC-USD') {
    return 'USDT';
  }
  return sym;
}

function normalizeMarketName(item: CoinGeckoMarketItem): string {
  if (item.id === 'binance-bridged-usdt-bnb-smart-chain') {
    return 'Tether USD';
  }
  if (item.id === 'binance-bridged-usdc-bnb-smart-chain') {
    return 'USD Coin';
  }
  return item.name;
}

async function fetchBinance24hrMap(
  pairs: string[]
): Promise<Map<string, Binance24hrTicker>> {
  const uniquePairs = Array.from(new Set(pairs.filter(Boolean)));
  const map = new Map<string, Binance24hrTicker>();
  if (uniquePairs.length === 0) return map;

  try {
    const query = encodeURIComponent(JSON.stringify(uniquePairs));
    const res = await fetch(`${BINANCE_TICKER_URL}?symbols=${query}`);
    if (!res.ok) return map;
    const rows = (await res.json()) as Binance24hrTicker[];
    for (const row of rows) {
      map.set(row.symbol, row);
    }
  } catch {
    // ignore transient network failure on live overlay
  }
  return map;
}

async function fetchFallbackFromBinance(): Promise<TopTokenEntry[]> {
  const tickerMap = await fetchBinance24hrMap(
    BINANCE_FALLBACK_CATALOG.map((c) => c.pair)
  );
  if (tickerMap.size === 0) {
    throw new Error('Live market feeds are temporarily unavailable.');
  }

  const now = Date.now();
  const entries: TopTokenEntry[] = [];

  for (const item of BINANCE_FALLBACK_CATALOG) {
    const tick = tickerMap.get(item.pair);
    if (!tick) continue;
    const priceUsd = Number(tick.lastPrice);
    const volume24hUsd = Number(tick.quoteVolume);
    const change24hPct = Number(tick.priceChangePercent);
    if (!Number.isFinite(priceUsd) || !Number.isFinite(volume24hUsd)) continue;

    entries.push({
      rank: 0,
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      address: item.address,
      decimals: item.decimals,
      isNative: item.isNative,
      logoURI: item.logoURI,
      priceUsd,
      volume24hUsd,
      change24hPct: Number.isFinite(change24hPct) ? change24hPct : 0,
      binancePair: item.pair,
      lastUpdated: now,
    });
  }

  return entries
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 10)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export async function fetchTop10BscTokens(): Promise<TopTokenEntry[]> {
  const [directory, marketsRes] = await Promise.all([
    getBscTokenDirectory(),
    fetch(COINGECKO_BSC_MARKETS_URL),
  ]);

  if (!marketsRes.ok) {
    return fetchFallbackFromBinance();
  }

  const markets = (await marketsRes.json()) as CoinGeckoMarketItem[];
  if (!Array.isArray(markets) || markets.length === 0) {
    return fetchFallbackFromBinance();
  }

  const resolved: TopTokenEntry[] = [];
  const seenKeys = new Set<string>();
  const now = Date.now();

  for (const item of markets) {
    if (
      item.current_price === null ||
      item.total_volume === null ||
      !Number.isFinite(item.current_price) ||
      !Number.isFinite(item.total_volume)
    ) {
      continue;
    }

    const displaySymbol = normalizeMarketSymbol(item);
    const displayName = normalizeMarketName(item);

    let address = '';
    let decimals = 18;
    let isNative = false;
    let fallbackLogo = '';

    if (item.id === 'binancecoin') {
      address = WBNB_ADDRESS;
      decimals = 18;
      isNative = true;
    } else if (item.id === 'wbnb') {
      address = WBNB_ADDRESS;
      decimals = 18;
    } else if (item.id === 'binance-bridged-usdt-bnb-smart-chain') {
      address = USDT_ADDRESS;
      decimals = 18;
    } else {
      const match =
        directory.get(displaySymbol.toLowerCase()) ||
        directory.get(item.symbol.trim().toLowerCase());
      if (!match) continue;
      address = match.address;
      decimals = match.decimals;
      fallbackLogo = match.logoURI || '';
    }

    const dedupeKey = isNative ? 'native-bnb' : address.toLowerCase();
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    resolved.push({
      rank: 0,
      id: item.id,
      symbol: displaySymbol,
      name: displayName,
      address,
      decimals,
      isNative,
      logoURI: item.image || fallbackLogo,
      priceUsd: item.current_price,
      volume24hUsd: item.total_volume,
      change24hPct: item.price_change_percentage_24h ?? 0,
      binancePair: BINANCE_SPOT_PAIR_BY_ID[item.id],
      lastUpdated: now,
    });
  }

  if (resolved.length === 0) {
    return fetchFallbackFromBinance();
  }

  const pairsToOverlay = resolved
    .slice(0, 15)
    .map((t) => t.binancePair)
    .filter((p): p is string => Boolean(p));
  const tickerMap = await fetchBinance24hrMap(pairsToOverlay);

  const enriched = resolved.map((entry) => {
    if (!entry.binancePair) return entry;
    const tick = tickerMap.get(entry.binancePair);
    if (!tick) return entry;
    const livePrice = Number(tick.lastPrice);
    const livePct = Number(tick.priceChangePercent);
    return {
      ...entry,
      priceUsd:
        Number.isFinite(livePrice) && livePrice > 0 ? livePrice : entry.priceUsd,
      change24hPct: Number.isFinite(livePct) ? livePct : entry.change24hPct,
    };
  });

  return enriched
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 10)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export async function refreshTopTokensLiveTick(
  current: TopTokenEntry[]
): Promise<TopTokenEntry[]> {
  if (current.length === 0) return fetchTop10BscTokens();

  const pairs = current
    .map((t) => t.binancePair)
    .filter((p): p is string => Boolean(p));
  if (pairs.length === 0) return current;

  const tickerMap = await fetchBinance24hrMap(pairs);
  if (tickerMap.size === 0) return current;

  const now = Date.now();
  return current.map((entry) => {
    if (!entry.binancePair) return entry;
    const tick = tickerMap.get(entry.binancePair);
    if (!tick) return entry;
    const livePrice = Number(tick.lastPrice);
    const livePct = Number(tick.priceChangePercent);
    return {
      ...entry,
      priceUsd:
        Number.isFinite(livePrice) && livePrice > 0 ? livePrice : entry.priceUsd,
      change24hPct: Number.isFinite(livePct) ? livePct : entry.change24hPct,
      lastUpdated: now,
    };
  });
}

export function toSwapToken(entry: TopTokenEntry): SwapToken {
  return {
    symbol: entry.symbol,
    name: entry.name,
    address: entry.address,
    decimals: entry.decimals,
    isNative: entry.isNative,
    logoURI: entry.logoURI,
  };
}
