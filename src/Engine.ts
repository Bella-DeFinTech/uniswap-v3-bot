import assert from "assert";
import JSBI from "jsbi";
import { ConfigurableCorePool } from "uniswap-v3-simulator";
import { Account } from "./Account";
import { isPositive, toBN } from "./util/BNUtils";

export interface Engine {
  mint(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }>;

  burn(
    owner: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }>;

  collect(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount0Requested: JSBI,
    amount1Requested: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }>;

  swap(
    zeroForOne: boolean,
    amountSpecified: JSBI,
    sqrtPriceLimitX96?: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }>;
}

export async function buildDryRunEngine(
  account: Account,
  configurableCorePool: ConfigurableCorePool
): Promise<Engine> {
  function mint(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }> {
    console.log("mint");
    return configurableCorePool
      .mint(recipient, tickLower, tickUpper, amount)
      .then(({ amount0, amount1 }) => {
        account.USDC = account.USDC.sub(toBN(amount0));
        assert(isPositive(account.USDC));
        account.WETH = account.WETH.sub(toBN(amount1));
        assert(isPositive(account.WETH));
        return Promise.resolve({ amount0, amount1 });
      })
      .catch((e) => Promise.reject(e));
  }

  function burn(
    owner: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }> {
    console.log("burn");
    return configurableCorePool.burn(owner, tickLower, tickUpper, amount);
  }

  function collect(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount0Requested: JSBI,
    amount1Requested: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }> {
    console.log("collect");
    return configurableCorePool
      .collect(
        recipient,
        tickLower,
        tickUpper,
        amount0Requested,
        amount1Requested
      )
      .then(({ amount0, amount1 }) => {
        account.USDC = account.USDC.add(toBN(amount0));
        account.WETH = account.WETH.add(toBN(amount1));
        return Promise.resolve({ amount0, amount1 });
      });
  }

  function swap(
    zeroForOne: boolean,
    amountSpecified: JSBI,
    sqrtPriceLimitX96?: JSBI
  ): Promise<{ amount0: JSBI; amount1: JSBI }> {
    console.log("swap");
    return configurableCorePool
      .swap(zeroForOne, amountSpecified, sqrtPriceLimitX96)
      .then(({ amount0, amount1 }) => {
        // subtract because sign of amount result is at the pool side
        account.USDC = account.USDC.sub(toBN(amount0));
        assert(isPositive(account.USDC));
        account.WETH = account.WETH.sub(toBN(amount1));
        assert(isPositive(account.WETH));
        return Promise.resolve({ amount0, amount1 });
      })
      .catch((e) => Promise.reject(e));
  }
  return { mint, burn, collect, swap };
}
