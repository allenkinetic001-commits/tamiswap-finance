import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, BarChart3, Check, Coins, Copy, ExternalLink, Wallet, X } from 'lucide-react';
import { ExternalTokenSelection, SwapWidget } from './components/SwapWidget';
import { BSC_CHAIN_ID } from './data/swapTokens';
import { ensureBscNetwork, formatWalletError, parseChainId } from './utils/bscWeb3';
import { TAMIYANOIA_TOKEN } from './utils/staking';
import type { TopTokenEntry } from './utils/topTokens';

const StakingView = lazy(() =>
  import('./components/StakingView').then((m) => ({ default: m.StakingView }))
);
const TopTokensView = lazy(() =>
  import('./components/TopTokensView').then((m) => ({ default: m.TopTokensView }))
);

const PUBLIC_DAPP_URL = 'https://tamiswap-finance.vercel.app';

function resolveDappUrl(): string {
  if (typeof window === 'undefined') return PUBLIC_DAPP_URL;
  const host = window.location.hostname.toLowerCase();
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
    return PUBLIC_DAPP_URL;
  }
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function isTrustUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Trust/i.test(navigator.userAgent || '');
}

function isSafePalUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /SafePal/i.test(navigator.userAgent || '');
}

function getMobileEnvironment(): {
  isAndroid: boolean;
  isIOS: boolean;
  isEmbeddedWebView: boolean;
} {
  if (typeof navigator === 'undefined') {
    return { isAndroid: false, isIOS: false, isEmbeddedWebView: false };
  }
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isEmbeddedWebView =
    /; wv\)/i.test(ua) ||
    /\b(FBAN|FBAV|Instagram|Line|MicroMessenger|Telegram|Twitter|GSA\/)\b/i.test(ua) ||
    (isIOS && !/Safari/i.test(ua));
  return { isAndroid, isIOS, isEmbeddedWebView };
}

interface InjectedProvider extends ethers.Eip1193Provider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  enable?: () => Promise<string[]>;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isSafePal?: boolean;
  isBitKeep?: boolean;
  isBitgetWallet?: boolean;
  isBinance?: boolean;
  isBinanceWeb3Wallet?: boolean;
  isPhantom?: boolean;
  providers?: InjectedProvider[];
}

interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: InjectedProvider;
}

interface Eip6963AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; rdns: string; icon?: string };
    provider: InjectedProvider;
  };
}

function inferProviderName(p: InjectedProvider): string {
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isRabby) return 'Rabby Wallet';
  if (p.isOkxWallet) return 'OKX Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isSafePal || isSafePalUserAgent()) return 'SafePal Wallet';
  if (p.isBitKeep || p.isBitgetWallet) return 'Bitget Wallet';
  if (p.isBinance || p.isBinanceWeb3Wallet) return 'Binance Web3 Wallet';
  if (p.isPhantom) return 'Phantom';
  if (p.isMetaMask) return 'MetaMask';
  if (isTrustUserAgent()) return 'Trust Wallet';
  return 'Browser Web3 Wallet';
}

function normalizeWalletKey(name: string, rdns?: string): string {
  const combined = `${rdns || ''} ${name}`.toLowerCase();
  if (combined.includes('trust')) return 'trust-wallet';
  if (combined.includes('binance')) return 'binance-wallet';
  if (combined.includes('metamask')) return 'metamask';
  if (combined.includes('rabby')) return 'rabby-wallet';
  if (combined.includes('okx') || combined.includes('okex')) return 'okx-wallet';
  if (combined.includes('coinbase')) return 'coinbase-wallet';
  if (combined.includes('safepal')) return 'safepal-wallet';
  if (combined.includes('bitget') || combined.includes('bitkeep')) return 'bitget-wallet';
  if (combined.includes('phantom')) return 'phantom';
  return rdns?.toLowerCase() || name.trim().toLowerCase();
}

function getWalletIconMeta(name: string): { src: string; bgClass: string } | null {
  const n = name.toLowerCase();
  if (n.includes('metamask')) return { src: '/assets/wallets/metamask.png', bgClass: 'bg-white' };
  if (n.includes('trust')) return { src: '/assets/wallets/trustwallet.png', bgClass: 'bg-white' };
  if (n.includes('okx')) return { src: '/assets/wallets/okx.png', bgClass: 'bg-black' };
  if (n.includes('coinbase')) return { src: '/assets/wallets/coinbase.png', bgClass: 'bg-white' };
  if (n.includes('safepal')) return { src: '/assets/wallets/safepal.png', bgClass: 'bg-white' };
  if (n.includes('bitget') || n.includes('bitkeep'))
    return { src: '/assets/wallets/bitget.png', bgClass: 'bg-[#0B1222]' };
  if (n.includes('rabby')) return { src: '/assets/wallets/rabby.png', bgClass: 'bg-[#7084FF]' };
  if (n.includes('binance')) return { src: '/assets/wallets/binance.png', bgClass: 'bg-[#0B1222]' };
  if (n.includes('phantom')) return { src: '/assets/wallets/phantom.png', bgClass: 'bg-[#534BB1]' };
  return null;
}

export default function App() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [activeProvider, setActiveProvider] = useState<InjectedProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isGreenMode, setIsGreenMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'swap' | 'stake' | 'top-tokens'>('swap');
  const [selectedTokenRequest, setSelectedTokenRequest] =
    useState<ExternalTokenSelection | null>(null);

  const discoveredMapRef = useRef<Map<string, DiscoveredWallet>>(new Map());
  const restoredAttemptedRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem('tamiswap_red_mode');
      window.localStorage.removeItem('tamiswap_green_mode');
    } catch {
      // ignore storage errors
    }
  }, []);

  const scanInjectedWallets = useCallback((): DiscoveredWallet[] => {
    const map = discoveredMapRef.current;

    function addCandidate(
      id: string,
      name: string,
      provider: InjectedProvider,
      icon?: string,
      preferOverwrite = false
    ) {
      if (!provider || typeof provider.request !== 'function') return;
      const canonicalKey = normalizeWalletKey(name, id);
      const displayName = canonicalKey === 'trust-wallet' ? 'Trust Wallet' : name;
      const existing = map.get(canonicalKey);
      if (existing) {
        if (preferOverwrite) {
          map.set(canonicalKey, {
            id: canonicalKey,
            name: displayName,
            icon: icon || existing.icon,
            provider,
          });
        }
        return;
      }
      const sameProvider = Array.from(map.values()).some(
        (entry) => entry.provider === provider
      );
      if (sameProvider) return;
      map.set(canonicalKey, { id: canonicalKey, name: displayName, icon, provider });
    }

    const win = window as unknown as {
      ethereum?: InjectedProvider;
      trustwallet?: InjectedProvider & { ethereum?: InjectedProvider };
      okxwallet?: InjectedProvider;
      safepalProvider?: InjectedProvider;
      safepal?: InjectedProvider & { ethereum?: InjectedProvider };
      binancew3w?: { ethereum?: InjectedProvider };
      bitkeep?: { ethereum?: InjectedProvider };
      phantom?: { ethereum?: InjectedProvider };
    };

    if (win.binancew3w?.ethereum) {
      addCandidate('com.binance.wallet', 'Binance Web3 Wallet', win.binancew3w.ethereum);
    }
    if (win.trustwallet?.ethereum) {
      addCandidate('com.trustwallet.app', 'Trust Wallet', win.trustwallet.ethereum);
    } else if (win.trustwallet) {
      addCandidate('com.trustwallet.app', 'Trust Wallet', win.trustwallet);
    }
    if (win.okxwallet) {
      addCandidate('com.okex.wallet', 'OKX Wallet', win.okxwallet);
    }
    if (win.safepalProvider) {
      addCandidate('io.safepal', 'SafePal Wallet', win.safepalProvider);
    }
    if (win.safepal?.ethereum) {
      addCandidate('io.safepal', 'SafePal Wallet', win.safepal.ethereum);
    } else if (win.safepal && typeof win.safepal.request === 'function') {
      addCandidate('io.safepal', 'SafePal Wallet', win.safepal);
    }
    if (win.bitkeep?.ethereum) {
      addCandidate('com.bitget.web3', 'Bitget Wallet', win.bitkeep.ethereum);
    }
    if (win.phantom?.ethereum) {
      addCandidate('app.phantom', 'Phantom', win.phantom.ethereum);
    }
    if (win.ethereum) {
      if (Array.isArray(win.ethereum.providers) && win.ethereum.providers.length > 0) {
        win.ethereum.providers.forEach((p, idx) => {
          const name = inferProviderName(p);
          addCandidate(`injected-${name.toLowerCase()}-${idx}`, name, p);
        });
      } else {
        const name = inferProviderName(win.ethereum);
        addCandidate(`injected-${name.toLowerCase()}`, name, win.ethereum);
      }
    }

    const list = Array.from(map.values());
    setWallets(list);
    return list;
  }, []);

  const trySilentRestore = useCallback(async (candidates: DiscoveredWallet[]) => {
    if (restoredAttemptedRef.current || candidates.length === 0) return;
    restoredAttemptedRef.current = true;
    for (const candidate of candidates) {
      try {
        const accs = (await withTimeout(
          candidate.provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
          2500
        )) as string[];
        if (accs && accs[0] && ethers.isAddress(accs[0])) {
          setActiveProvider(candidate.provider);
          setWalletAddress(ethers.getAddress(accs[0]));
          try {
            const hex = await withTimeout(
              candidate.provider.request({ method: 'eth_chainId' }),
              2000
            );
            setChainId(parseChainId(hex));
          } catch {
            // ignore chain read timeout during startup restore
          }
          break;
        }
      } catch {
        // ignore silent restore errors
      }
    }
  }, []);

  // Discover EIP-6963 wallets asynchronously + injected browser/mobile wallet globals
  useEffect(() => {
    const map = discoveredMapRef.current;

    function onAnnounce(event: Event) {
      const e = event as Eip6963AnnounceEvent;
      if (e.detail?.provider && e.detail?.info) {
        const canonicalKey = normalizeWalletKey(
          e.detail.info.name,
          e.detail.info.rdns || e.detail.info.uuid
        );
        const displayName = canonicalKey === 'trust-wallet' ? 'Trust Wallet' : e.detail.info.name;
        map.set(canonicalKey, {
          id: canonicalKey,
          name: displayName,
          icon: e.detail.info.icon,
          provider: e.detail.provider,
        });
        const nextList = Array.from(map.values());
        setWallets(nextList);
        void trySilentRestore(nextList);
      }
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const initial = scanInjectedWallets();
    void trySilentRestore(initial);

    // Some mobile wallet WebViews (Trust Wallet, SafePal) inject providers shortly after load
    const t1 = window.setTimeout(() => {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const rescan1 = scanInjectedWallets();
      void trySilentRestore(rescan1);
    }, 300);
    const t2 = window.setTimeout(() => {
      const rescan2 = scanInjectedWallets();
      void trySilentRestore(rescan2);
    }, 1000);

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [scanInjectedWallets, trySilentRestore]);

  // Subscribe to account & chain updates from the connected wallet
  useEffect(() => {
    if (!activeProvider?.on) return;

    function handleAccountsChanged(accs: unknown) {
      const list = accs as string[];
      setWalletAddress(
        list && list[0] && ethers.isAddress(list[0]) ? ethers.getAddress(list[0]) : null
      );
    }

    function handleChainChanged(hex: unknown) {
      const parsed = parseChainId(hex);
      if (parsed !== null) {
        setChainId(parsed);
      }
    }

    activeProvider.on('accountsChanged', handleAccountsChanged);
    activeProvider.on('chainChanged', handleChainChanged);
    return () => {
      activeProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      activeProvider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [activeProvider]);

  async function requestAccountsSafe(provider: InjectedProvider): Promise<string[]> {
    let raw: unknown;
    try {
      raw = await provider.request({ method: 'eth_requestAccounts' });
    } catch (err: unknown) {
      if (typeof provider.enable === 'function') {
        try {
          raw = await provider.enable();
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }
    if (Array.isArray(raw)) {
      const valid = raw.filter((a): a is string => typeof a === 'string' && ethers.isAddress(a));
      if (valid.length > 0) return valid;
    }
    if (
      raw &&
      typeof raw === 'object' &&
      'result' in raw &&
      Array.isArray((raw as { result?: unknown }).result)
    ) {
      const valid = (raw as { result: unknown[] }).result.filter(
        (a): a is string => typeof a === 'string' && ethers.isAddress(a)
      );
      if (valid.length > 0) return valid;
    }
    if (typeof provider.enable === 'function') {
      const enabled = await provider.enable();
      if (Array.isArray(enabled)) {
        const valid = enabled.filter(
          (a): a is string => typeof a === 'string' && ethers.isAddress(a)
        );
        if (valid.length > 0) return valid;
      }
    }
    const existing = await provider.request({ method: 'eth_accounts' });
    if (Array.isArray(existing)) {
      const valid = existing.filter(
        (a): a is string => typeof a === 'string' && ethers.isAddress(a)
      );
      if (valid.length > 0) return valid;
    }
    return [];
  }

  async function connectWithProvider(chosen: InjectedProvider) {
    setWalletNotice(null);
    setShowWalletModal(false);
    let activeChosen = chosen;
    try {
      const win = window as unknown as {
        ethereum?: InjectedProvider;
        trustwallet?: InjectedProvider & { ethereum?: InjectedProvider };
        safepalProvider?: InjectedProvider;
        safepal?: InjectedProvider;
      };
      const isTrustChoice =
        chosen === win.trustwallet ||
        chosen === win.trustwallet?.ethereum ||
        Boolean(chosen.isTrust || chosen.isTrustWallet) ||
        isTrustUserAgent();
      const isSafePalChoice =
        chosen === win.safepalProvider ||
        chosen === win.safepal ||
        Boolean(chosen.isSafePal) ||
        isSafePalUserAgent();

      let accounts: string[] = [];
      try {
        accounts = await requestAccountsSafe(activeChosen);
      } catch (primaryErr: unknown) {
        const errCode =
          primaryErr && typeof primaryErr === 'object' && 'code' in primaryErr
            ? (primaryErr as { code?: unknown }).code
            : undefined;
        if (
          errCode !== 4001 &&
          (isTrustChoice || isSafePalChoice) &&
          win.ethereum &&
          win.ethereum !== chosen &&
          typeof win.ethereum.request === 'function'
        ) {
          accounts = await requestAccountsSafe(win.ethereum);
          if (accounts.length > 0) activeChosen = win.ethereum;
        } else {
          throw primaryErr;
        }
      }

      if (
        accounts.length === 0 &&
        (isTrustChoice || isSafePalChoice) &&
        win.ethereum &&
        win.ethereum !== activeChosen &&
        typeof win.ethereum.request === 'function'
      ) {
        accounts = await requestAccountsSafe(win.ethereum);
        if (accounts.length > 0) activeChosen = win.ethereum;
      }

      if (accounts.length === 0 || !ethers.isAddress(accounts[0])) {
        throw new Error(
          'Wallet did not return an address. Make sure your wallet is unlocked and try again.'
        );
      }

      setActiveProvider(activeChosen);
      setWalletAddress(ethers.getAddress(accounts[0]));

      // Record initial chainId immediately so it is never stuck null if BSC switch is cancelled
      try {
        const initialHex = await activeChosen.request({ method: 'eth_chainId' });
        setChainId(parseChainId(initialHex));
      } catch {
        // ignore pre-read failure
      }

      await ensureBscNetwork(activeChosen);

      const finalHex = await activeChosen.request({ method: 'eth_chainId' });
      const finalChain = parseChainId(finalHex);
      setChainId(finalChain);
    } catch (err: unknown) {
      try {
        const currentHex = await activeChosen.request({ method: 'eth_chainId' });
        const currentChain = parseChainId(currentHex);
        if (currentChain !== null) setChainId(currentChain);
      } catch {
        // ignore read failure
      }
      setWalletNotice(formatWalletError(err));
    }
  }

  function handleConnectButton() {
    setWalletNotice(null);
    setModalNotice(null);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const latest = scanInjectedWallets();
    if (!walletAddress && (isTrustUserAgent() || (latest.length === 1 && latest[0].id === 'trust-wallet'))) {
      const trustEntry = latest.find(
        (w) => w.id === 'trust-wallet' || w.name.toLowerCase().includes('trust')
      );
      if (trustEntry) {
        void connectWithProvider(trustEntry.provider);
        return;
      }
    }
    if (!walletAddress && (isSafePalUserAgent() || (latest.length === 1 && latest[0].id === 'safepal-wallet'))) {
      const safePalEntry = latest.find(
        (w) => w.id === 'safepal-wallet' || w.name.toLowerCase().includes('safepal')
      );
      if (safePalEntry) {
        void connectWithProvider(safePalEntry.provider);
        return;
      }
    }
    setShowWalletModal(true);
  }

  async function handleSwitchToBsc() {
    if (!activeProvider) return;
    setWalletNotice(null);
    try {
      await ensureBscNetwork(activeProvider);
      const hex = await activeProvider.request({ method: 'eth_chainId' });
      setChainId(parseChainId(hex));
    } catch (err: unknown) {
      setWalletNotice(
        err instanceof Error ? err.message : 'Could not switch network to BNB Smart Chain.'
      );
    }
  }

  function handleDisconnect() {
    setWalletAddress(null);
    setActiveProvider(null);
    setChainId(null);
    setShowWalletModal(false);
  }

  async function handleCopySiteUrl() {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(resolveDappUrl());
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  }

  function handleMobileWalletClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    wallet: { id: string; name: string; href: string; isCustomScheme?: boolean }
  ) {
    const matchedInjected = wallets.find((w) => {
      const n = w.name.toLowerCase();
      if (wallet.id === 'trust') return n.includes('trust');
      if (wallet.id === 'metamask') return n.includes('metamask');
      if (wallet.id === 'binance') return n.includes('binance');
      if (wallet.id === 'okx') return n.includes('okx');
      if (wallet.id === 'coinbase') return n.includes('coinbase');
      if (wallet.id === 'safepal') return n.includes('safepal');
      if (wallet.id === 'bitget') return n.includes('bitget');
      return false;
    });
    if (matchedInjected) {
      e.preventDefault();
      void connectWithProvider(matchedInjected.provider);
      return;
    }

    void handleCopySiteUrl();

    const { isAndroid, isIOS, isEmbeddedWebView } = getMobileEnvironment();
    const isDesktop = !isAndroid && !isIOS;
    // Never navigate to trust:// or bnc:// directly from Desktop or an embedded WebView
    // where Chromium/WebView replaces the page with "Webpage not available (ERR_UNKNOWN_URL_SCHEME)".
    if (wallet.isCustomScheme && (isDesktop || isEmbeddedWebView)) {
      e.preventDefault();
      setModalNotice(
        `DApp link copied! Open ${wallet.name} → Browser and paste this link to trade: ${launchUrl}`
      );
      return;
    }

    if (wallet.id === 'binance') {
      setModalNotice(
        'DApp URL copied! Opening Binance App — go to Wallets → Web3 → Discover and paste the URL.'
      );
      return;
    }
    if (wallet.id === 'trust') {
      setModalNotice(
        'Opening Trust Wallet... Link copied as backup — if your browser does not switch automatically, open Trust Wallet → Browser and paste the link.'
      );
      return;
    }
    setModalNotice(
      `Opening ${wallet.name}... Backup link copied in case your browser asks you to paste it in the wallet Browser.`
    );
  }

  function handleSelectTokenForSwap(entry: TopTokenEntry) {
    setSelectedTokenRequest({
      token: {
        symbol: entry.symbol,
        name: entry.name,
        address: entry.address,
        decimals: entry.decimals,
        isNative: entry.isNative,
        logoURI: entry.logoURI,
      },
      nonce: Date.now(),
    });
    setActiveTab('swap');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleBuyTamiyanoia() {
    setSelectedTokenRequest({
      token: TAMIYANOIA_TOKEN,
      nonce: Date.now(),
    });
    setActiveTab('swap');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const wrongNetwork = Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;
  const launchUrl = resolveDappUrl();
  const launchHostPath = launchUrl.replace(/^https?:\/\//i, '');
  const { isAndroid } = getMobileEnvironment();
  const trustDeepLink = isAndroid
    ? `intent://open_url?coin_id=20000714&url=${encodeURIComponent(
        launchUrl
      )}#Intent;scheme=trust;package=com.wallet.crypto.trustapp;S.browser_fallback_url=${encodeURIComponent(
        launchUrl
      )};end`
    : `trust://open_url?coin_id=20000714&url=${encodeURIComponent(launchUrl)}`;
  const binanceDeepLink = isAndroid
    ? `intent://app.binance.com/web3#Intent;scheme=bnc;package=com.binance.dev;S.browser_fallback_url=${encodeURIComponent(
        launchUrl
      )};end`
    : 'bnc://app.binance.com/web3';
  const mobileWalletLinks = launchUrl
    ? [
        {
          id: 'trust',
          name: 'Trust Wallet',
          icon: '/assets/wallets/trustwallet.png',
          iconBg: 'bg-white',
          isCustomScheme: true,
          href: trustDeepLink,
        },
        {
          id: 'metamask',
          name: 'MetaMask',
          icon: '/assets/wallets/metamask.png',
          iconBg: 'bg-white',
          isCustomScheme: false,
          href: `https://metamask.app.link/dapp/${launchHostPath}`,
        },
        {
          id: 'binance',
          name: 'Binance Wallet',
          icon: '/assets/wallets/binance.png',
          iconBg: 'bg-[#0B1222]',
          isCustomScheme: true,
          href: binanceDeepLink,
        },
        {
          id: 'okx',
          name: 'OKX Wallet',
          icon: '/assets/wallets/okx.png',
          iconBg: 'bg-black',
          isCustomScheme: false,
          href: `https://www.okx.com/download?deeplink=${encodeURIComponent(
            `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(launchUrl)}`
          )}`,
        },
        {
          id: 'coinbase',
          name: 'Coinbase Wallet',
          icon: '/assets/wallets/coinbase.png',
          iconBg: 'bg-white',
          isCustomScheme: false,
          href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(launchUrl)}`,
        },
        {
          id: 'safepal',
          name: 'SafePal Wallet',
          icon: '/assets/wallets/safepal.png',
          iconBg: 'bg-white',
          isCustomScheme: false,
          href: `https://link.safepal.io/open_url?url=${encodeURIComponent(launchUrl)}`,
        },
        {
          id: 'bitget',
          name: 'Bitget Wallet',
          icon: '/assets/wallets/bitget.png',
          iconBg: 'bg-[#0B1222]',
          isCustomScheme: false,
          href: `https://bkcode.vip?action=dapp&url=${encodeURIComponent(launchUrl)}`,
        },
      ]
    : [];

  const svgColors = isGreenMode
    ? {
        wingTop: '#0f3821',
        wingMid: '#092415',
        wingBot: '#1e5f3a',
        plasma0: '#059669',
        plasma1: '#10b981',
        plasma2: '#d1fae5',
        cornerFill: '#072c18',
        border: '#10b981',
        veinMain: '#00e676',
        veinCore: '#a7f3d0',
        veinBranch: '#34d399',
        veinMid: '#10b981',
        veinBright: '#38ff9c',
        nodeLight: '#6ee7b7',
        nodeBright: '#34d399',
      }
    : {
        wingTop: '#0f1e38',
        wingMid: '#091224',
        wingBot: '#1e3a5f',
        plasma0: '#0055ff',
        plasma1: '#00b8ff',
        plasma2: '#cff4ff',
        cornerFill: '#07132c',
        border: '#00c8ff',
        veinMain: '#009dff',
        veinCore: '#aef0ff',
        veinBranch: '#00d4ff',
        veinMid: '#00b4ff',
        veinBright: '#00e5ff',
        nodeLight: '#7ce7ff',
        nodeBright: '#00d4ff',
      };

  return (
    <div
      className={`combat-tech-backdrop relative flex min-h-screen flex-col overflow-x-hidden text-slate-100 ${
        isGreenMode ? 'theme-green' : ''
      }`}
    >
      {/* Symmetrical Cybernetic Armor Cockpit & Glowing Neon Vein Network */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <svg
          className="absolute inset-0 h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 1440 900"
          fill="none"
        >
          <defs>
            <filter id="neon-blue-vein" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="steel-wing-l" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={svgColors.wingTop} stopOpacity="0.96" />
              <stop offset="55%" stopColor={svgColors.wingMid} stopOpacity="0.94" />
              <stop offset="100%" stopColor={svgColors.wingBot} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="steel-wing-r" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={svgColors.wingTop} stopOpacity="0.96" />
              <stop offset="55%" stopColor={svgColors.wingMid} stopOpacity="0.94" />
              <stop offset="100%" stopColor={svgColors.wingBot} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="plasma-beam" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={svgColors.plasma0} stopOpacity="0.35" />
              <stop offset="50%" stopColor={svgColors.plasma1} stopOpacity="1" />
              <stop offset="100%" stopColor={svgColors.plasma2} stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* Left side 3D armored wing plate & bottom corner armor */}
          <path
            d="M0 160 L82 230 L82 540 L150 640 L150 900 L0 900 Z"
            fill="url(#steel-wing-l)"
            opacity="0.86"
          />
          <path
            d="M0 160 L82 230 L82 540 L150 640 L150 900"
            stroke={svgColors.border}
            strokeWidth="2.4"
            filter="url(#neon-blue-vein)"
          />
          <path
            d="M0 430 L178 605 L295 815 L370 900"
            stroke="url(#plasma-beam)"
            strokeWidth="2.8"
            filter="url(#neon-blue-vein)"
          />
          <path
            d="M0 805 L210 805 L295 865 L340 900 L0 900 Z"
            fill={svgColors.cornerFill}
            fillOpacity="0.94"
            stroke={svgColors.plasma1}
            strokeWidth="2"
            filter="url(#neon-blue-vein)"
          />

          {/* Left Cybernetic Veins (branching energy arteries & capillary conduits) */}
          <g filter="url(#neon-blue-vein)">
            <path
              d="M0 245 L110 245 L165 298 L290 298 L345 345 L465 345"
              stroke={svgColors.veinMain}
              strokeWidth="2.2"
            />
            <path
              d="M0 245 L110 245 L165 298 L290 298 L345 345 L465 345"
              stroke={svgColors.veinCore}
              strokeWidth="1.2"
              className="cyber-vein-stream"
            />
            <path
              d="M165 298 L215 245 L330 245 L385 205 L485 205"
              stroke={svgColors.veinBranch}
              strokeWidth="1.3"
              strokeOpacity="0.82"
            />
            <path
              d="M82 375 L195 375 L255 430 L455 430"
              stroke={svgColors.veinMid}
              strokeWidth="1.8"
            />
            <path
              d="M255 430 L300 478 L420 478 L468 518"
              stroke={svgColors.veinBright}
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M115 585 L235 585 L295 535 L462 535"
              stroke={svgColors.veinMain}
              strokeWidth="2"
            />
            <path
              d="M115 585 L235 585 L295 535 L462 535"
              stroke={svgColors.veinCore}
              strokeWidth="1.1"
              className="cyber-vein-stream"
            />
            <path
              d="M235 585 L285 645 L395 645 L455 685"
              stroke={svgColors.border}
              strokeWidth="1.2"
              strokeOpacity="0.75"
            />
            <circle cx="465" cy="345" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="485" cy="205" r="2.8" fill={svgColors.nodeBright} />
            <circle cx="455" cy="430" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="462" cy="535" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="455" cy="685" r="2.8" fill={svgColors.nodeBright} />
          </g>

          {/* Right side 3D armored wing plate & bottom corner armor */}
          <path
            d="M1440 160 L1358 230 L1358 540 L1290 640 L1290 900 L1440 900 Z"
            fill="url(#steel-wing-r)"
            opacity="0.86"
          />
          <path
            d="M1440 160 L1358 230 L1358 540 L1290 640 L1290 900"
            stroke={svgColors.border}
            strokeWidth="2.4"
            filter="url(#neon-blue-vein)"
          />
          <path
            d="M1440 430 L1262 605 L1145 815 L1070 900"
            stroke="url(#plasma-beam)"
            strokeWidth="2.8"
            filter="url(#neon-blue-vein)"
          />
          <path
            d="M1440 805 L1230 805 L1145 865 L1100 900 L1440 900 Z"
            fill={svgColors.cornerFill}
            fillOpacity="0.94"
            stroke={svgColors.plasma1}
            strokeWidth="2"
            filter="url(#neon-blue-vein)"
          />

          {/* Right Cybernetic Veins (symmetrical energy arteries & capillary conduits) */}
          <g filter="url(#neon-blue-vein)">
            <path
              d="M1440 245 L1330 245 L1275 298 L1150 298 L1095 345 L975 345"
              stroke={svgColors.veinMain}
              strokeWidth="2.2"
            />
            <path
              d="M1440 245 L1330 245 L1275 298 L1150 298 L1095 345 L975 345"
              stroke={svgColors.veinCore}
              strokeWidth="1.2"
              className="cyber-vein-stream"
            />
            <path
              d="M1275 298 L1225 245 L1110 245 L1055 205 L955 205"
              stroke={svgColors.veinBranch}
              strokeWidth="1.3"
              strokeOpacity="0.82"
            />
            <path
              d="M1358 375 L1245 375 L1185 430 L985 430"
              stroke={svgColors.veinMid}
              strokeWidth="1.8"
            />
            <path
              d="M1185 430 L1140 478 L1020 478 L972 518"
              stroke={svgColors.veinBright}
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M1325 585 L1205 585 L1145 535 L978 535"
              stroke={svgColors.veinMain}
              strokeWidth="2"
            />
            <path
              d="M1325 585 L1205 585 L1145 535 L978 535"
              stroke={svgColors.veinCore}
              strokeWidth="1.1"
              className="cyber-vein-stream"
            />
            <path
              d="M1205 585 L1155 645 L1045 645 L985 685"
              stroke={svgColors.border}
              strokeWidth="1.2"
              strokeOpacity="0.75"
            />
            <circle cx="975" cy="345" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="955" cy="205" r="2.8" fill={svgColors.nodeBright} />
            <circle cx="985" cy="430" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="978" cy="535" r="3.5" fill={svgColors.nodeLight} />
            <circle cx="985" cy="685" r="2.8" fill={svgColors.nodeBright} />
          </g>
        </svg>

        <div
          className={`energy-vein-glow absolute top-1/4 left-1/2 h-[500px] w-[720px] -translate-x-1/2 rounded-full blur-[140px] ${
            isGreenMode ? 'bg-emerald-500/24' : 'bg-sky-500/24'
          }`}
        />
        <div
          className={`absolute bottom-0 left-1/2 h-[340px] w-[580px] -translate-x-1/2 rounded-full blur-[130px] ${
            isGreenMode ? 'bg-green-600/24' : 'bg-blue-600/24'
          }`}
        />
      </div>

      {/* Stepped Armored Top Navigation Bar */}
      <header className="combat-topbar relative z-20 flex h-16 sm:h-20 w-full items-center justify-between gap-1.5 sm:gap-4 px-2 sm:px-6">
        <div
          aria-hidden="true"
          className={`energy-vein-beam pointer-events-none absolute right-0 bottom-0 left-0 h-[2px] bg-gradient-to-r ${
            isGreenMode
              ? 'from-emerald-500/40 via-emerald-300 to-emerald-500/40'
              : 'from-sky-500/40 via-cyan-300 to-sky-500/40'
          }`}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          <div className="relative flex h-13 w-13 sm:h-16 sm:w-17 shrink-0 items-center justify-center">
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-1 rounded-full blur-md ${
                isGreenMode ? 'bg-emerald-500/35' : 'bg-sky-400/25'
              }`}
            />
            <img
              src={
                isGreenMode
                  ? '/assets/aistudio/tamiswap_green.png'
                  : '/assets/aistudio/tamiswap_00325eac.png'
              }
              alt="TamiSwap logo"
              width={68}
              height={64}
              className={`relative z-10 h-13 w-auto sm:h-16 object-contain [image-rendering:-webkit-optimize-contrast] ${
                isGreenMode ? 'drop-shadow-[0_0_10px_rgba(16,185,129,0.55)]' : ''
              }`}
            />
          </div>
          <div className="relative flex items-center shrink min-w-0">
            <img
              src={
                isGreenMode
                  ? '/assets/aistudio/tamiswap1_green.png'
                  : '/assets/aistudio/tamiswap1_f57f72d8.png'
              }
              alt="TamiSwap"
              width={180}
              height={60}
              className={`relative z-10 h-9 w-auto max-w-full sm:h-14 sm:max-w-none object-contain object-left [image-rendering:-webkit-optimize-contrast] ${
                isGreenMode
                  ? 'drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                  : 'drop-shadow-[0_0_12px_rgba(0,180,255,0.45)]'
              }`}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <div
            role="group"
            aria-label="Theme color switch"
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border p-0.5 transition-colors duration-200 ${
              isGreenMode
                ? 'border-emerald-400/80 bg-[#042212]/90 shadow-[0_0_14px_rgba(16,185,129,0.5)]'
                : 'border-sky-400/80 bg-[#041024]/90 shadow-[0_0_14px_rgba(0,180,255,0.45)]'
            }`}
          >
            <button
              type="button"
              onClick={() => setIsGreenMode(false)}
              aria-pressed={!isGreenMode}
              aria-label="Switch to Blue theme"
              title="Blue Mode"
              className={`flex h-4.5 w-4.5 sm:h-6 sm:w-6 cursor-pointer items-center justify-center rounded-full transition-all duration-150 ${
                !isGreenMode
                  ? 'bg-gradient-to-br from-cyan-100 via-sky-400 to-blue-600 shadow-[0_0_10px_rgba(0,212,255,0.95)] ring-1 ring-cyan-200'
                  : 'bg-sky-500/25 opacity-55 hover:opacity-90'
              }`}
            />
            <button
              type="button"
              onClick={() => setIsGreenMode(true)}
              aria-pressed={isGreenMode}
              aria-label="Switch to Green theme"
              title="Green Mode"
              className={`flex h-4.5 w-4.5 sm:h-6 sm:w-6 cursor-pointer items-center justify-center rounded-full transition-all duration-150 ${
                isGreenMode
                  ? 'bg-gradient-to-br from-emerald-200 via-emerald-500 to-green-700 shadow-[0_0_10px_rgba(16,185,129,0.95)] ring-1 ring-emerald-200'
                  : 'bg-emerald-500/25 opacity-55 hover:opacity-90'
              }`}
            />
          </div>

          <div className="wallet-cyber-rim">
            <button
              type="button"
              onClick={
                wrongNetwork
                  ? handleSwitchToBsc
                  : walletAddress
                  ? () => setShowWalletModal(true)
                  : handleConnectButton
              }
              className="wallet-cyber-btn inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 font-display text-[8.5px] sm:text-xs font-bold tracking-normal sm:tracking-wider text-white uppercase whitespace-nowrap shrink-0"
            >
              <Wallet
                className={`h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 shrink-0 ${
                  isGreenMode
                    ? 'text-emerald-300 drop-shadow-[0_0_6px_rgba(16,185,129,0.9)]'
                    : 'text-cyan-300 drop-shadow-[0_0_6px_rgba(0,212,255,0.9)]'
                }`}
              />
              <span className="chrome-text">
                {wrongNetwork
                  ? 'Switch to BNB Chain'
                  : walletAddress
                  ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                  : 'Connect BNB Wallet'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-start px-4 pt-6 pb-10 sm:pt-9">
        {/* Workspace Screen Switcher: Swap | Stake | Top 10 Tokens */}
        <div className="armor-chassis-shell mb-5 w-full max-w-[440px]">
          <div className="armor-well-rim">
            <div
              role="tablist"
              aria-label="DEX sections"
              className="armor-well grid grid-cols-3 gap-1.5 p-1.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'swap'}
                onClick={() => setActiveTab('swap')}
                className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-2 font-display text-[10px] sm:text-[11px] font-bold tracking-wide sm:tracking-wider uppercase transition-all whitespace-nowrap shrink-0 ${
                  activeTab === 'swap'
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                    : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                }`}
              >
                <ArrowLeftRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                <span>Swap</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'stake'}
                onClick={() => setActiveTab('stake')}
                className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-2 font-display text-[10px] sm:text-[11px] font-bold tracking-wide sm:tracking-wider uppercase transition-all whitespace-nowrap shrink-0 ${
                  activeTab === 'stake'
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                    : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                }`}
              >
                <Coins className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                <span>Stake</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'top-tokens'}
                onClick={() => setActiveTab('top-tokens')}
                className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-2 font-display text-[10px] sm:text-[11px] font-bold tracking-wide sm:tracking-wider uppercase transition-all whitespace-nowrap shrink-0 ${
                  activeTab === 'top-tokens'
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                    : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                }`}
              >
                <BarChart3 className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                <span>Top 10 Tokens</span>
              </button>
            </div>
          </div>
        </div>

        {walletNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="armor-chassis-shell mb-4 w-full max-w-[500px]"
          >
            <div className="armor-well-rim">
              <div
                className={`armor-well px-4 py-2.5 text-center text-xs ${
                  isGreenMode ? 'text-emerald-100' : 'text-cyan-100'
                }`}
              >
                {walletNotice}
              </div>
            </div>
          </motion.div>
        )}

        <div className={activeTab === 'swap' ? 'flex w-full justify-center' : 'hidden'}>
          <SwapWidget
            walletAddress={walletAddress}
            chainId={chainId}
            provider={activeProvider}
            onConnectWallet={handleConnectButton}
            onSwitchToBsc={handleSwitchToBsc}
            selectedTokenRequest={selectedTokenRequest}
            isGreenMode={isGreenMode}
          />
        </div>

        {activeTab === 'stake' && (
          <Suspense
            fallback={
              <div className="py-10 text-center font-mono text-xs text-slate-400">
                Loading Staking Vault...
              </div>
            }
          >
            <StakingView
              walletAddress={walletAddress}
              chainId={chainId}
              provider={activeProvider}
              onConnectWallet={handleConnectButton}
              onSwitchToBsc={handleSwitchToBsc}
              onBuyTamiyanoia={handleBuyTamiyanoia}
              isGreenMode={isGreenMode}
            />
          </Suspense>
        )}

        {activeTab === 'top-tokens' && (
          <Suspense
            fallback={
              <div className="py-10 text-center font-mono text-xs text-slate-400">
                Loading Top 10 Tokens...
              </div>
            }
          >
            <TopTokensView
              onSelectTokenForSwap={handleSelectTokenForSwap}
              isGreenMode={isGreenMode}
            />
          </Suspense>
        )}
      </main>

      {/* Cybernetic Wallet Selection / Connection Modal */}
      <AnimatePresence>
        {showWalletModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#010308]/85 p-4 backdrop-blur-md"
            onClick={() => setShowWalletModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="armor-chassis-shell w-full max-w-[400px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="armor-chassis-rim">
                <div className="armor-chassis relative p-5">
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-0 right-6 left-6 h-[1.5px] bg-gradient-to-r from-transparent to-transparent ${
                      isGreenMode ? 'via-emerald-400' : 'via-cyan-400'
                    }`}
                  />
                  <div
                    className={`mb-4 flex items-center justify-between border-b pb-3 ${
                      isGreenMode ? 'border-emerald-400/20' : 'border-sky-400/20'
                    }`}
                  >
                    <h2 className="font-display chrome-text text-sm font-bold tracking-widest uppercase">
                      {walletAddress ? 'BNB Chain Wallet' : 'Connect to BNB Chain'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowWalletModal(false)}
                      className={`combat-steel-btn p-1.5 text-slate-300 ${
                        isGreenMode ? 'hover:text-emerald-200' : 'hover:text-cyan-200'
                      }`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {walletAddress ? (
                    <div className="space-y-4">
                      <div className="armor-well-rim">
                        <div className="armor-well p-3.5">
                          <div
                            className={`text-xs font-semibold tracking-wider uppercase ${
                              wrongNetwork
                                ? 'text-amber-300'
                                : isGreenMode
                                ? 'text-emerald-300'
                                : 'text-sky-300'
                            }`}
                          >
                            {wrongNetwork
                              ? `Wrong Network (Chain ${chainId}) — Switch to BNB Smart Chain (56)`
                              : 'Active Address · BNB Smart Chain (56)'}
                          </div>
                          <div className="mt-1.5 font-mono text-xs break-all text-slate-100">
                            {walletAddress}
                          </div>
                        </div>
                      </div>
                      {wrongNetwork && (
                        <button
                          type="button"
                          onClick={handleSwitchToBsc}
                          className="combat-energy-btn font-display w-full py-2.5 text-xs font-bold tracking-wider text-white uppercase"
                        >
                          Switch to BNB Smart Chain (56)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        className="combat-steel-btn w-full border-red-500/55 py-2.5 text-xs font-bold tracking-wider text-red-200 uppercase hover:border-red-400 hover:text-white"
                      >
                        Disconnect Wallet
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {wallets.length > 0 && (
                        <div className="space-y-2">
                          <div className="font-mono text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                            Detected Browser Wallets
                          </div>
                          {wallets.map((w) => {
                            const fallbackMeta = getWalletIconMeta(w.name);
                            const iconSrc = w.icon || fallbackMeta?.src;
                            const iconBg = w.icon ? 'bg-transparent' : fallbackMeta?.bgClass || 'bg-white';
                            return (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => connectWithProvider(w.provider)}
                                className="combat-steel-btn flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-slate-100"
                              >
                                <span className="flex items-center gap-2.5">
                                  {iconSrc ? (
                                    <img
                                      src={iconSrc}
                                      alt={w.name}
                                      width={22}
                                      height={22}
                                      className={`h-5.5 w-5.5 shrink-0 rounded-md object-contain p-0.5 ${iconBg}`}
                                    />
                                  ) : (
                                    <Wallet
                                      className={`h-4 w-4 ${
                                        isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                                      }`}
                                    />
                                  )}
                                  <span className="tracking-wide">{w.name}</span>
                                </span>
                                <span
                                  className={`font-mono text-[11px] ${
                                    isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                                  }`}
                                >
                                  Connect
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="font-mono text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                          {wallets.length > 0
                            ? 'Or Open in Mobile Wallet App'
                            : 'Open in Any Mobile Wallet App'}
                        </div>
                        {wallets.length === 0 && (
                          <p className="text-xs leading-relaxed text-slate-300">
                            Choose a mobile wallet app to open this DEX directly, or connect using a desktop browser extension (MetaMask, Rabby, OKX, Binance Web3, Coinbase).
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          {mobileWalletLinks.map((wallet) => (
                            <a
                              key={wallet.id}
                              href={wallet.href}
                              target={wallet.isCustomScheme ? undefined : '_blank'}
                              rel={wallet.isCustomScheme ? undefined : 'noopener noreferrer'}
                              onClick={(e) => handleMobileWalletClick(e, wallet)}
                              className="combat-steel-btn flex items-center justify-between gap-1.5 px-2.5 py-2.5 text-xs font-semibold text-slate-100"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <img
                                  src={wallet.icon}
                                  alt={wallet.name}
                                  width={22}
                                  height={22}
                                  className={`h-5.5 w-5.5 shrink-0 rounded-md object-contain p-0.5 ${wallet.iconBg}`}
                                />
                                <span className="truncate">{wallet.name}</span>
                              </span>
                              <ExternalLink
                                className={`h-3 w-3 shrink-0 opacity-80 ${
                                  isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                                }`}
                              />
                            </a>
                          ))}
                        </div>
                        {modalNotice && (
                          <div
                            className={`border px-3 py-2 text-[11px] leading-relaxed ${
                              isGreenMode
                                ? 'border-emerald-400/45 bg-emerald-950/40 text-emerald-100'
                                : 'border-sky-400/45 bg-sky-950/40 text-cyan-100'
                            }`}
                          >
                            {modalNotice}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleCopySiteUrl}
                        className="combat-energy-btn flex w-full items-center justify-center gap-2 px-4 py-2.5 font-display text-[11px] font-bold tracking-wider text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
                      >
                        {copiedUrl ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>DApp Link Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy URL for Other Wallets</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
