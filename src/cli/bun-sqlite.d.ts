/** The part of Bun's built-in SQLite the CLI uses (https://bun.sh/docs/api/sqlite). */
declare module "bun:sqlite" {
  export class Database {
    constructor(
      filename: string,
      options?: { readonly?: boolean; readwrite?: boolean; create?: boolean },
    );
    prepare(sql: string): {
      all(...params: never[]): unknown[];
      run(...params: never[]): unknown;
    };
    run(sql: string): unknown;
    fileControl(cmd: number, value: number): number;
    close(): void;
  }
  export const constants: { SQLITE_FCNTL_PERSIST_WAL: number };
}
