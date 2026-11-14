import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, X } from 'lucide-react';
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
      {/* Subtle Cybernetic Circuitry Vein Backdrop & Volumetric Cobalt Core Lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.14]"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 1440 900"
        >
          <defs>
            <linearGradient id="vein-h" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0066ff" stopOpacity="0" />
              <stop offset="35%" stopColor="#00aaff" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="1" />
              <stop offset="65%" stopColor="#00aaff" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0066ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Symmetrical angular cybernetic armor trace lines */}
          <path
            d="M0 240 L260 240 L320 300 L520 300 M1440 240 L1180 240 L1120 300 L920 300"
            stroke="url(#vein-h)"
            strokeWidth="1.25"
            fill="none"
          />
          <path
            d="M0 640 L220 640 L290 570 L490 570 M1440 640 L1220 640 L1150 570 L950 570"
            stroke="url(#vein-h)"
            strokeWidth="1.25"
            fill="none"
          />
          <circle cx="520" cy="300" r="3" fill="#38bdf8" />
          <circle cx="920" cy="300" r="3" fill="#38bdf8" />
          <circle cx="490" cy="570" r="3" fill="#00e5ff" />
          <circle cx="950" cy="570" r="3" fill="#00e5ff" />
        </svg>
        <div className="energy-vein-glow absolute top-1/4 left-1/2 h-[460px] w-[660px] -translate-x-1/2 rounded-full bg-sky-500/14 blur-[135px]" />
        <div className="absolute bottom-0 left-1/2 h-[320px] w-[540px] -translate-x-1/2 rounded-full bg-blue-700/16 blur-[125px]" />
      </div>

      {/* Armored Top Navigation Bar */}
      <header className="combat-topbar relative z-20 flex h-16 items-center justify-between gap-8 px-6">
        <div
          aria-hidden="true"
          className="energy-vein-beam pointer-events-none absolute right-0 bottom-0 left-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
        />
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
          <div className="chrome-armor-plate flex h-9 w-9 items-center justify-center font-display text-xs font-extrabold tracking-wider text-slate-950">
            TH
          </div>
          <span className="font-display chrome-text text-base font-bold tracking-widest uppercase">
            THENA Swap
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={
              wrongNetwork
                ? handleSwitchToBsc
                : walletAddress
                ? () => setShowWalletModal(true)
                : handleConnectButton
            }
            className="combat-steel-btn px-4 py-2 font-mono text-xs font-semibold tracking-wider text-cyan-100 whitespace-nowrap shrink-0"
          >
            {wrongNetwork
              ? 'Switch to BSC (56)'
              : walletAddress
              ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
              : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-10">
        {walletNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="armor-chassis-shell mb-4 w-full max-w-[480px]"
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
