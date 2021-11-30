import JSBI from "jsbi";
import {
  CorePoolView,
  TickMath,
  LiquidityMath,
  FullMath,
  EventDBManager,
} from "@bella-defintech/uniswap-v3-simulator";
import { getDate } from "../src/util/DateUtils";
import { buildStrategy, CommonVariables, Phase } from "../src/Strategy";
import BN from "bn.js";
import { mul10pow, get10pow, toBN, toJSBI } from "../src/util/BNUtils";
import { Engine } from "../src/Engine";
import { MaxUint128, ZERO } from "../src/InternalConstants";
import { Account, buildAccount } from "../src/Account";
import { LogDBManager } from "./LogDBManager";

export interface RebalanceLog {
  curr_price: BN;
  amount0_out: BN;
  amount1_out: BN;
  token0_fee: BN;
  token1_fee: BN;
  curr_price_view: BN;
  price_lower_view: BN;
  price_upper_view: BN;
  tick_lower: number;
  tick_upper: number;
  amount0_in: BN;
  amount1_in: BN;
  liquidity: BN;
  swap_fee: BN;
  usdc_value: BN;
  date: Date;
}

describe("Test Strategy", function () {
  const eventDBManagerPath =
    "events_0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8.db";
  const rebalanceLogDBManagerPath = "rebalance_log_usdc_weth_3000.db";
  let logDB: LogDBManager;

  beforeEach(async function () {
    logDB = new LogDBManager(rebalanceLogDBManagerPath);
    await logDB.initTables();
  });

  afterEach(async function () {
    await logDB.close();
  });

  it("can run backtest", async function () {
    const PRICE_LOG = "priceLog";
    const LAST_TICK_LOWER = "lastTickLower";
    const LAST_TICK_UPPER = "lastTickUpper";
    const LAST_LIQUIDITY = "lastLiquidity";
    const ASSET_IN_USDC = "assetInUsdc";
    const REBALANCE_LOG = "rebalanceLog";
    const owner = "0x01";

    // set priceWindow for strategy
    let priceWindowOnDay = 7;
    // set std ratio
    let stdRatio = 1.96;
    let tickSpacing = 60;
    let initialAssetsAmount = mul10pow(new BN(2000), 6);
    let startDate = getDate(2021, 5, 5);
    let endDate = getDate(2021, 11, 6);

    let trigger = function (
      phase: Phase,
      corePoolView: CorePoolView,
      variable: Map<string, any>
    ) {
      switch (phase) {
        case Phase.AFTER_NEW_DAY:
          if (!variable.has(PRICE_LOG)) return false;
          return (variable.get(PRICE_LOG) as JSBI[]).length >= priceWindowOnDay;
        case Phase.AFTER_EVENT_APPLIED:
          return false;
      }
    };

    let cache = function (
      phase: Phase,
      corePoolView: CorePoolView,
      variable: Map<string, any>
    ) {
      switch (phase) {
        case Phase.AFTER_NEW_DAY:
          if (!variable.has(PRICE_LOG)) {
            variable.set(PRICE_LOG, new Array<JSBI>());
          }
          (variable.get(PRICE_LOG) as JSBI[]).push(corePoolView.sqrtPriceX96);
          break;
        case Phase.AFTER_EVENT_APPLIED:
          break;
      }
    };

    let act = async function (
      phase: Phase,
      engine: Engine,
      corePoolView: CorePoolView,
      variable: Map<string, any>
    ): Promise<void> {
      switch (phase) {
        case Phase.AFTER_NEW_DAY:
          let fullpriceLogs = variable.get(PRICE_LOG) as JSBI[];
          let priceLogs: JSBI[] = fullpriceLogs.slice(
            fullpriceLogs.length - priceWindowOnDay
          );
          let curr_price: BN = toBN(
            variable.get(CommonVariables.PRICE) as JSBI
          );

          // do calculation for rebalance
          let amount_limit: BN;
          let amount0_in: BN;
          let amount1_in: BN;
          let amount0_out: BN;
          let amount1_out: BN;
          let token0_fee: BN;
          let token1_fee: BN;
          let token0_balance_after_collect: BN;
          let token1_balance_after_collect: BN;
          let token0_balance_before_mint: BN;
          let token1_balance_before_mint: BN;
          let swap_fee: BN;
          let tick_lower: number;
          let tick_upper: number;
          let curr_price_view: BN;
          let price_lower_view: BN;
          let price_upper_view: BN;
          let s_deviation: BN;
          let lower_price: BN;
          let upper_price: BN;
          // TODO calculate and decide if not to rebalance
          // std based on price and not sqrt
          // based on ETH/USDC as pool native price
          // s_deviation = getStandardDeviation(priceLogs.map(log => new BN(log.sqrt_price_x96).sqr()))
          // lower_price = sqrt(curr_price.sqr().sub(s_deviation.muln(stdRatio * 100).divn(100)))
          // upper_price = sqrt(curr_price.sqr().add(s_deviation.muln(stdRatio * 100).divn(100)))
          // based on USDC/ETH as we use in analysis

          s_deviation = getStandardDeviation(
            priceLogs.map((log) => inversePriceX192(toBN(log).sqr()))
          );
          lower_price = sqrt(
            inversePriceX192(
              inversePriceX192(curr_price.sqr()).add(
                s_deviation.muln(stdRatio * 100).divn(100)
              )
            )
          );
          upper_price = sqrt(
            inversePriceX192(
              inversePriceX192(curr_price.sqr()).sub(
                s_deviation.muln(stdRatio * 100).divn(100)
              )
            )
          );
          tick_lower = getAvailableTick(
            new BN(
              TickMath.getTickAtSqrtRatio(
                JSBI.BigInt(lower_price.toString())
              ).toString()
            ),
            tickSpacing
          );
          tick_upper = getAvailableTick(
            new BN(
              TickMath.getTickAtSqrtRatio(
                JSBI.BigInt(upper_price.toString())
              ).toString()
            ),
            tickSpacing
          );
          // recalculate lower_price and upper_price according to available tick index
          lower_price = toBN(TickMath.getSqrtRatioAtTick(tick_lower));
          upper_price = toBN(TickMath.getSqrtRatioAtTick(tick_upper));

          curr_price_view = sqrtPriceToView(curr_price);
          // notice USDC/WETH price of lower and upper is contrary to tick index
          price_lower_view = sqrtPriceToView(upper_price);
          price_upper_view = sqrtPriceToView(lower_price);
          let lastTickLower: number;
          let lastTickUpper: number;
          let lastLiquidity: BN;
          // query and check if rebalance log existed
          if (!variable.has(REBALANCE_LOG)) {
            // firstly mint
            variable.set(REBALANCE_LOG, new Array<RebalanceLog>());
            amount0_out = new BN(0);
            amount1_out = new BN(0);
            token0_fee = new BN(0);
            token1_fee = new BN(0);
            token0_balance_after_collect = initialAssetsAmount;
            token1_balance_after_collect = new BN(0);
            amount_limit = initialAssetsAmount;
          } else {
            lastTickLower = variable.get(LAST_TICK_LOWER) as number;
            lastTickUpper = variable.get(LAST_TICK_UPPER) as number;
            lastLiquidity = variable.get(LAST_LIQUIDITY) as BN;
            // query fees
            await engine.burn(owner, lastTickLower, lastTickUpper, ZERO);
            let lastPosition = corePoolView.getPosition(
              owner,
              lastTickLower,
              lastTickUpper
            );
            token0_fee = toBN(lastPosition.tokensOwed0);
            token1_fee = toBN(lastPosition.tokensOwed1);
            // do rebalance
            let account = variable.get(CommonVariables.ACCOUNT) as Account;
            let token0AmountBefore = account.USDC;
            let token1AmountBefore = account.WETH;
            await engine.burn(
              owner,
              lastTickLower,
              lastTickUpper,
              toJSBI(lastLiquidity)
            );
            await engine.collect(
              owner,
              lastTickLower,
              lastTickUpper,
              MaxUint128,
              MaxUint128
            );
            account = variable.get(CommonVariables.ACCOUNT) as Account;
            let token0AmountAfter = account.USDC;
            let token1AmountAfter = account.WETH;
            amount0_out = new BN(token0AmountAfter)
              .sub(new BN(token0AmountBefore))
              .sub(token0_fee);
            amount1_out = new BN(token1AmountAfter)
              .sub(new BN(token1AmountBefore))
              .sub(token1_fee);
            token0_balance_after_collect = new BN(token0AmountAfter);
            token1_balance_after_collect = new BN(token1AmountAfter);
            amount_limit = getAssetsBalanceInUSDC(
              token0_balance_after_collect,
              token1_balance_after_collect,
              curr_price
            );
          }

          // provide liquidity
          // calculate liqudity to provide with limited amount of USDC at curr_pool_price
          // notice: the curr_pool_price is actually amount of ETH / amount of USDC
          let amount_in_denominator = curr_price
            .sub(lower_price)
            .mul(curr_price)
            .mul(upper_price)
            .add(upper_price.sub(curr_price).mul(curr_price).mul(curr_price));
          amount0_in = amount_limit
            .mul(upper_price.sub(curr_price))
            .mul(curr_price)
            .mul(curr_price)
            .div(amount_in_denominator);
          amount1_in = amount_limit
            .mul(curr_price.sub(lower_price))
            .mul(curr_price)
            .mul(upper_price)
            .mul(curr_price)
            .mul(curr_price)
            .div(amount_in_denominator)
            .shrn(96 * 2);
          // do swap if necessary
          if (token0_balance_after_collect.gt(amount0_in)) {
            // swap exact USDC for WETH
            await engine
              .swap(true, toJSBI(token0_balance_after_collect.sub(amount0_in)))
              .catch((e) => {
                // done(e);
              });
          } else if (token1_balance_after_collect.gt(amount1_in)) {
            // swap exact WETH for USDC
            await engine
              .swap(false, toJSBI(token1_balance_after_collect.sub(amount1_in)))
              .catch((e) => {
                // done(e);
              });
          }
          let account = variable.get(CommonVariables.ACCOUNT) as Account;
          token0_balance_before_mint = account.USDC;
          token1_balance_before_mint = account.WETH;
          // notice this is only a measurement for price slippage, don't take it as cost for net value calculation
          swap_fee = amount_limit.sub(
            getAssetsBalanceInUSDC(
              new BN(token0_balance_before_mint),
              new BN(token1_balance_before_mint),
              curr_price
            )
          );
          console.log("swap_fee: " + swap_fee.toString());

          // do provide liquidity
          await engine
            .mint(
              owner,
              tick_lower,
              tick_upper,
              LiquidityMath.maxLiquidityForAmounts(
                toJSBI(curr_price),
                toJSBI(lower_price),
                toJSBI(upper_price),
                toJSBI(token0_balance_before_mint),
                toJSBI(token1_balance_before_mint),
                true
              )
            )
            .catch((e) => {
              // done(e);
            });

          // call and save strategy status
          let positionLiquidity = toBN(
            corePoolView.getPosition(owner, tick_lower, tick_upper).liquidity
          );

          variable.set(LAST_TICK_LOWER, tick_lower);
          variable.set(LAST_TICK_UPPER, tick_upper);
          variable.set(LAST_LIQUIDITY, positionLiquidity);
          variable.set(ASSET_IN_USDC, amount_limit);

          let rebalanceLog = variable.get(REBALANCE_LOG) as RebalanceLog[];
          let date = variable.get(CommonVariables.DATE) as Date;
          // save log to variable
          let newLog: RebalanceLog = {
            curr_price,
            amount0_out,
            amount1_out,
            token0_fee,
            token1_fee,
            curr_price_view,
            price_lower_view,
            price_upper_view,
            tick_lower,
            tick_upper,
            amount0_in,
            amount1_in,
            liquidity: positionLiquidity,
            swap_fee,
            usdc_value: amount_limit,
            date,
          };
          rebalanceLog.push(newLog);
          await logDB.persistRebalanceLog(newLog);
          break;
        case Phase.AFTER_EVENT_APPLIED:
          break;
      }
    };

    let evaluate = function (
      corePoolView: CorePoolView,
      variable: Map<string, any>
    ) {
      let rebalanceLog = variable.get(REBALANCE_LOG) as RebalanceLog[];
      console.log("success!");
      console.log("rebalance count: " + rebalanceLog.length);
      console.log(
        "assets USDC value: " + variable.get(ASSET_IN_USDC).toString()
      );
    };

    // Make sure the DB has been initialized, and see scripts/EventsDownloaders
    // if you want to update the events.
    let eventDB = await EventDBManager.buildInstance(eventDBManagerPath);
    let strategy = await buildStrategy(
      eventDB,
      await buildAccount(initialAssetsAmount, new BN(0)),
      trigger,
      cache,
      act,
      evaluate
    );

    await strategy.backtest(startDate, endDate);

    await strategy.shutdown();
  });
});

function getStandardDeviation(data: BN[]): BN {
  let sum = function (x: BN, y: BN) {
    return x.add(y);
  };
  let square = function (x: BN) {
    return x.mul(x);
  };

  let mean: BN = data.reduce(sum).divn(data.length);
  let deviations = data.map(function (x: BN) {
    return x.sub(mean);
  });
  return sqrt(
    deviations
      .map(square)
      .reduce(sum)
      .divn(data.length - 1)
  );
}

function sqrt(value: BN): BN {
  return toBN(FullMath.sqrt(toJSBI(value)));
}

function getAvailableTick(tick: BN, tickSpacing: number): number {
  let quotient = tick.divn(tickSpacing);
  return quotient.muln(tickSpacing).toNumber();
}

function getAssetsBalanceInUSDC(
  token0_balance: BN,
  token1_balance: BN,
  curr_price: BN
): BN {
  return token0_balance.add(token1_balance.div(curr_price.sqr().shrn(96 * 2)));
}

function inversePriceX192(priceX192: BN): BN {
  return new BN(1).shln(192 * 2).div(priceX192);
}

function sqrtPriceToView(sqrtPriceX96: BN): BN {
  return get10pow(12).div(new BN(sqrtPriceX96).sqr().shrn(96 * 2));
}
