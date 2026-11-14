import { useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, Search } from 'lucide-react';
import { DEPLOYED_CONTRACTS, DeployedContract } from '../data/thenaRegistry';

interface ArchitectureViewProps {
  totalRepoFiles: number;
  totalSolidityLines: number;
  onOpenSource: (repoPath: string) => void;
  onInspectRpc: (contract: DeployedContract) => void;
}

const CATEGORIES = [
  'All',
  'Token & Emissions',
  'Vote-Escrow & NFTs',
  'Voting & Gauges',
  'AMM & Routing',
  'Governance & Security',
  'API Helpers',
] as const;

export function ArchitectureView({
  totalRepoFiles,
  totalSolidityLines,
  onOpenSource,
  onInspectRpc,
}: ArchitectureViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredContracts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return DEPLOYED_CONTRACTS.filter((c) => {
      const catMatch = selectedCategory === 'All' || c.category === selectedCategory;
      const textMatch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.repoPath.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q);
      return catMatch && textMatch;
    });
  }, [selectedCategory, searchQuery]);

  function handleCopy(id: string, address: string) {
    navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1600);
  }

  return (
    <div className="space-y-8">
      {/* Header Summary */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
          Protocol Architecture & Deployment Registry
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-400">
          THENA implements a Solidly-derived ve(3,3) liquidity coordinator on BNB Chain (Chain ID 56), combining
          ERC-721 vote-escrow locks, weekly epoch emissions, internal/external gauge bribes, and dual-invariant AMM + Algebra concentrated liquidity pools.
        </p>
      </div>

      {/* 4-column Key Spec Strip */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-800/80 bg-slate-800/80 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Repository Files</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {totalRepoFiles}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {totalSolidityLines.toLocaleString()} lines indexed
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Target Network</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            BSC · 56
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Solidity 0.8.13 & 0.7.0 (200 runs)
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Epoch Cadence</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            7 Days
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Resets Thursday 00:00 UTC
          </div>
        </div>
        <div className="bg-[#111622] px-5 py-4">
          <div className="text-xs text-slate-400">Max Lock Horizon</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            104 Wks
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Linear voting power decay (2 yrs)
          </div>
        </div>
      </div>

      {/* ve(3,3) Contract Interaction Topology */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111622] p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              ve(3,3) Epoch Value & Control Loop
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Click any contract module below to inspect its Solidity implementation directly.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            EpochController.sol · Chainlink Automation compatible
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <button
            type="button"
            onClick={() => onOpenSource('contracts/MinterUpgradeable.sol')}
            className="group flex flex-col justify-between rounded-md border border-slate-800 bg-[#0D111A] p-4 text-left transition-colors hover:border-amber-500/50"
          >
            <div>
              <div className="text-xs text-amber-400">01. Minting</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100 group-hover:text-amber-300">
                MinterUpgradeable
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Mints weekly THE (1% decay, 0.2% tail) and sends 4% team rate + veTHE anti-dilution rebase.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-amber-300">
              <span>Read MinterUpgradeable.sol</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSource('contracts/VotingEscrow.sol')}
            className="group flex flex-col justify-between rounded-md border border-slate-800 bg-[#0D111A] p-4 text-left transition-colors hover:border-amber-500/50"
          >
            <div>
              <div className="text-xs text-amber-400">02. Locking</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100 group-hover:text-amber-300">
                VotingEscrow
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Escrows THE into ERC-721 veTHE NFTs with linear voting weight up to 2 years and VeArtProxy SVG.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-amber-300">
              <span>Read VotingEscrow.sol</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSource('contracts/VoterV3.sol')}
            className="group flex flex-col justify-between rounded-md border border-slate-800 bg-[#0D111A] p-4 text-left transition-colors hover:border-amber-500/50"
          >
            <div>
              <div className="text-xs text-amber-400">03. Voting</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100 group-hover:text-amber-300">
                VoterV3
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Records veTHE pool weight allocations and distributes weekly emissions proportionally to active gauges.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-amber-300">
              <span>Read VoterV3.sol</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSource('contracts/GaugeV2.sol')}
            className="group flex flex-col justify-between rounded-md border border-slate-800 bg-[#0D111A] p-4 text-left transition-colors hover:border-amber-500/50"
          >
            <div>
              <div className="text-xs text-amber-400">04. Gauges</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100 group-hover:text-amber-300">
                GaugeV2 / CL
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Streams THE rewards to staked Pair LP and Algebra CL liquidity providers; routes trading fees to bribes.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-amber-300">
              <span>Read GaugeV2.sol</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSource('contracts/Bribes.sol')}
            className="group flex flex-col justify-between rounded-md border border-slate-800 bg-[#0D111A] p-4 text-left transition-colors hover:border-amber-500/50"
          >
            <div>
              <div className="text-xs text-amber-400">05. Incentives</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100 group-hover:text-amber-300">
                Bribes & Fees
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Internal bribes (100% swap fees) and external token bribes settle pro-rata to veTHE voters per epoch.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-amber-300">
              <span>Read Bribes.sol</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>
        </div>
      </section>

      {/* Deployed Contract Registry Table */}
      <section className="rounded-lg border border-slate-800/80 bg-[#111622]">
        <div className="flex flex-col gap-4 border-b border-slate-800/80 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              BNB Chain Deployed Contract Registry
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Addresses extracted from scripts/V1 and scripts/V2 deployment manifests.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter contract or address..."
                className="w-60 rounded-md border border-slate-800 bg-[#0B0E14] py-1.5 pr-3 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Category Segmented Filter */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-800/80 bg-[#0D111A] px-5 py-2.5">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="px-5 py-3 font-medium">Contract</th>
                <th className="px-4 py-3 font-medium">Role & Architecture</th>
                <th className="px-4 py-3 font-medium">BNB Chain Address</th>
                <th className="px-4 py-3 font-medium">Deployment</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredContracts.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-slate-800/30">
                  <td className="px-5 py-3.5 align-top whitespace-nowrap">
                    <div className="font-mono text-sm font-medium text-slate-100">
                      {c.name}
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      {c.category} · {c.version}
                    </div>
                  </td>
                  <td className="max-w-md px-4 py-3.5 align-top leading-relaxed text-slate-300">
                    {c.summary}
                  </td>
                  <td className="px-4 py-3.5 align-top whitespace-nowrap">
                    <div className="flex items-center gap-2 font-mono text-slate-200 tabular-nums">
                      <span>{c.address}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(c.id, c.address)}
                        title="Copy address"
                        className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                      >
                        {copiedId === c.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {c.repoPath}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 align-top whitespace-nowrap text-slate-400">
                    {c.upgradeable ? 'Upgradeable Proxy' : 'Immutable'}
                  </td>
                  <td className="px-5 py-3.5 text-right align-top whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenSource(c.repoPath)}
                        className="rounded border border-slate-700/80 bg-[#0B0E14] px-2.5 py-1 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:border-slate-600 hover:bg-slate-800"
                      >
                        View Source
                      </button>
                      {c.keyMethods.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onInspectRpc(c)}
                          className="inline-flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-slate-950 whitespace-nowrap shrink-0 hover:bg-amber-400"
                        >
                          <span>Query RPC</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredContracts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                    No contracts match your current filter.
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory('All');
                        setSearchQuery('');
                      }}
                      className="ml-2 text-amber-400 hover:underline"
                    >
                      Reset filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
