import { ethers } from 'ethers';
import {
  BSC_CHAIN_ID,
  BSC_CHAIN_ID_HEX,
  BSC_RPC_URLS,
  PANCAKE_PAIR_FACTORY_ADDRESS,
  PANCAKE_ROUTER_V2_ADDRESS,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_RECIPIENT,
  SwapToken,
  TAMI_FEE_ROUTER_ADDRESS,
  THENA_PAIR_FACTORY_ADDRESS,
  THENA_ROUTER_V2_ADDRESS,
  USDT_ADDRESS,
  WBNB_ADDRESS,
} from '../data/swapTokens';

export interface RouteHop {
  from: string;
  to: string;
  stable: boolean;
}

export type DexId = 'thena' | 'pancakeswap';

export interface KyberRouteHop {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  swapAmount: string;
  amountOut: string;
  exchange: string;
  poolExtra?: {
    fee?: number;
    feePrecision?: number;
  };
}

export interface KyberRouteSummary {
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
  amountOut: string;
  gas: string;
  route: KyberRouteHop[][];
  extraFee?: {
    feeAmount: string;
    chargeFeeBy: string;
    isInBps: boolean;
    feeReceiver: string;
  };
}

export interface OnChainQuote {
  dex: DexId;
  dexLabel: string;
  routerAddress: string;
  amountOutWei: bigint;
  amountOutFormatted: string;
  routes: RouteHop[];
  pancakePath: string[];
  routeSymbols: string[];
  priceImpactPct: number;
  feeBps: number;
  platformFeeBps: number;
  platformFeeWei: bigint;
  platformFeeRecipient: string;
  pairAddress: string | null;
  isWrapOrUnwrap: boolean;
  useFeeWrapper?: boolean;
  kyberRouteSummary?: KyberRouteSummary;
}

const KYBER_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const KYBER_BSC_API = 'https://aggregator-api.kyberswap.com/bsc/api/v1';

interface KyberRoutesResponse {
  code: number;
  message?: string;
  data?: {
    routeSummary?: KyberRouteSummary;
    routerAddress?: string;
  };
}

interface KyberBuildResponse {
  code: number;
  message?: string;
  data?: {
    routerAddress: string;
    data: string;
    amountOut: string;
  };
}

async function fetchKyberFeeQuote(params: {
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountInWei: bigint;
  mode: 'auto' | 'volatile' | 'stable';
}): Promise<{ routeSummary: KyberRouteSummary; routerAddress: string } | null> {
  const { tokenIn, tokenOut, amountInWei, mode } = params;
  const inAddr = tokenIn.isNative ? KYBER_NATIVE_TOKEN : tokenIn.address;
  const outAddr = tokenOut.isNative ? KYBER_NATIVE_TOKEN : tokenOut.address;

  const sourceList =
    mode === 'volatile'
      ? ['pancake,thena', 'pancake,pancake-v3,thena,thena-fusion']
      : mode === 'stable'
      ? ['thena,thena-fusion,pancake-v3,pancake']
      : ['pancake,pancake-v3,thena,thena-fusion', ''];

  for (const sources of sourceList) {
    try {
      const qs = new URLSearchParams({
        tokenIn: inAddr,
        tokenOut: outAddr,
        amountIn: amountInWei.toString(),
        feeAmount: String(PLATFORM_FEE_BPS),
        isInBps: 'true',
        chargeFeeBy: 'currency_in',
        feeReceiver: PLATFORM_FEE_RECIPIENT,
      });
      if (sources) {
        qs.set('includedSources', sources);
      }

      const res = await fetch(`${KYBER_BSC_API}/routes?${qs.toString()}`, {
        headers: { 'x-client-id': 'TamiSwap' },
      });
      if (!res.ok) continue;

      const json = (await res.json()) as KyberRoutesResponse;
      if (
        json.code === 0 &&
        json.data?.routeSummary &&
        json.data?.routerAddress &&
        BigInt(json.data.routeSummary.amountOut || '0') > 0n
      ) {
        return {
          routeSummary: json.data.routeSummary,
          routerAddress: ethers.getAddress(json.data.routerAddress),
        };
      }
    } catch {
      // try next source filter or direct fallback
    }
  }

  return null;
}

function summarizeKyberExchanges(route: KyberRouteHop[][]): {
  dex: DexId;
  dexLabel: string;
} {
  const exchanges = new Set<string>();
  for (const branch of route) {
    for (const hop of branch) {
      if (hop.exchange) exchanges.add(hop.exchange.toLowerCase());
    }
  }
  const hasThena = Array.from(exchanges).some((e) => e.includes('thena'));
  const hasPancake = Array.from(exchanges).some((e) => e.includes('pancake'));

  if (hasThena && hasPancake) {
    return { dex: 'thena', dexLabel: 'THENA · PancakeSwap' };
  }
  if (hasThena) {
    return { dex: 'thena', dexLabel: 'THENA' };
  }
  if (hasPancake) {
    const isV3 = exchanges.has('pancake-v3');
    return {
      dex: 'pancakeswap',
      dexLabel: isV3 && !exchanges.has('pancake') ? 'PancakeSwap V3' : 'PancakeSwap V2',
    };
  }
  return { dex: 'pancakeswap', dexLabel: 'THENA · PancakeSwap' };
}

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const WBNB_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad)',
];

const ROUTER_V2_ABI = [
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable)[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
];

const PANCAKE_ROUTER_V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
];

const PAIR_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB, bool stable) view returns (address)',
  'function getFee(bool _stable) view returns (uint256)',
];

const PANCAKE_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)',
  'function token0() view returns (address)',
];

const TAMI_FEE_ROUTER_ABI = [
  'function swapExactETHForTokensOnPancake(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHOnPancake(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokensOnPancake(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokensOnThena(uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) payable',
  'function swapExactTokensForETHOnThena(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline)',
  'function swapExactTokensForTokensOnThena(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline)',
];

function getConfiguredFeeWrapperAddress(): string | null {
  if (!TAMI_FEE_ROUTER_ADDRESS || !ethers.isAddress(TAMI_FEE_ROUTER_ADDRESS)) {
    return null;
  }
  return ethers.getAddress(TAMI_FEE_ROUTER_ADDRESS);
}

let cachedReadProvider: ethers.JsonRpcProvider | null = null;

export async function getBscReadProvider(): Promise<ethers.JsonRpcProvider> {
  if (cachedReadProvider) return cachedReadProvider;
  try {
    const fastest = await Promise.any(
      BSC_RPC_URLS.map(async (url) => {
        const provider = new ethers.JsonRpcProvider(url, BSC_CHAIN_ID, {
          staticNetwork: ethers.Network.from(BSC_CHAIN_ID),
        });
        await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        return provider;
      })
    );
    cachedReadProvider = fastest;
    return fastest;
  } catch {
    return new ethers.JsonRpcProvider(BSC_RPC_URLS[0], BSC_CHAIN_ID, {
      staticNetwork: ethers.Network.from(BSC_CHAIN_ID),
    });
  }
}

export function parseChainId(rawChainId: unknown): number | null {
  if (typeof rawChainId === 'number' && Number.isFinite(rawChainId)) {
    return rawChainId;
  }
  if (typeof rawChainId === 'string') {
    const trimmed = rawChainId.trim();
    if (!trimmed) return null;
    const parsed = trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? parseInt(trimmed, 16)
      : Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractWalletErrorCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    code?: unknown;
    data?: { originalError?: { code?: unknown }; code?: unknown };
    cause?: { code?: unknown };
  };
  if (typeof e.code === 'number') return e.code;
  if (typeof e.data?.originalError?.code === 'number') return e.data.originalError.code;
  if (typeof e.data?.code === 'number') return e.data.code;
  if (typeof e.cause?.code === 'number') return e.cause.code;
  return undefined;
}

function collectErrorMessages(err: unknown, depth = 0): string[] {
  if (!err || depth > 4) return [];
  if (typeof err === 'string') return [err];
  if (typeof err !== 'object') return [];
  const e = err as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['shortMessage', 'reason', 'message']) {
    if (typeof e[key] === 'string' && e[key]) out.push(e[key] as string);
  }
  for (const nested of ['info', 'error', 'data', 'originalError', 'cause']) {
    if (e[nested]) out.push(...collectErrorMessages(e[nested], depth + 1));
  }
  return out;
}

function isUserRejectedWalletError(err: unknown): boolean {
  const code = extractWalletErrorCode(err);
  if (code === 4001) return true;
  const msg = collectErrorMessages(err).join(' ').toLowerCase();
  return (
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('rejected the request') ||
    msg.includes('cancelled') ||
    msg.includes('canceled')
  );
}

export function formatWalletError(err: unknown): string {
  if (isUserRejectedWalletError(err)) {
    return 'Transaction cancelled in wallet.';
  }
  const allMsgs = collectErrorMessages(err);
  const joined = allMsgs.join(' | ').toLowerCase();

  if (joined.includes('insufficient funds') || joined.includes('exceeds balance')) {
    return 'Not enough BNB in your wallet to cover the swap amount plus gas fee.';
  }
  if (
    joined.includes('return amount is not enough') ||
    joined.includes('insufficient_output_amount') ||
    joined.includes('minreturn') ||
    joined.includes('too little received')
  ) {
    return 'Price moved or this token has a transfer tax — raise Slippage (e.g. 3% or 5%) in Settings and try again.';
  }
  if (joined.includes('transfer_from_failed') || joined.includes('allowance')) {
    return 'Token approval too low or token transfer blocked — approve again or increase Slippage in Settings.';
  }
  if (joined.includes('deadline') || joined.includes('expired')) {
    return 'Swap quote expired — please refresh and try again.';
  }

  // Prefer the most specific inner message that isn't ethers' generic "could not coalesce error"
  const meaningful = allMsgs.find(
    (m) =>
      m.trim().length > 0 &&
      !m.toLowerCase().includes('could not coalesce error') &&
      !m.toLowerCase().includes('unknown_error')
  );
  if (meaningful) {
    return meaningful.replace(/^execution reverted:\s*/i, '').slice(0, 220);
  }
  return 'Wallet RPC error — check you have enough BNB for gas, refresh the quote, or increase Slippage in Settings.';
}

export async function ensureBscNetwork(ethereum: ethers.Eip1193Provider): Promise<void> {
  const currentHex = await ethereum.request({ method: 'eth_chainId' });
  if (parseChainId(currentHex) === BSC_CHAIN_ID) return;

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (err: unknown) {
    if (isUserRejectedWalletError(err)) {
      throw new Error('Please approve switching your wallet to BNB Smart Chain (56).');
    }

    // Many wallets wrap 4902 or throw -32603 / "Unrecognized chain" when BSC isn't added yet
    try {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BSC_CHAIN_ID_HEX,
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: [
              'https://bsc-dataseed1.binance.org/',
              'https://bsc-dataseed2.binance.org/',
              'https://bsc-rpc.publicnode.com/',
            ],
            blockExplorerUrls: ['https://bscscan.com/'],
          },
        ],
      });

      const afterAddHex = await ethereum.request({ method: 'eth_chainId' });
      if (parseChainId(afterAddHex) !== BSC_CHAIN_ID) {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BSC_CHAIN_ID_HEX }],
        });
      }
    } catch (addErr: unknown) {
      if (isUserRejectedWalletError(addErr)) {
        throw new Error('Please approve adding BNB Smart Chain (56) in your wallet.');
      }
      throw new Error(
        'Please switch the network to BNB Smart Chain (BSC) in your wallet top bar.'
      );
    }
  }

  const finalHex = await ethereum.request({ method: 'eth_chainId' });
  if (parseChainId(finalHex) !== BSC_CHAIN_ID) {
    throw new Error(
      'Wallet is still not on BNB Smart Chain (Chain ID 56). Please switch to BNB Chain in your wallet.'
    );
  }
}

export async function fetchTokenInfo(address: string): Promise<SwapToken> {
  const checksummed = ethers.getAddress(address.trim());
  const provider = await getBscReadProvider();
  const token = new ethers.Contract(checksummed, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    token.symbol() as Promise<string>,
    token.name() as Promise<string>,
    token.decimals() as Promise<bigint>,
  ]);
  return {
    symbol,
    name,
    address: checksummed,
    decimals: Number(decimals),
    isNative: false,
  };
}

export async function fetchWalletBalances(
  walletAddress: string,
  tokens: SwapToken[]
): Promise<Record<string, string>> {
  const provider = await getBscReadProvider();
  const out: Record<string, string> = {};

  await Promise.all(
    tokens.map(async (t) => {
      try {
        if (t.isNative) {
          const bal = await provider.getBalance(walletAddress);
          out[t.symbol] = ethers.formatUnits(bal, t.decimals);
        } else {
          const contract = new ethers.Contract(t.address, ERC20_ABI, provider);
          const bal = (await contract.balanceOf(walletAddress)) as bigint;
          out[t.symbol] = ethers.formatUnits(bal, t.decimals);
        }
      } catch {
        out[t.symbol] = '0';
      }
    })
  );

  return out;
}

export async function fetchAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string = THENA_ROUTER_V2_ADDRESS
): Promise<bigint> {
  const provider = await getBscReadProvider();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return (await token.allowance(ownerAddress, spenderAddress)) as bigint;
}

export async function fetchOnChainQuote(params: {
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountInWei: bigint;
  mode: 'auto' | 'volatile' | 'stable';
  tokenSymbolMap: Record<string, string>;
}): Promise<OnChainQuote | null> {
  const { tokenIn, tokenOut, amountInWei, mode, tokenSymbolMap } = params;
  if (amountInWei <= 0n) return null;

  // Handle native BNB <-> WBNB 1:1 wrapping
  if (
    (tokenIn.isNative && tokenOut.address.toLowerCase() === WBNB_ADDRESS.toLowerCase()) ||
    (tokenOut.isNative && tokenIn.address.toLowerCase() === WBNB_ADDRESS.toLowerCase())
  ) {
    return {
      dex: 'thena',
      dexLabel: 'WBNB Wrap',
      routerAddress: WBNB_ADDRESS,
      amountOutWei: amountInWei,
      amountOutFormatted: ethers.formatUnits(amountInWei, tokenOut.decimals),
      routes: [],
      pancakePath: [],
      routeSymbols: [tokenIn.symbol, tokenOut.symbol],
      priceImpactPct: 0,
      feeBps: 0,
      platformFeeBps: 0,
      platformFeeWei: 0n,
      platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
      pairAddress: WBNB_ADDRESS,
      isWrapOrUnwrap: true,
    };
  }

  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    return null;
  }

  const provider = await getBscReadProvider();
  const thenaRouter = new ethers.Contract(THENA_ROUTER_V2_ADDRESS, ROUTER_V2_ABI, provider);
  const thenaFactory = new ethers.Contract(THENA_PAIR_FACTORY_ADDRESS, PAIR_FACTORY_ABI, provider);
  const pancakeRouter = new ethers.Contract(
    PANCAKE_ROUTER_V2_ADDRESS,
    PANCAKE_ROUTER_V2_ABI,
    provider
  );
  const pancakeFactory = new ethers.Contract(
    PANCAKE_PAIR_FACTORY_ADDRESS,
    PANCAKE_FACTORY_ABI,
    provider
  );

  const thenaCandidateRoutes: RouteHop[][] = [];
  const tryModes: boolean[] =
    mode === 'volatile' ? [false] : mode === 'stable' ? [true] : [false, true];

  // Direct 1-hop routes on THENA
  for (const stable of tryModes) {
    thenaCandidateRoutes.push([{ from: tokenIn.address, to: tokenOut.address, stable }]);
  }

  // 2-hop routes through WBNB and USDT
  const intermediates = [WBNB_ADDRESS, USDT_ADDRESS].filter(
    (mid) =>
      mid.toLowerCase() !== tokenIn.address.toLowerCase() &&
      mid.toLowerCase() !== tokenOut.address.toLowerCase()
  );

  for (const mid of intermediates) {
    for (const s1 of tryModes) {
      for (const s2 of tryModes) {
        thenaCandidateRoutes.push([
          { from: tokenIn.address, to: mid, stable: s1 },
          { from: mid, to: tokenOut.address, stable: s2 },
        ]);
      }
    }
  }

  // PancakeSwap V2 paths (active in auto and volatile modes)
  const pancakeCandidatePaths: string[][] = [];
  if (mode !== 'stable') {
    pancakeCandidatePaths.push([tokenIn.address, tokenOut.address]);
    for (const mid of intermediates) {
      pancakeCandidatePaths.push([tokenIn.address, mid, tokenOut.address]);
    }
  }

  const feeWrapperAddress = getConfiguredFeeWrapperAddress();
  const platformFeeWei = (amountInWei * BigInt(PLATFORM_FEE_BPS)) / 10000n;
  const effectiveInWei = amountInWei - platformFeeWei;
  if (effectiveInWei <= 0n) return null;

  type QuoteCandidate =
    | { dex: 'thena'; routes: RouteHop[]; pancakePath: string[]; outWei: bigint }
    | { dex: 'pancakeswap'; routes: RouteHop[]; pancakePath: string[]; outWei: bigint };

  const [thenaResults, pancakeResults, kyberFeeQuote] = await Promise.all([
    Promise.all(
      thenaCandidateRoutes.map(async (routes): Promise<QuoteCandidate | null> => {
        try {
          const amounts = (await thenaRouter.getAmountsOut(effectiveInWei, routes)) as bigint[];
          const outWei = amounts[amounts.length - 1];
          if (outWei <= 0n) return null;
          return { dex: 'thena', routes, pancakePath: [], outWei };
        } catch {
          return null;
        }
      })
    ),
    Promise.all(
      pancakeCandidatePaths.map(async (path): Promise<QuoteCandidate | null> => {
        try {
          const amounts = (await pancakeRouter.getAmountsOut(effectiveInWei, path)) as bigint[];
          const outWei = amounts[amounts.length - 1];
          if (outWei <= 0n) return null;
          return { dex: 'pancakeswap', routes: [], pancakePath: path, outWei };
        } catch {
          return null;
        }
      })
    ),
    fetchKyberFeeQuote({ tokenIn, tokenOut, amountInWei, mode }),
  ]);

  const valid = [...thenaResults, ...pancakeResults].filter(
    (r): r is QuoteCandidate => r !== null
  );
  if (valid.length === 0 && !kyberFeeQuote) return null;

  valid.sort((a, b) => (b.outWei > a.outWei ? 1 : b.outWei < a.outWei ? -1 : 0));
  const best = valid[0];

  let pairAddress: string | null = null;
  let feeBps = best
    ? best.dex === 'pancakeswap'
      ? 25 * (best.pancakePath.length - 1)
      : best.routes[0].stable
      ? 4
      : 20
    : 25;
  let priceImpactPct = 0;

  try {
    if (best && best.dex === 'thena') {
      const firstHop = best.routes[0];
      const [pAddr, feeVal] = await Promise.all([
        thenaFactory.getPair(firstHop.from, firstHop.to, firstHop.stable) as Promise<string>,
        thenaFactory.getFee(firstHop.stable) as Promise<bigint>,
      ]);
      if (pAddr && pAddr !== ethers.ZeroAddress) {
        pairAddress = pAddr;
        feeBps = Number(feeVal) * best.routes.length;
        if (best.routes.length === 1) {
          const pair = new ethers.Contract(pAddr, PAIR_ABI, provider);
          const [[r0, r1], t0] = await Promise.all([
            pair.getReserves() as Promise<[bigint, bigint, bigint]>,
            pair.token0() as Promise<string>,
          ]);
          const isT0In = t0.toLowerCase() === tokenIn.address.toLowerCase();
          const resIn = Number(ethers.formatUnits(isT0In ? r0 : r1, tokenIn.decimals));
          const resOut = Number(ethers.formatUnits(isT0In ? r1 : r0, tokenOut.decimals));
          const inFloat = Number(ethers.formatUnits(amountInWei, tokenIn.decimals));
          const outFloat = Number(ethers.formatUnits(best.outWei, tokenOut.decimals));
          if (resIn > 0 && resOut > 0 && inFloat > 0) {
            const spot = resOut / resIn;
            const exec = outFloat / inFloat;
            priceImpactPct = Math.max(0, ((spot - exec) / spot) * 100);
          }
        } else {
          priceImpactPct = 0.05;
        }
      }
    } else if (best && best.dex === 'pancakeswap') {
      const pAddr = (await pancakeFactory.getPair(
        best.pancakePath[0],
        best.pancakePath[1]
      )) as string;
      if (pAddr && pAddr !== ethers.ZeroAddress) {
        pairAddress = pAddr;
        if (best.pancakePath.length === 2) {
          const pair = new ethers.Contract(pAddr, PAIR_ABI, provider);
          const [[r0, r1], t0] = await Promise.all([
            pair.getReserves() as Promise<[bigint, bigint, bigint]>,
            pair.token0() as Promise<string>,
          ]);
          const isT0In = t0.toLowerCase() === tokenIn.address.toLowerCase();
          const resIn = Number(ethers.formatUnits(isT0In ? r0 : r1, tokenIn.decimals));
          const resOut = Number(ethers.formatUnits(isT0In ? r1 : r0, tokenOut.decimals));
          const inFloat = Number(ethers.formatUnits(amountInWei, tokenIn.decimals));
          const outFloat = Number(ethers.formatUnits(best.outWei, tokenOut.decimals));
          if (resIn > 0 && resOut > 0 && inFloat > 0) {
            const spot = resOut / resIn;
            const exec = outFloat / inFloat;
            priceImpactPct = Math.max(0, ((spot - exec) / spot) * 100);
          }
        } else {
          priceImpactPct = 0.25;
        }
      }
    }
  } catch {
    // Non-fatal metadata lookup
  }

  const kyberOutWei = kyberFeeQuote ? BigInt(kyberFeeQuote.routeSummary.amountOut) : 0n;
  const shouldPreferWrapper =
    Boolean(feeWrapperAddress && best) && (!kyberFeeQuote || (best && best.outWei >= kyberOutWei));

  if (kyberFeeQuote && !shouldPreferWrapper) {
    const outWei = kyberOutWei;
    const { dex, dexLabel } = summarizeKyberExchanges(kyberFeeQuote.routeSummary.route);
    const primaryBranch = kyberFeeQuote.routeSummary.route[0] || [];
    const kyberSymbols = [tokenIn.symbol];
    for (let i = 0; i < primaryBranch.length; i++) {
      const addr = primaryBranch[i].tokenOut.toLowerCase();
      if (i === primaryBranch.length - 1) {
        kyberSymbols.push(tokenOut.symbol);
      } else {
        kyberSymbols.push(
          addr === WBNB_ADDRESS.toLowerCase()
            ? 'WBNB'
            : tokenSymbolMap[addr] || `${addr.slice(0, 6)}...`
        );
      }
    }
    if (kyberSymbols.length === 1) kyberSymbols.push(tokenOut.symbol);

    return {
      dex,
      dexLabel,
      routerAddress: kyberFeeQuote.routerAddress,
      amountOutWei: outWei,
      amountOutFormatted: ethers.formatUnits(outWei, tokenOut.decimals),
      routes: best?.routes || [],
      pancakePath: best?.pancakePath || [],
      routeSymbols: kyberSymbols,
      priceImpactPct,
      feeBps,
      platformFeeBps: PLATFORM_FEE_BPS,
      platformFeeWei,
      platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
      pairAddress,
      isWrapOrUnwrap: false,
      kyberRouteSummary: kyberFeeQuote.routeSummary,
    };
  }

  if (!feeWrapperAddress || !best) {
    throw new Error(
      '0.25% platform fee enforcement active: deploy TamiSwapFeeRouter (VITE_FEE_ROUTER_ADDRESS) to route unindexed BEP-20 tokens directly through THENA/PancakeSwap with your platform fee.'
    );
  }

  const routeSymbols = [tokenIn.symbol];
  if (best.dex === 'thena') {
    for (let i = 0; i < best.routes.length; i++) {
      const addr = best.routes[i].to.toLowerCase();
      if (i === best.routes.length - 1) {
        routeSymbols.push(tokenOut.symbol);
      } else {
        routeSymbols.push(tokenSymbolMap[addr] || `${addr.slice(0, 6)}...`);
      }
    }
  } else {
    for (let i = 1; i < best.pancakePath.length; i++) {
      const addr = best.pancakePath[i].toLowerCase();
      if (i === best.pancakePath.length - 1) {
        routeSymbols.push(tokenOut.symbol);
      } else {
        routeSymbols.push(tokenSymbolMap[addr] || `${addr.slice(0, 6)}...`);
      }
    }
  }

  return {
    dex: best.dex,
    dexLabel: best.dex === 'pancakeswap' ? 'PancakeSwap V2' : 'THENA RouterV2',
    routerAddress: feeWrapperAddress,
    amountOutWei: best.outWei,
    amountOutFormatted: ethers.formatUnits(best.outWei, tokenOut.decimals),
    routes: best.routes,
    pancakePath: best.pancakePath,
    routeSymbols,
    priceImpactPct,
    feeBps,
    platformFeeBps: PLATFORM_FEE_BPS,
    platformFeeWei,
    platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
    pairAddress,
    isWrapOrUnwrap: false,
    useFeeWrapper: true,
  };
}

export interface SubmittedTx {
  hash: string;
  wait: () => Promise<ethers.TransactionReceipt | null>;
}

export async function getWalletSenderAddress(
  ethereum: ethers.Eip1193Provider
): Promise<string> {
  const accounts = (await ethereum.request({ method: 'eth_accounts' })) as string[] | null;
  if (accounts && accounts.length > 0 && ethers.isAddress(accounts[0])) {
    return ethers.getAddress(accounts[0]);
  }
  const requested = (await ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[] | null;
  if (requested && requested.length > 0 && ethers.isAddress(requested[0])) {
    return ethers.getAddress(requested[0]);
  }
  throw new Error('No wallet account connected.');
}

export async function estimateBscGasSafe(
  readProvider: ethers.JsonRpcProvider,
  tx: { from: string; to?: string; data: string; value: bigint },
  fallbackGas: bigint
): Promise<bigint> {
  try {
    const est = await readProvider.estimateGas(tx);
    // Add 30% safety headroom so fee-on-transfer / multi-hop swaps never run out of gas
    const buffered = (est * 130n) / 100n;
    return buffered > fallbackGas ? buffered : fallbackGas;
  } catch (err: unknown) {
    const msg = collectErrorMessages(err).join(' ').toLowerCase();
    const isRealRevert =
      msg.includes('revert') ||
      msg.includes('insufficient') ||
      msg.includes('return amount') ||
      msg.includes('transfer_from_failed') ||
      msg.includes('allowance') ||
      msg.includes('expired') ||
      msg.includes('call_exception');
    if (isRealRevert) {
      throw err;
    }
    return fallbackGas;
  }
}

export async function sendWalletTransaction(params: {
  ethereum: ethers.Eip1193Provider;
  from: string;
  to?: string;
  data: string;
  valueWei: bigint;
  readProvider: ethers.JsonRpcProvider;
  gasLimit: bigint;
}): Promise<SubmittedTx> {
  const { ethereum, from, to, data, valueWei, readProvider, gasLimit } = params;

  let gasPrice = ethers.parseUnits('1', 'gwei');
  try {
    const feeData = await readProvider.getFeeData();
    if (feeData.gasPrice && feeData.gasPrice > 0n) {
      // Slight 10% priority bump above node floor for fast BSC inclusion
      gasPrice = (feeData.gasPrice * 110n) / 100n;
    }
  } catch {
    // Keep 1 gwei BSC fallback
  }

  const baseTx: Record<string, string> = {
    from,
    data,
    value: ethers.toQuantity(valueWei),
    gas: ethers.toQuantity(gasLimit),
  };
  if (to) {
    baseTx.to = ethers.getAddress(to);
  }

  let txHash: string;
  try {
    txHash = (await ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ ...baseTx, gasPrice: ethers.toQuantity(gasPrice) }],
    })) as string;
  } catch (err: unknown) {
    if (isUserRejectedWalletError(err)) {
      throw new Error('Transaction cancelled in wallet.');
    }
    const msg = collectErrorMessages(err).join(' ').toLowerCase();
    // Some strict EIP-1559 wallet wrappers reject explicit legacy gasPrice — retry without gasPrice
    if (
      msg.includes('gasprice') ||
      msg.includes('maxfeepergas') ||
      msg.includes('eip-1559') ||
      msg.includes('invalid')
    ) {
      try {
        txHash = (await ethereum.request({
          method: 'eth_sendTransaction',
          params: [baseTx],
        })) as string;
      } catch (retryErr: unknown) {
        throw new Error(formatWalletError(retryErr));
      }
    } else {
      throw new Error(formatWalletError(err));
    }
  }

  return {
    hash: txHash,
    wait: async () => await readProvider.waitForTransaction(txHash, 1, 90_000),
  };
}

export async function approveTokenForRouter(
  ethereum: ethers.Eip1193Provider,
  tokenAddress: string,
  amountWei: bigint,
  spenderAddress: string = THENA_ROUTER_V2_ADDRESS
): Promise<ethers.TransactionReceipt | null> {
  await ensureBscNetwork(ethereum);
  const from = await getWalletSenderAddress(ethereum);
  const readProvider = await getBscReadProvider();
  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('approve', [
    ethers.getAddress(spenderAddress),
    amountWei,
  ]);
  const to = ethers.getAddress(tokenAddress);
  const gasLimit = await estimateBscGasSafe(
    readProvider,
    { from, to, data, value: 0n },
    85_000n
  );

  const submitted = await sendWalletTransaction({
    ethereum,
    from,
    to,
    data,
    valueWei: 0n,
    readProvider,
    gasLimit,
  });
  return await submitted.wait();
}

export async function executeOnChainSwap(params: {
  ethereum: ethers.Eip1193Provider;
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountInWei: bigint;
  amountOutMinWei: bigint;
  quote: OnChainQuote;
  deadlineMinutes: number;
  slippagePct?: number;
}): Promise<SubmittedTx> {
  const {
    ethereum,
    tokenIn,
    tokenOut,
    amountInWei,
    amountOutMinWei,
    quote,
    deadlineMinutes,
    slippagePct,
  } = params;

  await ensureBscNetwork(ethereum);
  const userAddress = await getWalletSenderAddress(ethereum);
  const readProvider = await getBscReadProvider();

  if (quote.isWrapOrUnwrap) {
    const wbnbIface = new ethers.Interface(WBNB_ABI);
    const data = tokenIn.isNative
      ? wbnbIface.encodeFunctionData('deposit')
      : wbnbIface.encodeFunctionData('withdraw', [amountInWei]);
    const valueWei = tokenIn.isNative ? amountInWei : 0n;
    const gasLimit = await estimateBscGasSafe(
      readProvider,
      { from: userAddress, to: WBNB_ADDRESS, data, value: valueWei },
      70_000n
    );
    return await sendWalletTransaction({
      ethereum,
      from: userAddress,
      to: WBNB_ADDRESS,
      data,
      valueWei,
      readProvider,
      gasLimit,
    });
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  if (quote.kyberRouteSummary) {
    const computedBps =
      slippagePct !== undefined
        ? Math.round(slippagePct * 100)
        : quote.amountOutWei > 0n
        ? Number(((quote.amountOutWei - amountOutMinWei) * 10000n) / quote.amountOutWei)
        : 50;
    const slippageTolerance = Math.max(5, Math.min(2000, computedBps));

    const buildKyberTx = async (summary: KyberRouteSummary, tolBps: number) => {
      const buildRes = await fetch(`${KYBER_BSC_API}/route/build`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': 'TamiSwap',
        },
        body: JSON.stringify({
          routeSummary: summary,
          sender: userAddress,
          recipient: userAddress,
          slippageTolerance: tolBps,
          deadline: Number(deadline),
        }),
      });
      const built = (await buildRes.json()) as KyberBuildResponse;
      if (!buildRes.ok || built.code !== 0 || !built.data?.data || !built.data?.routerAddress) {
        throw new Error(built.message || 'Unable to build swap transaction with platform fee.');
      }
      return {
        to: ethers.getAddress(built.data.routerAddress),
        data: built.data.data,
        valueWei: tokenIn.isNative ? amountInWei : 0n,
      };
    };

    let txPayload = await buildKyberTx(quote.kyberRouteSummary, slippageTolerance);
    let gasLimit: bigint;
    try {
      gasLimit = await estimateBscGasSafe(
        readProvider,
        {
          from: userAddress,
          to: txPayload.to,
          data: txPayload.data,
          value: txPayload.valueWei,
        },
        360_000n
      );
    } catch (estErr: unknown) {
      const errText = collectErrorMessages(estErr).join(' ').toLowerCase();
      // If price moved slightly since quote, try once with a fresh Kyber route before failing
      if (
        errText.includes('return amount is not enough') ||
        errText.includes('insufficient_output_amount')
      ) {
        const fresh = await fetchKyberFeeQuote({
          tokenIn,
          tokenOut,
          amountInWei,
          mode: 'auto',
        });
        if (fresh) {
          const freshPayload = await buildKyberTx(fresh.routeSummary, slippageTolerance);
          try {
            gasLimit = await estimateBscGasSafe(
              readProvider,
              {
                from: userAddress,
                to: freshPayload.to,
                data: freshPayload.data,
                value: freshPayload.valueWei,
              },
              360_000n
            );
            txPayload = freshPayload;
          } catch (freshErr: unknown) {
            // Check if higher slippage resolves a transfer-tax token (e.g. GTAN / WKC)
            for (const testBps of [300, 600, 1200]) {
              if (testBps <= slippageTolerance) continue;
              try {
                const probePayload = await buildKyberTx(fresh.routeSummary, testBps);
                await estimateBscGasSafe(
                  readProvider,
                  {
                    from: userAddress,
                    to: probePayload.to,
                    data: probePayload.data,
                    value: probePayload.valueWei,
                  },
                  360_000n
                );
                throw new Error(
                  `NEED_SLIPPAGE_${testBps / 100}:This token charges a transfer tax or moved in price — tap "Use ${testBps / 100}% Slippage" or raise Slippage in Settings.`
                );
              } catch (probeErr: unknown) {
                if (
                  probeErr instanceof Error &&
                  probeErr.message.startsWith('NEED_SLIPPAGE_')
                ) {
                  throw probeErr;
                }
              }
            }
            throw new Error(formatWalletError(freshErr));
          }
        } else {
          throw new Error(formatWalletError(estErr));
        }
      } else {
        throw new Error(formatWalletError(estErr));
      }
    }

    return await sendWalletTransaction({
      ethereum,
      from: userAddress,
      to: txPayload.to,
      data: txPayload.data,
      valueWei: txPayload.valueWei,
      readProvider,
      gasLimit,
    });
  }

  if (quote.useFeeWrapper) {
    const feeWrapperAddress = getConfiguredFeeWrapperAddress();
    if (!feeWrapperAddress) {
      throw new Error('TamiSwapFeeRouter contract address is not configured.');
    }
    const feeIface = new ethers.Interface(TAMI_FEE_ROUTER_ABI);
    let data = '';
    const valueWei = tokenIn.isNative && !tokenOut.isNative ? amountInWei : 0n;

    if (quote.dex === 'pancakeswap') {
      if (tokenIn.isNative && !tokenOut.isNative) {
        data = feeIface.encodeFunctionData('swapExactETHForTokensOnPancake', [
          amountOutMinWei,
          quote.pancakePath,
          userAddress,
          deadline,
        ]);
      } else if (!tokenIn.isNative && tokenOut.isNative) {
        data = feeIface.encodeFunctionData('swapExactTokensForETHOnPancake', [
          amountInWei,
          amountOutMinWei,
          quote.pancakePath,
          userAddress,
          deadline,
        ]);
      } else {
        data = feeIface.encodeFunctionData('swapExactTokensForTokensOnPancake', [
          amountInWei,
          amountOutMinWei,
          quote.pancakePath,
          userAddress,
          deadline,
        ]);
      }
    } else if (tokenIn.isNative && !tokenOut.isNative) {
      data = feeIface.encodeFunctionData('swapExactETHForTokensOnThena', [
        amountOutMinWei,
        quote.routes,
        userAddress,
        deadline,
      ]);
    } else if (!tokenIn.isNative && tokenOut.isNative) {
      data = feeIface.encodeFunctionData('swapExactTokensForETHOnThena', [
        amountInWei,
        amountOutMinWei,
        quote.routes,
        userAddress,
        deadline,
      ]);
    } else {
      data = feeIface.encodeFunctionData('swapExactTokensForTokensOnThena', [
        amountInWei,
        amountOutMinWei,
        quote.routes,
        userAddress,
        deadline,
      ]);
    }

    let gasLimit: bigint;
    try {
      gasLimit = await estimateBscGasSafe(
        readProvider,
        { from: userAddress, to: feeWrapperAddress, data, value: valueWei },
        360_000n
      );
    } catch (estErr: unknown) {
      throw new Error(formatWalletError(estErr));
    }

    return await sendWalletTransaction({
      ethereum,
      from: userAddress,
      to: feeWrapperAddress,
      data,
      valueWei,
      readProvider,
      gasLimit,
    });
  }

  throw new Error(
    'Platform fee enforcement blocked un-wrapped execution. Refresh your quote to route with the 0.25% fee.'
  );
}
