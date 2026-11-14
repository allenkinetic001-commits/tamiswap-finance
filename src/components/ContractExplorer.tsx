import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, FileCode2, Folder, Search } from 'lucide-react';

export interface RepoFileMeta {
  path: string;
  name: string;
  category: string;
  ext: string;
  lines: number;
  bytes: number;
  pragma: string | null;
  declarations: Array<{ kind: string; name: string }>;
}

interface RepoFileDetail {
  path: string;
  ext: string;
  lines: number;
  bytes: number;
  content: string;
  pragma: string | null;
  declarations: Array<{ kind: string; name: string }>;
  imports: string[];
  events: Array<{ name: string; signature: string; line: number }>;
  functions: Array<{
    name: string;
    visibility: string;
    mutability: string;
    signature: string;
    line: number;
  }>;
  constants: Array<{ name: string; type: string; value: string; line: number }>;
}

interface ContractExplorerProps {
  files: RepoFileMeta[];
  activePath: string;
  onSelectPath: (path: string) => void;
}

const CATEGORY_ORDER = [
  'Core Contracts',
  'Factories',
  'API Helpers',
  'Governance',
  'Chainlink Automation',
  'Merkle & Airdrop',
  'Team Vesting',
  'Interfaces',
  'Libraries',
  'V2 Scripts',
  'V1 Scripts',
  'Tests',
  'V1 Deprecated',
  'Configuration',
];

export function ContractExplorer({
  files,
  activePath,
  onSelectPath,
}: ContractExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    'V1 Deprecated': true,
    Interfaces: true,
    'V1 Scripts': true,
  });
  const [fileDetail, setFileDetail] = useState<RepoFileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHighlightedLine(null);

    fetch(`/api/repo/file?path=${encodeURIComponent(activePath)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: RepoFileDetail) => {
        if (!cancelled) {
          setFileDetail(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load source file');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePath]);

  const groupedFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<string, RepoFileMeta[]>();

    for (const f of files) {
      if (
        q &&
        !f.path.toLowerCase().includes(q) &&
        !f.declarations.some((d) => d.name.toLowerCase().includes(q))
      ) {
        continue;
      }
      const list = map.get(f.category) || [];
      list.push(f);
      map.set(f.category, list);
    }

    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      items: map.get(cat)!,
    }));
  }, [files, searchQuery]);

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function jumpToLine(lineNumber: number) {
    setHighlightedLine(lineNumber);
    const el = document.getElementById(`sol-line-${lineNumber}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function handleCopyCode() {
    if (!fileDetail) return;
    navigator.clipboard.writeText(fileDetail.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1600);
  }

  const codeLines = useMemo(() => {
    if (!fileDetail) return [];
    return fileDetail.content.split('\n');
  }, [fileDetail]);

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[620px] flex-col overflow-hidden rounded-lg border border-slate-800/80 bg-[#111622] lg:flex-row">
      {/* Left File Tree */}
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-800/80 bg-[#0D111A] lg:w-72 lg:border-r lg:border-b-0">
        <div className="border-b border-slate-800/80 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search .sol, contract, script..."
              className="w-full rounded border border-slate-800 bg-[#0B0E14] py-1.5 pr-2.5 pl-8 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {groupedFiles.map((group) => {
            const isCollapsed = searchQuery.trim() ? false : !!collapsedCategories[group.category];
            return (
              <div key={group.category} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleCategory(group.category)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-medium text-slate-300 hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${
                        isCollapsed ? '' : 'rotate-90'
                      }`}
                    />
                    <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
                    <span className="truncate">{group.category}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {group.items.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="mt-0.5 space-y-0.5 pl-4">
                    {group.items.map((item) => {
                      const active = item.path === activePath;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => onSelectPath(item.path)}
                          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                            active
                              ? 'bg-amber-500/15 font-medium text-amber-300'
                              : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <span className="truncate font-mono">{item.name}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                            {item.lines}L
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {groupedFiles.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-500">
              No files match "{searchQuery}"
            </div>
          )}
        </div>
      </aside>

      {/* Center Code Viewer */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#0B0E14]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#111622] px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-medium text-slate-100">
              {activePath}
            </div>
            {fileDetail && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                <span>{fileDetail.lines} lines</span>
                <span aria-hidden="true">·</span>
                <span>{(fileDetail.bytes / 1024).toFixed(1)} KB</span>
                {fileDetail.pragma && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-amber-400/90">
                      solidity {fileDetail.pragma}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            disabled={!fileDetail}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700/80 bg-[#0D111A] px-2.5 py-1 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:bg-slate-800 disabled:opacity-40"
          >
            {copiedCode ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy Source</span>
              </>
            )}
          </button>
        </div>

        <div ref={codeContainerRef} className="flex-1 overflow-auto font-mono text-xs leading-5">
          {loading && (
            <div className="space-y-2 p-5">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-slate-800/50"
                  style={{ width: `${55 + ((i * 17) % 40)}%` }}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="m-5 rounded border border-red-900/60 bg-red-950/30 p-4 text-xs text-red-300">
              Error loading file: {error}
            </div>
          )}

          {!loading && !error && fileDetail && (
            <table className="w-full border-collapse">
              <tbody>
                {codeLines.map((line, index) => {
                  const lineNo = index + 1;
                  const isHighlighted = highlightedLine === lineNo;
                  return (
                    <tr
                      key={lineNo}
                      id={`sol-line-${lineNo}`}
                      className={isHighlighted ? 'bg-amber-500/15' : 'hover:bg-slate-900/60'}
                    >
                      <td className="w-12 border-r border-slate-800/60 px-3 py-0.5 text-right text-[11px] text-slate-600 select-none tabular-nums">
                        {lineNo}
                      </td>
                      <td className="px-4 py-0.5 whitespace-pre text-slate-200">
                        {line || ' '}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right AST / ABI Outline Panel */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-slate-800/80 bg-[#0D111A] xl:flex">
        <div className="border-b border-slate-800/80 px-4 py-3">
          <div className="text-xs font-semibold text-slate-200">
            Contract Structure & ABI Outline
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Select any symbol to jump to line
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
          {fileDetail && fileDetail.declarations.length > 0 && (
            <div>
              <div className="mb-2 font-medium text-slate-400">Declarations</div>
              <div className="space-y-1">
                {fileDetail.declarations.map((d, idx) => (
                  <div
                    key={`${d.name}-${idx}`}
                    className="flex items-center justify-between font-mono text-slate-200"
                  >
                    <span className="truncate font-semibold text-amber-300">{d.name}</span>
                    <span className="text-[11px] text-slate-500">{d.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fileDetail && fileDetail.constants.length > 0 && (
            <div>
              <div className="mb-2 font-medium text-slate-400">Constants</div>
              <div className="space-y-1.5">
                {fileDetail.constants.map((c) => (
                  <button
                    key={`${c.name}-${c.line}`}
                    type="button"
                    onClick={() => jumpToLine(c.line)}
                    className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-800/60"
                  >
                    <span className="truncate font-mono text-slate-200">{c.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                      {c.value}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {fileDetail && fileDetail.functions.length > 0 && (
            <div>
              <div className="mb-2 font-medium text-slate-400">
                Functions ({fileDetail.functions.length})
              </div>
              <div className="space-y-1">
                {fileDetail.functions.map((fn, idx) => (
                  <button
                    key={`${fn.name}-${fn.line}-${idx}`}
                    type="button"
                    onClick={() => jumpToLine(fn.line)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-800/60"
                  >
                    <span className="truncate font-mono text-[11px] text-slate-200">
                      {fn.name}()
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                      {fn.mutability === 'view' || fn.mutability === 'pure'
                        ? fn.mutability
                        : fn.visibility}{' '}
                      · L{fn.line}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {fileDetail && fileDetail.events.length > 0 && (
            <div>
              <div className="mb-2 font-medium text-slate-400">
                Events ({fileDetail.events.length})
              </div>
              <div className="space-y-1">
                {fileDetail.events.map((ev) => (
                  <button
                    key={`${ev.name}-${ev.line}`}
                    type="button"
                    onClick={() => jumpToLine(ev.line)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-800/60"
                  >
                    <span className="truncate font-mono text-[11px] text-slate-300">
                      {ev.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                      L{ev.line}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {fileDetail && fileDetail.imports.length > 0 && (
            <div>
              <div className="mb-2 font-medium text-slate-400">
                Imports ({fileDetail.imports.length})
              </div>
              <div className="space-y-1 font-mono text-[11px] text-slate-400">
                {fileDetail.imports.map((imp) => (
                  <div key={imp} className="truncate" title={imp}>
                    {imp}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
