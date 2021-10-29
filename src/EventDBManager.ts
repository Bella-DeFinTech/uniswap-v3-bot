import { Knex, knex as knexBuilder } from "knex";
import { LiquidityEvent } from "./LiquidityEvent";
import { SwapEvent } from "./SwapEvent";
import { DateConverter, JSBIDeserializer } from "uniswap-v3-simulator";
import { EventType } from "./EventType";

type LiquidityEventRecord = {
  id: number;
  type: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  tick_lower: number;
  tick_upper: number;
  block_number: number;
  transaction_index: number;
  log_index: number;
  date: string;
};

type SwapEventRecord = {
  id: number;
  amount0: string;
  amount1: string;
  amountSpecified: string;
  sqrt_price_x96: string;
  liquidity: string;
  tick: number;
  block_number: number;
  transaction_index: number;
  log_index: number;
  date: string;
};

export class EventDBManager {
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

  getLiquidityEventsByDate(
    type: number,
    startDate: string,
    endDate: string
  ): Promise<LiquidityEvent[]> {
    return this.queryLiquidityEventsByDate(type, startDate, endDate).then(
      (rows: LiquidityEventRecord[]) =>
        Promise.resolve(
          rows.map(
            (row: LiquidityEventRecord): LiquidityEvent =>
              this.deserializeLiquidityEvent(row)
          )
        )
    );
  }

  getSwapEventsByDate(
    startDate: string,
    endDate: string
  ): Promise<SwapEvent[]> {
    return this.querySwapEventsByDate(startDate, endDate).then(
      (rows: SwapEventRecord[]) =>
        Promise.resolve(
          rows.map(
            (row: SwapEventRecord): SwapEvent => this.deserializeSwapEvent(row)
          )
        )
    );
  }

  close(): Promise<void> {
    return this.knex.destroy();
  }

  private queryLiquidityEventsByDate(
    type: number,
    startDate: string,
    endDate: string,
    trx?: Knex.Transaction
  ): Promise<LiquidityEventRecord[]> {
    return this.getBuilderContext("liquidity_events_usdc_weth_3000", trx)
      .where("type", type)
      .andWhere("date", ">=", startDate)
      .andWhere("date", "<", endDate);
  }

  private querySwapEventsByDate(
    startDate: string,
    endDate: string,
    trx?: Knex.Transaction
  ): Promise<SwapEventRecord[]> {
    return this.getBuilderContext("swap_events_usdc_weth_3000", trx)
      .andWhere("date", ">=", startDate)
      .andWhere("date", "<", endDate);
  }

  private deserializeLiquidityEvent(
    event: LiquidityEventRecord
  ): LiquidityEvent {
    return {
      id: event.id,
      type: event.type,
      liquidity: JSBIDeserializer(event.liquidity),
      amount0: JSBIDeserializer(event.amount0),
      amount1: JSBIDeserializer(event.amount1),
      tick_lower: event.tick_lower,
      tick_upper: event.tick_upper,
      block_number: event.block_number,
      transaction_index: event.transaction_index,
      log_index: event.log_index,
      date: DateConverter.parseDate(event.date),
    };
  }

  private deserializeSwapEvent(event: SwapEventRecord): SwapEvent {
    return {
      id: event.id,
      type: EventType.SWAP,
      amount0: JSBIDeserializer(event.amount0),
      amount1: JSBIDeserializer(event.amount1),
      amountSpecified: JSBIDeserializer(event.amountSpecified),
      sqrt_price_x96: JSBIDeserializer(event.sqrt_price_x96),
      liquidity: JSBIDeserializer(event.liquidity),
      tick: event.tick,
      block_number: event.block_number,
      transaction_index: event.transaction_index,
      log_index: event.log_index,
      date: DateConverter.parseDate(event.date),
    };
  }

  private getBuilderContext(
    tableName: string,
    trx?: Knex.Transaction
  ): Knex.QueryBuilder {
    return trx ? trx(tableName) : this.knex(tableName);
  }
}