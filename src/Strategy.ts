import { LiquidityEvent } from "./LiquidityEvent";
import { SwapEvent } from "./SwapEvent";
import { getTomorrow, format } from "./util/DateUtils";
import { EventDBManager } from "./EventDBManager";
import { EventType } from "./EventType";
import { Engine, buildDryRunEngine } from "./Engine";
import { Account } from "./Account";
import JSBI from "jsbi";
import {
  ConfigurableCorePool,
  CorePoolView,
  FeeAmount,
  SimulatorClient,
} from "uniswap-v3-simulator";

export interface Strategy {
  trigger: (
    phase: Phase,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => boolean;
  cache: (
    phase: Phase,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => void;
  act: (
    phase: Phase,
    engine: Engine,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => Promise<void>;
  evaluate: (corePoolView: CorePoolView, variable: Map<string, any>) => void;
  backtest: (startDate: Date, endDate: Date) => Promise<void>;
  run: (dryrun: boolean) => void;
}

export enum Phase {
  AFTER_NEW_DAY,
  AFTER_EVENT_APPLIED,
}

export enum CommonVariables {
  ACCOUNT = "account", //Account
  DATE = "currDate", //Date
  EVENT = "poolEvent", //LiquidityEvent | SwapEvent
  PRICE = "sqrtPriceX96", //JSBI
  TICK = "tickCurrent", //number
}

export async function buildStrategy(
  account: Account,
  trigger: (
    phase: Phase,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => boolean,
  cache: (
    phase: Phase,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => void,
  act: (
    phase: Phase,
    engine: Engine,
    corePoolView: CorePoolView,
    variable: Map<string, any>
  ) => Promise<void>,
  evaluate: (corePoolView: CorePoolView, variable: Map<string, any>) => void
): Promise<Strategy> {
  let variable: Map<string, any> = new Map();

  async function backtest(startDate: Date, endDate: Date): Promise<void> {
    // initial environment
    const systemUser = "0xSYSTEM";
    let liquidityEventDB = new EventDBManager(
      "liquidity_events_usdc_weth_3000.db"
    );
    let swapEventDB = new EventDBManager("swap_events_usdc_weth_3000.db");
    async function getAndSortEventByDate(
      startDate: Date,
      endDate: Date
    ): Promise<(LiquidityEvent | SwapEvent)[]> {
      let events: (LiquidityEvent | SwapEvent)[] = [];
      let mintEvents: LiquidityEvent[] =
        await liquidityEventDB.getLiquidityEventsByDate(
          EventType.MINT,
          format(startDate, "yyyy-MM-dd HH:mm:ss"),
          format(endDate, "yyyy-MM-dd HH:mm:ss")
        );
      let burnEvents: LiquidityEvent[] =
        await liquidityEventDB.getLiquidityEventsByDate(
          EventType.BURN,
          format(startDate, "yyyy-MM-dd HH:mm:ss"),
          format(endDate, "yyyy-MM-dd HH:mm:ss")
        );
      let swapEvents: SwapEvent[] = await swapEventDB.getSwapEventsByDate(
        format(startDate, "yyyy-MM-dd HH:mm:ss"),
        format(endDate, "yyyy-MM-dd HH:mm:ss")
      );
      events.push(...mintEvents);
      events.push(...burnEvents);
      events.push(...swapEvents);
      events.sort(function (a, b) {
        return a.blockNumber == b.blockNumber
          ? a.logIndex - b.logIndex
          : a.blockNumber - b.blockNumber;
      });
      return events;
    }

    // // TODO handle account balance during backtest independently
    // let usdcBalance = account.USDC;
    // let wethBalance = account.WETH;

    // TODO the pool should be initialized by param rather than fixed
    let clientInstace: SimulatorClient = await SimulatorClient.buildInstance();
    let sqrtPriceX96ForInitialization = JSBI.BigInt(
      "0x43efef20f018fdc58e7a5cf0416a"
    );
    let configurableCorePool: ConfigurableCorePool =
      clientInstace.initCorePoolFromConfig(
        SimulatorClient.buildPoolConfig(60, "USDC", "ETH", FeeAmount.MEDIUM)
      );
    await configurableCorePool.initialize(sqrtPriceX96ForInitialization);

    let engine = await buildDryRunEngine(account, configurableCorePool);

    async function replayEvent(
      event: LiquidityEvent | SwapEvent
    ): Promise<void> {
      switch (event.type) {
        case EventType.MINT:
          await configurableCorePool.mint(
            systemUser,
            event.tickLower,
            event.tickUpper,
            event.liquidity
          );
          break;
        case EventType.BURN:
          await configurableCorePool.burn(
            systemUser,
            event.tickLower,
            event.tickUpper,
            event.liquidity
          );
          break;
        case EventType.SWAP:
          let zeroForOne: boolean = JSBI.greaterThan(
            event.amount0,
            JSBI.BigInt(0)
          )
            ? true
            : false;
          // we can't ensure sqrt_price_limit from event or original trx
          // because we need to interpolate user custom action and that will affect pool state
          await configurableCorePool.swap(
            zeroForOne,
            event.amountSpecified
            //,event.sqrt_price_x96
          );
          break;
        default:
          // @ts-ignore: ExhaustiveCheck
          const exhaustiveCheck: never = event;
      }
    }

    // replay event and call user custom strategy
    let currDate = startDate;
    while (currDate < endDate) {
      // update common view
      variable.set(CommonVariables.DATE, currDate);
      console.log(currDate);
      // allow update custom cache no matter act is being triggered or not
      cache(Phase.AFTER_NEW_DAY, configurableCorePool.getCorePool(), variable);
      // decide whether to do action
      if (
        trigger(
          Phase.AFTER_NEW_DAY,
          configurableCorePool.getCorePool(),
          variable
        )
      ) {
        act(
          Phase.AFTER_NEW_DAY,
          engine,
          configurableCorePool.getCorePool(),
          variable
        );
      }
      let events = await getAndSortEventByDate(currDate, getTomorrow(currDate));
      if (events.length > 0) {
        for (let index = 0; index < events.length; index++) {
          // avoid stack overflow
          if (index % 4000 == 0) {
            configurableCorePool.takeSnapshot("");
          }
          let event = events[index];
          await replayEvent(event);
          let corePoolView = configurableCorePool.getCorePool();
          // update common view
          variable.set(CommonVariables.EVENT, event);
          variable.set(CommonVariables.PRICE, corePoolView.sqrtPriceX96);
          variable.set(CommonVariables.TICK, corePoolView.tickCurrent);
          // allow update custom cache no matter act is being triggered or not
          cache(Phase.AFTER_EVENT_APPLIED, corePoolView, variable);
          // decide whether to do action
          if (trigger(Phase.AFTER_EVENT_APPLIED, corePoolView, variable)) {
            act(Phase.AFTER_EVENT_APPLIED, engine, corePoolView, variable);
          }
        }
      }
      currDate = getTomorrow(currDate);
    }
    // shutdown environment
    await liquidityEventDB.close();
    await swapEventDB.close();
    await clientInstace.shutdown();
    // evaluate results
    evaluate(configurableCorePool.getCorePool(), variable);
  }

  function run(dryrun: boolean) {
    // TODO
  }

  // TODO account here should be a view
  variable.set(CommonVariables.ACCOUNT, account);

  return {
    trigger,
    cache,
    act,
    evaluate,
    backtest,
    run,
  };
}
