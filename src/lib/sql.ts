/**
 * What code that takes its database as a parameter needs of it: the SQL
 * plugin's two calls, with `$1`-style parameters. Taking one rather than
 * importing `db.ts` lets the same code run on a real SQLite file in tests.
 */
export interface Sql {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}
