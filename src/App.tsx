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

  return (
    <div className="combat-tech-backdrop relative flex min-h-screen flex-col overflow-x-hidden text-slate-100">
      {/* Symmetrical Cybernetic Armor Cockpit & Glowing Neon-Blue Vein Network */}
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
              <stop offset="0%" stopColor="#0f1e38" stopOpacity="0.96" />
              <stop offset="55%" stopColor="#091224" stopOpacity="0.94" />
              <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="steel-wing-r" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#0f1e38" stopOpacity="0.96" />
              <stop offset="55%" stopColor="#091224" stopOpacity="0.94" />
              <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="plasma-beam" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0055ff" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#00b8ff" stopOpacity="1" />
              <stop offset="100%" stopColor="#cff4ff" stopOpacity="1" />
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
            stroke="#00c8ff"
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
            fill="#07132c"
            fillOpacity="0.94"
            stroke="#00b8ff"
            strokeWidth="2"
            filter="url(#neon-blue-vein)"
          />

          {/* Left Cybernetic Blue Veins (branching energy arteries & capillary conduits) */}
          <g filter="url(#neon-blue-vein)">
            <path
              d="M0 245 L110 245 L165 298 L290 298 L345 345 L465 345"
              stroke="#009dff"
              strokeWidth="2.2"
            />
            <path
              d="M0 245 L110 245 L165 298 L290 298 L345 345 L465 345"
              stroke="#aef0ff"
              strokeWidth="1.2"
              className="cyber-vein-stream"
            />
            <path
              d="M165 298 L215 245 L330 245 L385 205 L485 205"
              stroke="#00d4ff"
              strokeWidth="1.3"
              strokeOpacity="0.82"
            />
            <path
              d="M82 375 L195 375 L255 430 L455 430"
              stroke="#00b4ff"
              strokeWidth="1.8"
            />
            <path
              d="M255 430 L300 478 L420 478 L468 518"
              stroke="#00e5ff"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M115 585 L235 585 L295 535 L462 535"
              stroke="#0099ff"
              strokeWidth="2"
            />
            <path
              d="M115 585 L235 585 L295 535 L462 535"
              stroke="#9eeaff"
              strokeWidth="1.1"
              className="cyber-vein-stream"
            />
            <path
              d="M235 585 L285 645 L395 645 L455 685"
              stroke="#00c8ff"
              strokeWidth="1.2"
              strokeOpacity="0.75"
            />
            <circle cx="465" cy="345" r="3.5" fill="#7ce7ff" />
            <circle cx="485" cy="205" r="2.8" fill="#00d4ff" />
            <circle cx="455" cy="430" r="3.5" fill="#7ce7ff" />
            <circle cx="462" cy="535" r="3.5" fill="#7ce7ff" />
            <circle cx="455" cy="685" r="2.8" fill="#00d4ff" />
          </g>

          {/* Right side 3D armored wing plate & bottom corner armor */}
          <path
            d="M1440 160 L1358 230 L1358 540 L1290 640 L1290 900 L1440 900 Z"
            fill="url(#steel-wing-r)"
            opacity="0.86"
          />
          <path
            d="M1440 160 L1358 230 L1358 540 L1290 640 L1290 900"
            stroke="#00c8ff"
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
            fill="#07132c"
            fillOpacity="0.94"
            stroke="#00b8ff"
            strokeWidth="2"
            filter="url(#neon-blue-vein)"
          />

          {/* Right Cybernetic Blue Veins (symmetrical energy arteries & capillary conduits) */}
          <g filter="url(#neon-blue-vein)">
            <path
              d="M1440 245 L1330 245 L1275 298 L1150 298 L1095 345 L975 345"
              stroke="#009dff"
              strokeWidth="2.2"
            />
            <path
              d="M1440 245 L1330 245 L1275 298 L1150 298 L1095 345 L975 345"
              stroke="#aef0ff"
              strokeWidth="1.2"
              className="cyber-vein-stream"
            />
            <path
              d="M1275 298 L1225 245 L1110 245 L1055 205 L955 205"
              stroke="#00d4ff"
              strokeWidth="1.3"
              strokeOpacity="0.82"
            />
            <path
              d="M1358 375 L1245 375 L1185 430 L985 430"
              stroke="#00b4ff"
              strokeWidth="1.8"
            />
            <path
              d="M1185 430 L1140 478 L1020 478 L972 518"
              stroke="#00e5ff"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M1325 585 L1205 585 L1145 535 L978 535"
              stroke="#0099ff"
              strokeWidth="2"
            />
            <path
              d="M1325 585 L1205 585 L1145 535 L978 535"
              stroke="#9eeaff"
              strokeWidth="1.1"
              className="cyber-vein-stream"
            />
            <path
              d="M1205 585 L1155 645 L1045 645 L985 685"
              stroke="#00c8ff"
              strokeWidth="1.2"
              strokeOpacity="0.75"
            />
            <circle cx="975" cy="345" r="3.5" fill="#7ce7ff" />
            <circle cx="955" cy="205" r="2.8" fill="#00d4ff" />
            <circle cx="985" cy="430" r="3.5" fill="#7ce7ff" />
            <circle cx="978" cy="535" r="3.5" fill="#7ce7ff" />
            <circle cx="985" cy="685" r="2.8" fill="#00d4ff" />
          </g>
        </svg>

        <div className="energy-vein-glow absolute top-1/4 left-1/2 h-[500px] w-[720px] -translate-x-1/2 rounded-full bg-sky-500/24 blur-[140px]" />
        <div className="absolute bottom-0 left-1/2 h-[340px] w-[580px] -translate-x-1/2 rounded-full bg-blue-600/24 blur-[130px]" />
      </div>

      {/* Stepped Armored Top Navigation Bar */}
      <header className="combat-topbar relative z-20 flex h-20 items-center justify-between gap-6 px-4 sm:px-6">
        <div
          aria-hidden="true"
          className="energy-vein-beam pointer-events-none absolute right-0 bottom-0 left-0 h-[2px] bg-gradient-to-r from-sky-500/40 via-cyan-300 to-sky-500/40"
        />
        <div className="flex items-center gap-3.5 whitespace-nowrap shrink-0">
          <div className="relative flex h-14 w-15 sm:h-16 sm:w-17 shrink-0 items-center justify-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-1 rounded-full bg-sky-400/25 blur-md"
            />
            <img
              src="/assets/aistudio/tamiswap_00325eac.png"
              alt="TamiSwap logo"
              width={68}
              height={64}
              className="relative z-10 h-14 w-auto sm:h-16 object-contain [image-rendering:-webkit-optimize-contrast]"
            />
          </div>
          <span className="font-display text-lg sm:text-xl font-extrabold tracking-widest uppercase whitespace-nowrap shrink-0">
            <span className="text-white">TAMI</span>
            <span className="text-sky-400 drop-shadow-[0_0_10px_rgba(56,189,248,0.65)]">
              SWAP
            </span>
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
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
              className="wallet-cyber-btn inline-flex items-center gap-2 px-4 py-2 font-display text-xs font-bold tracking-wider text-white uppercase whitespace-nowrap shrink-0"
            >
              <Wallet className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_6px_rgba(0,212,255,0.9)]" />
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
              <div className="armor-well px-4 py-2.5 text-center text-xs text-cyan-100">
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
                    className="pointer-events-none absolute top-0 right-6 left-6 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                  />
                  <div className="mb-4 flex items-center justify-between border-b border-sky-400/20 pb-3">
                    <h2 className="font-display chrome-text text-sm font-bold tracking-widest uppercase">
                      {walletAddress ? 'Connected Wallet' : 'Connect DEX Wallet'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowWalletModal(false)}
                      className="combat-steel-btn p-1.5 text-slate-300 hover:text-cyan-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {walletAddress ? (
                    <div className="space-y-4">
                      <div className="armor-well-rim">
                        <div className="armor-well p-3.5">
                          <div className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
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
                          <span className="font-mono text-[11px] text-cyan-300">
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
