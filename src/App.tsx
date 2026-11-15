import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, Wallet, X } from 'lucide-react';
import { SwapWidget } from './components/SwapWidget';
import { BSC_CHAIN_ID } from './data/swapTokens';
import { ensureBscNetwork } from './utils/bscWeb3';

interface InjectedProvider extends ethers.Eip1193Provider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: InjectedProvider[];
}

interface DiscoveredWallet {
  id: string;
  name: string;
  provider: InjectedProvider;
}

interface Eip6963AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; rdns: string };
    provider: InjectedProvider;
  };
}

function inferProviderName(p: InjectedProvider): string {
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isRabby) return 'Rabby Wallet';
  if (p.isOkxWallet) return 'OKX Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser Web3 Wallet';
}

export default function App() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [activeProvider, setActiveProvider] = useState<InjectedProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [isRedMode, setIsRedMode] = useState<boolean>(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem('tamiswap_red_mode');
    } catch {
      // ignore storage errors
    }
  }, []);

  // Discover EIP-6963 wallets asynchronously + window.trustwallet / window.ethereum
  useEffect(() => {
    const map = new Map<string, DiscoveredWallet>();

    const syncFromMap = () => {
      const list = Array.from(map.values());
      setWallets(list);
    };

    function addCandidate(id: string, name: string, provider: InjectedProvider) {
      if (!provider || typeof provider.request !== 'function') return;
      if (!map.has(id)) {
        map.set(id, { id, name, provider });
      }
    }

    function onAnnounce(event: Event) {
      const e = event as Eip6963AnnounceEvent;
      if (e.detail?.provider && e.detail?.info) {
        addCandidate(e.detail.info.rdns || e.detail.info.uuid, e.detail.info.name, e.detail.provider);
        syncFromMap();
      }
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const win = window as unknown as {
      ethereum?: InjectedProvider;
      trustwallet?: InjectedProvider;
    };

    if (win.trustwallet) {
      addCandidate('trustwallet-global', 'Trust Wallet', win.trustwallet);
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

    syncFromMap();

    // Auto-restore already-authorized session if any wallet is already unlocked & permitted
    const candidates = Array.from(map.values());
    if (candidates.length > 0) {
      (async () => {
        for (const candidate of candidates) {
          try {
            const accs = (await candidate.provider.request({
              method: 'eth_accounts',
            })) as string[];
            if (accs && accs[0]) {
              setActiveProvider(candidate.provider);
              setWalletAddress(ethers.getAddress(accs[0]));
              const hex = (await candidate.provider.request({
                method: 'eth_chainId',
              })) as string;
              setChainId(parseInt(hex, 16));
              break;
            }
          } catch {
            // ignore silent restore errors
          }
        }
      })();
    }

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    };
  }, []);

  // Subscribe to account & chain updates from the connected wallet
  useEffect(() => {
    if (!activeProvider?.on) return;

    function handleAccountsChanged(accs: unknown) {
      const list = accs as string[];
      setWalletAddress(list && list[0] ? ethers.getAddress(list[0]) : null);
    }

    function handleChainChanged(hex: unknown) {
      if (typeof hex === 'string') {
        setChainId(parseInt(hex, 16));
      }
    }

    activeProvider.on('accountsChanged', handleAccountsChanged);
    activeProvider.on('chainChanged', handleChainChanged);
    return () => {
      activeProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      activeProvider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [activeProvider]);

  async function connectWithProvider(chosen: InjectedProvider) {
    setWalletNotice(null);
    setShowWalletModal(false);
    try {
      const accounts = (await chosen.request({
        method: 'eth_requestAccounts',
      })) as string[];
      if (accounts && accounts[0]) {
        setActiveProvider(chosen);
        setWalletAddress(ethers.getAddress(accounts[0]));
      }
      await ensureBscNetwork(chosen);
      const hex = (await chosen.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(hex, 16));
    } catch (err: unknown) {
      setWalletNotice(
        err instanceof Error ? err.message : 'Wallet connection was rejected.'
      );
    }
  }

  function handleConnectButton() {
    setWalletNotice(null);
    if (wallets.length === 1) {
      connectWithProvider(wallets[0].provider);
      return;
    }
    setShowWalletModal(true);
  }

  async function handleSwitchToBsc() {
    if (!activeProvider) return;
    setWalletNotice(null);
    try {
      await ensureBscNetwork(activeProvider);
      const hex = (await activeProvider.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(hex, 16));
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

  const wrongNetwork = Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;
  const trustDeepLink =
    typeof window !== 'undefined'
      ? `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(
          window.location.href
        )}`
      : '#';

  const svgColors = isRedMode
    ? {
        wingTop: '#380f18',
        wingMid: '#24090f',
        wingBot: '#5f1e2c',
        plasma0: '#cc0022',
        plasma1: '#ff223a',
        plasma2: '#ffd6dc',
        cornerFill: '#2c0710',
        border: '#ff223a',
        veinMain: '#ff1e38',
        veinCore: '#ffb3be',
        veinBranch: '#ff3b52',
        veinMid: '#ff2a42',
        veinBright: '#ff4d63',
        nodeLight: '#ff99a8',
        nodeBright: '#ff3b52',
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
        isRedMode ? 'theme-red' : ''
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
            isRedMode ? 'bg-red-500/24' : 'bg-sky-500/24'
          }`}
        />
        <div
          className={`absolute bottom-0 left-1/2 h-[340px] w-[580px] -translate-x-1/2 rounded-full blur-[130px] ${
            isRedMode ? 'bg-rose-600/24' : 'bg-blue-600/24'
          }`}
        />
      </div>

      {/* Stepped Armored Top Navigation Bar */}
      <header className="combat-topbar relative z-20 flex h-16 sm:h-20 w-full items-center justify-between gap-1.5 sm:gap-4 px-2 sm:px-6">
        <div
          aria-hidden="true"
          className={`energy-vein-beam pointer-events-none absolute right-0 bottom-0 left-0 h-[2px] bg-gradient-to-r ${
            isRedMode
              ? 'from-red-500/40 via-rose-300 to-red-500/40'
              : 'from-sky-500/40 via-cyan-300 to-sky-500/40'
          }`}
        />
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <div className="relative flex h-13 w-13 sm:h-16 sm:w-17 shrink-0 items-center justify-center">
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-1 rounded-full blur-md ${
                isRedMode ? 'bg-red-500/35' : 'bg-sky-400/25'
              }`}
            />
            <img
              src="/assets/aistudio/tamiswap_00325eac.png"
              alt="TamiSwap logo"
              width={68}
              height={64}
              className={`relative z-10 h-13 w-auto sm:h-16 object-contain [image-rendering:-webkit-optimize-contrast] transition-opacity duration-150 ${
                isRedMode ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
            />
            <img
              src="/assets/aistudio/tamiswap_red.png?v=2"
              alt="TamiSwap logo red mode"
              width={68}
              height={64}
              className={`absolute inset-0 m-auto z-10 h-13 w-auto sm:h-16 object-contain drop-shadow-[0_0_10px_rgba(255,30,56,0.55)] [image-rendering:-webkit-optimize-contrast] transition-opacity duration-150 ${
                isRedMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          </div>
          <div className="relative flex items-center shrink min-w-0">
            <img
              src="/assets/aistudio/tamiswap1_f57f72d8.png"
              alt="TamiSwap"
              width={180}
              height={60}
              className={`relative z-10 h-auto max-h-5.5 w-full max-w-[68px] sm:h-11 sm:max-h-none sm:w-auto sm:max-w-none object-contain drop-shadow-[0_0_12px_rgba(0,180,255,0.45)] [image-rendering:-webkit-optimize-contrast] transition-opacity duration-150 ${
                isRedMode ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
            />
            <img
              src="/assets/aistudio/tamiswap1_red.png?v=2"
              alt="TamiSwap red mode"
              width={180}
              height={60}
              className={`absolute inset-0 z-10 h-full w-full object-contain drop-shadow-[0_0_12px_rgba(255,34,58,0.5)] [image-rendering:-webkit-optimize-contrast] transition-opacity duration-150 ${
                isRedMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <div
            role="group"
            aria-label="Theme color switch"
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border p-0.5 transition-colors duration-200 ${
              isRedMode
                ? 'border-red-400/80 bg-[#22040a]/90 shadow-[0_0_14px_rgba(255,34,58,0.5)]'
                : 'border-sky-400/80 bg-[#041024]/90 shadow-[0_0_14px_rgba(0,180,255,0.45)]'
            }`}
          >
            <button
              type="button"
              onClick={() => setIsRedMode(false)}
              aria-pressed={!isRedMode}
              aria-label="Switch to Blue theme"
              title="Blue Mode"
              className={`flex h-4.5 w-4.5 sm:h-6 sm:w-6 cursor-pointer items-center justify-center rounded-full transition-all duration-150 ${
                !isRedMode
                  ? 'bg-gradient-to-br from-cyan-100 via-sky-400 to-blue-600 shadow-[0_0_10px_rgba(0,212,255,0.95)] ring-1 ring-cyan-200'
                  : 'bg-sky-500/25 opacity-55 hover:opacity-90'
              }`}
            />
            <button
              type="button"
              onClick={() => setIsRedMode(true)}
              aria-pressed={isRedMode}
              aria-label="Switch to Red theme"
              title="Red Mode"
              className={`flex h-4.5 w-4.5 sm:h-6 sm:w-6 cursor-pointer items-center justify-center rounded-full transition-all duration-150 ${
                isRedMode
                  ? 'bg-gradient-to-br from-rose-200 via-red-500 to-red-700 shadow-[0_0_10px_rgba(255,40,64,0.95)] ring-1 ring-rose-200'
                  : 'bg-red-500/25 opacity-55 hover:opacity-90'
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
                  isRedMode
                    ? 'text-red-300 drop-shadow-[0_0_6px_rgba(255,40,64,0.9)]'
                    : 'text-cyan-300 drop-shadow-[0_0_6px_rgba(0,212,255,0.9)]'
                }`}
              />
              <span className="chrome-text">
                {wrongNetwork
                  ? 'Switch to BSC (56)'
                  : walletAddress
                  ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                  : 'Connect Wallet'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-10">
        {walletNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="armor-chassis-shell mb-4 w-full max-w-[500px]"
          >
            <div className="armor-well-rim">
              <div
                className={`armor-well px-4 py-2.5 text-center text-xs ${
                  isRedMode ? 'text-rose-100' : 'text-cyan-100'
                }`}
              >
                {walletNotice}
              </div>
            </div>
          </motion.div>
        )}
        <SwapWidget
          walletAddress={walletAddress}
          chainId={chainId}
          provider={activeProvider}
          onConnectWallet={handleConnectButton}
          onSwitchToBsc={handleSwitchToBsc}
          isRedMode={isRedMode}
        />
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
              className="armor-chassis-shell w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="armor-chassis-rim">
                <div className="armor-chassis relative p-5">
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-0 right-6 left-6 h-[1.5px] bg-gradient-to-r from-transparent to-transparent ${
                      isRedMode ? 'via-red-400' : 'via-cyan-400'
                    }`}
                  />
                  <div
                    className={`mb-4 flex items-center justify-between border-b pb-3 ${
                      isRedMode ? 'border-red-400/20' : 'border-sky-400/20'
                    }`}
                  >
                    <h2 className="font-display chrome-text text-sm font-bold tracking-widest uppercase">
                      {walletAddress ? 'Connected Wallet' : 'Connect DEX Wallet'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowWalletModal(false)}
                      className={`combat-steel-btn p-1.5 text-slate-300 ${
                        isRedMode ? 'hover:text-red-200' : 'hover:text-cyan-200'
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
                              isRedMode ? 'text-red-300' : 'text-sky-300'
                            }`}
                          >
                            Active Address (BNB Chain)
                          </div>
                          <div className="mt-1.5 font-mono text-xs break-all text-slate-100">
                            {walletAddress}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        className="combat-steel-btn w-full border-red-500/55 py-2.5 text-xs font-bold tracking-wider text-red-200 uppercase hover:border-red-400 hover:text-white"
                      >
                        Disconnect Wallet
                      </button>
                    </div>
                  ) : wallets.length > 0 ? (
                    <div className="space-y-2.5">
                      {wallets.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => connectWithProvider(w.provider)}
                          className="combat-steel-btn flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-100"
                        >
                          <span className="tracking-wide">{w.name}</span>
                          <span
                            className={`font-mono text-[11px] ${
                              isRedMode ? 'text-red-300' : 'text-cyan-300'
                            }`}
                          >
                            Detected
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3.5 text-xs">
                      <p className="leading-relaxed text-slate-300">
                        No browser wallet detected in this window. On mobile, open this URL directly inside Trust Wallet&apos;s built-in DApp browser, or use a desktop extension (Trust Wallet, MetaMask, Rabby).
                      </p>
                      <a
                        href={trustDeepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="combat-energy-btn flex w-full items-center justify-center gap-2 px-4 py-3 font-display text-xs font-bold tracking-wider text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
                      >
                        <span>Open in Trust Wallet App</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
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
