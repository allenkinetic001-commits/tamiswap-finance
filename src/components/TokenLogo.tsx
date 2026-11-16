import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { SwapToken } from '../data/swapTokens';

interface TokenLogoProps {
  token: Pick<SwapToken, 'symbol' | 'address' | 'isNative' | 'logoURI'>;
  size?: number;
}

const SYMBOL_LOGO_FALLBACKS: Record<string, string[]> = {
  BNB: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
    'https://coin-images.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  ],
  WBNB: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c/logo.png',
    'https://coin-images.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  ],
  TAMIYANOIA: ['/assets/aistudio/tamiswap_00325eac.png'],
  THE: [
    'https://coin-images.coingecko.com/coins/images/28864/small/Symbol-Color200x200.png?1706810126',
    'https://icons.llamao.fi/icons/protocols/thena?w=128&h=128',
  ],
  USDT: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png',
    'https://coin-images.coingecko.com/coins/images/325/small/Tether.png',
  ],
  USDC: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d/logo.png',
    'https://coin-images.coingecko.com/coins/images/6319/small/usdc.png',
  ],
  BTCB: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c/logo.png',
    'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
  ],
  ETH: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x2170Ed0880ac9A755fd29B2688956BD959F933F8/logo.png',
    'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
  ],
  CAKE: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png',
    'https://coin-images.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo_%281%29.png',
  ],
  GTAN: [
    'https://coin-images.coingecko.com/coins/images/68338/small/Giant_GTAN_200_logo.png?1755409446',
    'https://cdn.dexscreener.com/cms/images/50123949bedca2c0a1a6d6ce595d8c5edb2c6f36e8c3ac0988fc4275ebee0581?width=800&height=800&quality=95&format=auto',
  ],
  OCICAT: [
    'https://coin-images.coingecko.com/coins/images/36556/small/OCICAT.jpg?1711899902',
    'https://cdn.dexscreener.com/cms/images/78e8f2c404d8d98757193a6292d1e5018f79f23bd22f7d721db76fb3ccb0b335?width=800&height=800&quality=95&format=auto',
  ],
  TART: [
    'https://cdn.dexscreener.com/cms/images/kDVz5vcKSnLS1iEe?width=800&height=800&quality=95&format=auto',
    'https://coin-images.coingecko.com/coins/images/102178785/large/tart.jpg',
  ],
  WKC: [
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x6Ec90334d89dBdc89E08A133271be3d104128Edb/logo.png',
    'https://coin-images.coingecko.com/coins/images/26037/large/Wiki-Logo.png',
    'https://cdn.dexscreener.com/cms/images/6012b7aeac14fd99318f10747e4deb40c0de61588e12e873621e354f4033a513?width=800&height=800&quality=95&format=auto',
  ],
};

function BuiltInVectorFallback({ symbol, size }: { symbol: string; size: number }) {
  const s = size;

  switch (symbol.toUpperCase()) {
    case 'BNB':
    case 'WBNB': {
      const isWrapped = symbol.toUpperCase() === 'WBNB';
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle
            cx="16"
            cy="16"
            r="15.5"
            fill={isWrapped ? '#181A20' : '#F3BA2F'}
            stroke={isWrapped ? '#F3BA2F' : 'none'}
            strokeWidth={isWrapped ? '1.5' : '0'}
          />
          <path
            d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.26L16 26l-6.144-6.144 2.26-2.26zm9.364-1.596l2.26-2.26L26 16l-2.26 2.26L21.48 16zm-3.188 0L16 13.708 13.708 16 16 18.292 18.292 16z"
            fill={isWrapped ? '#F3BA2F' : '#FFFFFF'}
          />
        </svg>
      );
    }

    default: {
      const label = symbol.toUpperCase().slice(0, 3);
      return (
        <span
          style={{ width: s, height: s, fontSize: Math.max(8, Math.floor(s * 0.36)) }}
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan-400/45 bg-gradient-to-br from-slate-700 via-slate-900 to-cyan-950 font-mono font-bold text-cyan-200 shadow-[0_0_8px_rgba(0,229,255,0.2)]"
          aria-hidden="true"
        >
          {label}
        </span>
      );
    }
  }
}

function getChecksumAddress(address?: string): string | null {
  if (!address) return null;
  try {
    return ethers.getAddress(address);
  } catch {
    return address;
  }
}

export function TokenLogo({ token, size = 22 }: TokenLogoProps) {
  const sym = token.symbol.toUpperCase();

  const candidateUrls = useMemo(() => {
    const urls: string[] = [];
    if (token.logoURI) {
      urls.push(token.logoURI);
    }
    const symbolUrls = SYMBOL_LOGO_FALLBACKS[sym];
    if (symbolUrls) {
      urls.push(...symbolUrls);
    }
    if (!token.isNative && token.address) {
      const checksum = getChecksumAddress(token.address);
      if (checksum) {
        urls.push(
          `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${checksum}/logo.png`,
          `https://tokens.pancakeswap.finance/images/${checksum}.png`
        );
      }
    }
    return Array.from(new Set(urls));
  }, [token.logoURI, token.address, token.isNative, sym]);

  const [srcIndex, setSrcIndex] = useState(0);

  useEffect(() => {
    setSrcIndex(0);
  }, [token.symbol, token.address, token.isNative, token.logoURI]);

  const currentUrl = candidateUrls[srcIndex];

  if (currentUrl) {
    return (
      <img
        src={currentUrl}
        alt={`${token.symbol} logo`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setSrcIndex((prev) => prev + 1)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full bg-[#0B1222] object-cover ring-1 ring-white/15"
      />
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center justify-center">
      <BuiltInVectorFallback symbol={sym} size={size} />
    </span>
  );
}
