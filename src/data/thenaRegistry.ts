export interface DeployedContract {
  id: string;
  name: string;
  symbol?: string;
  category:
    | 'Token & Emissions'
    | 'Vote-Escrow & NFTs'
    | 'Voting & Gauges'
    | 'AMM & Routing'
    | 'Governance & Security'
    | 'API Helpers';
  address: string;
  repoPath: string;
  upgradeable: boolean;
  version: 'V1' | 'V2' | 'V3';
  summary: string;
  keyMethods: string[];
}

export const DEPLOYED_CONTRACTS: DeployedContract[] = [
  {
    id: 'thena-token',
    name: 'Thena',
    symbol: 'THE',
    category: 'Token & Emissions',
    address: '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11',
    repoPath: 'contracts/Thena.sol',
    upgradeable: false,
    version: 'V1',
    summary: 'ERC-20 protocol governance and emission token with 50M initial supply and single Minter mint authority.',
    keyMethods: ['name()', 'symbol()', 'decimals()', 'totalSupply()', 'minter()'],
  },
  {
    id: 'minter',
    name: 'MinterUpgradeable',
    category: 'Token & Emissions',
    address: '0xb7ED8fA63BEa18986fa78D62F33497B1acDEa1D8',
    repoPath: 'contracts/MinterUpgradeable.sol',
    upgradeable: true,
    version: 'V2',
    summary: 'Executes weekly Thursday 00:00 UTC emission minting (1% weekly decay, 0.2% tail emission, 4% team rate, veTHE rebase).',
    keyMethods: ['weekly()', 'active_period()', 'EMISSION()', 'TAIL_EMISSION()', 'REBASEMAX()', 'teamRate()'],
  },
  {
    id: 'rewards-distributor',
    name: 'RewardsDistributor',
    category: 'Token & Emissions',
    address: '0xE9fE83aA430Ace4b703C299701142f9dFdde730E',
    repoPath: 'contracts/RewardsDistributor.sol',
    upgradeable: false,
    version: 'V1',
    summary: 'Distributes weekly anti-dilution veTHE rebase emissions claimable per lock tokenId.',
    keyMethods: ['token()', 'last_token_time()', 'tokens_per_week(uint256)'],
  },
  {
    id: 'voting-escrow',
    name: 'VotingEscrow',
    symbol: 'veTHE',
    category: 'Vote-Escrow & NFTs',
    address: '0xfBBF371C9B0B994EebFcC977CEf603F7f31c070D',
    repoPath: 'contracts/VotingEscrow.sol',
    upgradeable: false,
    version: 'V1',
    summary: 'ERC-721 vote-escrow NFT holding locked THE for up to 2 years with linear voting power decay and merge/split support.',
    keyMethods: ['supply()', 'token()', 'voter()', 'artProxy()', 'balanceOfNFT(uint256)', 'locked(uint256)', 'tokenURI(uint256)'],
  },
  {
    id: 've-art-proxy',
    name: 'VeArtProxyUpgradeable',
    category: 'Vote-Escrow & NFTs',
    address: '0xE9fE83aA430Ace4b703C299701142f9dFdde730E',
    repoPath: 'contracts/VeArtProxyUpgradeable.sol',
    upgradeable: true,
    version: 'V1',
    summary: 'Generates on-chain Base64 JSON metadata and SVG token artwork dynamically reflecting veTHE balance and unlock end.',
    keyMethods: [],
  },
  {
    id: 'thenian',
    name: 'Thenian',
    symbol: 'THENIAN',
    category: 'Vote-Escrow & NFTs',
    address: '0x2Af749593978CB79Ed11B9959cD82FD128BA4f8d',
    repoPath: 'contracts/Thenian.sol',
    upgradeable: false,
    version: 'V1',
    summary: 'Founding THENA ecosystem ERC-721 collection eligible for trading fee staking royalties via Royalties and StakingNFTFeeConverter.',
    keyMethods: ['name()', 'symbol()', 'totalSupply()'],
  },
  {
    id: 'voter-v3',
    name: 'VoterV3',
    category: 'Voting & Gauges',
    address: '0x3a1d0952809f4948d15ebce8d345962a282c4fcb',
    repoPath: 'contracts/VoterV3.sol',
    upgradeable: true,
    version: 'V3',
    summary: 'Core ve(3,3) gauge controller coordinating epoch pool voting weights, internal fee bribes, external bribes, and emission distribution.',
    keyMethods: ['length()', 'totalWeight()', 'factory()', 'gaugefactory()', 'bribefactory()'],
  },
  {
    id: 'gauge-factory-v2',
    name: 'GaugeFactoryV2',
    category: 'Voting & Gauges',
    address: '0x2c788FE40A417612cb654b14a944cd549B5BF130',
    repoPath: 'contracts/factories/GaugeFactoryV2.sol',
    upgradeable: true,
    version: 'V2',
    summary: 'Deploys GaugeV2 rewarder contracts for standard vAMM and sAMM liquidity pairs with PermissionsRegistry role checks.',
    keyMethods: [],
  },
  {
    id: 'bribe-factory-v3',
    name: 'BribeFactoryV3',
    category: 'Voting & Gauges',
    address: '0xD50CEAB3071c61c85D04bDD65Feb12FEe7C91375',
    repoPath: 'contracts/factories/BribeFactoryV3.sol',
    upgradeable: true,
    version: 'V3',
    summary: 'Deploys internal (swap fees) and external (protocol incentives) Bribe contracts tied to each pool gauge.',
    keyMethods: [],
  },
  {
    id: 'pair-factory',
    name: 'PairFactory',
    category: 'AMM & Routing',
    address: '0xAFD89d21BdB66d00817d4153E055830B1c2B3970',
    repoPath: 'contracts/factories/PairFactory.sol',
    upgradeable: false,
    version: 'V1',
    summary: 'Creates volatile (x·y ≥ k) and stable (x³y + y³x ≥ k) Pair pools with independent fee bps and pause controls.',
    keyMethods: ['allPairsLength()', 'stableFee()', 'volatileFee()', 'isPaused()'],
  },
  {
    id: 'algebra-router',
    name: 'AlgebraSwapRouter',
    category: 'AMM & Routing',
    address: '0x327Dd3208f0bCF590A66110aCB6e5e6941A4EfA0',
    repoPath: 'contracts/GaugeV2_CL.sol',
    upgradeable: false,
    version: 'V2',
    summary: 'Concentrated liquidity (Fusion) swap and GaugeV2_CL farming integration for dynamic-fee Algebra pools.',
    keyMethods: [],
  },
  {
    id: 'permissions-registry',
    name: 'PermissionsRegistry',
    category: 'Governance & Security',
    address: '0xe3Db58904B868eFDECD374Ed4f7b75e2A0f3e0Eb',
    repoPath: 'contracts/PermissionsRegistry.sol',
    upgradeable: false,
    version: 'V2',
    summary: 'Role-based access registry governing GOVERNANCE, VOTER_ADMIN, GAUGE_ADMIN, BRIBE_ADMIN, and FEE_MANAGER permissions.',
    keyMethods: [],
  },
  {
    id: 'pair-api',
    name: 'PairAPI',
    category: 'API Helpers',
    address: '0xE89080cEb6CAEb9Eba5a0d4Aa13686eFcB78A32E',
    repoPath: 'contracts/APIHelper/PairAPI.sol',
    upgradeable: true,
    version: 'V2',
    summary: 'Aggregated multicall-style read lens returning pair reserves, fees, gauges, bribes, and user balances in one call.',
    keyMethods: [],
  },
];

export interface PoolSimulationSeed {
  id: string;
  symbol: string;
  pairType: 'vAMM' | 'sAMM' | 'CL';
  feeBps: number;
  tvlUsd: number;
  weeklyFeesUsd: number;
  externalBribesUsd: number;
  currentVotes: number;
}

export const INITIAL_POOLS: PoolSimulationSeed[] = [
  {
    id: 'cl-wbnb-usdt',
    symbol: 'CL-WBNB/USDT',
    pairType: 'CL',
    feeBps: 5,
    tvlUsd: 18_400_000,
    weeklyFeesUsd: 64_200,
    externalBribesUsd: 28_500,
    currentVotes: 14_200_000,
  },
  {
    id: 'vamm-the-wbnb',
    symbol: 'vAMM-THE/WBNB',
    pairType: 'vAMM',
    feeBps: 20,
    tvlUsd: 9_850_000,
    weeklyFeesUsd: 39_100,
    externalBribesUsd: 18_000,
    currentVotes: 11_500_000,
  },
  {
    id: 'samm-usdt-usdc',
    symbol: 'sAMM-USDT/USDC',
    pairType: 'sAMM',
    feeBps: 4,
    tvlUsd: 24_100_000,
    weeklyFeesUsd: 21_400,
    externalBribesUsd: 22_000,
    currentVotes: 8_900_000,
  },
  {
    id: 'cl-btcb-wbnb',
    symbol: 'CL-BTCB/WBNB',
    pairType: 'CL',
    feeBps: 5,
    tvlUsd: 14_600_000,
    weeklyFeesUsd: 34_800,
    externalBribesUsd: 12_400,
    currentVotes: 7_400_000,
  },
  {
    id: 'cl-eth-usdt',
    symbol: 'CL-ETH/USDT',
    pairType: 'CL',
    feeBps: 5,
    tvlUsd: 11_200_000,
    weeklyFeesUsd: 27_900,
    externalBribesUsd: 9_600,
    currentVotes: 5_800_000,
  },
  {
    id: 'samm-hay-usdt',
    symbol: 'sAMM-lisUSD/USDT',
    pairType: 'sAMM',
    feeBps: 4,
    tvlUsd: 6_300_000,
    weeklyFeesUsd: 6_800,
    externalBribesUsd: 16_200,
    currentVotes: 4_200_000,
  },
];
