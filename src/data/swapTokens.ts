export interface SwapToken {
  symbol: string;
  name: string;
  address: string; // ERC-20 address (WBNB address used for native BNB routing)
  decimals: number;
  isNative?: boolean;
  logoURI?: string;
}

export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = '0x38';

// Verified BNB Smart Chain (56) Router, Factory & Token Addresses
export const THENA_ROUTER_V2_ADDRESS = '0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109';
export const THENA_PAIR_FACTORY_ADDRESS = '0xAFD89d21BdB66d00817d4153E055830B1c2B3970';
export const PANCAKE_ROUTER_V2_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
export const PANCAKE_PAIR_FACTORY_ADDRESS = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
export const TAMIYANOIA_ADDRESS = '0x8bea530150675c1eC537Bde45c0480164590c898';
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
export const PLATFORM_FEE_BPS = 25;
export const PLATFORM_FEE_RECIPIENT = '0xcd4BDDeae498c7E303C153921b03da4b83FE846c';
export const TAMI_FEE_ROUTER_ADDRESS =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_FEE_ROUTER_ADDRESS || '').trim();
export const TAMIYANOIA_STAKING_ADDRESS =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_TAMIYANOIA_STAKING_ADDRESS || '').trim();

export const BSC_RPC_URLS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
];

// Default BNB Chain token list (users can also import any BEP-20 by contract address)
export const DEFAULT_SWAP_TOKENS: SwapToken[] = [
  {
    symbol: 'BNB',
    name: 'BNB (Native)',
    address: WBNB_ADDRESS,
    decimals: 18,
    isNative: true,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
  },
  {
    symbol: 'TAMIYANOIA',
    name: 'TAMIYANOIA',
    address: TAMIYANOIA_ADDRESS,
    decimals: 18,
    logoURI: '/assets/aistudio/tamiswap_00325eac.png',
  },
  {
    symbol: 'GTAN',
    name: 'GIANT',
    address: '0xbD7909318b9Ca4ff140B840F69bB310a785d1095',
    decimals: 9,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/68338/small/Giant_GTAN_200_logo.png?1755409446',
  },
  {
    symbol: 'Ocicat',
    name: 'Ocicat',
    address: '0xE53D384Cf33294C1882227ae4f90D64cF2a5dB70',
    decimals: 6,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/36556/small/OCICAT.jpg?1711899902',
  },
  {
    symbol: 'TART',
    name: 'TartSwap',
    address: '0x7AB8d02CBb51Ff7223fDe700eAaa2a91Bf750314',
    decimals: 9,
    logoURI:
      'https://cdn.dexscreener.com/cms/images/kDVz5vcKSnLS1iEe?width=800&height=800&quality=95&format=auto',
  },
  {
    symbol: 'WKC',
    name: 'WIKI CAT',
    address: '0x6Ec90334d89dBdc89E08A133271be3d104128Edb',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x6Ec90334d89dBdc89E08A133271be3d104128Edb/logo.png',
  },
  {
    symbol: 'THE',
    name: 'THENA',
    address: '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11',
    decimals: 18,
    logoURI:
      'https://coin-images.coingecko.com/coins/images/28864/small/Symbol-Color200x200.png?1706810126',
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: USDT_ADDRESS,
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d/logo.png',
  },
  {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    address: WBNB_ADDRESS,
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c/logo.png',
  },
  {
    symbol: 'BTCB',
    name: 'Bitcoin BEP20',
    address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c/logo.png',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum Token',
    address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x2170Ed0880ac9A755fd29B2688956BD959F933F8/logo.png',
  },
  {
    symbol: 'CAKE',
    name: 'PancakeSwap Token',
    address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    decimals: 18,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png',
  },
];
