import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import {
  BSC_CHAIN_ID,
  DEFAULT_SWAP_TOKENS,
  SwapToken,
  THENA_ROUTER_V2_ADDRESS,
} from '../data/swapTokens';
import {
  approveTokenForRouter,
  executeOnChainSwap,
  fetchAllowance,
  fetchOnChainQuote,
  fetchTokenInfo,
  fetchWalletBalances,
  OnChainQuote,
} from '../utils/bscWeb3';
import { TokenLogo } from './TokenLogo';

type RouteMode = 'auto' | 'volatile' | 'stable';

interface SwapWidgetProps {
  walletAddress: string | null;
  chainId: number | null;
  provider: ethers.Eip1193Provider | null;
  onConnectWallet: () => void;
  onSwitchToBsc: () => void;
}

function formatDisplayAmount(rawStr: string, maxDecimals = 6): string {
  const num = Number(rawStr);
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num < 0.000001) return '<0.000001';
  return num.toLocaleString(undefined, {
    maximumFractionDigits: num < 1 ? maxDecimals : 4,
  });
}

function computeMinReceivedWei(amountOutWei: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  const keepBps = 10000n - bps;
  return (amountOutWei * (keepBps > 0n ? keepBps : 0n)) / 10000n;
}

export function SwapWidget({
  walletAddress,
  chainId,
  provider,
  onConnectWallet,
  onSwitchToBsc,
}: SwapWidgetProps) {
  const [tokens, setTokens] = useState<SwapToken[]>(DEFAULT_SWAP_TOKENS);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [tokenInSymbol, setTokenInSymbol] = useState('BNB');
  const [tokenOutSymbol, setTokenOutSymbol] = useState('THE');
  const [amountInStr, setAmountInStr] = useState('0.1');
  const [routeMode, setRouteMode] = useState<RouteMode>('auto');
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [deadlineMin, setDeadlineMin] = useState(20);
  const [showSettings, setShowSettings] = useState(false);
  const [flipCount, setFlipCount] = useState(0);

  // Token selector & custom BEP-20 import state
  const [selectorSide, setSelectorSide] = useState<'in' | 'out' | null>(null);
  const [tokenSearch, setTokenSearch] = useState('');
  const [importingToken, setImportingToken] = useState(false);
  const [importedCandidate, setImportedCandidate] = useState<SwapToken | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Live quote & allowance state
  const [quote, setQuote] = useState<OnChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [allowanceWei, setAllowanceWei] = useState<bigint>(0n);
  const [checkingAllowance, setCheckingAllowance] = useState(false);

  // Transaction state
  const [txPending, setTxPending] = useState<'approve' | 'swap' | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatusText, setTxStatusText] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const tokenIn = useMemo(
    () => tokens.find((t) => t.symbol === tokenInSymbol) || tokens[0],
    [tokens, tokenInSymbol]
  );
  const tokenOut = useMemo(
    () => tokens.find((t) => t.symbol === tokenOutSymbol) || tokens[1],
    [tokens, tokenOutSymbol]
  );

  const tokenSymbolMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tokens) {
      if (!t.isNative) map[t.address.toLowerCase()] = t.symbol;
    }
    return map;
  }, [tokens]);

  const amountInWei = useMemo(() => {
    const clean = amountInStr.trim();
    if (!clean || Number(clean) <= 0 || !Number.isFinite(Number(clean))) return 0n;
    try {
      return ethers.parseUnits(clean, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountInStr, tokenIn.decimals]);

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setBalances({});
      return;
    }
    setLoadingBalances(true);
    try {
      const next = await fetchWalletBalances(walletAddress, tokens);
      setBalances(next);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletAddress, tokens]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // Live BSC Mainnet RouterV2 Quote
  useEffect(() => {
    if (amountInWei <= 0n || tokenIn.symbol === tokenOut.symbol) {
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
          mode: routeMode,
          tokenSymbolMap,
        });
        if (cancelled) return;
        if (!res) {
          setQuote(null);
          setQuoteError('No THENA liquidity route found on BNB Chain.');
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
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tokenIn, tokenOut, amountInWei, routeMode, tokenSymbolMap]);

  // Check ERC-20 allowance when paying with a BEP-20 token
  const refreshAllowance = useCallback(async () => {
    if (
      !walletAddress ||
      tokenIn.isNative ||
      (quote && quote.isWrapOrUnwrap)
    ) {
      setAllowanceWei(ethers.MaxUint256);
      return;
    }
    setCheckingAllowance(true);
    try {
      const val = await fetchAllowance(tokenIn.address, walletAddress);
      setAllowanceWei(val);
    } catch {
      setAllowanceWei(0n);
    } finally {
      setCheckingAllowance(false);
    }
  }, [walletAddress, tokenIn, quote]);

  useEffect(() => {
    refreshAllowance();
  }, [refreshAllowance]);

  // Auto-detect pasted 0x BEP-20 contract address inside token search
  useEffect(() => {
    const trimmed = tokenSearch.trim();
    setImportError(null);
    setImportedCandidate(null);
    if (!ethers.isAddress(trimmed)) return;

    const alreadyListed = tokens.some(
      (t) => t.address.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyListed) return;

    let cancelled = false;
    setImportingToken(true);
    fetchTokenInfo(trimmed)
      .then((info) => {
        if (!cancelled) setImportedCandidate(info);
      })
      .catch(() => {
        if (!cancelled) setImportError('Address is not a valid BEP-20 token on BNB Chain.');
      })
      .finally(() => {
        if (!cancelled) setImportingToken(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tokenSearch, tokens]);

  const balanceInStr = balances[tokenIn.symbol] || '0';
  const balanceOutStr = balances[tokenOut.symbol] || '0';
  const balanceInWei = useMemo(() => {
    try {
      return ethers.parseUnits(balanceInStr || '0', tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [balanceInStr, tokenIn.decimals]);

  const insufficientBalance =
    Boolean(walletAddress) && amountInWei > 0n && amountInWei > balanceInWei;
  const wrongNetwork = Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;
  const needsApproval =
    Boolean(walletAddress) &&
    !wrongNetwork &&
    !tokenIn.isNative &&
    !(quote?.isWrapOrUnwrap) &&
    amountInWei > 0n &&
    allowanceWei < amountInWei;

  const minReceivedWei = useMemo(() => {
    if (!quote) return 0n;
    if (quote.isWrapOrUnwrap) return quote.amountOutWei;
    return computeMinReceivedWei(quote.amountOutWei, slippagePct);
  }, [quote, slippagePct]);

  function handleFlipTokens() {
    setFlipCount((c) => c + 1);
    setTokenInSymbol(tokenOutSymbol);
    setTokenOutSymbol(tokenInSymbol);
    setTxHash(null);
    setTxError(null);
    setTxStatusText(null);
  }

  function handleSelectToken(token: SwapToken) {
    if (selectorSide === 'in') {
      if (token.symbol === tokenOutSymbol) setTokenOutSymbol(tokenInSymbol);
      setTokenInSymbol(token.symbol);
    } else if (selectorSide === 'out') {
      if (token.symbol === tokenInSymbol) setTokenInSymbol(tokenOutSymbol);
      setTokenOutSymbol(token.symbol);
    }
    setSelectorSide(null);
    setTokenSearch('');
    setImportedCandidate(null);
    setTxHash(null);
    setTxError(null);
    setTxStatusText(null);
  }

  function handleImportAndSelect(newToken: SwapToken) {
    setTokens((prev) => {
      if (prev.some((t) => t.address.toLowerCase() === newToken.address.toLowerCase())) {
        return prev;
      }
      return [...prev, newToken];
    });
    handleSelectToken(newToken);
  }

  function handleFillFraction(num: number, den: number) {
    if (!walletAddress) return;
    if (balanceInWei <= 0n) {
      setAmountInStr('0');
      return;
    }
    let targetWei = (balanceInWei * BigInt(num)) / BigInt(den);
    // Leave small gas reserve (~0.002 BNB) when clicking MAX on native BNB
    if (tokenIn.isNative && num === den) {
      const gasReserve = ethers.parseEther('0.002');
      targetWei = targetWei > gasReserve ? targetWei - gasReserve : 0n;
    }
    setAmountInStr(ethers.formatUnits(targetWei, tokenIn.decimals));
    setTxHash(null);
    setTxError(null);
  }

  async function handleApprove() {
    if (!provider || !walletAddress || amountInWei <= 0n) return;
    setTxPending('approve');
    setTxError(null);
    setTxHash(null);
    setTxStatusText(`Waiting for ${tokenIn.symbol} approval in wallet...`);
    try {
      const receipt = await approveTokenForRouter(
        provider,
        tokenIn.address,
        amountInWei
      );
      if (receipt) setTxHash(receipt.hash);
      setTxStatusText(`${tokenIn.symbol} approved for THENA RouterV2.`);
      await refreshAllowance();
    } catch (err: unknown) {
      const msg =
        (err as { shortMessage?: string; message?: string })?.shortMessage ||
        (err instanceof Error ? err.message : 'Approval rejected');
      setTxError(msg);
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleSwap() {
    if (!provider || !walletAddress || !quote || amountInWei <= 0n) return;
    setTxPending('swap');
    setTxError(null);
    setTxHash(null);
    setTxStatusText('Confirm swap transaction in your wallet...');

    try {
      const tx = await executeOnChainSwap({
        ethereum: provider,
        tokenIn,
        tokenOut,
        amountInWei,
        amountOutMinWei: minReceivedWei,
        routes: quote.routes,
        deadlineMinutes: deadlineMin,
        isWrapOrUnwrap: quote.isWrapOrUnwrap,
      });
      setTxHash(tx.hash);
      setTxStatusText('Transaction submitted — waiting for BNB Chain confirmation...');
      await tx.wait();
      setTxStatusText(
        `Confirmed: Swapped ${amountInStr} ${tokenIn.symbol} for ${tokenOut.symbol}`
      );
      await Promise.all([refreshBalances(), refreshAllowance()]);
    } catch (err: unknown) {
      const msg =
        (err as { shortMessage?: string; message?: string })?.shortMessage ||
        (err instanceof Error ? err.message : 'Swap transaction failed');
      setTxError(msg);
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  const filteredTokens = useMemo(() => {
    const q = tokenSearch.trim().toLowerCase();
    return tokens.filter(
      (t) =>
        !q ||
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }, [tokens, tokenSearch]);

  const exchangeRate = useMemo(() => {
    if (!quote || amountInWei <= 0n) return 0;
    const inF = Number(ethers.formatUnits(amountInWei, tokenIn.decimals));
    const outF = Number(quote.amountOutFormatted);
    return inF > 0 ? outF / inF : 0;
  }, [quote, amountInWei, tokenIn.decimals]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="armor-chassis-shell w-full max-w-[480px]"
    >
      <div className="armor-chassis-rim">
        <div className="armor-chassis relative overflow-hidden p-5 sm:p-6">
          {/* Top electric-blue energy vein conduit */}
          <div
            aria-hidden="true"
            className="energy-vein-beam pointer-events-none absolute top-0 right-6 left-6 h-[2px] bg-gradient-to-r from-transparent via-cyan-300 to-transparent"
          />
          {/* Subtle armor corner seam accents */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full opacity-55"
            preserveAspectRatio="none"
            viewBox="0 0 480 620"
            fill="none"
          >
            <path d="M22 10 H96 L112 20" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.45" />
            <path d="M458 10 H384 L368 20" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.45" />
            <path d="M22 610 H96 L112 600" stroke="#00e5ff" strokeWidth="1" strokeOpacity="0.4" />
            <path d="M458 610 H384 L368 600" stroke="#00e5ff" strokeWidth="1" strokeOpacity="0.4" />
          </svg>

          {/* Card Header */}
          <div className="relative z-10 mb-5 flex items-center justify-between border-b border-sky-400/20 pb-4">
            <div>
              <h1 className="font-display chrome-text text-xl font-extrabold tracking-widest uppercase">
                Swap
              </h1>
              <p className="mt-0.5 font-mono text-[11px] text-sky-300/80">
                THENA RouterV2 · {THENA_ROUTER_V2_ADDRESS.slice(0, 6)}...
                {THENA_ROUTER_V2_ADDRESS.slice(-4)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {walletAddress && (
                <button
                  type="button"
                  onClick={refreshBalances}
                  disabled={loadingBalances}
                  title="Refresh on-chain balances"
                  className="combat-steel-btn p-2 text-slate-300 hover:text-cyan-300 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loadingBalances ? 'animate-spin text-cyan-300' : ''}`}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                title="Swap settings"
                className={`combat-steel-btn p-2 ${
                  showSettings
                    ? 'border-cyan-400 text-cyan-300 shadow-[0_0_16px_rgba(0,229,255,0.34)]'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Settings Drawer */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="armor-well-rim relative z-10 mb-4"
              >
                <div className="armor-well space-y-3 p-3.5 text-xs">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-slate-200">
                      <span className="font-semibold tracking-wider uppercase">
                        Slippage Tolerance
                      </span>
                      <span className="font-mono font-bold text-cyan-300 tabular-nums">
                        {slippagePct}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[0.1, 0.5, 1.0].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSlippagePct(val)}
                          className={`flex-1 py-1.5 font-mono text-xs font-semibold transition-all ${
                            slippagePct === val
                              ? 'combat-steel-btn border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(0,229,255,0.28)]'
                              : 'border border-slate-800 bg-[#0b1324] text-slate-400 hover:border-sky-500/40 hover:text-slate-200'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                      <input
                        type="number"
                        min={0.05}
                        max={49}
                        step={0.1}
                        value={slippagePct}
                        onChange={(e) =>
                          setSlippagePct(
                            Math.max(0.05, Math.min(49, Number(e.target.value) || 0.5))
                          )
                        }
                        className="w-20 border border-sky-500/30 bg-[#030712] px-2 py-1.5 text-right font-mono text-xs text-cyan-100 tabular-nums focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-sky-400/20 pt-2.5">
                    <span className="font-semibold tracking-wider text-slate-200 uppercase">
                      Transaction Deadline
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={deadlineMin}
                        onChange={(e) =>
                          setDeadlineMin(
                            Math.max(1, Math.min(120, Number(e.target.value) || 20))
                          )
                        }
                        className="w-14 border border-sky-500/30 bg-[#030712] px-2 py-1 text-right font-mono text-xs text-cyan-100 tabular-nums focus:border-cyan-400 focus:outline-none"
                      />
                      <span className="text-slate-400">min</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pool Mode Selector */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well flex items-center gap-1 p-1 text-xs">
              {(
                [
                  { id: 'auto', label: 'Auto Route' },
                  { id: 'volatile', label: 'Volatile (x·y≥k)' },
                  { id: 'stable', label: 'Stable (x³y+y³x≥k)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRouteMode(opt.id)}
                  className={`flex-1 px-2 py-1.5 font-semibold tracking-wide whitespace-nowrap transition-all ${
                    routeMode === opt.id
                      ? 'combat-steel-btn border-cyan-400/80 text-cyan-200 shadow-[0_0_14px_rgba(0,229,255,0.28)]'
                      : 'border border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* You Pay Chamber */}
          <div className="armor-well-rim relative z-10">
            <div className="armor-well p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-display text-[11px] font-bold tracking-widest text-sky-300/90 uppercase">
                  You pay
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-400 tabular-nums">
                    {walletAddress
                      ? `Bal: ${formatDisplayAmount(balanceInStr)}`
                      : 'Wallet not connected'}
                  </span>
                  {walletAddress && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleFillFraction(1, 2)}
                        className="font-mono text-[11px] font-semibold text-slate-300 transition-colors hover:text-cyan-300"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFillFraction(1, 1)}
                        className="font-mono text-[11px] font-bold text-cyan-300 transition-colors hover:text-white"
                      >
                        MAX
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amountInStr}
                  onChange={(e) => {
                    setAmountInStr(e.target.value);
                    setTxHash(null);
                    setTxError(null);
                    setTxStatusText(null);
                  }}
                  placeholder="0.0"
                  className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold text-white placeholder-slate-600 tabular-nums focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSelectorSide('in')}
                  className="combat-steel-btn inline-flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-bold tracking-wider text-slate-50 whitespace-nowrap"
                >
                  <TokenLogo token={tokenIn} size={22} />
                  <span className="chrome-text font-display text-xs font-bold tracking-wider">
                    {tokenIn.symbol}
                  </span>
                  <ChevronDown className="h-4 w-4 text-cyan-300" />
                </button>
              </div>
            </div>
          </div>

          {/* Illuminated Flip Conduit */}
          <div className="relative z-20 -my-3.5 flex items-center justify-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-10 left-10 h-[1px] bg-gradient-to-r from-transparent via-sky-500/55 to-transparent"
            />
            <motion.button
              type="button"
              onClick={handleFlipTokens}
              animate={{ rotate: flipCount * 180 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              aria-label="Flip swap direction"
              className="combat-steel-btn relative flex h-10 w-10 items-center justify-center text-cyan-300 shadow-[0_0_18px_rgba(0,174,255,0.28)] hover:text-white"
            >
              <ArrowUpDown className="h-4 w-4" />
            </motion.button>
          </div>

          {/* You Receive Chamber */}
          <div className="armor-well-rim relative z-10">
            <div className="armor-well p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-display text-[11px] font-bold tracking-widest text-sky-300/90 uppercase">
                  You receive
                </span>
                <span className="font-mono text-slate-400 tabular-nums">
                  {walletAddress ? `Bal: ${formatDisplayAmount(balanceOutStr)}` : ''}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 truncate font-mono text-2xl font-bold text-white tabular-nums">
                  {quoting && amountInWei > 0n ? (
                    <span className="inline-flex items-center gap-2 text-base font-medium text-cyan-300">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Quoting BSC...</span>
                    </span>
                  ) : quote ? (
                    <span className="text-cyan-50 drop-shadow-[0_0_12px_rgba(0,204,255,0.35)]">
                      {formatDisplayAmount(quote.amountOutFormatted)}
                    </span>
                  ) : (
                    <span className="text-slate-600">0.0</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectorSide('out')}
                  className="combat-steel-btn inline-flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-bold tracking-wider text-slate-50 whitespace-nowrap"
                >
                  <TokenLogo token={tokenOut} size={22} />
                  <span className="chrome-text font-display text-xs font-bold tracking-wider">
                    {tokenOut.symbol}
                  </span>
                  <ChevronDown className="h-4 w-4 text-cyan-300" />
                </button>
              </div>
            </div>
          </div>

          {/* On-Chain Quote Summary */}
          {quote && amountInWei > 0n && (
            <div className="relative z-10 mt-4 space-y-2 border-t border-sky-400/25 pt-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Rate</span>
                <span className="font-mono text-slate-100 tabular-nums">
                  1 {tokenIn.symbol} ={' '}
                  {exchangeRate.toLocaleString(undefined, {
                    maximumFractionDigits: exchangeRate < 1 ? 6 : 4,
                  })}{' '}
                  {tokenOut.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">
                  Minimum received ({slippagePct}% slippage)
                </span>
                <span className="font-mono text-cyan-200 tabular-nums">
                  {formatDisplayAmount(
                    ethers.formatUnits(minReceivedWei, tokenOut.decimals)
                  )}{' '}
                  {tokenOut.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Price impact</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    quote.priceImpactPct > 5
                      ? 'text-red-400'
                      : quote.priceImpactPct > 1.5
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                  }`}
                >
                  {quote.priceImpactPct.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Pool fee</span>
                <span className="font-mono text-slate-300 tabular-nums">
                  {(quote.feeBps / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">On-chain route</span>
                <span className="font-mono text-cyan-200">
                  {quote.routeSymbols.join(' → ')}
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

          {/* Glossy 3D Electric-Blue Primary Action Button */}
          {!walletAddress ? (
            <button
              type="button"
              onClick={onConnectWallet}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
            >
              Connect Trust Wallet / Web3
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
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              <span>{quoting ? 'Fetching On-Chain Quote...' : 'Unavailable'}</span>
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
              onClick={handleSwap}
              disabled={txPending !== null}
              className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
            >
              {txPending === 'swap' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Swapping...</span>
                </>
              ) : (
                <span>
                  {quote.isWrapOrUnwrap
                    ? tokenIn.isNative
                      ? 'Wrap BNB to WBNB'
                      : 'Unwrap WBNB to BNB'
                    : `Swap ${tokenIn.symbol} for ${tokenOut.symbol}`}
                </span>
              )}
            </button>
          )}

          {/* Transaction Receipt / Status */}
          {(txStatusText || txHash) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="armor-well-rim relative z-10 mt-4"
            >
              <div className="armor-well p-3.5 text-xs">
                {txStatusText && (
                  <div className="font-medium text-cyan-200">{txStatusText}</div>
                )}
                {txHash && (
                  <a
                    href={`https://bscscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-sky-300 hover:text-white hover:underline"
                  >
                    <span>
                      View on BscScan ({txHash.slice(0, 10)}...{txHash.slice(-6)})
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Token Selector Modal + Custom BEP-20 Address Import */}
      <AnimatePresence>
        {selectorSide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#010308]/85 p-4 backdrop-blur-md"
            onClick={() => setSelectorSide(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="armor-chassis-shell w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="armor-chassis-rim">
                <div className="armor-chassis relative p-5">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 right-6 left-6 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                  />
                  <div className="mb-3.5 flex items-center justify-between border-b border-sky-400/20 pb-3">
                    <h2 className="font-display chrome-text text-sm font-bold tracking-widest uppercase">
                      Select or Import BEP-20 Token
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSelectorSide(null)}
                      className="combat-steel-btn p-1.5 text-slate-300 hover:text-cyan-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="armor-well-rim mb-3.5">
                    <input
                      type="text"
                      autoFocus
                      value={tokenSearch}
                      onChange={(e) => setTokenSearch(e.target.value)}
                      placeholder="Search symbol or paste 0x BEP-20 contract..."
                      className="armor-well w-full px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {importingToken && (
                    <div className="armor-well-rim mb-3">
                      <div className="armor-well flex items-center gap-2 px-3 py-2.5 text-xs text-cyan-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Looking up BEP-20 contract on BNB Chain...</span>
                      </div>
                    </div>
                  )}

                  {importError && (
                    <div className="mb-3 border border-red-500/45 bg-red-950/35 px-3 py-2 text-xs text-red-200">
                      {importError}
                    </div>
                  )}

                  {importedCandidate && (
                    <div className="mb-3 flex items-center justify-between border border-cyan-400/55 bg-sky-500/12 px-3.5 py-2.5 shadow-[0_0_16px_rgba(0,180,255,0.2)]">
                      <div className="flex items-center gap-3">
                        <TokenLogo token={importedCandidate} size={30} />
                        <div>
                          <div className="font-mono text-sm font-bold text-cyan-100">
                            {importedCandidate.symbol}
                          </div>
                          <div className="text-xs text-slate-300">
                            {importedCandidate.name} · {importedCandidate.decimals} decimals
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleImportAndSelect(importedCandidate)}
                        className="combat-energy-btn inline-flex items-center gap-1 px-3 py-1.5 font-display text-xs font-bold text-white uppercase"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Import</span>
                      </button>
                    </div>
                  )}

                  <div className="max-h-72 divide-y divide-sky-500/15 overflow-y-auto pr-1">
                    {filteredTokens.map((t) => {
                      const isSelected =
                        (selectorSide === 'in' && t.symbol === tokenInSymbol) ||
                        (selectorSide === 'out' && t.symbol === tokenOutSymbol);
                      return (
                        <button
                          key={`${t.symbol}-${t.address}`}
                          type="button"
                          onClick={() => handleSelectToken(t)}
                          className={`flex w-full items-center justify-between px-3 py-3 text-left transition-colors ${
                            isSelected
                              ? 'bg-sky-500/16 shadow-[inset_0_0_14px_rgba(0,180,255,0.16)]'
                              : 'hover:bg-slate-800/55'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <TokenLogo token={t} size={30} />
                            <div>
                              <div className="font-mono text-sm font-bold text-slate-100">
                                {t.symbol}
                              </div>
                              <div className="text-xs text-slate-400">
                                {t.name}
                                {!t.isNative &&
                                  ` · ${t.address.slice(0, 6)}...${t.address.slice(-4)}`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono text-xs font-medium text-cyan-200 tabular-nums">
                            {walletAddress
                              ? formatDisplayAmount(balances[t.symbol] || '0')
                              : '—'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
