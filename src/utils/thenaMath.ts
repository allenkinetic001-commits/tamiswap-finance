// Exact Solidity constants & math ported from THENA-Contracts

export const WEEK_SECONDS = 86400 * 7; // 604,800s (Thursday 00:00 UTC epoch boundary)
export const MAXTIME_SECONDS = 86400 * 7 * 52 * 2; // 62,899,200s (104 weeks / 2 years)
export const MAXTIME_WEEKS = 104;

export interface VeLockPosition {
  tokenId: number;
  amount: number; // THE locked
  lockWeeks: number; // 1..104
  createdAtWeek: number;
}

/**
 * Mirrors VotingEscrow.sol balanceOfNFT decay:
 * votingPower = amount * (unlock_end - current_ts) / MAXTIME
 */
export function computeVeBalance(amount: number, remainingWeeks: number): number {
  if (amount <= 0 || remainingWeeks <= 0) return 0;
  const clampedWeeks = Math.min(remainingWeeks, MAXTIME_WEEKS);
  return (amount * clampedWeeks) / MAXTIME_WEEKS;
}

export function buildDecaySeries(amount: number, lockWeeks: number) {
  const points: Array<{ week: number; power: number }> = [];
  const clamped = Math.max(1, Math.min(MAXTIME_WEEKS, Math.round(lockWeeks)));
  for (let w = 0; w <= MAXTIME_WEEKS; w += 4) {
    const remaining = Math.max(0, clamped - w);
    points.push({
      week: w,
      power: computeVeBalance(amount, remaining),
    });
  }
  if (points[points.length - 1]?.week !== MAXTIME_WEEKS) {
    points.push({
      week: MAXTIME_WEEKS,
      power: computeVeBalance(amount, Math.max(0, clamped - MAXTIME_WEEKS)),
    });
  }
  return points;
}

/**
 * Mirrors VeArtProxyUpgradeable.sol _tokenURI(uint _tokenId, uint _balanceOf, uint _locked_end, uint _value)
 */
export function generateVeArtSvgAndJson(
  tokenId: number,
  balanceOfWeiStr: string,
  lockedEndTimestamp: number,
  valueWeiStr: string
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet" viewBox="0 0 350 350"><style>.base { fill: white; font-family: serif; font-size: 14px; }</style><rect width="100%" height="100%" fill="black" /><text x="10" y="20" class="base">token ${tokenId}</text><text x="10" y="40" class="base">balanceOf ${balanceOfWeiStr}</text><text x="10" y="60" class="base">locked_end ${lockedEndTimestamp}</text><text x="10" y="80" class="base">value ${valueWeiStr}</text></svg>`;
  const jsonObj = {
    name: `lock #${tokenId}`,
    description:
      'Thena locks, can be used to boost gauge yields, vote on token emission, and receive bribes',
    image: `data:image/svg+xml;base64,${btoa(svg)}`,
  };
  const jsonString = JSON.stringify(jsonObj);
  const dataUri = `data:application/json;base64,${btoa(jsonString)}`;
  return { svg, jsonObj, dataUri };
}

export interface EpochProjection {
  epoch: number;
  weeklyEmission: number;
  tailEmission: number;
  isTail: boolean;
  rebaseAmount: number;
  teamShare: number;
  gaugeDistribution: number;
  circulatingSupply: number;
}

/**
 * Mirrors MinterUpgradeable.sol emission & rebase schedule:
 * - Initial weekly: 2,600,000 THE
 * - EMISSION = 990 / 1000 (1% weekly decay)
 * - TAIL_EMISSION = 2 / 1000 (0.2% of circulating supply floor)
 * - REBASEMAX = 300 / 1000 (max 30% of weekly emission scaled by veRatio)
 * - teamRate = 40 / 1000 (4% team allocation)
 */
export function projectMinterSchedule(params: {
  epochs: number;
  initialWeekly: number;
  initialCirculating: number;
  veLockedSupply: number;
  decayBps?: number; // default 990
  tailBps?: number; // default 2
  rebaseMaxBps?: number; // default 300
  teamRateBps?: number; // default 40
}): EpochProjection[] {
  const {
    epochs,
    initialWeekly,
    initialCirculating,
    veLockedSupply,
    decayBps = 990,
    tailBps = 2,
    rebaseMaxBps = 300,
    teamRateBps = 40,
  } = params;

  const PRECISION = 1000;
  let weekly = initialWeekly;
  let circulating = initialCirculating;
  const rows: EpochProjection[] = [];

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const decayed = (weekly * decayBps) / PRECISION;
    const tail = (circulating * tailBps) / PRECISION;
    const isTail = tail >= decayed;
    const effectiveWeekly = isTail ? tail : decayed;

    // calculate_growth(_minted): _minted * (REBASEMAX * (totalSupply - veSupply) / totalSupply) / PRECISION
    // In Solidly/THENA MinterUpgradeable: growth = _weekly * REBASEMAX / PRECISION * (circulating - veSupply) / circulating?
    // Actually in MinterUpgradeable.sol:
    // _veTotal = _ve.totalSupply(); _thenaTotal = circulating_supply();
    // rebase = _minted * REBASEMAX / PRECISION * ((_thenaTotal - _veTotal) / _thenaTotal) or capped
    const lockedRatio = Math.min(1, Math.max(0, veLockedSupply / Math.max(1, circulating)));
    const growthMultiplier = (rebaseMaxBps / PRECISION) * Math.pow(1 - lockedRatio, 2);
    const rebaseAmount = effectiveWeekly * growthMultiplier;
    const teamShare = (effectiveWeekly * teamRateBps) / PRECISION;
    const gaugeDistribution = Math.max(0, effectiveWeekly - teamShare);

    rows.push({
      epoch,
      weeklyEmission: effectiveWeekly,
      tailEmission: tail,
      isTail,
      rebaseAmount,
      teamShare,
      gaugeDistribution,
      circulatingSupply: circulating,
    });

    weekly = effectiveWeekly;
    circulating += effectiveWeekly + rebaseAmount;
  }

  return rows;
}

/**
 * Mirrors Pair.sol AMM Swap Math:
 * - Volatile: x * y >= k
 * - Stable:   x^3 * y + y^3 * x >= k (via Newton iteration _get_y)
 */
function fStable(x0: number, y: number): number {
  return (x0 * Math.pow(y, 3)) + (y * Math.pow(x0, 3));
}

function dStable(x0: number, y: number): number {
  return 3 * x0 * Math.pow(y, 2) + Math.pow(x0, 3);
}

function getYStable(x0: number, xy: number, yGuess: number): number {
  let y = yGuess;
  for (let i = 0; i < 64; i++) {
    const k = fStable(x0, y);
    if (k < xy) {
      const dy = (xy - k) / dStable(x0, y);
      y += dy;
    } else {
      const dy = (k - xy) / dStable(x0, y);
      y -= dy;
    }
    if (Math.abs(k - xy) / Math.max(1, xy) < 1e-12) break;
  }
  return y;
}

export function computePairSwap(params: {
  amountIn: number;
  reserveIn: number;
  reserveOut: number;
  stable: boolean;
  feeBps: number;
}) {
  const { amountIn, reserveIn, reserveOut, stable, feeBps } = params;
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) {
    return {
      amountOut: 0,
      feePaid: 0,
      effectivePrice: 0,
      spotPrice: reserveOut / Math.max(1, reserveIn),
      priceImpactPct: 0,
      kValue: 0,
    };
  }

  const feePaid = (amountIn * feeBps) / 10000;
  const amountInAfterFee = amountIn - feePaid;
  const spotPrice = reserveOut / reserveIn;

  let amountOut = 0;
  let kValue = 0;

  if (stable) {
    kValue = fStable(reserveIn, reserveOut);
    const yNew = getYStable(reserveIn + amountInAfterFee, kValue, reserveOut);
    amountOut = Math.max(0, reserveOut - yNew);
  } else {
    kValue = reserveIn * reserveOut;
    amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
  }

  const effectivePrice = amountOut / amountIn;
  const priceImpactPct = Math.max(0, ((spotPrice - effectivePrice) / spotPrice) * 100);

  return {
    amountOut,
    feePaid,
    effectivePrice,
    spotPrice,
    priceImpactPct,
    kValue,
  };
}
