import * as lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import type {
  SemanticDocumentRow,
  SemanticDocumentSource,
  SemanticSearchHit,
} from './types.js';
import { twitterSemanticStorePath } from './paths.js';

function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function idsWhereClause(ids: string[]): string {
  return `id IN (${ids.map(quoteSql).join(', ')})`;
}

function distanceToScore(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - (Math.max(0, distance) / 2)));
}

function toUnitVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return vector;
  return vector.map((value) => value / magnitude);
}

function toRecordArray<T>(rows: T[]): Record<string, unknown>[] {
  return rows as unknown as Record<string, unknown>[];
}

function normalizeVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number');
  }
  if (value && typeof value === 'object' && Symbol.iterator in value) {
    return Array.from(value as Iterable<unknown>).filter((entry): entry is number => typeof entry === 'number');
  }
  if (value && typeof value === 'object' && 'toArray' in value && typeof (value as { toArray?: () => unknown }).toArray === 'function') {
    const result = (value as { toArray: () => unknown }).toArray();
    if (Array.isArray(result)) {
      return result.filter((entry): entry is number => typeof entry === 'number');
    }
    if (result && typeof result === 'object' && Symbol.iterator in result) {
      return Array.from(result as Iterable<unknown>).filter((entry): entry is number => typeof entry === 'number');
    }
    return [];
  }
  return [];
}

function normalizeDocumentRow(row: Record<string, unknown>): SemanticDocumentRow {
  return {
    id: String(row.id),
    source: row.source as SemanticDocumentSource,
    tweetId: String(row.tweetId),
    url: String(row.url),
    authorHandle: typeof row.authorHandle === 'string' ? row.authorHandle : undefined,
    authorName: typeof row.authorName === 'string' ? row.authorName : undefined,
    postedAt: typeof row.postedAt === 'string' ? row.postedAt : null,
    text: String(row.text),
    textHash: String(row.textHash),
    embeddingVersion: String(row.embeddingVersion),
    vector: normalizeVector(row.vector),
  };
}

export class SemanticStore {
  private readonly connection: Connection;

  private constructor(connection: Connection) {
    this.connection = connection;
  }

  static async open(uri = twitterSemanticStorePath()): Promise<SemanticStore> {
    const connection = await lancedb.connect(uri);
    return new SemanticStore(connection);
  }

  async close(): Promise<void> {
    this.connection.close();
  }

  async tableNames(): Promise<string[]> {
    return this.connection.tableNames();
  }

  private async openTableIfExists(name: 'documents'): Promise<Table | null> {
    const tables = await this.connection.tableNames();
    if (!tables.includes(name)) return null;
    return this.connection.openTable(name);
  }

  private async ensureTable(name: 'documents', rows: Array<Record<string, unknown>>): Promise<Table | null> {
    if (rows.length === 0) {
      return this.openTableIfExists(name);
    }
    const existing = await this.openTableIfExists(name);
    if (existing) return existing;
    return this.connection.createTable(name, rows, { mode: 'create', existOk: true });
  }

  async getDocumentsByIds(ids: string[]): Promise<Map<string, SemanticDocumentRow>> {
    if (ids.length === 0) return new Map();
    const table = await this.openTableIfExists('documents');
    if (!table) return new Map();
    const rows = await table.query().where(idsWhereClause(ids)).toArray();
    return new Map(rows.map((row: Record<string, unknown>) => {
      const normalized = normalizeDocumentRow(row);
      return [normalized.id, normalized];
    }));
  }

  async upsertDocuments(rows: SemanticDocumentRow[]): Promise<void> {
    const table = await this.ensureTable('documents', toRecordArray(rows));
    if (!table || rows.length === 0) return;
    const ids = rows.map((row) => row.id);
    const existing = await this.getDocumentsByIds(ids);
    const changed = rows.filter((row) => {
      const current = existing.get(row.id);
      return !current
        || current.textHash !== row.textHash
        || current.embeddingVersion !== row.embeddingVersion;
    });
    if (changed.length === 0) return;
    const changedIds = changed.map((row) => row.id);
    if (changedIds.length > 0 && existing.size > 0) {
      await table.delete(idsWhereClause(changedIds));
    }
    await table.add(toRecordArray(changed.map((row) => ({
      ...row,
      vector: toUnitVector(row.vector),
    }))), { mode: 'append' });
  }

  async deleteDocumentIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const table = await this.openTableIfExists('documents');
    if (!table) return;
    await table.delete(idsWhereClause(ids));
  }

  async listDocumentsBySource(source: SemanticDocumentSource): Promise<SemanticDocumentRow[]> {
    const table = await this.openTableIfExists('documents');
    if (!table) return [];
    const rows = await table.query().where(`source = ${quoteSql(source)}`).toArray();
    return rows.map((row: Record<string, unknown>) => normalizeDocumentRow(row));
  }

  async searchDocuments(vector: number[], source: SemanticDocumentSource, limit = 5): Promise<SemanticSearchHit[]> {
    const table = await this.openTableIfExists('documents');
    if (!table) return [];
    const rows = await table
      .vectorSearch(toUnitVector(vector))
      .distanceType('cosine')
      .column('vector')
      .where(`source = ${quoteSql(source)}`)
      .limit(limit)
      .toArray();
    return rows.map((row: Record<string, unknown>) => {
      const normalized = normalizeDocumentRow(row);
      const distance = Number(row._distance ?? 0);
      return {
        id: normalized.id,
        distance,
        score: distanceToScore(distance),
        row: normalized,
      };
    });
  }

  async countDocumentsBySource(source: SemanticDocumentSource): Promise<number> {
    const table = await this.openTableIfExists('documents');
    if (!table) return 0;
    return table.countRows(`source = ${quoteSql(source)}`);
  }
}
