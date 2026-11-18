import { ethers } from 'ethers';
import {
  SwapToken,
  WBNB_ADDRESS,
} from '../data/swapTokens';
import { fetchOnChainQuote, getBscReadProvider } from './bscWeb3';

export interface BnbStakingPool {
  id: 'slisbnb' | 'bnbx';
  protocolName: string;
  token: SwapToken;
  stakeManagerAddress: string;
  llamaProject?: string;
  llamaSymbol: string;
  contractUrl: string;
}

export interface StakingPoolStats {
  apyPct: number | null;
  tvlUsd: number | null;
  totalPooledBnb: number | null;
  bnbPerToken: number | null;
}

export const NATIVE_BNB_TOKEN: SwapToken = {
  symbol: 'BNB',
  name: 'BNB (Native)',
  address: WBNB_ADDRESS,
  decimals: 18,
  isNative: true,
  logoURI:
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
};

export const BNB_STAKING_POOLS: BnbStakingPool[] = [
  {
    id: 'slisbnb',
    protocolName: 'Lista DAO',
    token: {
      symbol: 'slisBNB',
      name: 'Lista Staked BNB',
      address: '0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B',
      decimals: 18,
      logoURI:
        'https://coin-images.coingecko.com/coins/images/31101/small/slisBNB_200x200.png?1707363149',
    },
    stakeManagerAddress: '0x1adB950d8bB3dA4bE104211D5AB038628e477fE6',
    llamaProject: 'lista-liquid-staking',
    llamaSymbol: 'SLISBNB',
    contractUrl:
      'https://bscscan.com/token/0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B',
  },
  {
    id: 'bnbx',
    protocolName: 'Stader Labs',
    token: {
      symbol: 'BNBx',
      name: 'Stader BNBx',
      address: '0x1bdd3Cf7F79cfB8EdbB955f20ad99211551BA275',
      decimals: 18,
      logoURI:
        'https://coin-images.coingecko.com/coins/images/26842/small/BNBx_Logo.png?1696525902',
    },
    stakeManagerAddress: '0x7276241a669489E4BBB76f63d2A43Bfe63080F2F',
    llamaSymbol: 'BNBX',
    contractUrl:
      'https://bscscan.com/token/0x1bdd3Cf7F79cfB8EdbB955f20ad99211551BA275',
  },
];

const LISTA_MGR_ABI = [
  'function convertSnBnbToBnb(uint256 _amountInSnBnb) view returns (uint256)',
  'function getTotalPooledBnb() view returns (uint256)',
];

const STADER_MGR_ABI = [
  'function getTotalPooledBnb() view returns (uint256)',
];

interface LlamaPoolRaw {
  chain?: string;
  project?: string;
  symbol?: string;
  apy?: number | null;
  tvlUsd?: number | null;
}

export async function fetchLiveBnbStakingStats(): Promise<
  Record<string, StakingPoolStats>
> {
  const stats: Record<string, StakingPoolStats> = {
    slisbnb: {
      apyPct: null,
      tvlUsd: null,
      totalPooledBnb: null,
      bnbPerToken: null,
    },
    bnbx: {
      apyPct: null,
      tvlUsd: null,
      totalPooledBnb: null,
      bnbPerToken: null,
    },
  };

  // 1. Live BSC APY & TVL from DeFiLlama Yields API
  const llamaPromise = (async () => {
    try {
      const res = await fetch('https://yields.llama.fi/pools');
      if (!res.ok) return;
      const json = (await res.json()) as { data?: LlamaPoolRaw[] };
      const rows = (json.data || []).filter((p) => p.chain === 'BSC');

      for (const pool of BNB_STAKING_POOLS) {
        const match = rows.find((r) => {
          const sym = (r.symbol || '').toUpperCase();
          if (pool.llamaProject && r.project === pool.llamaProject && sym === pool.llamaSymbol) {
            return true;
          }
          return sym === pool.llamaSymbol && (r.apy ?? 0) > 0;
        });
        if (match) {
          stats[pool.id].apyPct =
            typeof match.apy === 'number' && Number.isFinite(match.apy)
              ? match.apy
              : null;
          stats[pool.id].tvlUsd =
            typeof match.tvlUsd === 'number' && Number.isFinite(match.tvlUsd)
              ? match.tvlUsd
              : null;
        }
      }
    } catch {
      // Keep non-mocked null if yields API is unreachable
    }
  })();

  // 2. Direct BSC RPC StakeManager stats + live 1-token exit quote
  const onChainPromise = (async () => {
    try {
      const provider = await getBscReadProvider();
      const listaMgr = new ethers.Contract(
        BNB_STAKING_POOLS[0].stakeManagerAddress,
        LISTA_MGR_ABI,
        provider
      );
      const staderMgr = new ethers.Contract(
        BNB_STAKING_POOLS[1].stakeManagerAddress,
        STADER_MGR_ABI,
        provider
      );

      const [listaRatio, listaPooled, staderPooled, bnbxQuote] =
        await Promise.allSettled([
          listaMgr.convertSnBnbToBnb(ethers.parseEther('1')) as Promise<bigint>,
          listaMgr.getTotalPooledBnb() as Promise<bigint>,
          staderMgr.getTotalPooledBnb() as Promise<bigint>,
          fetchOnChainQuote({
            tokenIn: BNB_STAKING_POOLS[1].token,
            tokenOut: NATIVE_BNB_TOKEN,
            amountInWei: ethers.parseEther('1'),
            mode: 'auto',
            tokenSymbolMap: {
              [BNB_STAKING_POOLS[1].token.address.toLowerCase()]: 'BNBx',
            },
          }),
        ]);

      if (listaRatio.status === 'fulfilled') {
        stats.slisbnb.bnbPerToken = Number(ethers.formatEther(listaRatio.value));
      }
      if (listaPooled.status === 'fulfilled') {
        stats.slisbnb.totalPooledBnb = Number(
          ethers.formatEther(listaPooled.value)
        );
      }
      if (staderPooled.status === 'fulfilled') {
        stats.bnbx.totalPooledBnb = Number(
          ethers.formatEther(staderPooled.value)
        );
      }
      if (bnbxQuote.status === 'fulfilled' && bnbxQuote.value) {
        stats.bnbx.bnbPerToken = Number(bnbxQuote.value.amountOutFormatted);
      }
    } catch {
      // ignore RPC stats error
    }
  })();

  await Promise.all([llamaPromise, onChainPromise]);
  return stats;
}
