import type { SqlValue, TableBackedSqlDriver } from "./driver";

export type InMemorySqlDriver = TableBackedSqlDriver;

type Row = Record<string, unknown>;

class MemoryDriver implements InMemorySqlDriver {
  private readonly tables = new Map<string, Row[]>();

  async execute(sql: string, params: SqlValue[] = []): Promise<{ rowsAffected: number }> {
    const compactSql = sql.replace(/\s+/g, " ").trim();
    const normalized = normalizeSql(sql);

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      return { rowsAffected: 0 };
    }

    if (normalized.startsWith("CREATE TABLE")) {
      const match = compactSql.match(/^CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+)/i);
      if (match) {
        this.createTable(match[1].toLowerCase());
      }
      return { rowsAffected: 0 };
    }

    const insert = compactSql.match(/^INSERT(?: OR REPLACE)? INTO ([a-z_]+) \((.+?)\) VALUES \((.+?)\)/i);
    if (insert) {
      const table = insert[1].toLowerCase();
      const columns = insert[2].split(",").map((column) => column.trim().toLowerCase());
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      if (normalized.startsWith("INSERT OR REPLACE")) {
        await this.upsert(table, row);
      } else {
        await this.insert(table, row);
      }
      return { rowsAffected: 1 };
    }

    const update = compactSql.match(/^UPDATE ([a-z_]+) SET (.+?) WHERE (.+)$/i);
    if (update) {
      const table = update[1].toLowerCase();
      const patch = parseAssignments(update[2], params);
      const predicate = buildPredicate(update[3], params);
      const rowsAffected = await this.updateWhere(table, predicate, patch);
      return { rowsAffected };
    }

    const deleteStatement = compactSql.match(/^DELETE FROM ([a-z_]+)(?: WHERE (.+))?$/i);
    if (deleteStatement) {
      const table = deleteStatement[1].toLowerCase();
      const predicate = deleteStatement[2] ? buildPredicate(deleteStatement[2], params) : undefined;
      const rowsAffected = await this.deleteWhere(table, predicate);
      return { rowsAffected };
    }

    return { rowsAffected: 0 };
  }

  async select<TRecord extends Row>(sql: string, params: SqlValue[] = []): Promise<TRecord[]> {
    const compactSql = sql.replace(/\s+/g, " ").trim();
    const normalized = normalizeSql(sql);

    if (normalized.includes("FROM SQLITE_MASTER")) {
      return [...this.tables.keys()]
        .sort()
        .map((name) => ({ name }) as unknown as TRecord);
    }

    if (normalized.includes("FROM SCHEMA_MIGRATIONS")) {
      const table = await this.listTable<TRecord>("schema_migrations");
      if (normalized.includes("WHERE VERSION")) {
        return table.filter((row) => row.version === params[0]);
      }
      return table;
    }

    const select = compactSql.match(/^SELECT \* FROM ([a-z_]+)(?: WHERE (.*?))?(?: ORDER BY .*?)?(?: LIMIT \d+)?$/i);
    if (select) {
      const table = select[1].toLowerCase();
      const whereClause = select[2];
      const predicate = whereClause ? buildPredicate(whereClause, params) : undefined;
      return this.listTable<TRecord>(table, predicate as ((row: TRecord) => boolean) | undefined);
    }

    return [];
  }

  async transaction<T>(operation: (driver: InMemorySqlDriver) => Promise<T>): Promise<T> {
    const snapshot = cloneTables(this.tables);
    try {
      return await operation(this);
    } catch (error) {
      this.tables.clear();
      for (const [name, rows] of snapshot.entries()) {
        this.tables.set(name, rows);
      }
      throw error;
    }
  }

  hasTable(name: string): boolean {
    return this.tables.has(name);
  }

  createTable(name: string): void {
    if (!this.tables.has(name)) {
      this.tables.set(name, []);
    }
  }

  async insert(table: string, row: Row): Promise<void> {
    this.createTable(table);
    this.tables.get(table)?.push(cloneRow(row));
  }

  async upsert(table: string, row: Row, key = "id"): Promise<void> {
    this.createTable(table);
    const rows = this.tables.get(table);
    if (!rows) {
      return;
    }

    const index = rows.findIndex((candidate) => candidate[key] === row[key]);
    if (index >= 0) {
      rows[index] = cloneRow({ ...rows[index], ...row });
    } else {
      rows.push(cloneRow(row));
    }
  }

  async updateWhere(
    table: string,
    predicate: (row: Row) => boolean,
    patch: Row,
  ): Promise<number> {
    const rows = this.tables.get(table) ?? [];
    let count = 0;
    for (const row of rows) {
      if (predicate(row)) {
        Object.assign(row, patch);
        count += 1;
      }
    }
    return count;
  }

  async listTable<TRecord extends Row>(
    table: string,
    predicate?: (row: TRecord) => boolean,
  ): Promise<TRecord[]> {
    const rows = (this.tables.get(table) ?? []).map((row) => cloneRow(row) as TRecord);
    return predicate ? rows.filter(predicate) : rows;
  }

  async getById<TRecord extends Row>(table: string, id: string): Promise<TRecord | null> {
    const rows = await this.listTable<TRecord>(table);
    return rows.find((row) => row.id === id) ?? null;
  }

  async deleteWhere(table: string, predicate?: (row: Row) => boolean): Promise<number> {
    const rows = this.tables.get(table) ?? [];
    const nextRows = predicate ? rows.filter((row) => !predicate(row)) : [];
    this.tables.set(table, nextRows);
    return rows.length - nextRows.length;
  }
}

export function createInMemorySqlDriver(): InMemorySqlDriver {
  return new MemoryDriver();
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toUpperCase();
}

function cloneRow(row: Row): Row {
  return JSON.parse(JSON.stringify(row)) as Row;
}

function cloneTables(tables: Map<string, Row[]>): Map<string, Row[]> {
  return new Map([...tables.entries()].map(([name, rows]) => [name, rows.map(cloneRow)]));
}

function parseAssignments(assignments: string, params: SqlValue[]): Row {
  return Object.fromEntries(
    assignments.split(",").map((assignment) => {
      const match = assignment.trim().match(/^([a-z_]+)\s*=\s*\$(\d+)$/i);
      if (!match) {
        throw new Error(`Unsupported in-memory SQL assignment: ${assignment}`);
      }
      return [match[1].toLowerCase(), params[Number(match[2]) - 1]];
    }),
  );
}

function buildPredicate(whereClause: string, params: SqlValue[]): (row: Row) => boolean {
  const normalizedWhere = whereClause.replace(/\s+LIMIT\s+\d+$/i, "").replace(/\s+ORDER BY\s+.*$/i, "");
  const conditions = normalizedWhere.split(/\s+AND\s+/i).map((condition) => condition.trim());

  return (row) =>
    conditions.every((condition) => {
      const placeholderMatch = condition.match(/^([a-z_]+)\s*=\s*\$(\d+)$/i);
      if (placeholderMatch) {
        return row[placeholderMatch[1].toLowerCase()] === params[Number(placeholderMatch[2]) - 1];
      }

      const literalMatch = condition.match(/^([a-z_]+)\s*=\s*'?([^']+)'?$/i);
      if (literalMatch) {
        const rowValue = row[literalMatch[1].toLowerCase()];
        const literal = literalMatch[2];
        return String(rowValue) === literal;
      }

      throw new Error(`Unsupported in-memory SQL predicate: ${condition}`);
    });
}
