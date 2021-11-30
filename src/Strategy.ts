import { LiquidityEvent } from "./LiquidityEvent";
import { SwapEvent } from "./SwapEvent";
import { getTomorrow, format } from "./util/DateUtils";
import { EventType } from "./EventType";
import { Engine, buildDryRunEngine } from "./Engine";
import { Account } from "./Account";
import JSBI from "jsbi";
import {
  ConfigurableCorePool,
  CorePoolView,
  EventDBManager,
  SimulationDataManager,
  SimulatorClient,
  SQLiteSimulationDataManager,
} from "@bella-defintech/uniswap-v3-simulator";

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
  run: (dryrun: boolean) => Promise<void>;
  shutdown: () => Promise<void>;
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
  eventDB: EventDBManager,
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

  /* 
    Everytime we do the backtest of a strategy, we build an instance of the 
    Tuner, replay events in a batch of a day from startDate soecified by the 
    user, ask the user whether they want to do some transaction(mint, burn, 
    swap, collect). If the user choose to trigger it, we run the act callback 
    then repeat the steps above until the endDate comes.
  */
  async function backtest(startDate: Date, endDate: Date): Promise<void> {
    // initial environment
    const systemUser = "0xSYSTEM";
    async function getAndSortEventByDate(
      startDate: Date,
      endDate: Date
    ): Promise<(LiquidityEvent | SwapEvent)[]> {
      let events: (LiquidityEvent | SwapEvent)[] = [];
      let mintEvents: LiquidityEvent[] = await eventDB.getLiquidityEventsByDate(
        EventType.MINT,
        format(startDate, "yyyy-MM-dd HH:mm:ss"),
        format(endDate, "yyyy-MM-dd HH:mm:ss")
      );
      let burnEvents: LiquidityEvent[] = await eventDB.getLiquidityEventsByDate(
        EventType.BURN,
        format(startDate, "yyyy-MM-dd HH:mm:ss"),
        format(endDate, "yyyy-MM-dd HH:mm:ss")
      );
      let swapEvents: SwapEvent[] = await eventDB.getSwapEventsByDate(
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

    let simulationDataManager: SimulationDataManager =
      await SQLiteSimulationDataManager.buildInstance();
    let clientInstance = new SimulatorClient(simulationDataManager);
    let poolConfig = await eventDB.getPoolConfig();
    let configurableCorePool: ConfigurableCorePool =
      clientInstance.initCorePoolFromConfig(poolConfig!);
    let sqrtPriceX96ForInitialization = await eventDB.getInitialSqrtPriceX96();
    await configurableCorePool.initialize(sqrtPriceX96ForInitialization);

    // This is an implementation of Engine interface based on the Tuner.
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
    await clientInstance.shutdown();
    // evaluate results
    evaluate(configurableCorePool.getCorePool(), variable);
  }

  async function run(dryrun: boolean) {
    // If we want to make the strategy run on mainnet, just implement Engine interface with abi to interact with mainnet contracts.
    // We can also make the strategy run based on our events DB which updates and represents state of mainnet.
    // TODO
  }

  async function shutdown() {
    await eventDB.close();
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
    shutdown,
  };
}
