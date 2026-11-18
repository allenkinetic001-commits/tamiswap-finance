import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { motion } from 'motion/react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  Gift,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  BSC_CHAIN_ID,
  PLATFORM_FEE_RECIPIENT,
  TAMIYANOIA_ADDRESS,
} from '../data/swapTokens';
import {
  approveTokenForRouter,
  fetchAllowance,
  fetchWalletBalances,
} from '../utils/bscWeb3';
import {
  claimTamiyanoiaReward,
  deployTamiyanoiaStakingContract,
  fetchTamiPairSnapshot,
  fetchTamiStakingState,
  fundTamiyanoiaRewards,
  getEffectiveTamiStakingAddress,
  saveLocalTamiStakingAddress,
  setTamiyanoiaFeeConfig,
  stakeTamiyanoia,
  TamiPairSnapshot,
  TamiStakingOnChainState,
  TAMIYANOIA_TOKEN,
  unstakeTamiyanoia,
} from '../utils/staking';
import { TokenLogo } from './TokenLogo';

interface StakingViewProps {
  walletAddress: string | null;
  chainId: number | null;
  provider: ethers.Eip1193Provider | null;
  onConnectWallet: () => void;
  onSwitchToBsc: () => void;
  onBuyTamiyanoia?: () => void;
  isGreenMode?: boolean;
}

type StakeAction = 'stake' | 'unstake';

function formatAmount(rawStr: string, maxDecimals = 4): string {
  const num = Number(rawStr);
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  const digits = num >= 1_000_000 ? 0 : num >= 1_000 ? 2 : maxDecimals;
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function StakingView({
  walletAddress,
  chainId,
  provider,
  onConnectWallet,
  onSwitchToBsc,
  onBuyTamiyanoia,
  isGreenMode = false,
}: StakingViewProps) {
  const [action, setAction] = useState<StakeAction>('stake');
  const [tamiAmountStr, setTamiAmountStr] = useState('');

  const [tamiContractAddr, setTamiContractAddr] = useState<string>(() =>
    getEffectiveTamiStakingAddress()
  );
  const [bindAddressInput, setBindAddressInput] = useState('');
  const [bindError, setBindError] = useState<string | null>(null);
  const [showOwnerSetup, setShowOwnerSetup] = useState(false);
  const [justDeployedAddr, setJustDeployedAddr] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const [tamiState, setTamiState] = useState<TamiStakingOnChainState | null>(null);
  const [tamiPair, setTamiPair] = useState<TamiPairSnapshot | null>(null);
  const [loadingTami, setLoadingTami] = useState(true);

  const [fundAmountStr, setFundAmountStr] = useState('');
  const [fundDurationDays, setFundDurationDays] = useState('30');

  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [tamiAllowanceWei, setTamiAllowanceWei] = useState<bigint>(0n);
  const [checkingAllowance, setCheckingAllowance] = useState(false);

  const [txPending, setTxPending] = useState<
    'deploy' | 'approve' | 'stake' | 'claim' | 'fund-approve' | 'fund' | 'fee' | null
  >(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatusText, setTxStatusText] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const wrongNetwork =
    Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;

  const loadTamiData = useCallback(async () => {
    setLoadingTami(true);
    try {
      const [stateRes, pairRes] = await Promise.all([
        fetchTamiStakingState(tamiContractAddr, walletAddress),
        fetchTamiPairSnapshot(),
      ]);
      setTamiState(stateRes);
      setTamiPair(pairRes);
    } finally {
      setLoadingTami(false);
    }
  }, [tamiContractAddr, walletAddress]);

  useEffect(() => {
    void loadTamiData();
  }, [loadTamiData]);

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setBalances({});
      return;
    }
    setLoadingBalances(true);
    try {
      const next = await fetchWalletBalances(walletAddress, [TAMIYANOIA_TOKEN]);
      setBalances(next);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const tamiWalletBalanceStr =
    balances[TAMIYANOIA_ADDRESS.toLowerCase()] ?? '0';

  const tamiWalletBalanceWei = useMemo(() => {
    try {
      return ethers.parseUnits(tamiWalletBalanceStr || '0', 18);
    } catch {
      return 0n;
    }
  }, [tamiWalletBalanceStr]);

  const tamiInputWei = useMemo(() => {
    const clean = tamiAmountStr.trim();
    if (!clean || Number.isNaN(Number(clean)) || Number(clean) <= 0) return 0n;
    try {
      return ethers.parseUnits(clean, 18);
    } catch {
      return 0n;
    }
  }, [tamiAmountStr]);

  const fundAmountWei = useMemo(() => {
    const clean = fundAmountStr.trim();
    if (!clean || Number.isNaN(Number(clean)) || Number(clean) <= 0) return 0n;
    try {
      return ethers.parseUnits(clean, 18);
    } catch {
      return 0n;
    }
  }, [fundAmountStr]);

  const refreshTamiAllowance = useCallback(async () => {
    if (!walletAddress || !tamiState?.isValidContract || !tamiState.contractAddress) {
      setTamiAllowanceWei(0n);
      return;
    }
    setCheckingAllowance(true);
    try {
      const current = await fetchAllowance(
        TAMIYANOIA_ADDRESS,
        walletAddress,
        tamiState.contractAddress
      );
      setTamiAllowanceWei(current);
    } finally {
      setCheckingAllowance(false);
    }
  }, [walletAddress, tamiState?.isValidContract, tamiState?.contractAddress]);

  useEffect(() => {
    void refreshTamiAllowance();
  }, [refreshTamiAllowance]);

  const tamiAvailableWei =
    action === 'stake'
      ? tamiWalletBalanceWei
      : tamiState?.userStakedWei ?? 0n;
  const tamiAvailableStr = ethers.formatUnits(tamiAvailableWei, 18);

  const insufficientTami =
    Boolean(walletAddress) && tamiInputWei > tamiAvailableWei;
  const needsTamiApproval =
    action === 'stake' &&
    Boolean(tamiState?.isValidContract) &&
    tamiInputWei > 0n &&
    tamiAllowanceWei < tamiInputWei;
  const needsFundApproval =
    Boolean(tamiState?.isValidContract) &&
    fundAmountWei > 0n &&
    tamiAllowanceWei < fundAmountWei;

  const nowSec = Math.floor(Date.now() / 1000);
  const isTamiLocked = Boolean(
    tamiState?.isValidContract &&
      tamiState.lockDurationSec > 0 &&
      tamiState.userUnlockTime > nowSec
  );

  const isOwnerWallet = Boolean(
    walletAddress &&
      ((tamiState?.ownerAddress &&
        walletAddress.toLowerCase() === tamiState.ownerAddress.toLowerCase()) ||
        walletAddress.toLowerCase() === PLATFORM_FEE_RECIPIENT.toLowerCase())
  );

  function handleFillFraction(num: number, den: number) {
    setTxHash(null);
    setTxError(null);
    setTxStatusText(null);
    if (tamiAvailableWei <= 0n) {
      setTamiAmountStr('0');
      return;
    }
    const usable = (tamiAvailableWei * BigInt(num)) / BigInt(den);
    const formatted = ethers.formatUnits(usable, 18);
    setTamiAmountStr(
      num === 1 && den === 1 ? formatted : formatted.replace(/\.?0+$/, '') || '0'
    );
  }

  async function handleCopyDeployedAddress(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  async function handleOneClickDeploy() {
    if (!provider || !walletAddress) return;
    setTxError(null);
    setTxHash(null);
    setBindError(null);
    setTxPending('deploy');
    setTxStatusText('Confirm contract deployment in your wallet (~$2 BNB gas)...');
    try {
      const { contractAddress, txHash: deployHash } =
        await deployTamiyanoiaStakingContract(provider);
      if (deployHash) setTxHash(deployHash);
      saveLocalTamiStakingAddress(contractAddress);
      setTamiContractAddr(contractAddress);
      setJustDeployedAddr(contractAddress);
      setTxStatusText(
        `TAMIYANOIA Staking Contract deployed at ${contractAddress}! Now add TAMIYANOIA rewards below.`
      );
      await loadTamiData();
    } catch (err: unknown) {
      setTxError(
        err instanceof Error ? err.message : 'Contract deployment cancelled or failed.'
      );
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleBindTamiContract() {
    setBindError(null);
    const candidate = bindAddressInput.trim();
    if (!ethers.isAddress(candidate)) {
      setBindError('Enter a valid BNB Smart Chain contract address (0x...).');
      return;
    }
    const normalized = ethers.getAddress(candidate);
    const stateCheck = await fetchTamiStakingState(normalized, walletAddress);
    if (!stateCheck.isValidContract) {
      setBindError(
        'No valid TamiyanoiaStaking contract found at that address on BNB Smart Chain.'
      );
      return;
    }
    saveLocalTamiStakingAddress(normalized);
    setTamiContractAddr(normalized);
    setTamiState(stateCheck);
    setBindAddressInput('');
    setJustDeployedAddr(normalized);
    setTxStatusText('TAMIYANOIA Staking contract connected and live!');
  }

  async function handleApproveTami(
    amountToApprove: bigint,
    mode: 'approve' | 'fund-approve'
  ) {
    if (!provider || !walletAddress || !tamiState?.contractAddress) return;
    setTxError(null);
    setTxHash(null);
    setTxPending(mode);
    setTxStatusText('Approving TAMIYANOIA in your wallet...');
    try {
      const receipt = await approveTokenForRouter(
        provider,
        TAMIYANOIA_ADDRESS,
        amountToApprove,
        tamiState.contractAddress
      );
      if (receipt?.hash) setTxHash(receipt.hash);
      setTxStatusText('TAMIYANOIA approved. Ready for the next step!');
      await refreshTamiAllowance();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Approval failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleTamiStakeOrUnstake() {
    if (
      !provider ||
      !walletAddress ||
      !tamiState?.contractAddress ||
      tamiInputWei <= 0n
    ) {
      return;
    }
    setTxError(null);
    setTxHash(null);
    setTxPending('stake');
    setTxStatusText(
      action === 'stake'
        ? `Confirm staking ${formatAmount(tamiAmountStr)} TAMIYANOIA in your wallet...`
        : `Confirm unstaking ${formatAmount(tamiAmountStr)} TAMIYANOIA in your wallet...`
    );
    try {
      const tx =
        action === 'stake'
          ? await stakeTamiyanoia(provider, tamiState.contractAddress, tamiInputWei)
          : await unstakeTamiyanoia(provider, tamiState.contractAddress, tamiInputWei);
      setTxHash(tx.hash);
      setTxStatusText('Transaction sent to BNB Chain. Confirming...');
      await tx.wait();
      setTxStatusText(
        action === 'stake'
          ? `Successfully staked ${formatAmount(tamiAmountStr)} TAMIYANOIA!`
          : `Successfully unstaked ${formatAmount(tamiAmountStr)} TAMIYANOIA!`
      );
      setTamiAmountStr('');
      await Promise.all([refreshBalances(), refreshTamiAllowance(), loadTamiData()]);
    } catch (err: unknown) {
      setTxError(
        err instanceof Error ? err.message : 'TAMIYANOIA staking transaction failed.'
      );
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleClaimTamiReward() {
    if (!provider || !walletAddress || !tamiState?.contractAddress) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('claim');
    setTxStatusText('Sending earned TAMIYANOIA rewards to your wallet...');
    try {
      const tx = await claimTamiyanoiaReward(provider, tamiState.contractAddress);
      setTxHash(tx.hash);
      setTxStatusText('Claim transaction sent. Waiting for confirmation...');
      await tx.wait();
      setTxStatusText('TAMIYANOIA rewards claimed!');
      await Promise.all([refreshBalances(), loadTamiData()]);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Claim failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleOwnerFundRewards() {
    if (
      !provider ||
      !walletAddress ||
      !tamiState?.contractAddress ||
      fundAmountWei <= 0n
    ) {
      return;
    }
    const days = Math.max(1, Math.min(365, Number(fundDurationDays) || 30));
    setTxError(null);
    setTxHash(null);
    setTxPending('fund');
    setTxStatusText(
      `Depositing ${formatAmount(fundAmountStr)} TAMIYANOIA rewards for ${days} days...`
    );
    try {
      const tx = await fundTamiyanoiaRewards(
        provider,
        tamiState.contractAddress,
        fundAmountWei,
        days
      );
      setTxHash(tx.hash);
      setTxStatusText('Reward funding sent to BNB Chain. Confirming...');
      await tx.wait();
      setTxStatusText(
        `Live! ${formatAmount(fundAmountStr)} TAMIYANOIA rewards active for ${days} days.`
      );
      setFundAmountStr('');
      await Promise.all([refreshBalances(), refreshTamiAllowance(), loadTamiData()]);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Funding rewards failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleToggleFee(bps: 0 | 25) {
    if (!provider || !walletAddress || !tamiState?.contractAddress) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('fee');
    setTxStatusText(`Updating staking fee to ${(bps / 100).toFixed(2)}%...`);
    try {
      const tx = await setTamiyanoiaFeeConfig(
        provider,
        tamiState.contractAddress,
        bps,
        0
      );
      setTxHash(tx.hash);
      await tx.wait();
      setTxStatusText(`Staking fee updated to ${(bps / 100).toFixed(2)}%.`);
      await loadTamiData();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Fee update failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="armor-chassis-shell relative w-full max-w-[520px]"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-1.5 left-1/2 z-20 h-3 w-48 -translate-x-1/2 rounded-full blur-md ${
          isGreenMode ? 'bg-emerald-400/90' : 'bg-cyan-300/90'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-1.5 left-1/2 z-20 h-3 w-44 -translate-x-1/2 rounded-full blur-md ${
          isGreenMode ? 'bg-emerald-500/85' : 'bg-sky-400/85'
        }`}
      />

      <div className="armor-chassis-rim">
        <div className="armor-chassis relative overflow-hidden p-4 sm:p-6">
          <div
            aria-hidden="true"
            className={`energy-vein-beam pointer-events-none absolute top-0 right-6 left-6 h-[2.5px] bg-gradient-to-r from-transparent to-transparent ${
              isGreenMode ? 'via-emerald-200' : 'via-cyan-200'
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute right-8 bottom-0 left-8 h-[2px] bg-gradient-to-r from-transparent to-transparent ${
              isGreenMode ? 'via-emerald-400' : 'via-cyan-300'
            }`}
          />

          {/* Header */}
          <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <TokenLogo token={TAMIYANOIA_TOKEN} size={38} />
              <div>
                <h1 className="font-display chrome-text text-lg sm:text-2xl font-extrabold tracking-widest uppercase">
                  TAMIYANOIA Staking
                </h1>
                <p className="mt-0.5 text-xs text-slate-300">
                  Lock TAMIYANOIA to earn extra TAMIYANOIA rewards — withdraw anytime
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadTamiData();
                void refreshBalances();
              }}
              disabled={loadingBalances || loadingTami}
              title="Refresh TAMIYANOIA staking pool"
              className={`combat-steel-btn p-2.5 text-slate-200 disabled:opacity-50 ${
                isGreenMode ? 'hover:text-emerald-300' : 'hover:text-cyan-300'
              }`}
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loadingBalances || loadingTami
                    ? `animate-spin ${isGreenMode ? 'text-emerald-300' : 'text-cyan-300'}`
                    : ''
                }`}
              />
            </button>
          </div>

          {/* Live Metrics Row */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well grid grid-cols-3 divide-x divide-slate-700/60 px-2 py-2.5 text-center">
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  Reward Rate
                </div>
                <div
                  className={`mt-0.5 font-mono text-xs sm:text-sm font-bold tabular-nums ${
                    isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                  }`}
                >
                  {loadingTami && !tamiState
                    ? '...'
                    : tamiState?.isValidContract
                    ? tamiState.apyPct && tamiState.apyPct > 0
                      ? `${tamiState.apyPct.toFixed(1)}% APY`
                      : tamiState.rewardReserveWei > 0n
                      ? 'Active Pool'
                      : 'Ready to Fund'
                    : 'Soon'}
                </div>
              </div>
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  {tamiState?.isValidContract ? 'Total Staked' : 'Swap Pool'}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                  {loadingTami && !tamiState
                    ? '...'
                    : tamiState?.isValidContract
                    ? `${formatAmount(ethers.formatUnits(tamiState.totalStakedWei, 18), 2)} TAMI`
                    : tamiPair
                    ? `${tamiPair.pooledBnb.toFixed(2)} BNB LP`
                    : 'PancakeSwap V2'}
                </div>
              </div>
              <div className="px-1">
                <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  {tamiState?.isValidContract ? 'Your Staked' : 'Your TAMI'}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                  {!walletAddress
                    ? '—'
                    : tamiState?.isValidContract
                    ? formatAmount(ethers.formatUnits(tamiState.userStakedWei, 18), 2)
                    : formatAmount(tamiWalletBalanceStr, 2)}
                </div>
              </div>
            </div>
          </div>

          {tamiState?.isValidContract ? (
            <>
              {/* Newly Deployed Address Notice for Owner */}
              {justDeployedAddr && (
                <div className="armor-well-rim relative z-10 mb-3.5">
                  <div className="armor-well space-y-2 border border-emerald-400/35 p-3 text-xs">
                    <div className="font-display text-[11px] font-bold tracking-wider text-emerald-300 uppercase">
                      Vault Deployed! Send This Address to Lock It For All Visitors:
                    </div>
                    <div className="flex items-center justify-between gap-2 border border-slate-700 bg-[#050a14] px-2.5 py-1.5 font-mono text-[11px] text-white">
                      <span className="truncate">{justDeployedAddr}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyDeployedAddress(justDeployedAddr)}
                        className="inline-flex shrink-0 items-center gap-1 text-emerald-300 hover:text-white"
                      >
                        {copiedAddr ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Stake / Unstake Toggle */}
              <div className="armor-well-rim relative z-10 mb-3.5">
                <div className="armor-well grid grid-cols-2 gap-1 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAction('stake');
                      setTamiAmountStr('');
                      setTxHash(null);
                      setTxError(null);
                      setTxStatusText(null);
                    }}
                    className={`py-2 font-display text-[11px] font-bold tracking-wider uppercase transition-all whitespace-nowrap ${
                      action === 'stake'
                        ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                        : isGreenMode
                        ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                        : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                    }`}
                  >
                    Stake TAMIYANOIA
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAction('unstake');
                      setTamiAmountStr('');
                      setTxHash(null);
                      setTxError(null);
                      setTxStatusText(null);
                    }}
                    className={`py-2 font-display text-[11px] font-bold tracking-wider uppercase transition-all whitespace-nowrap ${
                      action === 'unstake'
                        ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                        : isGreenMode
                        ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                        : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                    }`}
                  >
                    Unstake TAMIYANOIA
                  </button>
                </div>
              </div>

              {/* Amount Input Chamber */}
              <div className="armor-well-rim relative z-10">
                <div className="armor-well p-3.5 sm:p-4">
                  <div className="mb-2.5 flex items-center justify-between text-xs">
                    <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                      {action === 'stake' ? 'Amount to Stake' : 'Amount to Unstake'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-300 tabular-nums">
                        {walletAddress
                          ? `${action === 'stake' ? 'Bal' : 'Staked'}: ${formatAmount(
                              tamiAvailableStr,
                              2
                            )}`
                          : 'Wallet not connected'}
                      </span>
                      {walletAddress && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleFillFraction(1, 2)}
                            className={`font-mono text-[11px] font-semibold text-slate-300 transition-colors ${
                              isGreenMode ? 'hover:text-emerald-300' : 'hover:text-cyan-300'
                            }`}
                          >
                            50%
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFillFraction(1, 1)}
                            className={`font-mono text-[11px] font-bold transition-colors hover:text-white ${
                              isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                            }`}
                          >
                            MAX
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={tamiAmountStr}
                      onChange={(e) => {
                        setTamiAmountStr(e.target.value);
                        setTxHash(null);
                        setTxError(null);
                        setTxStatusText(null);
                      }}
                      placeholder="0.0"
                      className={`min-w-0 flex-1 bg-transparent font-mono font-bold text-white placeholder-slate-600 tabular-nums focus:outline-none ${
                        tamiAmountStr.length > 14
                          ? 'text-sm sm:text-xl'
                          : tamiAmountStr.length > 9
                          ? 'text-base sm:text-2xl'
                          : 'text-lg sm:text-[26px]'
                      }`}
                    />
                    <div className="combat-steel-btn inline-flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold tracking-wider text-white whitespace-nowrap">
                      <TokenLogo token={TAMIYANOIA_TOKEN} size={20} />
                      <span>TAMI</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Claimable Rewards Box */}
              <div className="armor-well-rim relative z-10 mt-3.5">
                <div className="armor-well flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      <Gift
                        className={`h-3.5 w-3.5 ${
                          isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                        }`}
                      />
                      <span>Earned TAMIYANOIA Rewards</span>
                    </div>
                    <div
                      className={`mt-0.5 truncate font-mono text-sm sm:text-base font-extrabold tabular-nums ${
                        isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                      }`}
                    >
                      {walletAddress
                        ? `${formatAmount(
                            ethers.formatUnits(tamiState.userEarnedWei, 18),
                            4
                          )} TAMIYANOIA`
                        : 'Connect wallet to view'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !walletAddress ||
                      wrongNetwork ||
                      tamiState.userEarnedWei <= 0n ||
                      txPending !== null
                    }
                    onClick={handleClaimTamiReward}
                    className="combat-steel-btn shrink-0 px-3.5 py-2 font-display text-[11px] font-bold tracking-wider text-white uppercase disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {txPending === 'claim' ? 'Claiming...' : 'Claim'}
                  </button>
                </div>
              </div>

              {/* Vault Summary */}
              <div
                className={`relative z-10 mt-4 space-y-2 border-t pt-3.5 text-xs ${
                  isGreenMode ? 'border-emerald-400/25' : 'border-sky-400/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Unlock rule</span>
                  <span className="font-mono text-slate-100">
                    {tamiState.lockDurationSec === 0
                      ? 'Flexible (Withdraw Anytime)'
                      : `${Math.round(tamiState.lockDurationSec / 86400)} Days Lock`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Rewards left in vault</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {formatAmount(
                      ethers.formatUnits(tamiState.rewardReserveWei, 18),
                      2
                    )}{' '}
                    TAMIYANOIA
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <ShieldCheck
                      className={`h-3.5 w-3.5 ${
                        isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                      }`}
                    />
                    <span>Staking fee</span>
                  </span>
                  <span className="font-mono text-slate-200">
                    {((action === 'stake'
                      ? tamiState.stakeFeeBps
                      : tamiState.unstakeFeeBps) /
                      100
                    ).toFixed(2)}
                    %
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Staking vault contract</span>
                  <a
                    href={`https://bscscan.com/address/${tamiState.contractAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 font-mono text-[11px] hover:underline ${
                      isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                    }`}
                  >
                    <span>
                      {tamiState.contractAddress.slice(0, 6)}...
                      {tamiState.contractAddress.slice(-4)}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {txError && (
                <div className="relative z-10 mt-3 border border-red-500/50 bg-red-950/40 px-3.5 py-2 text-xs text-red-200">
                  {txError}
                </div>
              )}

              {/* Primary Action CTA */}
              {!walletAddress ? (
                <button
                  type="button"
                  onClick={onConnectWallet}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2.5 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
                >
                  <Wallet
                    className={`h-4 w-4 ${
                      isGreenMode ? 'text-emerald-100' : 'text-cyan-100'
                    }`}
                  />
                  <span>Connect BNB Wallet</span>
                </button>
              ) : wrongNetwork ? (
                <button
                  type="button"
                  onClick={onSwitchToBsc}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]"
                >
                  Switch to BNB Smart Chain (56)
                </button>
              ) : tamiInputWei <= 0n ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
                >
                  Enter TAMIYANOIA amount
                </button>
              ) : insufficientTami ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
                >
                  Insufficient {action === 'stake' ? 'Wallet' : 'Staked'} Balance
                </button>
              ) : action === 'unstake' && isTamiLocked ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-amber-300 uppercase"
                >
                  Locked until{' '}
                  {new Date(tamiState.userUnlockTime * 1000).toLocaleDateString()}
                </button>
              ) : checkingAllowance ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center gap-2 px-4 py-3.5 text-xs font-bold tracking-widest text-slate-300 uppercase"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Checking Approval...</span>
                </button>
              ) : needsTamiApproval ? (
                <button
                  type="button"
                  onClick={() => handleApproveTami(tamiInputWei, 'approve')}
                  disabled={txPending !== null}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
                >
                  {txPending === 'approve' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Approving TAMIYANOIA...</span>
                    </>
                  ) : (
                    <span>Approve TAMIYANOIA</span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleTamiStakeOrUnstake}
                  disabled={txPending !== null}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
                >
                  {txPending === 'stake' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {action === 'stake' ? 'Staking TAMIYANOIA...' : 'Unstaking...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Coins className="h-4 w-4" />
                      <span>
                        {action === 'stake'
                          ? 'Stake TAMIYANOIA'
                          : 'Unstake TAMIYANOIA'}
                      </span>
                    </>
                  )}
                </button>
              )}

              {/* Owner Controls (Reward Funding & Fee Switch) */}
              {isOwnerWallet && (
                <div className="armor-well-rim relative z-10 mt-4">
                  <div className="armor-well space-y-3 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold tracking-wider text-amber-300 uppercase">
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>Owner: Add TAMIYANOIA Rewards</span>
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        Admin Wallet
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={fundAmountStr}
                        onChange={(e) => setFundAmountStr(e.target.value)}
                        placeholder="Reward TAMI"
                        className="col-span-2 border border-slate-700 bg-[#050a14] px-2.5 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                      />
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={fundDurationDays}
                        onChange={(e) => setFundDurationDays(e.target.value)}
                        placeholder="Days"
                        className="border border-slate-700 bg-[#050a14] px-2.5 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={fundAmountWei <= 0n || txPending !== null}
                      onClick={() =>
                        needsFundApproval
                          ? handleApproveTami(fundAmountWei, 'fund-approve')
                          : handleOwnerFundRewards()
                      }
                      className="combat-energy-btn w-full px-3 py-2.5 font-display text-[11px] font-extrabold tracking-wider text-white uppercase disabled:opacity-45"
                    >
                      {txPending === 'fund-approve'
                        ? 'Approving Rewards...'
                        : txPending === 'fund'
                        ? 'Depositing Rewards...'
                        : needsFundApproval
                        ? '1. Approve Reward TAMIYANOIA'
                        : `Deposit Rewards (${fundDurationDays || 30} Days)`}
                    </button>

                    <div className="flex items-center justify-between gap-2 border-t border-slate-700/60 pt-2.5">
                      <span className="text-[11px] text-slate-300">
                        Treasury stake fee:
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={txPending !== null}
                          onClick={() => handleToggleFee(0)}
                          className={`px-2.5 py-1 font-mono text-[10px] font-bold transition-all ${
                            tamiState.stakeFeeBps === 0
                              ? 'combat-energy-btn text-white'
                              : 'combat-steel-btn text-slate-300'
                          }`}
                        >
                          0%
                        </button>
                        <button
                          type="button"
                          disabled={txPending !== null}
                          onClick={() => handleToggleFee(25)}
                          className={`px-2.5 py-1 font-mono text-[10px] font-bold transition-all ${
                            tamiState.stakeFeeBps === 25
                              ? 'combat-energy-btn text-white'
                              : 'combat-steel-btn text-slate-300'
                          }`}
                        >
                          0.25%
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Pre-Deployment TAMIYANOIA Staking View */
            <div className="relative z-10 space-y-3.5">
              <div className="armor-well-rim">
                <div className="armor-well space-y-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-xs sm:text-sm font-bold tracking-wider text-white uppercase">
                      TAMIYANOIA Staking — Launching Soon
                    </span>
                    <a
                      href={`https://bscscan.com/token/${TAMIYANOIA_ADDRESS}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 font-mono text-[11px] hover:underline ${
                        isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                      }`}
                    >
                      <span>Token Info</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300">
                    Lock your{' '}
                    <span className="font-semibold text-white">TAMIYANOIA</span> tokens
                    here to earn extra TAMIYANOIA rewards while holding. Withdraw your
                    tokens anytime with zero lockup!
                  </p>

                  {tamiPair && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-2.5 text-[11px]">
                      <span className="text-slate-400">Current Swap Rate</span>
                      <span className="font-mono font-semibold text-slate-100 tabular-nums">
                        1 BNB ≈ {formatAmount(String(tamiPair.tamiPerBnb), 0)} TAMIYANOIA
                      </span>
                    </div>
                  )}

                  {onBuyTamiyanoia && (
                    <button
                      type="button"
                      onClick={onBuyTamiyanoia}
                      className="combat-energy-btn font-display flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-extrabold tracking-wider text-white uppercase"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                      <span>Buy TAMIYANOIA on Swap</span>
                    </button>
                  )}
                </div>
              </div>

              {txError && (
                <div className="border border-red-500/50 bg-red-950/40 px-3.5 py-2 text-xs text-red-200">
                  {txError}
                </div>
              )}

              {/* Subtle Owner Setup Toggle (Auto-shown for owner wallet 0xcd4B...846c) */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowOwnerSetup((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400 transition-colors hover:text-slate-200"
                >
                  <KeyRound className="h-3 w-3" />
                  <span>
                    {showOwnerSetup || isOwnerWallet
                      ? 'Hide Owner Launch Panel'
                      : 'Project Owner? Launch TAMIYANOIA Staking'}
                  </span>
                </button>
              </div>

              {(showOwnerSetup || isOwnerWallet) && (
                <div className="armor-well-rim">
                  <div className="armor-well space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-xs font-bold tracking-wider text-amber-300 uppercase">
                        Owner: 1-Click Launch TAMIYANOIA Vault
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">
                      Click below to launch your own{' '}
                      <span className="font-mono text-white">TAMIYANOIA</span> staking
                      contract directly from your wallet on BNB Smart Chain (~$2 gas).
                      Owner &amp; treasury are set to{' '}
                      <span className="font-mono text-slate-100">
                        {PLATFORM_FEE_RECIPIENT.slice(0, 6)}...
                        {PLATFORM_FEE_RECIPIENT.slice(-4)}
                      </span>
                      .
                    </p>

                    {!walletAddress ? (
                      <button
                        type="button"
                        onClick={onConnectWallet}
                        className="combat-energy-btn font-display flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-extrabold tracking-wider text-white uppercase"
                      >
                        <Wallet className="h-4 w-4" />
                        <span>Connect Owner Wallet</span>
                      </button>
                    ) : wrongNetwork ? (
                      <button
                        type="button"
                        onClick={onSwitchToBsc}
                        className="combat-energy-btn font-display flex w-full items-center justify-center px-4 py-3 text-xs font-extrabold tracking-wider text-white uppercase"
                      >
                        Switch to BNB Smart Chain (56)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleOneClickDeploy}
                        disabled={txPending !== null}
                        className="combat-energy-btn font-display flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-extrabold tracking-wider text-white uppercase disabled:opacity-60"
                      >
                        {txPending === 'deploy' ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Deploying Vault on BSC...</span>
                          </>
                        ) : (
                          <>
                            <Rocket className="h-4 w-4" />
                            <span>1-Click Deploy TAMIYANOIA Vault</span>
                          </>
                        )}
                      </button>
                    )}

                    <div className="border-t border-slate-700/60 pt-2.5">
                      <div className="mb-1.5 text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                        Or paste already-deployed contract address:
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={bindAddressInput}
                          onChange={(e) => {
                            setBindAddressInput(e.target.value);
                            setBindError(null);
                          }}
                          placeholder="0x... TamiyanoiaStaking address"
                          className="min-w-0 flex-1 border border-slate-700 bg-[#050a14] px-2.5 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleBindTamiContract}
                          className="combat-steel-btn shrink-0 px-3 py-2 font-display text-[11px] font-bold tracking-wider text-white uppercase"
                        >
                          Connect
                        </button>
                      </div>
                      {bindError && (
                        <div className="mt-1.5 text-[11px] text-red-300">{bindError}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Transaction Receipt */}
          {(txStatusText || txHash) && (
            <div className="armor-well-rim relative z-10 mt-4">
              <div className="armor-well p-3.5 text-xs">
                {txStatusText && (
                  <div
                    className={`font-medium ${
                      isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                    }`}
                  >
                    {txStatusText}
                  </div>
                )}
                {txHash && (
                  <a
                    href={`https://bscscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] hover:text-white hover:underline ${
                      isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                    }`}
                  >
                    <span>
                      View on BscScan ({txHash.slice(0, 10)}...{txHash.slice(-6)})
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
