import { ethers } from 'ethers';
import {
  BSC_CHAIN_ID,
  BSC_CHAIN_ID_HEX,
  BSC_RPC_URLS,
  SwapToken,
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

export interface OnChainQuote {
  amountOutWei: bigint;
  amountOutFormatted: string;
  routes: RouteHop[];
  routeSymbols: string[];
  priceImpactPct: number;
  feeBps: number;
  pairAddress: string | null;
  isWrapOrUnwrap: boolean;
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

const PAIR_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB, bool stable) view returns (address)',
  'function getFee(bool _stable) view returns (uint256)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)',
  'function token0() view returns (address)',
];

let cachedReadProvider: ethers.JsonRpcProvider | null = null;

export async function getBscReadProvider(): Promise<ethers.JsonRpcProvider> {
  if (cachedReadProvider) return cachedReadProvider;
  for (const url of BSC_RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, BSC_CHAIN_ID, {
        staticNetwork: ethers.Network.from(BSC_CHAIN_ID),
      });
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500)),
      ]);
      cachedReadProvider = provider;
      return provider;
    } catch {
      // try next RPC
    }
  }
  // Fallback to primary
  return new ethers.JsonRpcProvider(BSC_RPC_URLS[0], BSC_CHAIN_ID, {
    staticNetwork: ethers.Network.from(BSC_CHAIN_ID),
  });
}

export async function ensureBscNetwork(ethereum: ethers.Eip1193Provider): Promise<void> {
  const chainIdHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
  if (parseInt(chainIdHex, 16) === BSC_CHAIN_ID) return;

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BSC_CHAIN_ID_HEX,
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: ['https://bsc-dataseed1.binance.org/'],
            blockExplorerUrls: ['https://bscscan.com/'],
          },
        ],
      });
    } else {
      throw err;
    }
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
  ownerAddress: string
): Promise<bigint> {
  const provider = await getBscReadProvider();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return (await token.allowance(ownerAddress, THENA_ROUTER_V2_ADDRESS)) as bigint;
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
      amountOutWei: amountInWei,
      amountOutFormatted: ethers.formatUnits(amountInWei, tokenOut.decimals),
      routes: [],
      routeSymbols: [tokenIn.symbol, tokenOut.symbol],
      priceImpactPct: 0,
      feeBps: 0,
      pairAddress: WBNB_ADDRESS,
      isWrapOrUnwrap: true,
    };
  }

  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    return null;
  }

  const provider = await getBscReadProvider();
  const router = new ethers.Contract(THENA_ROUTER_V2_ADDRESS, ROUTER_V2_ABI, provider);
  const factory = new ethers.Contract(THENA_PAIR_FACTORY_ADDRESS, PAIR_FACTORY_ABI, provider);

  const candidateRoutes: RouteHop[][] = [];
  const tryModes: boolean[] =
    mode === 'volatile' ? [false] : mode === 'stable' ? [true] : [false, true];

  // Direct 1-hop routes
  for (const stable of tryModes) {
    candidateRoutes.push([{ from: tokenIn.address, to: tokenOut.address, stable }]);
  }

  // 2-hop routes through WBNB and USDT when in auto mode or direct pair has low/no liquidity
  const intermediates = [WBNB_ADDRESS, USDT_ADDRESS].filter(
    (mid) =>
      mid.toLowerCase() !== tokenIn.address.toLowerCase() &&
      mid.toLowerCase() !== tokenOut.address.toLowerCase()
  );

  for (const mid of intermediates) {
    for (const s1 of tryModes) {
      for (const s2 of tryModes) {
        candidateRoutes.push([
          { from: tokenIn.address, to: mid, stable: s1 },
          { from: mid, to: tokenOut.address, stable: s2 },
        ]);
      }
    }
  }

  const results = await Promise.all(
    candidateRoutes.map(async (routes) => {
      try {
        const amounts = (await router.getAmountsOut(amountInWei, routes)) as bigint[];
        const outWei = amounts[amounts.length - 1];
        if (outWei <= 0n) return null;
        return { routes, outWei };
      } catch {
        return null;
      }
    })
  );

  const valid = results.filter(
    (r): r is { routes: RouteHop[]; outWei: bigint } => r !== null
  );
  if (valid.length === 0) return null;

  valid.sort((a, b) => (b.outWei > a.outWei ? 1 : b.outWei < a.outWei ? -1 : 0));
  const best = valid[0];

  // Inspect first hop pair reserves & fee for price impact display
  let pairAddress: string | null = null;
  let feeBps = best.routes[0].stable ? 4 : 20;
  let priceImpactPct = 0;

  try {
    const firstHop = best.routes[0];
    const [pAddr, feeVal] = await Promise.all([
      factory.getPair(firstHop.from, firstHop.to, firstHop.stable) as Promise<string>,
      factory.getFee(firstHop.stable) as Promise<bigint>,
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
        // Approximate multi-hop impact conservatively from fee + depth
        priceImpactPct = 0.05;
      }
    }
  } catch {
    // Non-fatal metadata lookup
  }

  const routeSymbols = [tokenIn.symbol];
  for (let i = 0; i < best.routes.length; i++) {
    const addr = best.routes[i].to.toLowerCase();
    if (i === best.routes.length - 1) {
      routeSymbols.push(tokenOut.symbol);
    } else {
      routeSymbols.push(tokenSymbolMap[addr] || `${addr.slice(0, 6)}...`);
    }
  }

  return {
    amountOutWei: best.outWei,
    amountOutFormatted: ethers.formatUnits(best.outWei, tokenOut.decimals),
    routes: best.routes,
    routeSymbols,
    priceImpactPct,
    feeBps,
    pairAddress,
    isWrapOrUnwrap: false,
  };
}

export async function approveTokenForRouter(
  ethereum: ethers.Eip1193Provider,
  tokenAddress: string,
  amountWei: bigint
): Promise<ethers.TransactionReceipt | null> {
  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = (await token.approve(
    THENA_ROUTER_V2_ADDRESS,
    amountWei
  )) as ethers.TransactionResponse;
  return await tx.wait();
}

export async function executeOnChainSwap(params: {
  ethereum: ethers.Eip1193Provider;
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountInWei: bigint;
  amountOutMinWei: bigint;
  routes: RouteHop[];
  deadlineMinutes: number;
  isWrapOrUnwrap: boolean;
}): Promise<ethers.TransactionResponse> {
  const {
    ethereum,
    tokenIn,
    tokenOut,
    amountInWei,
    amountOutMinWei,
    routes,
    deadlineMinutes,
    isWrapOrUnwrap,
  } = params;

  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const userAddress = await signer.getAddress();

  if (isWrapOrUnwrap) {
    const wbnb = new ethers.Contract(WBNB_ADDRESS, WBNB_ABI, signer);
    if (tokenIn.isNative) {
      return (await wbnb.deposit({ value: amountInWei })) as ethers.TransactionResponse;
    } else {
      return (await wbnb.withdraw(amountInWei)) as ethers.TransactionResponse;
    }
  }

  const router = new ethers.Contract(THENA_ROUTER_V2_ADDRESS, ROUTER_V2_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  if (tokenIn.isNative && !tokenOut.isNative) {
    return (await router.swapExactETHForTokens(
      amountOutMinWei,
      routes,
      userAddress,
      deadline,
      { value: amountInWei }
    )) as ethers.TransactionResponse;
  }

  if (!tokenIn.isNative && tokenOut.isNative) {
    return (await router.swapExactTokensForETH(
      amountInWei,
      amountOutMinWei,
      routes,
      userAddress,
      deadline
    )) as ethers.TransactionResponse;
  }

  return (await router.swapExactTokensForTokens(
    amountInWei,
    amountOutMinWei,
    routes,
    userAddress,
    deadline
  )) as ethers.TransactionResponse;
}
