import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { motion } from 'motion/react';
import {
  ArrowDownUp,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  BSC_CHAIN_ID,
  PLATFORM_FEE_RECIPIENT,
  THENA_ROUTER_V2_ADDRESS,
} from '../data/swapTokens';
import {
  approveTokenForRouter,
  executeOnChainSwap,
  fetchAllowance,
  fetchOnChainQuote,
  fetchWalletBalances,
  OnChainQuote,
} from '../utils/bscWeb3';
import {
  BNB_STAKING_POOLS,
  BnbStakingPool,
  fetchLiveBnbStakingStats,
  NATIVE_BNB_TOKEN,
  StakingPoolStats,
} from '../utils/staking';
import { TokenLogo } from './TokenLogo';

interface StakingViewProps {
  walletAddress: string | null;
  chainId: number | null;
  provider: ethers.Eip1193Provider | null;
  onConnectWallet: () => void;
  onSwitchToBsc: () => void;
  isGreenMode?: boolean;
}

type StakeAction = 'stake' | 'unstake';

function formatAmount(rawStr: string, maxDecimals = 6): string {
  const num = Number(rawStr);
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num < 0.000001) return '<0.000001';
  const digits = num >= 1_000_000 ? 0 : num >= 1_000 ? 2 : num >= 1 ? 4 : maxDecimals;
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTvlCompact(tvlUsd: number | null, pooledBnb: number | null): string {
  if (tvlUsd && tvlUsd > 0) {
    if (tvlUsd >= 1_000_000_000) return `$${(tvlUsd / 1_000_000_000).toFixed(2)}B`;
    if (tvlUsd >= 1_000_000) return `$${(tvlUsd / 1_000_000).toFixed(1)}M`;
    if (tvlUsd >= 1_000) return `$${(tvlUsd / 1_000).toFixed(0)}K`;
    return `$${tvlUsd.toFixed(0)}`;
  }
  if (pooledBnb && pooledBnb > 0) {
    return `${Math.round(pooledBnb).toLocaleString()} BNB`;
  }
  return 'Live BSC';
}

function computeMinReceivedWei(amountOutWei: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  const keepBps = 10000n - bps;
  return (amountOutWei * (keepBps > 0n ? keepBps : 0n)) / 10000n;
}

export function StakingView({
  walletAddress,
  chainId,
  provider,
  onConnectWallet,
  onSwitchToBsc,
  isGreenMode = false,
}: StakingViewProps) {
  const [selectedPoolId, setSelectedPoolId] = useState<BnbStakingPool['id']>('slisbnb');
  const [action, setAction] = useState<StakeAction>('stake');
  const [amountStr, setAmountStr] = useState('0.1');

  const [statsMap, setStatsMap] = useState<Record<string, StakingPoolStats>>({});
  const [loadingStats, setLoadingStats] = useState(true);

  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [quote, setQuote] = useState<OnChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [allowanceWei, setAllowanceWei] = useState<bigint>(ethers.MaxUint256);
  const [checkingAllowance, setCheckingAllowance] = useState(false);

  const [txPending, setTxPending] = useState<'approve' | 'stake' | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatusText, setTxStatusText] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const slippagePct = 0.5;
  const deadlineMin = 20;

  const activePool = useMemo(
    () => BNB_STAKING_POOLS.find((p) => p.id === selectedPoolId) || BNB_STAKING_POOLS[0],
    [selectedPoolId]
  );

  const poolStats = statsMap[activePool.id];
  const tokenIn = action === 'stake' ? NATIVE_BNB_TOKEN : activePool.token;
  const tokenOut = action === 'stake' ? activePool.token : NATIVE_BNB_TOKEN;

  const tokenSymbolMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of BNB_STAKING_POOLS) {
      map[p.token.address.toLowerCase()] = p.token.symbol;
    }
    return map;
  }, []);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const next = await fetchLiveBnbStakingStats();
      setStatsMap(next);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setBalances({});
      return;
    }
    setLoadingBalances(true);
    try {
      const tokens = [NATIVE_BNB_TOKEN, ...BNB_STAKING_POOLS.map((p) => p.token)];
      const next = await fetchWalletBalances(walletAddress, tokens);
      setBalances(next);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const amountInWei = useMemo(() => {
    const clean = amountStr.trim();
    if (!clean || Number(clean) <= 0 || !Number.isFinite(Number(clean))) return 0n;
    try {
      return ethers.parseUnits(clean, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountStr, tokenIn.decimals]);

  // Fetch live on-chain Stake / Unstake quote (includes 0.25% platform fee to treasury)
  useEffect(() => {
    if (amountInWei <= 0n) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }

    let cancelled = false;
    setQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetchOnChainQuote({
          tokenIn,
          tokenOut,
          amountInWei,
          mode: 'auto',
          tokenSymbolMap,
        });
        if (cancelled) return;
        if (!res) {
          setQuote(null);
          setQuoteError('No live BSC liquidity route found for this pool.');
        } else {
          setQuote(res);
          setQuoteError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(
            err instanceof Error ? err.message : 'Unable to reach BNB Chain RPC'
          );
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tokenIn, tokenOut, amountInWei, tokenSymbolMap]);

  // Check allowance when unstaking BEP-20 staked BNB token
  const refreshAllowance = useCallback(async () => {
    if (!walletAddress || tokenIn.isNative) {
      setAllowanceWei(ethers.MaxUint256);
      return;
    }
    setCheckingAllowance(true);
    try {
      const spenderAddress = quote?.routerAddress || THENA_ROUTER_V2_ADDRESS;
      const val = await fetchAllowance(tokenIn.address, walletAddress, spenderAddress);
      setAllowanceWei(val);
    } catch {
      setAllowanceWei(0n);
    } finally {
      setCheckingAllowance(false);
    }
  }, [walletAddress, tokenIn, quote?.routerAddress]);

  useEffect(() => {
    void refreshAllowance();
  }, [refreshAllowance]);

  const bnbBalanceStr = balances['BNB'] || '0';
  const stakedBalanceStr = balances[activePool.token.symbol] || '0';
  const balanceInStr = action === 'stake' ? bnbBalanceStr : stakedBalanceStr;

  const balanceInWei = useMemo(() => {
    try {
      return ethers.parseUnits(balanceInStr || '0', tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [balanceInStr, tokenIn.decimals]);

  const insufficientBalance = Boolean(walletAddress) && amountInWei > balanceInWei;
  const wrongNetwork =
    Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;
  const needsApproval =
    Boolean(walletAddress) &&
    !wrongNetwork &&
    !tokenIn.isNative &&
    amountInWei > 0n &&
    allowanceWei < amountInWei;

  const minReceivedWei = useMemo(() => {
    if (!quote) return 0n;
    return computeMinReceivedWei(quote.amountOutWei, slippagePct);
  }, [quote]);

  const exchangeRate = useMemo(() => {
    if (!quote || amountInWei <= 0n) return 0;
    const inF = Number(ethers.formatUnits(amountInWei, tokenIn.decimals));
    const outF = Number(quote.amountOutFormatted);
    return inF > 0 ? outF / inF : 0;
  }, [quote, amountInWei, tokenIn.decimals]);

  const stakedBnbValue = useMemo(() => {
    const staked = Number(stakedBalanceStr);
    const ratio = poolStats?.bnbPerToken;
    if (!Number.isFinite(staked) || staked <= 0 || !ratio) return null;
    return staked * ratio;
  }, [stakedBalanceStr, poolStats?.bnbPerToken]);

  function handleFillFraction(num: number, den: number) {
    if (balanceInWei <= 0n) {
      setAmountStr('0');
      return;
    }
    let usable = (balanceInWei * BigInt(num)) / BigInt(den);
    if (tokenIn.isNative && num === 1 && den === 1) {
      const gasBuffer = ethers.parseEther('0.003');
      usable = balanceInWei > gasBuffer ? balanceInWei - gasBuffer : 0n;
    }
    const formatted = ethers.formatUnits(usable, tokenIn.decimals);
    const trimmed = Number(formatted).toFixed(6).replace(/\.?0+$/, '');
    setAmountStr(trimmed || '0');
    setTxHash(null);
    setTxError(null);
    setTxStatusText(null);
  }

  async function handleApprove() {
    if (!provider || !walletAddress || !quote) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('approve');
    setTxStatusText(`Approving ${tokenIn.symbol} for BNB unstaking...`);
    try {
      const receipt = await approveTokenForRouter(
        provider,
        tokenIn.address,
        amountInWei,
        quote.routerAddress
      );
      if (receipt?.hash) {
        setTxHash(receipt.hash);
      }
      setTxStatusText(`${tokenIn.symbol} approved. Ready to unstake to BNB.`);
      await refreshAllowance();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Approval transaction failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleExecuteStakeAction() {
    if (!provider || !walletAddress || !quote) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('stake');
    setTxStatusText(
      action === 'stake'
        ? `Confirm BNB staking (${amountStr} BNB → ${activePool.token.symbol}) in wallet...`
        : `Confirm unstaking (${amountStr} ${activePool.token.symbol} → BNB) in wallet...`
    );
    try {
      const tx = await executeOnChainSwap({
        ethereum: provider,
        tokenIn,
        tokenOut,
        amountInWei,
        amountOutMinWei: minReceivedWei,
        quote,
        deadlineMinutes: deadlineMin,
        slippagePct,
      });
      setTxHash(tx.hash);
      setTxStatusText('Transaction broadcast on BNB Chain. Waiting for confirmation...');
      await tx.wait();
      setTxStatusText(
        action === 'stake'
          ? `Staked ${amountStr} BNB into ${activePool.token.symbol}.`
          : `Unstaked ${amountStr} ${activePool.token.symbol} back to BNB.`
      );
      await Promise.all([refreshBalances(), refreshAllowance(), loadStats()]);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Staking transaction failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="armor-chassis-shell relative w-full max-w-[520px]"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-1.5 left-1/2 z-20 h-3 w-48 -translate-x-1/2 rounded-full blur-md ${
          isGreenMode ? 'bg-emerald-400/90' : 'bg-cyan-300/90'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-1.5 left-1/2 z-20 h-3 w-44 -translate-x-1/2 rounded-full blur-md ${
          isGreenMode ? 'bg-emerald-500/85' : 'bg-sky-400/85'
        }`}
      />

      <div className="armor-chassis-rim">
        <div className="armor-chassis relative overflow-hidden p-4 sm:p-6">
          <div
            aria-hidden="true"
            className={`energy-vein-beam pointer-events-none absolute top-0 right-6 left-6 h-[2.5px] bg-gradient-to-r from-transparent to-transparent ${
              isGreenMode ? 'via-emerald-200' : 'via-cyan-200'
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute right-8 bottom-0 left-8 h-[2px] bg-gradient-to-r from-transparent to-transparent ${
              isGreenMode ? 'via-emerald-400' : 'via-cyan-300'
            }`}
          />

          {/* Section Header */}
          <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display chrome-text text-xl sm:text-2xl font-extrabold tracking-widest uppercase">
                BNB Staking
              </h1>
              <p className="mt-1 text-xs text-slate-300">
                Liquid BNB Smart Chain staking · Earn on-chain yield · 0.25% platform fee
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadStats();
                void refreshBalances();
              }}
              disabled={loadingStats || loadingBalances}
              title="Refresh staking pools and balances"
              className={`combat-steel-btn p-2.5 text-slate-200 disabled:opacity-50 ${
                isGreenMode ? 'hover:text-emerald-300' : 'hover:text-cyan-300'
              }`}
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loadingStats || loadingBalances
                    ? `animate-spin ${isGreenMode ? 'text-emerald-300' : 'text-cyan-300'}`
                    : ''
                }`}
              />
            </button>
          </div>

          {/* Pool Selector Tabs */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well grid grid-cols-2 gap-1.5 p-1.5">
              {BNB_STAKING_POOLS.map((pool) => {
                const isActive = pool.id === activePool.id;
                const s = statsMap[pool.id];
                return (
                  <button
                    key={pool.id}
                    type="button"
                    onClick={() => {
                      setSelectedPoolId(pool.id);
                      setTxHash(null);
                      setTxError(null);
                      setTxStatusText(null);
                    }}
                    className={`flex items-center justify-between gap-2 px-2.5 py-2 text-left transition-all ${
                      isActive
                        ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                        : isGreenMode
                        ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                        : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <TokenLogo token={pool.token} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs font-bold">
                          {pool.token.symbol}
                        </span>
                        <span className="block truncate text-[10px] text-slate-300">
                          {pool.protocolName}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[11px] font-bold tabular-nums ${
                        isActive
                          ? 'text-white'
                          : isGreenMode
                          ? 'text-emerald-300'
                          : 'text-cyan-300'
                      }`}
                    >
                      {s?.apyPct && s.apyPct > 0 ? `${s.apyPct.toFixed(2)}%` : 'Live'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Pool Metrics Row */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well grid grid-cols-3 divide-x divide-slate-700/60 px-2 py-2.5 text-center">
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  Live APY
                </div>
                <div
                  className={`mt-0.5 font-mono text-xs sm:text-sm font-bold tabular-nums ${
                    isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                  }`}
                >
                  {loadingStats && !poolStats
                    ? '...'
                    : poolStats?.apyPct && poolStats.apyPct > 0
                    ? `${poolStats.apyPct.toFixed(2)}%`
                    : 'Validator Yield'}
                </div>
              </div>
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  Pool Liquidity
                </div>
                <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                  {loadingStats && !poolStats
                    ? '...'
                    : formatTvlCompact(
                        poolStats?.tvlUsd ?? null,
                        poolStats?.totalPooledBnb ?? null
                      )}
                </div>
              </div>
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  Your Staked
                </div>
                <div className="mt-0.5 truncate font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                  {walletAddress
                    ? `${formatAmount(stakedBalanceStr, 4)} ${activePool.token.symbol}`
                    : '—'}
                </div>
                {walletAddress && stakedBnbValue !== null && stakedBnbValue > 0 && (
                  <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                    ≈ {formatAmount(String(stakedBnbValue), 4)} BNB
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stake / Unstake Toggle */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well grid grid-cols-2 gap-1 p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setAction('stake');
                  setTxHash(null);
                  setTxError(null);
                  setTxStatusText(null);
                }}
                className={`py-2 font-display text-[11px] font-bold tracking-wider uppercase transition-all whitespace-nowrap ${
                  action === 'stake'
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                    : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                }`}
              >
                Stake BNB
              </button>
              <button
                type="button"
                onClick={() => {
                  setAction('unstake');
                  setTxHash(null);
                  setTxError(null);
                  setTxStatusText(null);
                }}
                className={`py-2 font-display text-[11px] font-bold tracking-wider uppercase transition-all whitespace-nowrap ${
                  action === 'unstake'
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                    : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                }`}
              >
                Unstake to BNB
              </button>
            </div>
          </div>

          {/* Input Chamber */}
          <div className="armor-well-rim relative z-10">
            <div className="armor-well p-3.5 sm:p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                  {action === 'stake' ? 'Amount to Stake' : 'Amount to Unstake'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-300 tabular-nums">
                    {walletAddress
                      ? `Bal: ${formatAmount(balanceInStr)}`
                      : 'Wallet not connected'}
                  </span>
                  {walletAddress && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleFillFraction(1, 2)}
                        className={`font-mono text-[11px] font-semibold text-slate-300 transition-colors ${
                          isGreenMode ? 'hover:text-emerald-300' : 'hover:text-cyan-300'
                        }`}
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFillFraction(1, 1)}
                        className={`font-mono text-[11px] font-bold transition-colors hover:text-white ${
                          isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                        }`}
                      >
                        MAX
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 sm:gap-3">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amountStr}
                  onChange={(e) => {
                    setAmountStr(e.target.value);
                    setTxHash(null);
                    setTxError(null);
                    setTxStatusText(null);
                  }}
                  placeholder="0.0"
                  className={`min-w-0 flex-1 bg-transparent font-mono font-bold text-white placeholder-slate-600 tabular-nums focus:outline-none ${
                    amountStr.length > 14
                      ? 'text-sm sm:text-xl'
                      : amountStr.length > 9
                      ? 'text-base sm:text-2xl'
                      : 'text-lg sm:text-[26px]'
                  }`}
                />
                <div className="combat-steel-btn inline-flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold tracking-wider text-white whitespace-nowrap">
                  <TokenLogo token={tokenIn} size={20} />
                  <span>{tokenIn.symbol}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Flip Direction Button */}
          <div className="relative z-20 -my-3.5 flex items-center justify-center">
            <button
              type="button"
              onClick={() =>
                setAction((prev) => (prev === 'stake' ? 'unstake' : 'stake'))
              }
              aria-label="Switch between Stake and Unstake"
              className={`combat-hex-core relative flex h-10 w-11 items-center justify-center hover:text-white ${
                isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
              }`}
            >
              <ArrowDownUp className="h-4 w-4" />
            </button>
          </div>

          {/* Receive Chamber */}
          <div className="armor-well-rim relative z-10">
            <div className="armor-well p-3.5 sm:p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                  {action === 'stake' ? 'You Receive (Staked Token)' : 'You Receive (BNB)'}
                </span>
                <a
                  href={activePool.contractUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 font-mono text-[11px] hover:underline ${
                    isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                  }`}
                >
                  <span>{activePool.token.symbol} Contract</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="flex items-center justify-between gap-2 sm:gap-3">
                {(() => {
                  const formattedOut = quote ? formatAmount(quote.amountOutFormatted) : '';
                  const outSizeClass =
                    formattedOut.length > 14
                      ? 'text-sm sm:text-xl'
                      : formattedOut.length > 10
                      ? 'text-base sm:text-2xl'
                      : 'text-lg sm:text-[26px]';
                  return (
                    <div
                      title={quote ? quote.amountOutFormatted : undefined}
                      className={`min-w-0 flex-1 truncate font-mono font-bold text-white tabular-nums ${outSizeClass}`}
                    >
                      {quoting && amountInWei > 0n ? (
                        <span
                          className={`inline-flex items-center gap-2 text-sm font-medium ${
                            isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                          }`}
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Quoting BSC...</span>
                        </span>
                      ) : quote ? (
                        <span>{formattedOut}</span>
                      ) : (
                        <span className="text-slate-600">0.0</span>
                      )}
                    </div>
                  );
                })()}

                <div className="combat-steel-btn inline-flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold tracking-wider text-white whitespace-nowrap">
                  <TokenLogo token={tokenOut} size={20} />
                  <span>{tokenOut.symbol}</span>
                </div>
              </div>
            </div>
          </div>

          {/* On-Chain Summary */}
          {quote && amountInWei > 0n && (
            <div
              className={`relative z-10 mt-4 space-y-2 border-t pt-3.5 text-xs ${
                isGreenMode ? 'border-emerald-400/25' : 'border-sky-400/25'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-slate-400">Rate</span>
                <span className="font-mono text-[11px] sm:text-xs text-slate-100 tabular-nums">
                  1 {tokenIn.symbol} = {exchangeRate.toFixed(6)} {tokenOut.symbol}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-slate-400">
                  Minimum received ({slippagePct}% slippage)
                </span>
                <span
                  className={`font-mono text-[11px] sm:text-xs tabular-nums ${
                    isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                  }`}
                >
                  {formatAmount(ethers.formatUnits(minReceivedWei, tokenOut.decimals))}{' '}
                  {tokenOut.symbol}
                </span>
              </div>
              {quote.platformFeeBps > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <ShieldCheck
                      className={`h-3.5 w-3.5 ${
                        isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                      }`}
                    />
                    <span>
                      Platform fee ({(quote.platformFeeBps / 100).toFixed(2)}% to treasury)
                    </span>
                  </span>
                  <span className="font-mono text-[11px] sm:text-xs text-slate-300 tabular-nums">
                    {formatAmount(
                      ethers.formatUnits(quote.platformFeeWei, tokenIn.decimals)
                    )}{' '}
                    {tokenIn.symbol}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-slate-400">Treasury recipient</span>
                <span className="truncate font-mono text-[11px] text-slate-300">
                  {PLATFORM_FEE_RECIPIENT.slice(0, 6)}...{PLATFORM_FEE_RECIPIENT.slice(-4)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-slate-400">On-chain route</span>
                <span
                  className={`truncate text-right font-mono ${
                    isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                  }`}
                >
                  {quote.routeSymbols.join(' → ')} · {quote.dexLabel}
                </span>
              </div>
            </div>
          )}

          {quoteError && (
            <div className="relative z-10 mt-3 border border-amber-400/45 bg-amber-950/35 px-3.5 py-2 text-xs text-amber-200">
              {quoteError}
            </div>
          )}

          {txError && (
            <div className="relative z-10 mt-3 border border-red-500/50 bg-red-950/40 px-3.5 py-2 text-xs text-red-200">
              {txError}
            </div>
          )}

          {/* Action CTA */}
          {!walletAddress ? (
            <button
              type="button"
              onClick={onConnectWallet}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2.5 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
            >
              <Wallet
                className={`h-4 w-4 ${
                  isGreenMode ? 'text-emerald-100' : 'text-cyan-100'
                }`}
              />
              <span>Connect BNB Wallet</span>
            </button>
          ) : wrongNetwork ? (
            <button
              type="button"
              onClick={onSwitchToBsc}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
            >
              Switch to BNB Smart Chain (56)
            </button>
          ) : amountInWei <= 0n ? (
            <button
              type="button"
              disabled
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
            >
              Enter an amount
            </button>
          ) : insufficientBalance ? (
            <button
              type="button"
              disabled
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
            >
              Insufficient {tokenIn.symbol} balance
            </button>
          ) : checkingAllowance || quoting || !quote ? (
            <button
              type="button"
              disabled
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center gap-2 px-4 py-3.5 text-xs font-bold tracking-widest text-slate-300 uppercase"
            >
              <Loader2
                className={`h-4 w-4 animate-spin ${
                  isGreenMode ? 'text-emerald-400' : 'text-cyan-400'
                }`}
              />
              <span>{quoting ? 'Fetching Live Quote...' : 'Unavailable'}</span>
            </button>
          ) : needsApproval ? (
            <button
              type="button"
              onClick={handleApprove}
              disabled={txPending !== null}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
            >
              {txPending === 'approve' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Approving {tokenIn.symbol}...</span>
                </>
              ) : (
                <span>Approve {tokenIn.symbol}</span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleExecuteStakeAction}
              disabled={txPending !== null}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
            >
              {txPending === 'stake' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{action === 'stake' ? 'Staking BNB...' : 'Unstaking...'}</span>
                </>
              ) : (
                <>
                  <Coins className="h-4 w-4" />
                  <span>
                    {action === 'stake'
                      ? `Stake ${amountStr} BNB`
                      : `Unstake ${activePool.token.symbol} to BNB`}
                  </span>
                </>
              )}
            </button>
          )}

          {/* Transaction Receipt */}
          {(txStatusText || txHash) && (
            <div className="armor-well-rim relative z-10 mt-4">
              <div className="armor-well p-3.5 text-xs">
                {txStatusText && (
                  <div
                    className={`font-medium ${
                      isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                    }`}
                  >
                    {txStatusText}
                  </div>
                )}
                {txHash && (
                  <a
                    href={`https://bscscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] hover:text-white hover:underline ${
                      isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                    }`}
                  >
                    <span>
                      View on BscScan ({txHash.slice(0, 10)}...{txHash.slice(-6)})
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
