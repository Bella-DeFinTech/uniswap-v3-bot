import { BigNumber as BN } from "ethers";

export interface Account {
  USDC: BN;
  WETH: BN;
}

export function print(account: Account) {
  console.log("USDC balance: " + account.USDC.toString());
  console.log("WETH balance: " + account.WETH.toString());
}

export async function buildAccount(
  USDCAmount: BN,
  WETHAmount: BN
): Promise<Account> {
  return {
    USDC: USDCAmount,
    WETH: WETHAmount,
  };
}
