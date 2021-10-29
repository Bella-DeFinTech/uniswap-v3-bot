import BN from "bn.js";
import JSBI from "jsbi";

export function sum(bnArr: BN[]) {
  return bnArr.reduce((prev, current) => {
    return prev.add(current);
  });
}

export function mul10pow(bn: BN, n: number) {
  return bn.mul(new BN(10).pow(new BN(n)));
}

export function div10pow(bn: BN, n: number) {
  return bn.div(new BN(10).pow(new BN(n)));
}

export function get10pow(n: number) {
  return new BN(10).pow(new BN(n));
}

export function isPositive(bn: BN): boolean {
  return bn.cmpn(0) === 1;
}

export function toBN(number: any): BN {
  return new BN(number.toString());
}

export function toJSBI(number: any): JSBI {
  return JSBI.BigInt(number.toString());
}
