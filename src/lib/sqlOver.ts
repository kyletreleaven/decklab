import type { Sql } from "./sql";

/**
 * A synchronous SQLite connection, as `node:sqlite` (`DatabaseSync`) and
 * `bun:sqlite` (`Database`) both provide one.
 */
export interface SyncSqlite {
  prepare(sql: string): {
    all(...params: never[]): unknown[];
    run(...params: never[]): unknown;
  };
}

/**
 * `$1`-style parameters, as the SQL plugin takes them, over a synchronous
 * SQLite. Neither runtime binds `$n` by its number: `node:sqlite` binds only
 * anonymous `?` positionally, and `bun:sqlite` numbers parameters in the
 * order they first appear. So each `$n` becomes `?`, and the parameters are
 * laid out in the order the holes appear.
 *
 * The CLI's floor (docs/cli.md), and the tests' way onto a real SQLite file.
 */
export function sqlOver(db: SyncSqlite): Sql {
  const bind = (sql: string, params: unknown[]) => {
    const order: number[] = [];
    const text = sql.replace(/\$(\d+)/g, (_, n: string) => {
      order.push(Number(n) - 1);
      return "?";
    });
    return { stmt: db.prepare(text), args: order.map((i) => params[i]) as never[] };
  };
  return {
    async select<T>(sql: string, params: unknown[] = []) {
      const { stmt, args } = bind(sql, params);
      return stmt.all(...args) as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const { stmt, args } = bind(sql, params);
      stmt.run(...args);
    },
  };
}
