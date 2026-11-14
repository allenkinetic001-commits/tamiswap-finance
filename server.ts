import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ethers } from 'ethers';

const app = express();
app.use(express.json({ limit: '1mb' }));

const REPO_ROOT = path.resolve(process.cwd(), 'contracts-repo');
const BSC_RPCS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
];

interface RepoFileMeta {
  path: string;
  name: string;
  category: string;
  ext: string;
  lines: number;
  bytes: number;
  pragma: string | null;
  declarations: Array<{ kind: string; name: string }>;
}

function classifyRepoPath(relPath: string): string {
  if (relPath.startsWith('contracts/APIHelper/')) return 'API Helpers';
  if (relPath.startsWith('contracts/factories/')) return 'Factories';
  if (relPath.startsWith('contracts/governance/')) return 'Governance';
  if (relPath.startsWith('contracts/chainlink/')) return 'Chainlink Automation';
  if (relPath.startsWith('contracts/MerkleTreeAndAirdrop/')) return 'Merkle & Airdrop';
  if (relPath.startsWith('contracts/TeamVesting/')) return 'Team Vesting';
  if (relPath.startsWith('contracts/interfaces/')) return 'Interfaces';
  if (relPath.startsWith('contracts/libraries/')) return 'Libraries';
  if (relPath.startsWith('contracts/')) return 'Core Contracts';
  if (relPath.startsWith('V1_Deprecated_Contracts/')) return 'V1 Deprecated';
  if (relPath.startsWith('scripts/V2/')) return 'V2 Scripts';
  if (relPath.startsWith('scripts/')) return 'V1 Scripts';
  if (relPath.startsWith('test/')) return 'Tests';
  return 'Configuration';
}

function parseSolidityQuickMeta(content: string) {
  const pragmaMatch = content.match(/pragma\s+solidity\s+([^;]+);/);
  const declarations: Array<{ kind: string; name: string }> = [];
  const declRegex = /^\s*(?:abstract\s+)?(contract|interface|library)\s+([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(content)) !== null) {
    declarations.push({ kind: m[1], name: m[2] });
  }
  return {
    pragma: pragmaMatch ? pragmaMatch[1].trim() : null,
    declarations,
  };
}

function parseSolidityFullDetails(content: string) {
  const imports: string[] = [];
  const importRegex = /import\s+(?:[^"']+from\s+)?["']([^"']+)["'];/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }

  const events: Array<{ name: string; signature: string; line: number }> = [];
  const functions: Array<{
    name: string;
    visibility: string;
    mutability: string;
    signature: string;
    line: number;
  }> = [];
  const constants: Array<{ name: string; type: string; value: string; line: number }> = [];

  const lines = content.split('\n');
  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const trimmed = rawLine.trim();

    const evMatch = trimmed.match(/^event\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
    if (evMatch) {
      events.push({
        name: evMatch[1],
        signature: `${evMatch[1]}(${evMatch[2].replace(/\s+/g, ' ').trim()})`,
        line: lineNum,
      });
    }

    const fnMatch = trimmed.match(
      /^function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*([^{;]*)/
    );
    if (fnMatch) {
      const modifiersStr = fnMatch[3] || '';
      const visMatch = modifiersStr.match(/\b(external|public|internal|private)\b/);
      const mutMatch = modifiersStr.match(/\b(view|pure|payable)\b/);
      functions.push({
        name: fnMatch[1],
        visibility: visMatch ? visMatch[1] : 'public',
        mutability: mutMatch ? mutMatch[1] : 'nonpayable',
        signature: `${fnMatch[1]}(${fnMatch[2].replace(/\s+/g, ' ').trim()})`,
        line: lineNum,
      });
    }

    const constMatch = trimmed.match(
      /^([A-Za-z0-9_\[\]]+)\s+(?:public|internal|private)?\s*constant\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/
    );
    if (constMatch) {
      constants.push({
        type: constMatch[1],
        name: constMatch[2],
        value: constMatch[3].trim(),
        line: lineNum,
      });
    }
  });

  return { imports, events, functions, constants };
}

async function walkDir(dir: string, base: string): Promise<RepoFileMeta[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: RepoFileMeta[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath, base);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.sol', '.js', '.md', '.json'].includes(ext)) continue;
      const content = await fs.readFile(fullPath, 'utf-8');
      const meta = ext === '.sol' ? parseSolidityQuickMeta(content) : { pragma: null, declarations: [] };
      results.push({
        path: relPath,
        name: entry.name,
        category: classifyRepoPath(relPath),
        ext,
        lines: content.split('\n').length,
        bytes: Buffer.byteLength(content, 'utf-8'),
        pragma: meta.pragma,
        declarations: meta.declarations,
      });
    }
  }
  return results;
}

let cachedTree: RepoFileMeta[] | null = null;

app.get('/api/repo/tree', async (_req, res) => {
  try {
    if (!cachedTree) {
      const files = await walkDir(REPO_ROOT, REPO_ROOT);
      files.sort((a, b) => a.path.localeCompare(b.path));
      cachedTree = files;
    }
    res.json({ files: cachedTree });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to scan contracts repository';
    res.status(500).json({ error: message });
  }
});

app.get('/api/repo/file', async (req, res) => {
  try {
    const relPath = String(req.query.path || '');
    if (!relPath || relPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    const resolved = path.resolve(REPO_ROOT, relPath);
    if (!resolved.startsWith(REPO_ROOT)) {
      return res.status(403).json({ error: 'Path outside repository bounds' });
    }
    const content = await fs.readFile(resolved, 'utf-8');
    const ext = path.extname(resolved).toLowerCase();
    const quick = ext === '.sol' ? parseSolidityQuickMeta(content) : { pragma: null, declarations: [] };
    const details = ext === '.sol' ? parseSolidityFullDetails(content) : { imports: [], events: [], functions: [], constants: [] };
    res.json({
      path: relPath,
      ext,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf-8'),
      content,
      ...quick,
      ...details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to read file';
    res.status(404).json({ error: message });
  }
});

// Safe allowlist of read-only ABI signatures for THENA BNB Chain contracts
const ALLOWED_VIEW_SIGNATURES: Record<string, string> = {
  'name()': 'function name() view returns (string)',
  'symbol()': 'function symbol() view returns (string)',
  'decimals()': 'function decimals() view returns (uint8)',
  'totalSupply()': 'function totalSupply() view returns (uint256)',
  'supply()': 'function supply() view returns (uint256)',
  'token()': 'function token() view returns (address)',
  'voter()': 'function voter() view returns (address)',
  'minter()': 'function minter() view returns (address)',
  'artProxy()': 'function artProxy() view returns (address)',
  'weekly()': 'function weekly() view returns (uint256)',
  'active_period()': 'function active_period() view returns (uint256)',
  'EMISSION()': 'function EMISSION() view returns (uint256)',
  'TAIL_EMISSION()': 'function TAIL_EMISSION() view returns (uint256)',
  'REBASEMAX()': 'function REBASEMAX() view returns (uint256)',
  'teamRate()': 'function teamRate() view returns (uint256)',
  'allPairsLength()': 'function allPairsLength() view returns (uint256)',
  'stableFee()': 'function stableFee() view returns (uint256)',
  'volatileFee()': 'function volatileFee() view returns (uint256)',
  'isPaused()': 'function isPaused() view returns (bool)',
  'length()': 'function length() view returns (uint256)',
  'totalWeight()': 'function totalWeight() view returns (uint256)',
  'factory()': 'function factory() view returns (address)',
  'gaugefactory()': 'function gaugefactory() view returns (address)',
  'bribefactory()': 'function bribefactory() view returns (address)',
  'last_token_time()': 'function last_token_time() view returns (uint256)',
  'tokens_per_week(uint256)': 'function tokens_per_week(uint256) view returns (uint256)',
  'balanceOf(address)': 'function balanceOf(address) view returns (uint256)',
  'balanceOfNFT(uint256)': 'function balanceOfNFT(uint256) view returns (uint256)',
  'locked(uint256)': 'function locked(uint256) view returns (int128 amount, uint256 end)',
  'tokenURI(uint256)': 'function tokenURI(uint256) view returns (string)',
};

function formatDecodedValue(val: unknown): string {
  if (typeof val === 'bigint') return val.toString();
  if (Array.isArray(val)) return val.map(formatDecodedValue).join(', ');
  if (val && typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

app.post('/api/rpc/call', async (req, res) => {
  const started = Date.now();
  try {
    const { address, signature, args = [] } = req.body as {
      address?: string;
      signature?: string;
      args?: string[];
    };

    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Valid contract address is required' });
    }
    const abiLine = signature ? ALLOWED_VIEW_SIGNATURES[signature] : undefined;
    if (!abiLine) {
      return res.status(400).json({ error: 'Unsupported or write method rejected (read-only view calls only)' });
    }

    const iface = new ethers.Interface([abiLine]);
    const fnName = signature!.split('(')[0];
    const calldata = iface.encodeFunctionData(fnName, args);

    let lastError = 'All BSC RPC endpoints timed out';
    for (const rpcUrl of BSC_RPCS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: address, data: calldata }, 'latest'],
          }),
        });
        clearTimeout(timer);

        if (!rpcRes.ok) {
          lastError = `RPC HTTP ${rpcRes.status}`;
          continue;
        }
        const json = (await rpcRes.json()) as { result?: string; error?: { message: string } };
        if (json.error) {
          return res.status(422).json({
            error: json.error.message || 'Contract execution reverted',
            calldata,
            rpcUrl,
            latencyMs: Date.now() - started,
          });
        }
        const rawResult = json.result || '0x';
        const decodedResult = iface.decodeFunctionResult(fnName, rawResult);
        const formatted =
          decodedResult.length === 1
            ? formatDecodedValue(decodedResult[0])
            : Array.from(decodedResult).map(formatDecodedValue);

        return res.json({
          address,
          signature,
          calldata,
          rawResult,
          decoded: formatted,
          rpcUrl,
          chainId: 56,
          latencyMs: Date.now() - started,
        });
      } catch (innerErr: unknown) {
        lastError = innerErr instanceof Error ? innerErr.message : 'Network error';
      }
    }

    return res.status(503).json({
      error: `Unable to reach BNB Chain RPC (${lastError})`,
      calldata,
      latencyMs: Date.now() - started,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid RPC request';
    res.status(400).json({ error: message });
  }
});

const PAIR_FACTORY_ADDRESS = '0xAFD89d21BdB66d00817d4153E055830B1c2B3970';
const PAIR_FACTORY_IFACE = new ethers.Interface([
  'function getPair(address tokenA, address tokenB, bool stable) view returns (address)',
  'function getFee(bool _stable) view returns (uint256)',
]);
const PAIR_IFACE = new ethers.Interface([
  'function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)',
  'function getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)',
  'function token0() view returns (address)',
]);

async function bscEthCall(to: string, data: string): Promise<string> {
  for (const rpcUrl of BSC_RPCS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      });
      clearTimeout(timer);
      if (!rpcRes.ok) continue;
      const json = (await rpcRes.json()) as { result?: string; error?: unknown };
      if (json.result && !json.error) {
        return json.result;
      }
    } catch {
      // try next RPC endpoint
    }
  }
  throw new Error('BSC RPC unreachable');
}

app.post('/api/swap/quote', async (req, res) => {
  try {
    const {
      tokenIn,
      tokenOut,
      amountInWei,
      mode = 'auto',
    } = req.body as {
      tokenIn?: string;
      tokenOut?: string;
      amountInWei?: string;
      mode?: 'auto' | 'volatile' | 'stable';
    };

    if (!tokenIn || !tokenOut || !ethers.isAddress(tokenIn) || !ethers.isAddress(tokenOut)) {
      return res.status(400).json({ error: 'Valid tokenIn and tokenOut addresses required' });
    }
    if (!amountInWei || BigInt(amountInWei) <= 0n) {
      return res.status(400).json({ error: 'Positive amountInWei required' });
    }

    const amountIn = BigInt(amountInWei);

    const checkPool = async (stable: boolean) => {
      const pairRaw = await bscEthCall(
        PAIR_FACTORY_ADDRESS,
        PAIR_FACTORY_IFACE.encodeFunctionData('getPair', [tokenIn, tokenOut, stable])
      );
      const pairDecoded = PAIR_FACTORY_IFACE.decodeFunctionResult('getPair', pairRaw);
      const pairAddress = String(pairDecoded[0]);
      if (!pairAddress || pairAddress === ethers.ZeroAddress) {
        return null;
      }
      const [outRaw, reservesRaw, token0Raw, feeRaw] = await Promise.all([
        bscEthCall(pairAddress, PAIR_IFACE.encodeFunctionData('getAmountOut', [amountIn, tokenIn])),
        bscEthCall(pairAddress, PAIR_IFACE.encodeFunctionData('getReserves', [])),
        bscEthCall(pairAddress, PAIR_IFACE.encodeFunctionData('token0', [])),
        bscEthCall(PAIR_FACTORY_ADDRESS, PAIR_FACTORY_IFACE.encodeFunctionData('getFee', [stable])),
      ]);
      const amountOut = BigInt(PAIR_IFACE.decodeFunctionResult('getAmountOut', outRaw)[0]);
      const reservesDecoded = PAIR_IFACE.decodeFunctionResult('getReserves', reservesRaw);
      const r0 = BigInt(reservesDecoded[0]);
      const r1 = BigInt(reservesDecoded[1]);
      const t0 = String(PAIR_IFACE.decodeFunctionResult('token0', token0Raw)[0]);
      const feeBps = BigInt(PAIR_FACTORY_IFACE.decodeFunctionResult('getFee', feeRaw)[0]);
      const isToken0In = t0.toLowerCase() === tokenIn.toLowerCase();
      return {
        pairAddress,
        stable,
        amountOut: amountOut.toString(),
        reserveIn: (isToken0In ? r0 : r1).toString(),
        reserveOut: (isToken0In ? r1 : r0).toString(),
        feeBps: Number(feeBps),
      };
    };

    const candidates: Array<NonNullable<Awaited<ReturnType<typeof checkPool>>>> = [];
    if (mode === 'auto' || mode === 'volatile') {
      const v = await checkPool(false).catch(() => null);
      if (v && BigInt(v.amountOut) > 0n) candidates.push(v);
    }
    if (mode === 'auto' || mode === 'stable') {
      const s = await checkPool(true).catch(() => null);
      if (s && BigInt(s.amountOut) > 0n) candidates.push(s);
    }

    if (candidates.length === 0) {
      return res.status(404).json({ error: 'No direct live pair liquidity found on BSC PairFactory' });
    }

    candidates.sort((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1));
    return res.json({
      source: 'bsc-mainnet',
      best: candidates[0],
      alternatives: candidates,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Quote lookup failed';
    return res.status(503).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.DEFAULT_APP_PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`THENA Contracts Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
