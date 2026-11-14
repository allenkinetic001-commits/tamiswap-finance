export interface SwapToken {
  symbol: string;
  name: string;
  address: string; // ERC-20 address (WBNB address used for native BNB routing)
  decimals: number;
  isNative?: boolean;
}

export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = '0x38';

// Verified THENA BNB Smart Chain (56) Contract Addresses
export const THENA_ROUTER_V2_ADDRESS = '0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109';
export const THENA_PAIR_FACTORY_ADDRESS = '0xAFD89d21BdB66d00817d4153E055830B1c2B3970';
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

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
  },
  {
    symbol: 'THE',
    name: 'THENA',
    address: '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11',
    decimals: 18,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: USDT_ADDRESS,
    decimals: 18,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
  },
  {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    address: WBNB_ADDRESS,
    decimals: 18,
  },
  {
    symbol: 'BTCB',
    name: 'Bitcoin BEP20',
    address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    decimals: 18,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum Token',
    address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    decimals: 18,
  },
  {
    symbol: 'CAKE',
    name: 'PancakeSwap Token',
    address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    decimals: 18,
  },
];
