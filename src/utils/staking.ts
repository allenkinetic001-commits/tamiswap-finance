import { ethers } from 'ethers';
import {
  PANCAKE_PAIR_FACTORY_ADDRESS,
  SwapToken,
  TAMIYANOIA_ADDRESS,
  TAMIYANOIA_STAKING_ADDRESS,
  WBNB_ADDRESS,
} from '../data/swapTokens';
import {
  ensureBscNetwork,
  fetchOnChainQuote,
  getBscReadProvider,
} from './bscWeb3';

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

export interface TamiStakingOnChainState {
  isConfigured: boolean;
  isValidContract: boolean;
  contractAddress: string;
  ownerAddress: string | null;
  treasuryAddress: string | null;
  totalStakedWei: bigint;
  rewardReserveWei: bigint;
  rewardRateWeiPerSec: bigint;
  periodFinish: number;
  lockDurationSec: number;
  stakeFeeBps: number;
  unstakeFeeBps: number;
  apyPct: number | null;
  userStakedWei: bigint;
  userEarnedWei: bigint;
  userUnlockTime: number;
}

export interface TamiPairSnapshot {
  pairAddress: string;
  pooledBnb: number;
  pooledTami: number;
  tamiPerBnb: number;
}

export const TAMIYANOIA_TOKEN: SwapToken = {
  symbol: 'TAMIYANOIA',
  name: 'TAMIYANOIA',
  address: TAMIYANOIA_ADDRESS,
  decimals: 18,
  logoURI: '/assets/aistudio/tamiswap_00325eac.png',
};

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

export const TAMI_STAKING_STORAGE_KEY = 'tamiswap_tami_staking_contract';

export const TAMI_STAKING_ABI = [
  'function stakingToken() view returns (address)',
  'function owner() view returns (address)',
  'function treasury() view returns (address)',
  'function totalStaked() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function earned(address account) view returns (uint256)',
  'function rewardReserve() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function rewardsDuration() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  'function lockDuration() view returns (uint256)',
  'function unlockTime(address account) view returns (uint256)',
  'function stakeFeeBps() view returns (uint16)',
  'function unstakeFeeBps() view returns (uint16)',
  'function stake(uint256 amount) external',
  'function withdraw(uint256 amount) external',
  'function claimReward() external',
  'function exit() external',
  'function fundRewards(uint256 amount, uint256 durationDays) external',
];

const LISTA_MGR_ABI = [
  'function convertSnBnbToBnb(uint256 _amountInSnBnb) view returns (uint256)',
  'function getTotalPooledBnb() view returns (uint256)',
];

const STADER_MGR_ABI = [
  'function getTotalPooledBnb() view returns (uint256)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
];

interface LlamaPoolRaw {
  chain?: string;
  project?: string;
  symbol?: string;
  apy?: number | null;
  tvlUsd?: number | null;
}

export function getEffectiveTamiStakingAddress(): string {
  if (TAMIYANOIA_STAKING_ADDRESS && ethers.isAddress(TAMIYANOIA_STAKING_ADDRESS)) {
    return ethers.getAddress(TAMIYANOIA_STAKING_ADDRESS);
  }
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(TAMI_STAKING_STORAGE_KEY)?.trim() || '';
      if (saved && ethers.isAddress(saved)) {
        return ethers.getAddress(saved);
      }
    } catch {
      // ignore storage errors
    }
  }
  return '';
}

export function saveLocalTamiStakingAddress(addr: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = addr.trim();
    if (!clean) {
      window.localStorage.removeItem(TAMI_STAKING_STORAGE_KEY);
    } else if (ethers.isAddress(clean)) {
      window.localStorage.setItem(TAMI_STAKING_STORAGE_KEY, ethers.getAddress(clean));
    }
  } catch {
    // ignore storage errors
  }
}

export async function fetchTamiPairSnapshot(): Promise<TamiPairSnapshot | null> {
  try {
    const provider = await getBscReadProvider();
    const factory = new ethers.Contract(
      PANCAKE_PAIR_FACTORY_ADDRESS,
      ['function getPair(address,address) view returns (address)'],
      provider
    );
    const pairAddress = (await factory.getPair(
      WBNB_ADDRESS,
      TAMIYANOIA_ADDRESS
    )) as string;
    if (!pairAddress || pairAddress === ethers.ZeroAddress) return null;

    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [[r0, r1], token0] = await Promise.all([
      pair.getReserves() as Promise<[bigint, bigint, bigint]>,
      pair.token0() as Promise<string>,
    ]);

    const isWbnbToken0 = token0.toLowerCase() === WBNB_ADDRESS.toLowerCase();
    const wbnbWei = isWbnbToken0 ? r0 : r1;
    const tamiWei = isWbnbToken0 ? r1 : r0;

    const pooledBnb = Number(ethers.formatEther(wbnbWei));
    const pooledTami = Number(ethers.formatUnits(tamiWei, 18));
    if (pooledBnb <= 0 || pooledTami <= 0) return null;

    return {
      pairAddress,
      pooledBnb,
      pooledTami,
      tamiPerBnb: pooledTami / pooledBnb,
    };
  } catch {
    return null;
  }
}

export async function fetchTamiStakingState(
  contractAddress: string,
  walletAddress: string | null
): Promise<TamiStakingOnChainState> {
  const empty: TamiStakingOnChainState = {
    isConfigured: Boolean(contractAddress && ethers.isAddress(contractAddress)),
    isValidContract: false,
    contractAddress,
    ownerAddress: null,
    treasuryAddress: null,
    totalStakedWei: 0n,
    rewardReserveWei: 0n,
    rewardRateWeiPerSec: 0n,
    periodFinish: 0,
    lockDurationSec: 0,
    stakeFeeBps: 0,
    unstakeFeeBps: 0,
    apyPct: null,
    userStakedWei: 0n,
    userEarnedWei: 0n,
    userUnlockTime: 0,
  };

  if (!empty.isConfigured) return empty;

  try {
    const provider = await getBscReadProvider();
    const code = await provider.getCode(contractAddress);
    if (!code || code === '0x') {
      return empty;
    }

    const staking = new ethers.Contract(contractAddress, TAMI_STAKING_ABI, provider);
    const tokenAddr = (await staking.stakingToken()) as string;
    if (!tokenAddr || tokenAddr.toLowerCase() !== TAMIYANOIA_ADDRESS.toLowerCase()) {
      return empty;
    }

    const [
      ownerAddr,
      treasuryAddr,
      totalStaked,
      rewardReserve,
      rewardRate,
      periodFinish,
      lockDuration,
      stakeFeeBps,
      unstakeFeeBps,
    ] = await Promise.all([
      staking.owner() as Promise<string>,
      staking.treasury() as Promise<string>,
      staking.totalStaked() as Promise<bigint>,
      staking.rewardReserve() as Promise<bigint>,
      staking.rewardRate() as Promise<bigint>,
      staking.periodFinish() as Promise<bigint>,
      staking.lockDuration() as Promise<bigint>,
      staking.stakeFeeBps() as Promise<bigint>,
      staking.unstakeFeeBps() as Promise<bigint>,
    ]);

    let userStakedWei = 0n;
    let userEarnedWei = 0n;
    let userUnlockTime = 0;

    if (walletAddress && ethers.isAddress(walletAddress)) {
      const [uBal, uEarned, uUnlock] = await Promise.all([
        staking.balanceOf(walletAddress) as Promise<bigint>,
        staking.earned(walletAddress) as Promise<bigint>,
        staking.unlockTime(walletAddress) as Promise<bigint>,
      ]);
      userStakedWei = uBal;
      userEarnedWei = uEarned;
      userUnlockTime = Number(uUnlock);
    }

    const finishNum = Number(periodFinish);
    const nowSec = Math.floor(Date.now() / 1000);
    let apyPct: number | null = null;
    if (finishNum > nowSec && rewardRate > 0n && totalStaked > 0n) {
      const annualRewards = Number(ethers.formatUnits(rewardRate * 31536000n, 18));
      const totalStakedFloat = Number(ethers.formatUnits(totalStaked, 18));
      if (totalStakedFloat > 0 && Number.isFinite(annualRewards)) {
        apyPct = (annualRewards / totalStakedFloat) * 100;
      }
    }

    return {
      isConfigured: true,
      isValidContract: true,
      contractAddress: ethers.getAddress(contractAddress),
      ownerAddress: ethers.getAddress(ownerAddr),
      treasuryAddress: ethers.getAddress(treasuryAddr),
      totalStakedWei: totalStaked,
      rewardReserveWei: rewardReserve,
      rewardRateWeiPerSec: rewardRate,
      periodFinish: finishNum,
      lockDurationSec: Number(lockDuration),
      stakeFeeBps: Number(stakeFeeBps),
      unstakeFeeBps: Number(unstakeFeeBps),
      apyPct,
      userStakedWei,
      userEarnedWei,
      userUnlockTime,
    };
  } catch {
    return empty;
  }
}

export async function stakeTamiyanoia(
  ethereum: ethers.Eip1193Provider,
  contractAddress: string,
  amountWei: bigint
): Promise<ethers.TransactionResponse> {
  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const staking = new ethers.Contract(contractAddress, TAMI_STAKING_ABI, signer);
  return (await staking.stake(amountWei)) as ethers.TransactionResponse;
}

export async function unstakeTamiyanoia(
  ethereum: ethers.Eip1193Provider,
  contractAddress: string,
  amountWei: bigint
): Promise<ethers.TransactionResponse> {
  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const staking = new ethers.Contract(contractAddress, TAMI_STAKING_ABI, signer);
  return (await staking.withdraw(amountWei)) as ethers.TransactionResponse;
}

export async function claimTamiyanoiaReward(
  ethereum: ethers.Eip1193Provider,
  contractAddress: string
): Promise<ethers.TransactionResponse> {
  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const staking = new ethers.Contract(contractAddress, TAMI_STAKING_ABI, signer);
  return (await staking.claimReward()) as ethers.TransactionResponse;
}

export async function fundTamiyanoiaRewards(
  ethereum: ethers.Eip1193Provider,
  contractAddress: string,
  amountWei: bigint,
  durationDays: number
): Promise<ethers.TransactionResponse> {
  await ensureBscNetwork(ethereum);
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const signer = await browserProvider.getSigner();
  const staking = new ethers.Contract(contractAddress, TAMI_STAKING_ABI, signer);
  return (await staking.fundRewards(
    amountWei,
    BigInt(durationDays)
  )) as ethers.TransactionResponse;
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
