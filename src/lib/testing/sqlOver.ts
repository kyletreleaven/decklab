import type { DatabaseSync } from "node:sqlite";
import type { Sql } from "../sql";

/**
 * `$1`-style parameters, as the SQL plugin takes them, over `node:sqlite`,
 * which binds only anonymous `?` positionally: each `$n` becomes `?`, and the
 * parameters are laid out in the order the holes appear.
 */
export function sqlOver(db: DatabaseSync): Sql {
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
