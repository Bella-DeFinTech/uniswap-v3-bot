import {
  ConfigurableCorePool,
  FeeAmount,
  PoolConfig,
  SimulationDataManager,
  SimulatorClient,
  SQLiteSimulationDataManager,
  Transition,
} from "@bella-defintech/uniswap-v3-simulator";
import JSBI from "jsbi";

describe("Test Simulator", function () {
  let clientInstance: SimulatorClient;

  beforeEach(async function () {
    let simulationDataManager: SimulationDataManager =
      await SQLiteSimulationDataManager.buildInstance();
    clientInstance = new SimulatorClient(simulationDataManager);
  });

  afterEach(async function () {
    await clientInstance.shutdown();
  });

  it("can be used by user", async function () {
    let sqrtPriceX96ForInitialization = JSBI.BigInt("4295128739");
    let configurableCorePool: ConfigurableCorePool =
      clientInstance.initCorePoolFromConfig(
        new PoolConfig(60, "USDC", "ETH", FeeAmount.MEDIUM)
      );
    await configurableCorePool.initialize(sqrtPriceX96ForInitialization);

    configurableCorePool.updatePostProcessor(
      (pool: ConfigurableCorePool, transition: Transition) => {
        console.log(pool.id);
        console.log(transition.getTarget().timestamp);
        return Promise.resolve();
      }
    );

    await configurableCorePool.mint(
      "0x01",
      -887272,
      887272,
      JSBI.BigInt("10860507277202")
    );
    console.log(configurableCorePool.getCorePool().liquidity.toString());
    configurableCorePool.stepBack();
    console.log(configurableCorePool.getCorePool().liquidity.toString());
  });
});
