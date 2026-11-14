import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
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

  useEffect(() => {
    const map = new Map<string, DiscoveredWallet>();

    const syncFromMap = () => {
      setWallets(Array.from(map.values()));
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
        addCandidate(
          e.detail.info.rdns || e.detail.info.uuid,
          e.detail.info.name,
          e.detail.provider
        );
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
    <div className="flex min-h-screen flex-col bg-[#0B0E14] text-slate-100">
      <header className="flex h-16 items-center justify-between gap-8 border-b border-slate-800/80 px-6">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-amber-500 font-mono text-xs font-bold text-slate-950">
            TH
          </div>
          <span className="font-display text-base font-semibold tracking-tight text-slate-50">
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
            className="rounded-lg border border-slate-700/80 bg-[#111622] px-3.5 py-2 font-mono text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors hover:border-amber-500/50 hover:text-amber-300"
          >
            {wrongNetwork
              ? 'Switch to BSC (56)'
              : walletAddress
              ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
              : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        {walletNotice && (
          <div className="mb-4 w-full max-w-[480px] rounded-lg border border-slate-800 bg-[#111622] px-4 py-2.5 text-center text-xs text-slate-300">
            {walletNotice}
          </div>
        )}
        <SwapWidget
          walletAddress={walletAddress}
          chainId={chainId}
          provider={activeProvider}
          onConnectWallet={handleConnectButton}
          onSwitchToBsc={handleSwitchToBsc}
        />
      </main>

      {showWalletModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowWalletModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-800 bg-[#111622] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                {walletAddress ? 'Connected Wallet' : 'Connect DEX Wallet'}
              </h2>
              <button
                type="button"
                onClick={() => setShowWalletModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {walletAddress ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3.5">
                  <div className="text-xs text-slate-400">Active Address (BNB Chain)</div>
                  <div className="mt-1 font-mono text-xs break-all text-slate-100">
                    {walletAddress}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="w-full rounded-lg border border-red-900/60 bg-red-950/30 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-950/50"
                >
                  Disconnect Wallet
                </button>
              </div>
            ) : wallets.length > 0 ? (
              <div className="space-y-2">
                {wallets.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => connectWithProvider(w.provider)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-[#0B0E14] px-4 py-3 text-left text-xs font-semibold text-slate-100 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                  >
                    <span>{w.name}</span>
                    <span className="font-mono text-[11px] text-slate-500">Detected</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="leading-relaxed text-slate-300">
                  No browser wallet detected in this window. On mobile, open this URL directly inside Trust Wallet&apos;s built-in DApp browser, or use a desktop extension (Trust Wallet, MetaMask, Rabby).
                </p>
                <a
                  href={trustDeepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <span>Open in Trust Wallet App</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
