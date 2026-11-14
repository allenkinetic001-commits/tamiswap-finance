import { useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { RotateCcw } from 'lucide-react';
import { INITIAL_POOLS } from '../data/thenaRegistry';
import { projectMinterSchedule } from '../utils/thenaMath';

interface EpochVoterViewProps {
  onOpenSource: (path: string) => void;
}

export function EpochVoterView({ onOpenSource }: EpochVoterViewProps) {
  // MinterUpgradeable parameters
  const [initialWeekly, setInitialWeekly] = useState(2_600_000);
  const [circulatingSupply, setCirculatingSupply] = useState(50_000_000);
  const [veLockedSupply, setVeLockedSupply] = useState(28_000_000);
  const [decayBps, setDecayBps] = useState(990);
  const [thePriceUsd, setThePriceUsd] = useState(0.45);

  // VoterV3 user simulation
  const [userVePower, setUserVePower] = useState(25_000);
  const [weights, setWeights] = useState<Record<string, number>>({
    'cl-wbnb-usdt': 35,
    'vamm-the-wbnb': 30,
    'samm-usdt-usdc': 20,
    'cl-btcb-wbnb': 15,
    'cl-eth-usdt': 0,
    'samm-hay-usdt': 0,
  });

  const schedule = useMemo(
    () =>
      projectMinterSchedule({
        epochs: 52,
        initialWeekly,
        initialCirculating: circulatingSupply,
        veLockedSupply,
        decayBps,
      }),
    [initialWeekly, circulatingSupply, veLockedSupply, decayBps]
  );

  const epoch1 = schedule[0];
  const epoch52 = schedule[schedule.length - 1];

  const totalWeightAllocated = useMemo(
    () => Object.values(weights).reduce((s, v) => s + v, 0),
    [weights]
  );

  const poolAnalytics = useMemo(() => {
    const baseTotalVotes = INITIAL_POOLS.reduce((s, p) => s + p.currentVotes, 0);
    const totalVotesWithUser = baseTotalVotes + userVePower * (totalWeightAllocated / 100);

    return INITIAL_POOLS.map((pool) => {
      const userPct = weights[pool.id] || 0;
      const userVotesOnPool = (userVePower * userPct) / 100;
      const poolTotalVotes = pool.currentVotes + userVotesOnPool;
      const voteShare = poolTotalVotes / Math.max(1, totalVotesWithUser);
      const weeklyTheEmission = epoch1.gaugeDistribution * voteShare;
      const weeklyEmissionUsd = weeklyTheEmission * thePriceUsd;
      const gaugeAprPct = ((weeklyEmissionUsd * 52) / Math.max(1, pool.tvlUsd)) * 100;

      const totalBribePoolUsd = pool.weeklyFeesUsd + pool.externalBribesUsd;
      const userVoteFractionOfPool = userVotesOnPool / Math.max(1, poolTotalVotes);
      const userWeeklyBribeUsd = totalBribePoolUsd * userVoteFractionOfPool;
      const bribeAprPct =
        userVotesOnPool > 0
          ? ((userWeeklyBribeUsd * 52) / (userVotesOnPool * thePriceUsd)) * 100
          : ((totalBribePoolUsd * 52) / Math.max(1, pool.currentVotes * thePriceUsd)) * 100;

      return {
        ...pool,
        userPct,
        userVotesOnPool,
        poolTotalVotes,
        voteSharePct: voteShare * 100,
        weeklyTheEmission,
        gaugeAprPct,
        totalBribePoolUsd,
        userWeeklyBribeUsd,
        bribeAprPct,
      };
    });
  }, [weights, userVePower, totalWeightAllocated, epoch1.gaugeDistribution, thePriceUsd]);

  const totalUserWeeklyRewardsUsd = useMemo(
    () => poolAnalytics.reduce((s, p) => s + p.userWeeklyBribeUsd, 0),
    [poolAnalytics]
  );

  // Build real VoterV3.vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights) calldata preview
  const voteCalldataPreview = useMemo(() => {
    try {
      const iface = new ethers.Interface([
        'function vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights)',
      ]);
      const activePools = poolAnalytics.filter((p) => p.userPct > 0);
      const dummyAddrs = activePools.map((_, idx) =>
        ethers.getAddress(`0x00000000000000000000000000000000000010${(idx + 10).toString(16)}`)
      );
      const rawWeights = activePools.map((p) => BigInt(p.userPct * 100));
      return iface.encodeFunctionData('vote', [1042n, dummyAddrs, rawWeights]);
    } catch {
      return '0x';
    }
  }, [poolAnalytics]);

  function handleResetWeights() {
    setWeights({
      'cl-wbnb-usdt': 0,
      'vamm-the-wbnb': 0,
      'samm-usdt-usdc': 0,
      'cl-btcb-wbnb': 0,
      'cl-eth-usdt': 0,
      'samm-hay-usdt': 0,
    });
  }

  function handleWeightChange(poolId: string, val: number) {
    setWeights((prev) => ({
      ...prev,
      [poolId]: Math.max(0, Math.min(100, val)),
    }));
  }

  const maxWeeklyChart = Math.max(1, ...schedule.map((s) => s.weeklyEmission + s.rebaseAmount));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            Epoch Emissions & VoterV3 Allocator
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Model weekly token emissions from <span className="font-mono text-slate-300">MinterUpgradeable.sol</span> and allocate veTHE votes across gauges in <span className="font-mono text-slate-300">VoterV3.sol</span> to project LP APR and <span className="font-mono text-slate-300">Bribes.sol</span> voter yields.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenSource('contracts/MinterUpgradeable.sol')}
            className="rounded border border-slate-700/80 bg-[#111622] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
          >
            MinterUpgradeable.sol
          </button>
          <button
            type="button"
            onClick={() => onOpenSource('contracts/VoterV3.sol')}
            className="rounded border border-slate-700/80 bg-[#111622] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
          >
            VoterV3.sol
          </button>
        </div>
      </div>

      {/* MinterUpgradeable 52-Week Projection */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-4">
            <h2 className="text-sm font-semibold text-slate-100">
              MinterUpgradeable Parameters
            </h2>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Starting Weekly Mint</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {(initialWeekly / 1_000_000).toFixed(2)}M THE
                </span>
              </div>
              <input
                type="range"
                min={500_000}
                max={3_000_000}
                step={50_000}
                value={initialWeekly}
                onChange={(e) => setInitialWeekly(Number(e.target.value))}
                className="mt-1.5 w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">EMISSION Decay (bps / 1000)</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {decayBps} ({((1000 - decayBps) / 10).toFixed(1)}% / wk)
                </span>
              </div>
              <input
                type="range"
                min={970}
                max={995}
                step={1}
                value={decayBps}
                onChange={(e) => setDecayBps(Number(e.target.value))}
                className="mt-1.5 w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">veTHE Lock Ratio</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {((veLockedSupply / circulatingSupply) * 100).toFixed(0)}% locked
                </span>
              </div>
              <input
                type="range"
                min={5_000_000}
                max={48_000_000}
                step={1_000_000}
                value={veLockedSupply}
                onChange={(e) => setVeLockedSupply(Number(e.target.value))}
                className="mt-1.5 w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Reference THE Price</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  ${thePriceUsd.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={3.0}
                step={0.05}
                value={thePriceUsd}
                onChange={(e) => setThePriceUsd(Number(e.target.value))}
                className="mt-1.5 w-full accent-amber-500"
              />
            </div>
          </div>

          <div className="flex flex-col justify-between lg:col-span-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-xs font-medium text-slate-300">
                52-Epoch Emission Schedule (Gauges + Team 4% + veTHE Rebase)
              </div>
              <div className="flex items-center gap-4 font-mono text-[11px] text-slate-400 tabular-nums">
                <span>
                  E1: {(epoch1.weeklyEmission / 1000).toFixed(0)}k THE
                </span>
                <span>
                  E52: {(epoch52.weeklyEmission / 1000).toFixed(0)}k THE
                </span>
                <span className="text-amber-400">
                  E1 Rebase: {(epoch1.rebaseAmount / 1000).toFixed(1)}k THE
                </span>
              </div>
            </div>

            <div className="flex h-48 items-end gap-1 rounded border border-slate-800/80 bg-[#0B0E14] px-3 pt-4 pb-2">
              {schedule.map((ep) => {
                const gaugeH = (ep.gaugeDistribution / maxWeeklyChart) * 100;
                const rebaseH = (ep.rebaseAmount / maxWeeklyChart) * 100;
                return (
                  <div
                    key={ep.epoch}
                    title={`Epoch ${ep.epoch}: ${Math.round(ep.weeklyEmission).toLocaleString()} THE weekly + ${Math.round(ep.rebaseAmount).toLocaleString()} rebase`}
                    className="group flex h-full flex-1 flex-col justify-end"
                  >
                    <div
                      className="w-full bg-emerald-500/70 transition-opacity group-hover:bg-emerald-400"
                      style={{ height: `${rebaseH}%` }}
                    />
                    <div
                      className="w-full rounded-t-[1px] bg-amber-500/80 transition-opacity group-hover:bg-amber-400"
                      style={{ height: `${gaugeH}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>Epoch 1 (Current)</span>
              <span>Amber: Weekly Gauge Mint · Green: veTHE Anti-Dilution Rebase</span>
              <span>Epoch 52 (Year 1)</span>
            </div>
          </div>
        </div>
      </section>

      {/* VoterV3 Gauge Allocation Table */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111622]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              VoterV3 Gauge Weight Allocation
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Distribute your veTHE across active Pair & Algebra CL gauges. Total allocation should sum to 100%.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Your veTHE</label>
              <input
                type="number"
                min={100}
                step={1000}
                value={userVePower}
                onChange={(e) => setUserVePower(Math.max(0, Number(e.target.value)))}
                className="w-28 rounded border border-slate-800 bg-[#0B0E14] px-2.5 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div className="font-mono text-xs tabular-nums">
              <span className="text-slate-400">Allocated: </span>
              <span
                className={
                  totalWeightAllocated === 100
                    ? 'font-semibold text-emerald-400'
                    : 'font-semibold text-amber-400'
                }
              >
                {totalWeightAllocated}%
              </span>
            </div>

            <button
              type="button"
              onClick={handleResetWeights}
              className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-[#0B0E14] px-2.5 py-1 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3" />
              <span>reset()</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="px-5 py-3 font-medium">Pool & Type</th>
                <th className="px-4 py-3 text-right font-medium">TVL</th>
                <th className="px-4 py-3 text-right font-medium">Fees + Bribes / Wk</th>
                <th className="px-4 py-3 text-right font-medium">Bribe APR</th>
                <th className="px-4 py-3 text-right font-medium">Projected Gauge Mint</th>
                <th className="px-4 py-3 font-medium">Your Vote Weight</th>
                <th className="px-5 py-3 text-right font-medium">Your Epoch Reward</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {poolAnalytics.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/30">
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <div className="font-mono text-sm font-medium text-slate-100">
                      {p.symbol}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {p.pairType} · {p.feeBps} bps fee
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                    ${(p.tvlUsd / 1_000_000).toFixed(2)}M
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                    ${p.totalBribePoolUsd.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                    {p.bribeAprPct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-200 tabular-nums whitespace-nowrap">
                    <div>{Math.round(p.weeklyTheEmission).toLocaleString()} THE</div>
                    <div className="text-[11px] text-slate-500">
                      {p.voteSharePct.toFixed(1)}% share · {p.gaugeAprPct.toFixed(1)}% LP APR
                    </div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={p.userPct}
                        onChange={(e) => handleWeightChange(p.id, Number(e.target.value))}
                        className="w-24 accent-amber-500"
                      />
                      <span className="w-9 text-right font-mono text-slate-200 tabular-nums">
                        {p.userPct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono font-semibold text-amber-400 tabular-nums whitespace-nowrap">
                    ${p.userWeeklyBribeUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-800 bg-[#0D111A]">
                <td colSpan={6} className="px-5 py-3 text-right text-xs font-medium text-slate-400">
                  Projected Total Epoch Voter Yield (Fees + External Bribes)
                </td>
                <td className="px-5 py-3 text-right font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  ${totalUserWeeklyRewardsUsd.toFixed(2)} / wk
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t border-slate-800/80 bg-[#0B0E14] px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-400">
            Encoded VoterV3.vote(1042, _poolVote, _weights) ABI Calldata
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
            {voteCalldataPreview}
          </div>
        </div>
      </section>
    </div>
  );
}
