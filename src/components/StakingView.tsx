import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { motion } from 'motion/react';
import {
  ArrowDownUp,
  ArrowRightLeft,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  Gift,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  BSC_CHAIN_ID,
  PLATFORM_FEE_RECIPIENT,
  TAMIYANOIA_ADDRESS,
  THENA_ROUTER_V2_ADDRESS,
} from '../data/swapTokens';
import {
  approveTokenForRouter,
  executeOnChainSwap,
  fetchAllowance,
  fetchOnChainQuote,
  fetchWalletBalances,
  OnChainQuote,
} from '../utils/bscWeb3';
import {
  BNB_STAKING_POOLS,
  claimTamiyanoiaReward,
  fetchLiveBnbStakingStats,
  fetchTamiPairSnapshot,
  fetchTamiStakingState,
  fundTamiyanoiaRewards,
  getEffectiveTamiStakingAddress,
  NATIVE_BNB_TOKEN,
  saveLocalTamiStakingAddress,
  stakeTamiyanoia,
  StakingPoolStats,
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

type PoolSelection = 'tamiyanoia' | 'slisbnb' | 'bnbx';
type StakeAction = 'stake' | 'unstake';

function formatAmount(rawStr: string, maxDecimals = 6): string {
  const num = Number(rawStr);
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num < 0.000001) return '<0.000001';
  const digits = num >= 1_000_000 ? 0 : num >= 1_000 ? 2 : num >= 1 ? 4 : maxDecimals;
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTvlCompact(tvlUsd: number | null, pooledBnb: number | null): string {
  if (tvlUsd && tvlUsd > 0) {
    if (tvlUsd >= 1_000_000_000) return `$${(tvlUsd / 1_000_000_000).toFixed(2)}B`;
    if (tvlUsd >= 1_000_000) return `$${(tvlUsd / 1_000_000).toFixed(1)}M`;
    if (tvlUsd >= 1_000) return `$${(tvlUsd / 1_000).toFixed(0)}K`;
    return `$${tvlUsd.toFixed(0)}`;
  }
  if (pooledBnb && pooledBnb > 0) {
    return `${Math.round(pooledBnb).toLocaleString()} BNB`;
  }
  return 'Live BSC';
}

function computeMinReceivedWei(amountOutWei: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  const keepBps = 10000n - bps;
  return (amountOutWei * (keepBps > 0n ? keepBps : 0n)) / 10000n;
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
  const [selectedPoolId, setSelectedPoolId] = useState<PoolSelection>('tamiyanoia');
  const [action, setAction] = useState<StakeAction>('stake');
  const [amountStr, setAmountStr] = useState('0.1');
  const [tamiAmountStr, setTamiAmountStr] = useState('');

  const [tamiContractAddr, setTamiContractAddr] = useState<string>(() =>
    getEffectiveTamiStakingAddress()
  );
  const [bindAddressInput, setBindAddressInput] = useState('');
  const [bindError, setBindError] = useState<string | null>(null);
  const [showOwnerSetup, setShowOwnerSetup] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [tamiState, setTamiState] = useState<TamiStakingOnChainState | null>(null);
  const [tamiPair, setTamiPair] = useState<TamiPairSnapshot | null>(null);
  const [loadingTami, setLoadingTami] = useState(true);

  const [fundAmountStr, setFundAmountStr] = useState('');
  const [fundDurationDays, setFundDurationDays] = useState('30');

  const [statsMap, setStatsMap] = useState<Record<string, StakingPoolStats>>({});
  const [loadingStats, setLoadingStats] = useState(true);

  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [quote, setQuote] = useState<OnChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [allowanceWei, setAllowanceWei] = useState<bigint>(ethers.MaxUint256);
  const [tamiAllowanceWei, setTamiAllowanceWei] = useState<bigint>(0n);
  const [checkingAllowance, setCheckingAllowance] = useState(false);

  const [txPending, setTxPending] = useState<
    'approve' | 'stake' | 'claim' | 'fund-approve' | 'fund' | null
  >(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatusText, setTxStatusText] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const slippagePct = 0.5;
  const deadlineMin = 20;

  const isTamiSelected = selectedPoolId === 'tamiyanoia';
  const activeBnbPool = useMemo(
    () =>
      BNB_STAKING_POOLS.find((p) => p.id === selectedPoolId) || BNB_STAKING_POOLS[0],
    [selectedPoolId]
  );

  const poolStats = statsMap[activeBnbPool.id];
  const tokenIn = action === 'stake' ? NATIVE_BNB_TOKEN : activeBnbPool.token;
  const tokenOut = action === 'stake' ? activeBnbPool.token : NATIVE_BNB_TOKEN;

  const tokenSymbolMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of BNB_STAKING_POOLS) {
      map[p.token.address.toLowerCase()] = p.token.symbol;
    }
    return map;
  }, []);

  const wrongNetwork =
    Boolean(walletAddress) && chainId !== null && chainId !== BSC_CHAIN_ID;

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const next = await fetchLiveBnbStakingStats();
      setStatsMap(next);
    } finally {
      setLoadingStats(false);
    }
  }, []);

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
    void loadStats();
  }, [loadStats]);

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
      const tokens = [
        TAMIYANOIA_TOKEN,
        NATIVE_BNB_TOKEN,
        ...BNB_STAKING_POOLS.map((p) => p.token),
      ];
      const next = await fetchWalletBalances(walletAddress, tokens);
      setBalances(next);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // Balance lookups
  const bnbBalanceStr = balances['NATIVE_BNB'] ?? '0';
  const tamiWalletBalanceStr =
    balances[TAMIYANOIA_ADDRESS.toLowerCase()] ?? '0';
  const stakedBnbTokenBalanceStr =
    balances[activeBnbPool.token.address.toLowerCase()] ?? '0';
  const bnbFlowBalanceInStr =
    action === 'stake' ? bnbBalanceStr : stakedBnbTokenBalanceStr;

  const stakedBnbValue = useMemo(() => {
    const bal = Number(stakedBnbTokenBalanceStr);
    const rate = poolStats?.bnbPerToken;
    if (!Number.isFinite(bal) || bal <= 0 || !rate) return null;
    return bal * rate;
  }, [stakedBnbTokenBalanceStr, poolStats?.bnbPerToken]);

  // Parsed amounts
  const amountInWei = useMemo(() => {
    if (isTamiSelected) return 0n;
    const clean = amountStr.trim();
    if (!clean || Number.isNaN(Number(clean)) || Number(clean) <= 0) return 0n;
    try {
      return ethers.parseUnits(clean, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [isTamiSelected, amountStr, tokenIn.decimals]);

  const bnbFlowBalanceInWei = useMemo(() => {
    try {
      return ethers.parseUnits(bnbFlowBalanceInStr || '0', tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [bnbFlowBalanceInStr, tokenIn.decimals]);

  const tamiInputWei = useMemo(() => {
    const clean = tamiAmountStr.trim();
    if (!clean || Number.isNaN(Number(clean)) || Number(clean) <= 0) return 0n;
    try {
      return ethers.parseUnits(clean, 18);
    } catch {
      return 0n;
    }
  }, [tamiAmountStr]);

  const tamiWalletBalanceWei = useMemo(() => {
    try {
      return ethers.parseUnits(tamiWalletBalanceStr || '0', 18);
    } catch {
      return 0n;
    }
  }, [tamiWalletBalanceStr]);

  const fundAmountWei = useMemo(() => {
    const clean = fundAmountStr.trim();
    if (!clean || Number.isNaN(Number(clean)) || Number(clean) <= 0) return 0n;
    try {
      return ethers.parseUnits(clean, 18);
    } catch {
      return 0n;
    }
  }, [fundAmountStr]);

  // Allowance check for BNB Liquid Staking (unstake)
  const refreshAllowance = useCallback(async () => {
    if (isTamiSelected || !walletAddress || tokenIn.isNative || amountInWei <= 0n) {
      setAllowanceWei(ethers.MaxUint256);
      return;
    }
    const spender = quote?.routerAddress || THENA_ROUTER_V2_ADDRESS;
    setCheckingAllowance(true);
    try {
      const current = await fetchAllowance(tokenIn.address, walletAddress, spender);
      setAllowanceWei(current);
    } finally {
      setCheckingAllowance(false);
    }
  }, [isTamiSelected, walletAddress, tokenIn, amountInWei, quote?.routerAddress]);

  useEffect(() => {
    void refreshAllowance();
  }, [refreshAllowance]);

  // Allowance check for TAMIYANOIA Staking Contract
  const refreshTamiAllowance = useCallback(async () => {
    if (
      !isTamiSelected ||
      !walletAddress ||
      !tamiState?.isValidContract ||
      !tamiState.contractAddress
    ) {
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
  }, [isTamiSelected, walletAddress, tamiState?.isValidContract, tamiState?.contractAddress]);

  useEffect(() => {
    void refreshTamiAllowance();
  }, [refreshTamiAllowance]);

  // Live quote for BNB liquid staking
  useEffect(() => {
    if (isTamiSelected) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    if (amountInWei <= 0n) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }

    setQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const nextQuote = await fetchOnChainQuote({
          tokenIn,
          tokenOut,
          amountInWei,
          mode: 'auto',
          tokenSymbolMap,
        });
        if (!cancelled) setQuote(nextQuote);
      } catch (err: unknown) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(
            err instanceof Error
              ? err.message
              : 'Unable to fetch on-chain staking route.'
          );
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isTamiSelected, tokenIn, tokenOut, amountInWei, tokenSymbolMap]);

  const insufficientBnbFlow =
    !isTamiSelected && Boolean(walletAddress) && amountInWei > bnbFlowBalanceInWei;
  const needsBnbApproval =
    !isTamiSelected &&
    !tokenIn.isNative &&
    amountInWei > 0n &&
    allowanceWei < amountInWei;

  const minReceivedWei = useMemo(() => {
    if (!quote) return 0n;
    return computeMinReceivedWei(quote.amountOutWei, slippagePct);
  }, [quote, slippagePct]);

  const exchangeRate = useMemo(() => {
    if (!quote || amountInWei <= 0n) return 0;
    const inFloat = Number(ethers.formatUnits(amountInWei, tokenIn.decimals));
    const outFloat = Number(quote.amountOutFormatted);
    if (!inFloat || !outFloat) return 0;
    return outFloat / inFloat;
  }, [quote, amountInWei, tokenIn.decimals]);

  // TAMIYANOIA derived checks
  const tamiAvailableWei =
    action === 'stake'
      ? tamiWalletBalanceWei
      : tamiState?.userStakedWei ?? 0n;
  const tamiAvailableStr = ethers.formatUnits(tamiAvailableWei, 18);
  const insufficientTami =
    isTamiSelected && Boolean(walletAddress) && tamiInputWei > tamiAvailableWei;
  const needsTamiApproval =
    isTamiSelected &&
    action === 'stake' &&
    Boolean(tamiState?.isValidContract) &&
    tamiInputWei > 0n &&
    tamiAllowanceWei < tamiInputWei;
  const needsFundApproval =
    isTamiSelected &&
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

    if (isTamiSelected) {
      if (tamiAvailableWei <= 0n) {
        setTamiAmountStr('0');
        return;
      }
      const usable = (tamiAvailableWei * BigInt(num)) / BigInt(den);
      const formatted = ethers.formatUnits(usable, 18);
      setTamiAmountStr(num === 1 && den === 1 ? formatted : formatted.replace(/\.?0+$/, '') || '0');
      return;
    }

    if (bnbFlowBalanceInWei <= 0n) {
      setAmountStr('0');
      return;
    }
    let usable = (bnbFlowBalanceInWei * BigInt(num)) / BigInt(den);
    if (tokenIn.isNative && num === 1 && den === 1) {
      const gasBuffer = ethers.parseEther('0.003');
      usable = bnbFlowBalanceInWei > gasBuffer ? bnbFlowBalanceInWei - gasBuffer : 0n;
    }
    const formatted = ethers.formatUnits(usable, tokenIn.decimals);
    const trimmed = Number(formatted).toFixed(6).replace(/\.?0+$/, '');
    setAmountStr(trimmed || '0');
  }

  async function handleCopyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // ignore clipboard permissions
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
        'No valid TamiyanoiaStaking contract found at that address on BNB Smart Chain (Chain 56).'
      );
      return;
    }
    saveLocalTamiStakingAddress(normalized);
    setTamiContractAddr(normalized);
    setTamiState(stateCheck);
    setBindAddressInput('');
    setTxStatusText('TAMIYANOIA Staking contract verified and activated!');
  }

  // BNB Liquid Staking handlers
  async function handleApproveBnbToken() {
    if (!provider || !walletAddress || !quote) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('approve');
    setTxStatusText(`Approving ${tokenIn.symbol} for BNB unstaking...`);
    try {
      const receipt = await approveTokenForRouter(
        provider,
        tokenIn.address,
        amountInWei,
        quote.routerAddress
      );
      if (receipt?.hash) setTxHash(receipt.hash);
      setTxStatusText(`${tokenIn.symbol} approved. Ready to unstake to BNB.`);
      await refreshAllowance();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Approval transaction failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleExecuteBnbStakeAction() {
    if (!provider || !walletAddress || !quote) return;
    setTxError(null);
    setTxHash(null);
    setTxPending('stake');
    setTxStatusText(
      action === 'stake'
        ? `Confirm BNB staking (${amountStr} BNB → ${activeBnbPool.token.symbol}) in wallet...`
        : `Confirm unstaking (${amountStr} ${activeBnbPool.token.symbol} → BNB) in wallet...`
    );
    try {
      const tx = await executeOnChainSwap({
        ethereum: provider,
        tokenIn,
        tokenOut,
        amountInWei,
        amountOutMinWei: minReceivedWei,
        quote,
        deadlineMinutes: deadlineMin,
        slippagePct,
      });
      setTxHash(tx.hash);
      setTxStatusText('Transaction broadcast on BNB Chain. Waiting for confirmation...');
      await tx.wait();
      setTxStatusText(
        action === 'stake'
          ? `Staked ${amountStr} BNB into ${activeBnbPool.token.symbol}.`
          : `Unstaked ${amountStr} ${activeBnbPool.token.symbol} back to BNB.`
      );
      await Promise.all([refreshBalances(), refreshAllowance(), loadStats()]);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Staking transaction failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  // TAMIYANOIA Staking handlers
  async function handleApproveTami(amountToApprove: bigint, mode: 'approve' | 'fund-approve') {
    if (!provider || !walletAddress || !tamiState?.contractAddress) return;
    setTxError(null);
    setTxHash(null);
    setTxPending(mode);
    setTxStatusText('Approving TAMIYANOIA for staking contract...');
    try {
      const receipt = await approveTokenForRouter(
        provider,
        TAMIYANOIA_ADDRESS,
        amountToApprove,
        tamiState.contractAddress
      );
      if (receipt?.hash) setTxHash(receipt.hash);
      setTxStatusText('TAMIYANOIA approved on BNB Smart Chain.');
      await refreshTamiAllowance();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Approval failed.');
      setTxStatusText(null);
    } finally {
      setTxPending(null);
    }
  }

  async function handleTamiStakeOrUnstake() {
    if (!provider || !walletAddress || !tamiState?.contractAddress || tamiInputWei <= 0n)
      return;
    setTxError(null);
    setTxHash(null);
    setTxPending('stake');
    setTxStatusText(
      action === 'stake'
        ? `Confirm staking ${formatAmount(tamiAmountStr)} TAMIYANOIA in wallet...`
        : `Confirm unstaking ${formatAmount(tamiAmountStr)} TAMIYANOIA in wallet...`
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
          ? `Staked ${formatAmount(tamiAmountStr)} TAMIYANOIA.`
          : `Unstaked ${formatAmount(tamiAmountStr)} TAMIYANOIA.`
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
    setTxStatusText('Claiming earned TAMIYANOIA rewards...');
    try {
      const tx = await claimTamiyanoiaReward(provider, tamiState.contractAddress);
      setTxHash(tx.hash);
      setTxStatusText('Claim transaction sent. Waiting for confirmation...');
      await tx.wait();
      setTxStatusText('TAMIYANOIA rewards claimed to your wallet!');
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
    setTxStatusText(`Funding ${formatAmount(fundAmountStr)} TAMIYANOIA rewards for ${days} days...`);
    try {
      const tx = await fundTamiyanoiaRewards(
        provider,
        tamiState.contractAddress,
        fundAmountWei,
        days
      );
      setTxHash(tx.hash);
      setTxStatusText('Funding transaction broadcast. Waiting for confirmation...');
      await tx.wait();
      setTxStatusText(`Funded ${formatAmount(fundAmountStr)} TAMIYANOIA rewards over ${days} days!`);
      setFundAmountStr('');
      await Promise.all([refreshBalances(), refreshTamiAllowance(), loadTamiData()]);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Funding rewards failed.');
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
            <div>
              <h1 className="font-display chrome-text text-xl sm:text-2xl font-extrabold tracking-widest uppercase">
                TamiSwap Staking
              </h1>
              <p className="mt-1 text-xs text-slate-300">
                Put your tokens to work and earn rewards — withdraw anytime
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadTamiData();
                void loadStats();
                void refreshBalances();
              }}
              disabled={loadingStats || loadingBalances || loadingTami}
              title="Refresh staking pools and balances"
              className={`combat-steel-btn p-2.5 text-slate-200 disabled:opacity-50 ${
                isGreenMode ? 'hover:text-emerald-300' : 'hover:text-cyan-300'
              }`}
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loadingStats || loadingBalances || loadingTami
                    ? `animate-spin ${isGreenMode ? 'text-emerald-300' : 'text-cyan-300'}`
                    : ''
                }`}
              />
            </button>
          </div>

          {/* Pool Selector: Featured TAMIYANOIA + BNB Liquid Pools */}
          <div className="armor-well-rim relative z-10 mb-3.5">
            <div className="armor-well space-y-1.5 p-1.5">
              {/* #1 Native TAMIYANOIA Pool */}
              <button
                type="button"
                onClick={() => {
                  setSelectedPoolId('tamiyanoia');
                  setTxHash(null);
                  setTxError(null);
                  setTxStatusText(null);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-all ${
                  isTamiSelected
                    ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                    : isGreenMode
                    ? 'border border-emerald-500/25 text-slate-200 hover:border-emerald-500/50 hover:text-white'
                    : 'border border-sky-500/25 text-slate-200 hover:border-sky-500/50 hover:text-white'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <TokenLogo token={TAMIYANOIA_TOKEN} size={26} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-extrabold tracking-wide">
                      <span>TAMIYANOIA</span>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 font-display text-[9px] font-bold tracking-wider uppercase ${
                          isTamiSelected
                            ? 'bg-white/15 text-white'
                            : isGreenMode
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-cyan-500/20 text-cyan-300'
                        }`}
                      >
                        Native Token
                      </span>
                    </span>
                    <span className="block truncate text-[10px] text-slate-300">
                      Stake TAMIYANOIA · Earn TAMIYANOIA Rewards
                    </span>
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] font-bold tabular-nums ${
                    isTamiSelected
                      ? 'text-white'
                      : isGreenMode
                      ? 'text-emerald-300'
                      : 'text-cyan-300'
                  }`}
                >
                  {tamiState?.isValidContract
                    ? tamiState.apyPct && tamiState.apyPct > 0
                      ? `${tamiState.apyPct.toFixed(1)}% APY`
                      : 'Live'
                    : 'Soon'}
                </span>
              </button>

              {/* BNB Liquid Staking Pools */}
              <div className="grid grid-cols-2 gap-1.5">
                {BNB_STAKING_POOLS.map((pool) => {
                  const isActive = !isTamiSelected && pool.id === activeBnbPool.id;
                  const s = statsMap[pool.id];
                  return (
                    <button
                      key={pool.id}
                      type="button"
                      onClick={() => {
                        setSelectedPoolId(pool.id);
                        setTxHash(null);
                        setTxError(null);
                        setTxStatusText(null);
                      }}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? 'combat-energy-btn text-white drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)]'
                          : isGreenMode
                          ? 'border border-transparent text-slate-300 hover:border-emerald-500/35 hover:text-white'
                          : 'border border-transparent text-slate-300 hover:border-sky-500/35 hover:text-white'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <TokenLogo token={pool.token} size={22} />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs font-bold">
                            {pool.token.symbol}
                          </span>
                          <span className="block truncate text-[10px] text-slate-300">
                            {pool.protocolName}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[11px] font-bold tabular-nums ${
                          isActive
                            ? 'text-white'
                            : isGreenMode
                            ? 'text-emerald-300'
                            : 'text-cyan-300'
                        }`}
                      >
                        {s?.apyPct && s.apyPct > 0 ? `${s.apyPct.toFixed(2)}%` : 'Live'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {isTamiSelected ? (
            <>
              {/* TAMIYANOIA Live Metrics Row */}
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
                          : '0% (No Rewards)'
                        : 'Soon'}
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                      {tamiState?.isValidContract ? 'Total Staked' : 'Swap LP Pool'}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                      {loadingTami && !tamiState
                        ? '...'
                        : tamiState?.isValidContract
                        ? `${formatAmount(ethers.formatUnits(tamiState.totalStakedWei, 18), 2)} TAMI`
                        : tamiPair
                        ? `${tamiPair.pooledBnb.toFixed(2)} BNB`
                        : 'PancakeSwap V2'}
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                      {tamiState?.isValidContract ? 'Your Staked' : 'Wallet TAMI'}
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

                  {/* TAMIYANOIA Amount Chamber */}
                  <div className="armor-well-rim relative z-10">
                    <div className="armor-well p-3.5 sm:p-4">
                      <div className="mb-2.5 flex items-center justify-between text-xs">
                        <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                          {action === 'stake' ? 'TAMIYANOIA to Stake' : 'TAMIYANOIA to Unstake'}
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

                  {/* Earned Rewards + Claim Bar */}
                  <div className="armor-well-rim relative z-10 mt-3.5">
                    <div className="armor-well flex items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          <Gift
                            className={`h-3.5 w-3.5 ${
                              isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                            }`}
                          />
                          <span>Claimable TAMIYANOIA Rewards</span>
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
                        className="combat-steel-btn shrink-0 px-3 py-2 font-display text-[11px] font-bold tracking-wider text-white uppercase disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {txPending === 'claim' ? 'Claiming...' : 'Claim'}
                      </button>
                    </div>
                  </div>

                  {/* Pool Details */}
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
                      <span className="text-slate-400">Reward reserve in vault</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        {formatAmount(
                          ethers.formatUnits(tamiState.rewardReserveWei, 18),
                          2
                        )}{' '}
                        TAMIYANOIA
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Staking fee</span>
                      <span className="font-mono text-slate-200">
                        {((action === 'stake' ? tamiState.stakeFeeBps : tamiState.unstakeFeeBps) / 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Staking contract</span>
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

                  {/* Primary CTA */}
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
                      Locked until {new Date(tamiState.userUnlockTime * 1000).toLocaleDateString()}
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

                  {/* Owner Reward Funder Panel (only visible to owner / treasury wallet) */}
                  {isOwnerWallet && (
                    <div className="armor-well-rim relative z-10 mt-4">
                      <div className="armor-well space-y-2.5 p-3.5">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold tracking-wider text-amber-300 uppercase">
                            <KeyRound className="h-3.5 w-3.5" />
                            <span>Owner Reward Funding</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            Admin Only
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
                          className="combat-steel-btn w-full px-3 py-2 font-display text-[11px] font-bold tracking-wider text-white uppercase disabled:opacity-45"
                        >
                          {txPending === 'fund-approve'
                            ? 'Approving Rewards...'
                            : txPending === 'fund'
                            ? 'Funding Rewards...'
                            : needsFundApproval
                            ? '1. Approve Reward TAMIYANOIA'
                            : `Fund Rewards (${fundDurationDays || 30} Days)`}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Pre-Deployment TAMIYANOIA Card (Layman-Friendly + Collapsible Owner Setup) */
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
                        Soon you&apos;ll be able to lock your <span className="font-semibold text-white">TAMIYANOIA</span> tokens
                        right here to earn extra TAMIYANOIA rewards. While the vault is being
                        finalized, you can buy TAMIYANOIA or stake your BNB right now to earn
                        live rewards!
                      </p>

                      {tamiPair && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-2.5 text-[11px]">
                          <span className="text-slate-400">Current Swap Rate</span>
                          <span className="font-mono font-semibold text-slate-100 tabular-nums">
                            1 BNB ≈ {formatAmount(String(tamiPair.tamiPerBnb), 0)} TAMIYANOIA
                          </span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                        {onBuyTamiyanoia && (
                          <button
                            type="button"
                            onClick={onBuyTamiyanoia}
                            className="combat-energy-btn font-display flex items-center justify-center gap-1.5 px-3 py-3 text-[11px] font-extrabold tracking-wider text-white uppercase"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            <span>Buy TAMIYANOIA</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedPoolId('slisbnb')}
                          className="combat-steel-btn font-display flex items-center justify-center gap-1.5 px-3 py-3 text-[11px] font-bold tracking-wider text-slate-100 uppercase"
                        >
                          <Coins className="h-3.5 w-3.5" />
                          <span>Stake BNB Now</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Subtle Owner Toggle so Regular Users Aren't Confused */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowOwnerSetup((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400 transition-colors hover:text-slate-200"
                    >
                      <KeyRound className="h-3 w-3" />
                      <span>
                        {showOwnerSetup || isOwnerWallet
                          ? 'Hide Owner Contract Setup'
                          : 'Project Owner? Connect Staking Contract'}
                      </span>
                    </button>
                  </div>

                  {(showOwnerSetup || isOwnerWallet) && (
                    <div className="armor-well-rim">
                      <div className="armor-well space-y-2.5 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-[11px] font-bold tracking-wider text-slate-200 uppercase">
                            Owner: Connect Deployed Staking Contract
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowDeployGuide((prev) => !prev)}
                            className={`font-mono text-[11px] font-semibold hover:underline ${
                              isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                            }`}
                          >
                            {showDeployGuide ? 'Hide Deploy Info' : 'Deploy Guide'}
                          </button>
                        </div>

                        {showDeployGuide && (
                          <div className="space-y-2 border border-slate-700/70 bg-[#050a14]/90 p-2.5 text-[11px] text-slate-300">
                            <div>
                              1. Open{' '}
                              <span className="font-mono text-white">remix.ethereum.org</span>{' '}
                              with{' '}
                              <span className="font-mono text-white">TamiyanoiaStaking.sol</span>{' '}
                              and select <span className="text-white">BNB Smart Chain</span>.
                            </div>
                            <div>2. Deploy with these 3 constructor addresses:</div>
                            <div className="space-y-1 font-mono text-[10px]">
                              {[
                                {
                                  key: 'token',
                                  label: '_stakingToken',
                                  val: TAMIYANOIA_ADDRESS,
                                },
                                {
                                  key: 'treasury',
                                  label: '_treasury',
                                  val: PLATFORM_FEE_RECIPIENT,
                                },
                                {
                                  key: 'owner',
                                  label: '_initialOwner',
                                  val: PLATFORM_FEE_RECIPIENT,
                                },
                              ].map((item) => (
                                <div
                                  key={item.key}
                                  className="flex items-center justify-between gap-2 border border-slate-800 bg-[#070f1d] px-2 py-1"
                                >
                                  <span className="truncate">
                                    <span className="text-slate-400">{item.label}: </span>
                                    <span className="text-slate-100">{item.val}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyValue(item.key, item.val)}
                                    className="shrink-0 text-slate-300 hover:text-white"
                                  >
                                    {copiedField === item.key ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div>
                              3. Paste the deployed contract address below to activate staking.
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={bindAddressInput}
                            onChange={(e) => {
                              setBindAddressInput(e.target.value);
                              setBindError(null);
                            }}
                            placeholder="0x... deployed TamiyanoiaStaking address"
                            className="min-w-0 flex-1 border border-slate-700 bg-[#050a14] px-2.5 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleBindTamiContract}
                            className="combat-steel-btn shrink-0 px-3 py-2 font-display text-[11px] font-bold tracking-wider text-white uppercase"
                          >
                            Activate
                          </button>
                        </div>
                        {bindError && (
                          <div className="text-[11px] text-red-300">{bindError}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* BNB Liquid Staking Pools (slisBNB / BNBx) */
            <>
              {/* Live Pool Metrics Row */}
              <div className="armor-well-rim relative z-10 mb-3.5">
                <div className="armor-well grid grid-cols-3 divide-x divide-slate-700/60 px-2 py-2.5 text-center">
                  <div className="px-1">
                    <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                      Live APY
                    </div>
                    <div
                      className={`mt-0.5 font-mono text-xs sm:text-sm font-bold tabular-nums ${
                        isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                      }`}
                    >
                      {loadingStats && !poolStats
                        ? '...'
                        : poolStats?.apyPct && poolStats.apyPct > 0
                        ? `${poolStats.apyPct.toFixed(2)}%`
                        : 'Validator Yield'}
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                      Pool Liquidity
                    </div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                      {loadingStats && !poolStats
                        ? '...'
                        : formatTvlCompact(
                            poolStats?.tvlUsd ?? null,
                            poolStats?.totalPooledBnb ?? null
                          )}
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                      Your Staked
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
                      {walletAddress
                        ? `${formatAmount(stakedBnbTokenBalanceStr, 4)} ${activeBnbPool.token.symbol}`
                        : '—'}
                    </div>
                    {walletAddress && stakedBnbValue !== null && stakedBnbValue > 0 && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                        ≈ {formatAmount(String(stakedBnbValue), 4)} BNB
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Layman Helper Note */}
              <div className="relative z-10 mb-3 px-1 text-[11px] leading-relaxed text-slate-300">
                {action === 'stake'
                  ? `Put BNB in to get ${activeBnbPool.token.symbol}, which automatically grows in BNB value over time. Swap back anytime to collect rewards.`
                  : `Swap your ${activeBnbPool.token.symbol} back into regular BNB + your earned staking rewards anytime.`}
              </div>

              {/* Stake / Unstake Toggle */}
              <div className="armor-well-rim relative z-10 mb-3.5">
                <div className="armor-well grid grid-cols-2 gap-1 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAction('stake');
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
                    Stake BNB
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAction('unstake');
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
                    Unstake to BNB
                  </button>
                </div>
              </div>

              {/* Input Chamber */}
              <div className="armor-well-rim relative z-10">
                <div className="armor-well p-3.5 sm:p-4">
                  <div className="mb-2.5 flex items-center justify-between text-xs">
                    <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                      {action === 'stake' ? 'Amount to Stake' : 'Amount to Unstake'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-300 tabular-nums">
                        {walletAddress
                          ? `Bal: ${formatAmount(bnbFlowBalanceInStr)}`
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
                      value={amountStr}
                      onChange={(e) => {
                        setAmountStr(e.target.value);
                        setTxHash(null);
                        setTxError(null);
                        setTxStatusText(null);
                      }}
                      placeholder="0.0"
                      className={`min-w-0 flex-1 bg-transparent font-mono font-bold text-white placeholder-slate-600 tabular-nums focus:outline-none ${
                        amountStr.length > 14
                          ? 'text-sm sm:text-xl'
                          : amountStr.length > 9
                          ? 'text-base sm:text-2xl'
                          : 'text-lg sm:text-[26px]'
                      }`}
                    />
                    <div className="combat-steel-btn inline-flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold tracking-wider text-white whitespace-nowrap">
                      <TokenLogo token={tokenIn} size={20} />
                      <span>{tokenIn.symbol}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Flip Direction Button */}
              <div className="relative z-20 -my-3.5 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() =>
                    setAction((prev) => (prev === 'stake' ? 'unstake' : 'stake'))
                  }
                  aria-label="Switch between Stake and Unstake"
                  className={`combat-hex-core relative flex h-10 w-11 items-center justify-center hover:text-white ${
                    isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                  }`}
                >
                  <ArrowDownUp className="h-4 w-4" />
                </button>
              </div>

              {/* Receive Chamber */}
              <div className="armor-well-rim relative z-10">
                <div className="armor-well p-3.5 sm:p-4">
                  <div className="mb-2.5 flex items-center justify-between text-xs">
                    <span className="font-display text-[11px] font-bold tracking-widest text-slate-200 uppercase">
                      {action === 'stake'
                        ? 'You Receive (Staked Token)'
                        : 'You Receive (BNB)'}
                    </span>
                    <a
                      href={activeBnbPool.contractUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 font-mono text-[11px] hover:underline ${
                        isGreenMode ? 'text-emerald-300' : 'text-sky-300'
                      }`}
                    >
                      <span>{activeBnbPool.token.symbol} Contract</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    {(() => {
                      const formattedOut = quote
                        ? formatAmount(quote.amountOutFormatted)
                        : '';
                      const outSizeClass =
                        formattedOut.length > 14
                          ? 'text-sm sm:text-xl'
                          : formattedOut.length > 10
                          ? 'text-base sm:text-2xl'
                          : 'text-lg sm:text-[26px]';
                      return (
                        <div
                          title={quote ? quote.amountOutFormatted : undefined}
                          className={`min-w-0 flex-1 truncate font-mono font-bold text-white tabular-nums ${outSizeClass}`}
                        >
                          {quoting && amountInWei > 0n ? (
                            <span
                              className={`inline-flex items-center gap-2 text-sm font-medium ${
                                isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                              }`}
                            >
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Quoting BSC...</span>
                            </span>
                          ) : quote ? (
                            <span>{formattedOut}</span>
                          ) : (
                            <span className="text-slate-600">0.0</span>
                          )}
                        </div>
                      );
                    })()}

                    <div className="combat-steel-btn inline-flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold tracking-wider text-white whitespace-nowrap">
                      <TokenLogo token={tokenOut} size={20} />
                      <span>{tokenOut.symbol}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* On-Chain Summary */}
              {quote && amountInWei > 0n && (
                <div
                  className={`relative z-10 mt-4 space-y-2 border-t pt-3.5 text-xs ${
                    isGreenMode ? 'border-emerald-400/25' : 'border-sky-400/25'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-2">
                    <span className="text-slate-400">Rate</span>
                    <span className="font-mono text-[11px] sm:text-xs text-slate-100 tabular-nums">
                      1 {tokenIn.symbol} = {exchangeRate.toFixed(6)} {tokenOut.symbol}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2">
                    <span className="text-slate-400">
                      Minimum received ({slippagePct}% slippage)
                    </span>
                    <span
                      className={`font-mono text-[11px] sm:text-xs tabular-nums ${
                        isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                      }`}
                    >
                      {formatAmount(
                        ethers.formatUnits(minReceivedWei, tokenOut.decimals)
                      )}{' '}
                      {tokenOut.symbol}
                    </span>
                  </div>
                  {quote.platformFeeBps > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <ShieldCheck
                          className={`h-3.5 w-3.5 ${
                            isGreenMode ? 'text-emerald-300' : 'text-cyan-300'
                          }`}
                        />
                        <span>
                          Platform fee ({(quote.platformFeeBps / 100).toFixed(2)}% to
                          treasury)
                        </span>
                      </span>
                      <span className="font-mono text-[11px] sm:text-xs text-slate-300 tabular-nums">
                        {formatAmount(
                          ethers.formatUnits(quote.platformFeeWei, tokenIn.decimals)
                        )}{' '}
                        {tokenIn.symbol}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-slate-400">Treasury recipient</span>
                    <span className="truncate font-mono text-[11px] text-slate-300">
                      {PLATFORM_FEE_RECIPIENT.slice(0, 6)}...
                      {PLATFORM_FEE_RECIPIENT.slice(-4)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-slate-400">On-chain route</span>
                    <span
                      className={`truncate text-right font-mono ${
                        isGreenMode ? 'text-emerald-200' : 'text-cyan-200'
                      }`}
                    >
                      {quote.routeSymbols.join(' → ')} · {quote.dexLabel}
                    </span>
                  </div>
                </div>
              )}

              {quoteError && (
                <div className="relative z-10 mt-3 border border-amber-400/45 bg-amber-950/35 px-3.5 py-2 text-xs text-amber-200">
                  {quoteError}
                </div>
              )}

              {txError && (
                <div className="relative z-10 mt-3 border border-red-500/50 bg-red-950/40 px-3.5 py-2 text-xs text-red-200">
                  {txError}
                </div>
              )}

              {/* Action CTA */}
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
              ) : amountInWei <= 0n ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
                >
                  Enter an amount
                </button>
              ) : insufficientBnbFlow ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center px-4 py-3.5 text-xs font-bold tracking-widest text-slate-400 uppercase"
                >
                  Insufficient {tokenIn.symbol} balance
                </button>
              ) : checkingAllowance || quoting || !quote ? (
                <button
                  type="button"
                  disabled
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full cursor-not-allowed items-center justify-center gap-2 px-4 py-3.5 text-xs font-bold tracking-widest text-slate-300 uppercase"
                >
                  <Loader2
                    className={`h-4 w-4 animate-spin ${
                      isGreenMode ? 'text-emerald-400' : 'text-cyan-400'
                    }`}
                  />
                  <span>{quoting ? 'Fetching Live Quote...' : 'Unavailable'}</span>
                </button>
              ) : needsBnbApproval ? (
                <button
                  type="button"
                  onClick={handleApproveBnbToken}
                  disabled={txPending !== null}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
                >
                  {txPending === 'approve' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Approving {tokenIn.symbol}...</span>
                    </>
                  ) : (
                    <span>Approve {tokenIn.symbol}</span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExecuteBnbStakeAction}
                  disabled={txPending !== null}
                  className="combat-energy-btn font-display relative z-10 mt-5 flex w-full items-center justify-center gap-2 px-4 py-3.5 text-xs font-extrabold tracking-widest text-white uppercase drop-shadow-[0_1px_2px_rgba(2,6,23,0.9)] disabled:opacity-60"
                >
                  {txPending === 'stake' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{action === 'stake' ? 'Staking BNB...' : 'Unstaking...'}</span>
                    </>
                  ) : (
                    <>
                      <Coins className="h-4 w-4" />
                      <span>
                        {action === 'stake'
                          ? `Stake ${amountStr} BNB`
                          : `Unstake ${activeBnbPool.token.symbol} to BNB`}
                      </span>
                    </>
                  )}
                </button>
              )}
            </>
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
