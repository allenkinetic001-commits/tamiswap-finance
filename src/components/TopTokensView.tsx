import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import {
  fetchTop10BscTokens,
  refreshTopTokensLiveTick,
  TopTokenEntry,
} from '../utils/topTokens';
import { TokenLogo } from './TokenLogo';

interface TopTokensViewProps {
  onSelectTokenForSwap: (token: TopTokenEntry) => void;
  isGreenMode?: boolean;
}

function formatUsdPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '$0.00';
  if (price >= 1000) {
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (price >= 1) {
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`;
  }
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  }
  return `$${price.toFixed(8)}`;
}

function formatVolumeUsd(vol: number): string {
  if (!Number.isFinite(vol) || vol <= 0) return '$0';
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatUpdatedTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function TrendTriangle({ isUp }: { isUp: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 8"
      className="h-2.5 w-2.5 shrink-0 fill-current"
    >
      {isUp ? (
        <polygon points="5,0 10,8 0,8" />
      ) : (
        <polygon points="0,0 10,0 5,8" />
      )}
    </svg>
  );
}

export function TopTokensView({
  onSelectTokenForSwap,
  isGreenMode = false,
}: TopTokensViewProps) {
  const [tokens, setTokens] = useState<TopTokenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const tokensRef = useRef<TopTokenEntry[]>([]);
  tokensRef.current = tokens;

  const loadFullRanking = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const list = await fetchTop10BscTokens();
      setTokens(list);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load real-time BNB Chain token rankings.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFullRanking(false);

    // Sub-10s live price & 24h% tick overlay + 30s full 24h volume re-rank
    const tickInterval = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      if (tokensRef.current.length === 0) return;
      const updated = await refreshTopTokensLiveTick(tokensRef.current);
      setTokens(updated);
      setLastUpdated(Date.now());
    }, 10_000);

    const rankInterval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadFullRanking(false);
    }, 30_000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadFullRanking(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(tickInterval);
      clearInterval(rankInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadFullRanking]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="armor-chassis-shell relative w-full max-w-[780px]"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-1.5 left-1/2 z-20 h-3 w-56 -translate-x-1/2 rounded-full blur-md ${
          isGreenMode ? 'bg-emerald-400/90' : 'bg-cyan-300/90'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-1.5 left-1/2 z-20 h-3 w-52 -translate-x-1/2 rounded-full blur-md ${
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
          <div className="relative z-10 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display chrome-text text-xl sm:text-2xl font-extrabold tracking-widest uppercase">
                Top 10 Tokens
              </h1>
              <p className="mt-1 text-xs text-slate-300">
                BNB Chain · Ranked by 24h Trading Volume · Click any token to swap
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              {lastUpdated && (
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  Updated {formatUpdatedTime(lastUpdated)}
                </span>
              )}
              <button
                type="button"
                onClick={() => void loadFullRanking(true)}
                disabled={loading || refreshing}
                title="Refresh live token rankings"
                className={`combat-steel-btn inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50 ${
                  isGreenMode ? 'hover:text-emerald-200' : 'hover:text-cyan-200'
                }`}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    refreshing
                      ? `animate-spin ${isGreenMode ? 'text-emerald-300' : 'text-cyan-300'}`
                      : ''
                  }`}
                />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Single-Elevation Table Container */}
          <div className="armor-well-rim relative z-10">
            <div className="armor-well overflow-hidden">
              {loading && tokens.length === 0 ? (
                <div
                  className={`divide-y ${
                    isGreenMode ? 'divide-emerald-500/15' : 'divide-sky-500/15'
                  }`}
                >
                  {Array.from({ length: 10 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="flex h-[58px] items-center justify-between px-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-5 rounded bg-slate-800/80" />
                        <div className="h-8 w-8 rounded-full bg-slate-800/80" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-20 rounded bg-slate-800/80" />
                          <div className="h-3 w-28 rounded bg-slate-800/60" />
                        </div>
                      </div>
                      <div className="space-y-1.5 text-right">
                        <div className="ml-auto h-3.5 w-20 rounded bg-slate-800/80" />
                        <div className="ml-auto h-3 w-14 rounded bg-slate-800/60" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error && tokens.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                  <p className="text-sm font-medium text-slate-200">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      void loadFullRanking(true);
                    }}
                    className="combat-energy-btn font-display px-5 py-2.5 text-xs font-bold tracking-wider text-white uppercase"
                  >
                    Retry Live Feed
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop High-Density Table */}
                  <div className="hidden sm:block">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr
                          className={`border-b text-[11px] font-semibold tracking-wider text-slate-400 uppercase ${
                            isGreenMode ? 'border-emerald-400/20' : 'border-sky-400/20'
                          }`}
                        >
                          <th className="w-12 py-3 pl-4 pr-2 font-mono">#</th>
                          <th className="py-3 px-2">Token</th>
                          <th className="py-3 px-2 text-right">Price</th>
                          <th className="py-3 px-2 text-right">24h Change</th>
                          <th className="py-3 px-2 text-right">24h Volume</th>
                          <th className="w-20 py-3 pl-2 pr-4 text-right">Trade</th>
                        </tr>
                      </thead>
                      <tbody
                        className={`divide-y ${
                          isGreenMode ? 'divide-emerald-500/15' : 'divide-sky-500/15'
                        }`}
                      >
                        {tokens.map((token) => {
                          const isUp = token.change24hPct >= 0;
                          return (
                            <tr
                              key={`${token.rank}-${token.symbol}-${token.address}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectTokenForSwap(token)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onSelectTokenForSwap(token);
                                }
                              }}
                              className={`group cursor-pointer transition-colors focus:outline-none ${
                                isGreenMode
                                  ? 'hover:bg-emerald-500/12 focus:bg-emerald-500/15'
                                  : 'hover:bg-sky-500/12 focus:bg-sky-500/15'
                              }`}
                            >
                              <td className="py-3 pl-4 pr-2 font-mono text-xs font-semibold text-slate-400 tabular-nums">
                                {token.rank}
                              </td>
                              <td className="py-3 px-2">
                                <div className="flex items-center gap-3">
                                  <TokenLogo token={token} size={32} />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-sm font-bold text-white">
                                        {token.symbol}
                                      </span>
                                    </div>
                                    <div className="max-w-[190px] truncate text-xs text-slate-400">
                                      {token.name}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-2 text-right font-mono text-sm font-semibold text-slate-100 tabular-nums">
                                {formatUsdPrice(token.priceUsd)}
                              </td>
                              <td className="py-3 px-2 text-right font-mono text-sm font-bold tabular-nums">
                                <span
                                  className={`inline-flex items-center justify-end gap-1.5 ${
                                    isUp ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  <TrendTriangle isUp={isUp} />
                                  <span>
                                    {isUp ? '+' : ''}
                                    {token.change24hPct.toFixed(2)}%
                                  </span>
                                </span>
                              </td>
                              <td className="py-3 px-2 text-right font-mono text-xs font-medium text-slate-300 tabular-nums">
                                {formatVolumeUsd(token.volume24hUsd)}
                              </td>
                              <td className="py-3 pl-2 pr-4 text-right">
                                <span
                                  className={`inline-flex items-center gap-1 font-display text-[11px] font-bold tracking-wider uppercase transition-transform group-hover:translate-x-0.5 ${
                                    isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                                  }`}
                                >
                                  <span>Swap</span>
                                  <ArrowRight className="h-3 w-3" />
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Compact List (<640px) */}
                  <div
                    className={`divide-y sm:hidden ${
                      isGreenMode ? 'divide-emerald-500/15' : 'divide-sky-500/15'
                    }`}
                  >
                    {tokens.map((token) => {
                      const isUp = token.change24hPct >= 0;
                      return (
                        <button
                          key={`m-${token.rank}-${token.symbol}-${token.address}`}
                          type="button"
                          onClick={() => onSelectTokenForSwap(token)}
                          className={`flex w-full items-center justify-between gap-2.5 px-3.5 py-3 text-left transition-colors ${
                            isGreenMode
                              ? 'active:bg-emerald-500/15'
                              : 'active:bg-sky-500/15'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="w-5 shrink-0 font-mono text-xs font-semibold text-slate-400 tabular-nums">
                              {token.rank}
                            </span>
                            <TokenLogo token={token} size={30} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm font-bold text-white">
                                  {token.symbol}
                                </span>
                              </div>
                              <div className="truncate text-[11px] text-slate-400">
                                {token.name} · Vol {formatVolumeUsd(token.volume24hUsd)}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 text-right font-mono tabular-nums">
                            <div className="text-sm font-bold text-slate-100">
                              {formatUsdPrice(token.priceUsd)}
                            </div>
                            <div
                              className={`inline-flex items-center justify-end gap-1 text-xs font-bold ${
                                isUp ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              <TrendTriangle isUp={isUp} />
                              <span>
                                {isUp ? '+' : ''}
                                {token.change24hPct.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
