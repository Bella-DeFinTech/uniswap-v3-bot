import { Knex, knex as knexBuilder } from "knex";
import { DateConverter } from "uniswap-v3-simulator";
import BN from "bn.js";
import { RebalanceLog } from "./Backtest.test";

const DATE_FORMAT: string = "YYYY-MM-DD HH:mm:ss.SSS";

// type RebalanceLogRecord = {
//   id: number;
//   curr_price: string;
//   amount0_out: string;
//   amount1_out: string;
//   token0_fee: string;
//   token1_fee: string;
//   curr_price_view: string;
//   price_lower_view: string;
//   price_upper_view: string;
//   tick_lower: number;
//   tick_upper: number;
//   amount0_in: string;
//   amount1_in: string;
//   liquidity: string;
//   swap_fee: string;
//   date: Date;
// };

export class LogDBManager {
  private knex: Knex;

  constructor(dbPath: string) {
    const config: Knex.Config = {
      client: "sqlite3",
      connection: {
        filename: dbPath, //:memory:
      },
      // sqlite does not support inserting default values. Set the `useNullAsDefault` flag to hide the warning.
      useNullAsDefault: true,
    };
    this.knex = knexBuilder(config);
  }

  initTables(): Promise<void> {
    const knex = this.knex;
    let tasks = [
      knex.schema.hasTable("rebalanceLog").then((exists: boolean) =>
        !exists
          ? knex.schema.createTable(
              "rebalanceLog",
              function (t: Knex.TableBuilder) {
                t.increments("id").primary();
                t.string("curr_price", 255);
                t.string("amount0_out", 255);
                t.string("amount1_out", 255);
                t.string("token0_fee", 255);
                t.string("token1_fee", 255);
                t.string("curr_price_view", 255);
                t.string("price_lower_view", 255);
                t.string("price_upper_view", 255);
                t.integer("tick_lower");
                t.integer("tick_upper");
                t.string("amount0_in", 255);
                t.string("amount1_in", 255);
                t.string("liquidity", 255);
                t.string("swap_fee", 255);
                t.string("usdc_value", 255);
                t.text("date");
              }
            )
          : Promise.resolve()
      ),
    ];
    return Promise.all(tasks).then(() => Promise.resolve());
  }

  persistRebalanceLog(rebalanceLog: RebalanceLog): Promise<number> {
    return this.knex
      .transaction((trx) =>
        this.insertRebalanceLog(
          rebalanceLog.curr_price,
          rebalanceLog.amount0_out,
          rebalanceLog.amount1_out,
          rebalanceLog.token0_fee,
          rebalanceLog.token1_fee,
          rebalanceLog.curr_price_view,
          rebalanceLog.price_lower_view,
          rebalanceLog.price_upper_view,
          rebalanceLog.tick_lower,
          rebalanceLog.tick_upper,
          rebalanceLog.amount0_in,
          rebalanceLog.amount1_in,
          rebalanceLog.liquidity,
          rebalanceLog.swap_fee,
          rebalanceLog.usdc_value,
          rebalanceLog.date,
          trx
        )
      )
      .then((ids) => Promise.resolve(ids[0]));
  }

  close(): Promise<void> {
    return this.knex.destroy();
  }

  private insertRebalanceLog(
    curr_price: BN,
    amount0_out: BN,
    amount1_out: BN,
    token0_fee: BN,
    token1_fee: BN,
    curr_price_view: BN,
    price_lower_view: BN,
    price_upper_view: BN,
    tick_lower: number,
    tick_upper: number,
    amount0_in: BN,
    amount1_in: BN,
    liquidity: BN,
    swap_fee: BN,
    usdc_value: BN,
    date: Date,
    trx?: Knex.Transaction
  ): Promise<Array<number>> {
    return this.getBuilderContext("rebalanceLog", trx).insert([
      {
        curr_price: curr_price.toString(),
        amount0_out: amount0_out.toString(),
        amount1_out: amount1_out.toString(),
        token0_fee: token0_fee.toString(),
        token1_fee: token1_fee.toString(),
        curr_price_view: curr_price_view,
        price_lower_view: price_lower_view.toString(),
        price_upper_view: price_upper_view.toString(),
        tick_lower,
        tick_upper,
        amount0_in: amount0_in.toString(),
        amount1_in: amount1_in.toString(),
        liquidity: liquidity.toString(),
        swap_fee: swap_fee.toString(),
        usdc_value: usdc_value.toString(),
        date: DateConverter.formatDate(date, DATE_FORMAT),
      },
    ]);
  }

  private getBuilderContext(
    tableName: string,
    trx?: Knex.Transaction
  ): Knex.QueryBuilder {
    return trx ? trx(tableName) : this.knex(tableName);
  }
}
