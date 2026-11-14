import { useMemo, useState } from 'react';
import { Check, Copy, GitMerge, Plus, Scissors } from 'lucide-react';
import {
  buildDecaySeries,
  computeVeBalance,
  generateVeArtSvgAndJson,
  MAXTIME_WEEKS,
  VeLockPosition,
  WEEK_SECONDS,
} from '../utils/thenaMath';

interface VeLockStudioProps {
  onOpenSource: (path: string) => void;
}

const INITIAL_LOCKS: VeLockPosition[] = [
  { tokenId: 1042, amount: 25000, lockWeeks: 104, createdAtWeek: 0 },
  { tokenId: 1187, amount: 8500, lockWeeks: 52, createdAtWeek: 0 },
];

export function VeLockStudio({ onOpenSource }: VeLockStudioProps) {
  const [locks, setLocks] = useState<VeLockPosition[]>(INITIAL_LOCKS);
  const [selectedTokenId, setSelectedTokenId] = useState<number>(1042);

  // Create Lock form
  const [newAmount, setNewAmount] = useState<number>(10000);
  const [newWeeks, setNewWeeks] = useState<number>(104);

  // Modify Lock inputs
  const [addAmount, setAddAmount] = useState<number>(2500);
  const [mergeTargetId, setMergeTargetId] = useState<number>(1187);
  const [splitRatioPct, setSplitRatioPct] = useState<number>(50);
  const [elapsedWeeks, setElapsedWeeks] = useState<number>(0);
  const [copiedUri, setCopiedUri] = useState(false);

  const selectedLock = useMemo(
    () => locks.find((l) => l.tokenId === selectedTokenId) || locks[0],
    [locks, selectedTokenId]
  );

  const totalVePower = useMemo(
    () =>
      locks.reduce(
        (sum, l) => sum + computeVeBalance(l.amount, Math.max(0, l.lockWeeks - elapsedWeeks)),
        0
      ),
    [locks, elapsedWeeks]
  );

  const totalTheLocked = useMemo(
    () => locks.reduce((sum, l) => sum + l.amount, 0),
    [locks]
  );

  const activePower = selectedLock
    ? computeVeBalance(selectedLock.amount, Math.max(0, selectedLock.lockWeeks - elapsedWeeks))
    : 0;

  const decaySeries = useMemo(() => {
    if (!selectedLock) return [];
    return buildDecaySeries(selectedLock.amount, selectedLock.lockWeeks);
  }, [selectedLock]);

  const veArt = useMemo(() => {
    if (!selectedLock) return null;
    const nowEpoch = Math.floor(Date.now() / 1000 / WEEK_SECONDS) * WEEK_SECONDS;
    const unlockEnd = nowEpoch + selectedLock.lockWeeks * WEEK_SECONDS;
    const balanceWei = BigInt(Math.round(activePower * 1e6)) * 10n ** 12n;
    const valueWei = BigInt(Math.round(selectedLock.amount * 1e6)) * 10n ** 12n;
    return generateVeArtSvgAndJson(
      selectedLock.tokenId,
      balanceWei.toString(),
      unlockEnd,
      valueWei.toString()
    );
  }, [selectedLock, activePower]);

  function handleCreateLock() {
    if (newAmount <= 0) return;
    const nextId = Math.max(1000, ...locks.map((l) => l.tokenId)) + 1;
    const created: VeLockPosition = {
      tokenId: nextId,
      amount: newAmount,
      lockWeeks: Math.max(1, Math.min(MAXTIME_WEEKS, newWeeks)),
      createdAtWeek: elapsedWeeks,
    };
    setLocks((prev) => [...prev, created]);
    setSelectedTokenId(nextId);
  }

  function handleIncreaseAmount() {
    if (!selectedLock || addAmount <= 0) return;
    setLocks((prev) =>
      prev.map((l) =>
        l.tokenId === selectedLock.tokenId ? { ...l, amount: l.amount + addAmount } : l
      )
    );
  }

  function handleExtendToMax() {
    if (!selectedLock) return;
    setLocks((prev) =>
      prev.map((l) =>
        l.tokenId === selectedLock.tokenId
          ? { ...l, lockWeeks: Math.min(MAXTIME_WEEKS, elapsedWeeks + MAXTIME_WEEKS) }
          : l
      )
    );
  }

  function handleMerge() {
    if (!selectedLock || locks.length < 2) return;
    const fromLock = locks.find((l) => l.tokenId === mergeTargetId && l.tokenId !== selectedLock.tokenId);
    if (!fromLock) return;
    const mergedWeeks = Math.max(selectedLock.lockWeeks, fromLock.lockWeeks);
    setLocks((prev) =>
      prev
        .filter((l) => l.tokenId !== fromLock.tokenId)
        .map((l) =>
          l.tokenId === selectedLock.tokenId
            ? { ...l, amount: l.amount + fromLock.amount, lockWeeks: mergedWeeks }
            : l
        )
    );
  }

  function handleSplit() {
    if (!selectedLock || selectedLock.amount < 2) return;
    const firstAmount = Math.round((selectedLock.amount * splitRatioPct) / 100);
    const secondAmount = selectedLock.amount - firstAmount;
    if (firstAmount <= 0 || secondAmount <= 0) return;
    const nextId = Math.max(1000, ...locks.map((l) => l.tokenId)) + 1;
    setLocks((prev) => [
      ...prev.map((l) =>
        l.tokenId === selectedLock.tokenId ? { ...l, amount: firstAmount } : l
      ),
      {
        tokenId: nextId,
        amount: secondAmount,
        lockWeeks: selectedLock.lockWeeks,
        createdAtWeek: selectedLock.createdAtWeek,
      },
    ]);
  }

  function handleCopyTokenUri() {
    if (!veArt) return;
    navigator.clipboard.writeText(veArt.dataUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1500);
  }

  // SVG Chart dimensions
  const chartW = 560;
  const chartH = 210;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const maxVal = Math.max(1, selectedLock?.amount || 1);

  const polyPoints = decaySeries
    .map((pt) => {
      const x = padL + (pt.week / MAXTIME_WEEKS) * plotW;
      const y = padT + (1 - pt.power / maxVal) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const currentMarkerX = padL + (elapsedWeeks / MAXTIME_WEEKS) * plotW;
  const currentMarkerY = padT + (1 - activePower / maxVal) * plotH;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            veTHE Lock & VeArtProxy Studio
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Simulate ERC-721 vote-escrow mechanics from <span className="font-mono text-slate-300">VotingEscrow.sol</span> and inspect live on-chain SVG metadata generated by <span className="font-mono text-slate-300">VeArtProxyUpgradeable.sol</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenSource('contracts/VotingEscrow.sol')}
            className="rounded border border-slate-700/80 bg-[#111622] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
          >
            VotingEscrow.sol
          </button>
          <button
            type="button"
            onClick={() => onOpenSource('contracts/VeArtProxyUpgradeable.sol')}
            className="rounded border border-slate-700/80 bg-[#111622] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
          >
            VeArtProxyUpgradeable.sol
          </button>
        </div>
      </div>

      {/* Portfolio Totals Strip */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-800/80 bg-slate-800/80 sm:grid-cols-4">
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Active veNFT Locks</div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-100 tabular-nums">
            {locks.length}
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Total Locked THE</div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-100 tabular-nums">
            {totalTheLocked.toLocaleString()} THE
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Total Voting Power (t+{elapsedWeeks}w)</div>
          <div className="mt-1 font-mono text-xl font-semibold text-amber-400 tabular-nums">
            {totalVePower.toLocaleString(undefined, { maximumFractionDigits: 1 })} veTHE
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Time Scrub (Weeks Elapsed)</div>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={104}
              value={elapsedWeeks}
              onChange={(e) => setElapsedWeeks(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <span className="w-10 text-right font-mono text-sm font-medium text-slate-200 tabular-nums">
              {elapsedWeeks}w
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Lock Selector + Create Lock + Actions */}
        <div className="space-y-6 lg:col-span-5">
          {/* Existing Locks Table */}
          <section className="rounded-lg border border-slate-800/80 bg-[#111622]">
            <div className="border-b border-slate-800/80 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-100">
                veTHE NFT Positions
              </h2>
            </div>
            <div className="divide-y divide-slate-800/60">
              {locks.map((l) => {
                const remWeeks = Math.max(0, l.lockWeeks - elapsedWeeks);
                const power = computeVeBalance(l.amount, remWeeks);
                const active = l.tokenId === selectedLock?.tokenId;
                return (
                  <button
                    key={l.tokenId}
                    type="button"
                    onClick={() => setSelectedTokenId(l.tokenId)}
                    className={`flex w-full items-center justify-between px-5 py-3 text-left transition-colors ${
                      active ? 'bg-amber-500/10' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div>
                      <div className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
                        lock #{l.tokenId}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
                        {l.amount.toLocaleString()} THE · {remWeeks}w remaining
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold text-amber-400 tabular-nums">
                        {power.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </div>
                      <div className="text-[11px] text-slate-500">veTHE power</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Create Lock (`create_lock`) */}
          <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5">
            <h2 className="text-sm font-semibold text-slate-100">
              create_lock(uint _value, uint _lock_duration)
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Mint a new veTHE ERC-721 lock rounded to weekly Thursday 00:00 UTC epochs.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs text-slate-400">Lock Amount (THE)</label>
                <input
                  type="number"
                  min={1}
                  value={newAmount}
                  onChange={(e) => setNewAmount(Math.max(1, Number(e.target.value)))}
                  className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Duration (1 – 104 Weeks)</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {newWeeks} weeks ({((newWeeks / MAXTIME_WEEKS) * 100).toFixed(0)}% weight)
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={104}
                  value={newWeeks}
                  onChange={(e) => setNewWeeks(Number(e.target.value))}
                  className="mt-2 w-full accent-amber-500"
                />
                <div className="mt-2 flex items-center gap-1.5">
                  {[4, 26, 52, 104].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewWeeks(preset)}
                      className={`rounded px-2.5 py-1 font-mono text-xs whitespace-nowrap shrink-0 ${
                        newWeeks === preset
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-[#0B0E14] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset === 104 ? '2Y (MAX)' : `${preset}W`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs">
                <span className="text-slate-400">Initial Voting Power</span>
                <span className="font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  {computeVeBalance(newAmount, newWeeks).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{' '}
                  veTHE
                </span>
              </div>

              <button
                type="button"
                onClick={handleCreateLock}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Mint Simulated veTHE Lock</span>
              </button>
            </div>
          </section>

          {/* Mutate Selected Lock */}
          {selectedLock && (
            <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5">
              <h2 className="text-sm font-semibold text-slate-100">
                Manage lock #{selectedLock.tokenId}
              </h2>

              <div className="mt-4 space-y-4">
                {/* increase_amount */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400">
                      increase_amount (+THE)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={addAmount}
                      onChange={(e) => setAddAmount(Math.max(1, Number(e.target.value)))}
                      className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-3 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleIncreaseAmount}
                    className="rounded border border-slate-700 bg-[#0D111A] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
                  >
                    Add THE
                  </button>
                  <button
                    type="button"
                    onClick={handleExtendToMax}
                    className="rounded border border-slate-700 bg-[#0D111A] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
                  >
                    Extend to 2Y
                  </button>
                </div>

                {/* split */}
                <div className="flex items-end gap-2 border-t border-slate-800/80 pt-3">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400">
                      split(uint[] amounts) · Keep {splitRatioPct}% / Split {100 - splitRatioPct}%
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={5}
                      value={splitRatioPct}
                      onChange={(e) => setSplitRatioPct(Number(e.target.value))}
                      className="mt-2 w-full accent-amber-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSplit}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0D111A] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span>Split NFT</span>
                  </button>
                </div>

                {/* merge */}
                {locks.length > 1 && (
                  <div className="flex items-end gap-2 border-t border-slate-800/80 pt-3">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400">
                        merge(uint _from, uint _to)
                      </label>
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(Number(e.target.value))}
                        className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:outline-none"
                      >
                        {locks
                          .filter((l) => l.tokenId !== selectedLock.tokenId)
                          .map((l) => (
                            <option key={l.tokenId} value={l.tokenId}>
                              lock #{l.tokenId} ({l.amount.toLocaleString()} THE)
                            </option>
                          ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleMerge}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0D111A] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      <span>Merge Into #{selectedLock.tokenId}</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Decay Curve + VeArtProxy On-Chain SVG */}
        <div className="space-y-6 lg:col-span-7">
          {/* Linear Decay Curve */}
          <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Linear Voting Power Decay (slope = amount / MAXTIME)
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  lock #{selectedLock?.tokenId} · {selectedLock?.amount.toLocaleString()} THE locked for {selectedLock?.lockWeeks} weeks
                </p>
              </div>
              <div className="font-mono text-xs text-amber-400 tabular-nums">
                Current: {activePower.toLocaleString(undefined, { maximumFractionDigits: 2 })} veTHE
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="h-56 w-full min-w-[440px]"
                aria-label="veTHE linear decay chart"
              >
                {/* Horizontal gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const y = padT + (1 - frac) * plotH;
                  const labelVal = Math.round(maxVal * frac);
                  return (
                    <g key={frac}>
                      <line
                        x1={padL}
                        x2={chartW - padR}
                        y1={y}
                        y2={y}
                        stroke="rgba(148,163,184,0.12)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padL - 8}
                        y={y + 4}
                        textAnchor="end"
                        className="fill-slate-500 font-mono text-[10px]"
                      >
                        {labelVal >= 1000 ? `${(labelVal / 1000).toFixed(1)}k` : labelVal}
                      </text>
                    </g>
                  );
                })}

                {/* X axis ticks */}
                {[0, 26, 52, 78, 104].map((wk) => {
                  const x = padL + (wk / MAXTIME_WEEKS) * plotW;
                  return (
                    <text
                      key={wk}
                      x={x}
                      y={chartH - 8}
                      textAnchor="middle"
                      className="fill-slate-500 font-mono text-[10px]"
                    >
                      {wk}w
                    </text>
                  );
                })}

                {/* Decay Line */}
                <polyline
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="2.2"
                  points={polyPoints}
                />

                {/* Current elapsed week marker */}
                <line
                  x1={currentMarkerX}
                  x2={currentMarkerX}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="rgba(248,250,252,0.35)"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={currentMarkerX}
                  cy={currentMarkerY}
                  r="4.5"
                  fill="#F59E0B"
                  stroke="#0B0E14"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </section>

          {/* VeArtProxyUpgradeable Output */}
          {veArt && (
            <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    VeArtProxyUpgradeable._tokenURI() Output
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Exact on-chain Base64 SVG and ERC-721 JSON rendered by contracts/VeArtProxyUpgradeable.sol
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyTokenUri}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-700/80 bg-[#0B0E14] px-2.5 py-1 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
                >
                  {copiedUri ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copied Data URI</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Base64 URI</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className="overflow-hidden rounded border border-slate-800 bg-black">
                    <img
                      src={veArt.jsonObj.image}
                      alt={`veTHE ${veArt.jsonObj.name}`}
                      className="aspect-square w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <div className="flex flex-col justify-between space-y-3 md:col-span-7">
                  <div>
                    <div className="text-xs font-medium text-slate-400">Decoded ERC-721 JSON</div>
                    <pre className="mt-1.5 overflow-x-auto rounded border border-slate-800 bg-[#0B0E14] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                      {JSON.stringify(
                        {
                          name: veArt.jsonObj.name,
                          description: veArt.jsonObj.description,
                          image: `${veArt.jsonObj.image.slice(0, 56)}...`,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Raw On-Chain SVG Markup</div>
                    <pre className="mt-1.5 max-h-36 overflow-auto rounded border border-slate-800 bg-[#0B0E14] p-3 font-mono text-[11px] leading-relaxed text-amber-200/85">
                      {veArt.svg}
                    </pre>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
