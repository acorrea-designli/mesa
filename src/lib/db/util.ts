import { randomBytes } from "node:crypto";

type Row = Record<string, unknown>;

/** Short, sortable-enough ids: prefix + 12 base36 chars. */
export function newId(prefix: string): string {
  const n = BigInt("0x" + randomBytes(8).toString("hex"));
  return `${prefix}_${n.toString(36).padStart(12, "0").slice(0, 12)}`;
}

export const nowIso = (now: Date = new Date()) => now.toISOString();

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export interface MapSpec {
  json?: string[]; // snake_case column names holding JSON
  bool?: string[]; // snake_case column names holding 0/1
}

/** Map a snake_case SQLite row to a camelCase domain object. */
export function fromRow<T>(row: unknown, spec: MapSpec = {}): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row as Row)) {
    let val: unknown = v;
    if (spec.json?.includes(k)) val = v == null ? null : JSON.parse(String(v));
    else if (spec.bool?.includes(k)) val = Boolean(v);
    out[camel(k)] = val;
  }
  return out as T;
}

export function fromRows<T>(rows: unknown[], spec: MapSpec = {}): T[] {
  return rows.map((r) => fromRow<T>(r, spec));
}

type SqlValue = string | number | bigint | null | Uint8Array;

/** Turn a camelCase patch into `col = ?` assignments, encoding JSON and booleans. */
export function toAssignments(
  patch: Record<string, unknown>,
  spec: MapSpec = {},
): { sql: string; values: SqlValue[] } {
  const cols: string[] = [];
  const values: SqlValue[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = snake(k);
    cols.push(`${col} = ?`);
    values.push(encode(col, v, spec));
  }
  return { sql: cols.join(", "), values };
}

export function encode(col: string, v: unknown, spec: MapSpec = {}): SqlValue {
  if (v === null || v === undefined) return null;
  if (spec.json?.includes(col)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v as SqlValue;
}

/** Insert a camelCase object into a table. */
export function insertSql(
  table: string,
  obj: Record<string, unknown>,
  spec: MapSpec = {},
): { sql: string; values: SqlValue[] } {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => snake(k));
  const values = entries.map(([k, v]) => encode(snake(k), v, spec));
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    values,
  };
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`);
    this.name = "NotFoundError";
  }
}

/** A request the repo cannot accept because of its content (HTTP 400). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** A request that is understood but not allowed for this caller (HTTP 403): editing a mark someone else made. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}
