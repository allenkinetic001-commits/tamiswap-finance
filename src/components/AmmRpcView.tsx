import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { DEPLOYED_CONTRACTS, DeployedContract } from '../data/thenaRegistry';
import { computePairSwap } from '../utils/thenaMath';

interface AmmRpcViewProps {
  preselectedContract?: DeployedContract | null;
  onOpenSource: (path: string) => void;
}

interface RpcResponse {
  address?: string;
  signature?: string;
  calldata?: string;
  rawResult?: string;
  decoded?: string | string[];
  rpcUrl?: string;
  chainId?: number;
  latencyMs?: number;
  error?: string;
}

const INSPECTABLE_CONTRACTS = DEPLOYED_CONTRACTS.filter((c) => c.keyMethods.length > 0);

export function AmmRpcView({ preselectedContract, onOpenSource }: AmmRpcViewProps) {
  // Pair.sol AMM Invariant Calculator state
  const [reserveIn, setReserveIn] = useState(1_000_000);
  const [reserveOut, setReserveOut] = useState(1_000_000);
  const [amountIn, setAmountIn] = useState(50_000);
  const [volatileFeeBps, setVolatileFeeBps] = useState(20); // 0.20%
  const [stableFeeBps, setStableFeeBps] = useState(4); // 0.04%

  // Live BNB Chain RPC Inspector state
  const [selectedContractId, setSelectedContractId] = useState<string>(
    preselectedContract?.keyMethods.length ? preselectedContract.id : INSPECTABLE_CONTRACTS[0].id
  );
  const [selectedMethod, setSelectedMethod] = useState<string>(
    preselectedContract?.keyMethods[0] || INSPECTABLE_CONTRACTS[0].keyMethods[0]
  );
  const [argInput, setArgInput] = useState('1');
  const [rpcLoading, setRpcLoading] = useState(false);
  const [rpcResult, setRpcResult] = useState<RpcResponse | null>(null);

  useEffect(() => {
    if (preselectedContract && preselectedContract.keyMethods.length > 0) {
      setSelectedContractId(preselectedContract.id);
      setSelectedMethod(preselectedContract.keyMethods[0]);
      setRpcResult(null);
    }
  }, [preselectedContract]);

  const activeContract = useMemo(
    () => INSPECTABLE_CONTRACTS.find((c) => c.id === selectedContractId) || INSPECTABLE_CONTRACTS[0],
    [selectedContractId]
  );

  const methodRequiresArg = useMemo(
    () => /\((uint256|address)\)/.test(selectedMethod),
    [selectedMethod]
  );

  const volatileSwap = useMemo(
    () =>
      computePairSwap({
        amountIn,
        reserveIn,
        reserveOut,
        stable: false,
        feeBps: volatileFeeBps,
      }),
    [amountIn, reserveIn, reserveOut, volatileFeeBps]
  );

  const stableSwap = useMemo(
    () =>
      computePairSwap({
        amountIn,
        reserveIn,
        reserveOut,
        stable: true,
        feeBps: stableFeeBps,
      }),
    [amountIn, reserveIn, reserveOut, stableFeeBps]
  );

  // Price Impact curve data across trade sizes 1%..50% of reserveIn
  const curvePoints = useMemo(() => {
    const steps = [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
    return steps.map((ratio) => {
      const tradeSize = reserveIn * ratio;
      const v = computePairSwap({
        amountIn: tradeSize,
        reserveIn,
        reserveOut,
        stable: false,
        feeBps: volatileFeeBps,
      });
      const s = computePairSwap({
        amountIn: tradeSize,
        reserveIn,
        reserveOut,
        stable: true,
        feeBps: stableFeeBps,
      });
      return {
        ratioPct: ratio * 100,
        volatileImpact: v.priceImpactPct,
        stableImpact: s.priceImpactPct,
      };
    });
  }, [reserveIn, reserveOut, volatileFeeBps, stableFeeBps]);

  async function handleExecuteRpcCall() {
    setRpcLoading(true);
    setRpcResult(null);
    try {
      const args = methodRequiresArg ? [argInput.trim()] : [];
      const res = await fetch('/api/rpc/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: activeContract.address,
          signature: selectedMethod,
          args,
        }),
      });
      const data = (await res.json()) as RpcResponse;
      setRpcResult(data);
    } catch (err: unknown) {
      setRpcResult({
        error: err instanceof Error ? err.message : 'Network error calling /api/rpc/call',
      });
    } finally {
      setRpcLoading(false);
    }
  }

  // SVG Dimensions for Price Impact comparison
  const svgW = 540;
  const svgH = 200;
  const pL = 48;
  const pR = 16;
  const pT = 16;
  const pB = 28;
  const plotW = svgW - pL - pR;
  const plotH = svgH - pT - pB;
  const maxImpact = Math.max(
    10,
    ...curvePoints.map((c) => Math.max(c.volatileImpact, c.stableImpact))
  );

  const volatilePath = curvePoints
    .map((c, i) => {
      const x = pL + (i / (curvePoints.length - 1)) * plotW;
      const y = pT + (1 - c.volatileImpact / maxImpact) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const stablePath = curvePoints
    .map((c, i) => {
      const x = pL + (i / (curvePoints.length - 1)) * plotW;
      const y = pT + (1 - c.stableImpact / maxImpact) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            Pair.sol AMM Invariants & BNB Chain RPC Inspector
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Compare Volatile (<span className="font-mono text-slate-300">x·y ≥ k</span>) vs Stable (<span className="font-mono text-slate-300">x³y + y³x ≥ k</span>) swap curves from <span className="font-mono text-slate-300">Pair.sol</span> and execute live read-only <span className="font-mono text-slate-300">eth_call</span> queries against BSC Mainnet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenSource('contracts/Pair.sol')}
          className="rounded border border-slate-700/80 bg-[#111622] px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800"
        >
          Pair.sol
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Pair.sol Invariant Calculator */}
        <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-5 xl:col-span-6">
          <div className="border-b border-slate-800/80 pb-3.5">
            <h2 className="text-base font-semibold text-slate-100">
              Pair.getAmountOut() Dual-Invariant Workbench
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Evaluates both AMM curves side by side using Newton-Raphson convergence for stable pairs.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-slate-400">Reserve A (Token In)</label>
              <input
                type="number"
                min={1000}
                step={10000}
                value={reserveIn}
                onChange={(e) => setReserveIn(Math.max(1000, Number(e.target.value)))}
                className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Reserve B (Token Out)</label>
              <input
                type="number"
                min={1000}
                step={10000}
                value={reserveOut}
                onChange={(e) => setReserveOut(Math.max(1000, Number(e.target.value)))}
                className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Swap Amount In</label>
              <input
                type="number"
                min={1}
                step={1000}
                value={amountIn}
                onChange={(e) => setAmountIn(Math.max(1, Number(e.target.value)))}
                className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Volatile Fee (bps)</span>
                <span className="font-mono text-slate-200 tabular-nums">{volatileFeeBps} bps</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={volatileFeeBps}
                onChange={(e) => setVolatileFeeBps(Number(e.target.value))}
                className="mt-1 w-full accent-amber-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Stable Fee (bps)</span>
                <span className="font-mono text-slate-200 tabular-nums">{stableFeeBps} bps</span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={stableFeeBps}
                onChange={(e) => setStableFeeBps(Number(e.target.value))}
                className="mt-1 w-full accent-emerald-500"
              />
            </div>
          </div>

          {/* Comparison Table */}
          <div className="mt-5 overflow-hidden rounded border border-slate-800/80">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 bg-[#0D111A] text-slate-400">
                  <th className="px-3.5 py-2.5 font-medium">Metric</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-amber-400">
                    vAMM (x·y ≥ k)
                  </th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-emerald-400">
                    sAMM (x³y + y³x ≥ k)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-[#0B0E14] font-mono tabular-nums">
                <tr>
                  <td className="px-3.5 py-2.5 font-sans text-slate-400">amountOut</td>
                  <td className="px-3.5 py-2.5 text-right text-slate-100">
                    {volatileSwap.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-slate-100">
                    {stableSwap.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
                <tr>
                  <td className="px-3.5 py-2.5 font-sans text-slate-400">Effective Price</td>
                  <td className="px-3.5 py-2.5 text-right text-slate-200">
                    {volatileSwap.effectivePrice.toFixed(4)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-slate-200">
                    {stableSwap.effectivePrice.toFixed(4)}
                  </td>
                </tr>
                <tr>
                  <td className="px-3.5 py-2.5 font-sans text-slate-400">Price Impact</td>
                  <td className="px-3.5 py-2.5 text-right text-amber-400">
                    {volatileSwap.priceImpactPct.toFixed(2)}%
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-emerald-400">
                    {stableSwap.priceImpactPct.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-3.5 py-2.5 font-sans text-slate-400">Fee to Bribes</td>
                  <td className="px-3.5 py-2.5 text-right text-slate-300">
                    {volatileSwap.feePaid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-slate-300">
                    {stableSwap.feePaid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Slippage Comparison SVG */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Price Impact vs Trade Depth (1% – 50% of Reserve A)</span>
              <span className="font-mono text-[11px]">
                Amber: vAMM · Emerald: sAMM
              </span>
            </div>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="h-44 w-full">
              {[0, 0.5, 1].map((frac) => {
                const y = pT + (1 - frac) * plotH;
                return (
                  <g key={frac}>
                    <line
                      x1={pL}
                      x2={svgW - pR}
                      y1={y}
                      y2={y}
                      stroke="rgba(148,163,184,0.12)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={pL - 6}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 font-mono text-[10px]"
                    >
                      {(maxImpact * frac).toFixed(0)}%
                    </text>
                  </g>
                );
              })}
              {curvePoints.map((c, idx) => {
                const x = pL + (idx / (curvePoints.length - 1)) * plotW;
                return (
                  <text
                    key={c.ratioPct}
                    x={x}
                    y={svgH - 6}
                    textAnchor="middle"
                    className="fill-slate-500 font-mono text-[10px]"
                  >
                    {c.ratioPct}%
                  </text>
                );
              })}
              <polyline fill="none" stroke="#F59E0B" strokeWidth="2" points={volatilePath} />
              <polyline fill="none" stroke="#10B981" strokeWidth="2" points={stablePath} />
            </svg>
          </div>
        </section>

        {/* Right: Live BNB Chain RPC Inspector */}
        <section className="flex flex-col justify-between rounded-lg border border-slate-800/80 bg-[#111622] p-5 xl:col-span-6">
          <div>
            <div className="border-b border-slate-800/80 pb-3.5">
              <h2 className="text-base font-semibold text-slate-100">
                BNB Chain Read-Only RPC Inspector (Chain ID 56)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Execute live <span className="font-mono text-slate-300">eth_call</span> queries against verified THENA deployment addresses via bsc-dataseed.
              </p>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs text-slate-400">Target Contract</label>
                <select
                  value={activeContract.id}
                  onChange={(e) => {
                    const next = INSPECTABLE_CONTRACTS.find((c) => c.id === e.target.value);
                    if (next) {
                      setSelectedContractId(next.id);
                      setSelectedMethod(next.keyMethods[0]);
                      setRpcResult(null);
                    }
                  }}
                  className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-3 py-2 font-mono text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                >
                  {INSPECTABLE_CONTRACTS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.address}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400">View Function</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {activeContract.keyMethods.map((method) => {
                    const active = method === selectedMethod;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => {
                          setSelectedMethod(method);
                          setRpcResult(null);
                        }}
                        className={`rounded px-2.5 py-1 font-mono text-xs whitespace-nowrap shrink-0 transition-colors ${
                          active
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'border border-slate-800 bg-[#0B0E14] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {method}
                      </button>
                    );
                  })}
                </div>
              </div>

              {methodRequiresArg && (
                <div>
                  <label className="block text-xs text-slate-400">
                    Call Argument ({selectedMethod.includes('address') ? 'address' : 'uint256'})
                  </label>
                  <input
                    type="text"
                    value={argInput}
                    onChange={(e) => setArgInput(e.target.value)}
                    placeholder={
                      selectedMethod.includes('address') ? '0x...' : 'e.g. 1'
                    }
                    className="mt-1 w-full rounded border border-slate-800 bg-[#0B0E14] px-3 py-2 font-mono text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleExecuteRpcCall}
                disabled={rpcLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {rpcLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Querying BSC Mainnet...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    <span>Execute eth_call</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* RPC Output Box */}
          <div className="mt-6 rounded border border-slate-800/80 bg-[#0B0E14] p-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 text-xs">
              <span className="font-medium text-slate-300">Decoded Response</span>
              {rpcResult?.latencyMs !== undefined && (
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {rpcResult.latencyMs} ms · {rpcResult.rpcUrl ? new URL(rpcResult.rpcUrl).hostname : 'BSC'}
                </span>
              )}
            </div>

            {!rpcResult && !rpcLoading && (
              <div className="py-8 text-center text-xs text-slate-500">
                Select a contract and view method above, then click Execute eth_call to read live BSC Mainnet state.
              </div>
            )}

            {rpcLoading && (
              <div className="space-y-2 py-6">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800/60" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-800/60" />
              </div>
            )}

            {rpcResult?.error && (
              <div className="mt-3 rounded border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
                {rpcResult.error}
              </div>
            )}

            {rpcResult && !rpcResult.error && (
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500">Decoded Value</div>
                  <div className="mt-1 max-h-40 overflow-auto rounded bg-[#111622] p-2.5 font-mono text-sm font-semibold break-all text-emerald-400">
                    {Array.isArray(rpcResult.decoded)
                      ? rpcResult.decoded.join(' , ')
                      : rpcResult.decoded}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Encoded Calldata</div>
                  <div className="mt-1 font-mono text-[11px] break-all text-slate-400">
                    {rpcResult.calldata}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Raw Hex Returndata</div>
                  <div className="mt-1 max-h-24 overflow-auto font-mono text-[11px] break-all text-slate-500">
                    {rpcResult.rawResult}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
