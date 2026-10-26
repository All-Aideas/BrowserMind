import type { BenchmarkReport } from "./benchmark";
import type { ProductQaReport } from "./productQa";
import type { DiagnosticSession } from "./types";

export const MEMORY_LIMITS = {
  sourceChars: 500_000,
  tracebackChars: 100_000,
} as const;

export interface SourceMemoryRecord {
  version: 1;
  savedAt: string;
  selectedSampleId: string;
  benchmarkMode: boolean;
  code: string;
  traceback: string;
}

export interface SessionMemoryRecord {
  version: 1;
  savedAt: string;
  session?: DiagnosticSession;
  productQa?: ProductQaReport;
}

export interface BenchmarkMemoryRecord {
  version: 1;
  savedAt: string;
  report?: BenchmarkReport;
}

export interface MemorySnapshot {
  source?: SourceMemoryRecord;
  session?: SessionMemoryRecord;
  benchmark?: BenchmarkMemoryRecord;
}

export interface MemorySaveInput {
  source: Omit<SourceMemoryRecord, "version" | "savedAt">;
  session?: Omit<SessionMemoryRecord, "version" | "savedAt">;
  benchmark?: Omit<BenchmarkMemoryRecord, "version" | "savedAt">;
  savedAt?: string;
}

export type MemoryBucket = "source" | "session" | "benchmark";

export interface MemoryBackend {
  get<T>(bucket: MemoryBucket, key: string): Promise<T | undefined>;
  put<T>(bucket: MemoryBucket, key: string, value: T): Promise<void>;
  delete(bucket: MemoryBucket, key: string): Promise<void>;
}

const DATABASE_NAME = "browsermind-data-memory";
const DATABASE_VERSION = 1;
const CURRENT_KEY = "current";
const BUCKETS: readonly MemoryBucket[] = ["source", "session", "benchmark"];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      BUCKETS.forEach((bucket) => {
        if (!database.objectStoreNames.contains(bucket)) database.createObjectStore(bucket);
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la memoria local."));
  });
}

export function createInMemoryBackend(): MemoryBackend {
  const buckets = new Map<MemoryBucket, Map<string, unknown>>(
    BUCKETS.map((bucket) => [bucket, new Map<string, unknown>()]),
  );
  return {
    async get<T>(bucket: MemoryBucket, key: string) {
      return buckets.get(bucket)?.get(key) as T | undefined;
    },
    async put<T>(bucket: MemoryBucket, key: string, value: T) {
      buckets.get(bucket)?.set(key, value);
    },
    async delete(bucket: MemoryBucket, key: string) {
      buckets.get(bucket)?.delete(key);
    },
  };
}

export function createIndexedDbBackend(factory?: IDBFactory): MemoryBackend {
  if (!factory) return createInMemoryBackend();
  let database: Promise<IDBDatabase> | undefined;
  const getDatabase = () => database ??= openDatabase(factory);

  return {
    async get<T>(bucket: MemoryBucket, key: string) {
      const db = await getDatabase();
      const transaction = db.transaction(bucket, "readonly");
      return requestResult(transaction.objectStore(bucket).get(key)) as Promise<T | undefined>;
    },
    async put<T>(bucket: MemoryBucket, key: string, value: T) {
      const db = await getDatabase();
      await requestResult(db.transaction(bucket, "readwrite").objectStore(bucket).put(value, key));
    },
    async delete(bucket: MemoryBucket, key: string) {
      const db = await getDatabase();
      await requestResult(db.transaction(bucket, "readwrite").objectStore(bucket).delete(key));
    },
  };
}

export function createBrowserMindMemory(backend?: MemoryBackend): BrowserMindMemory {
  const factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
  return new BrowserMindMemory(backend ?? createIndexedDbBackend(factory));
}

export class BrowserMindMemory {
  constructor(private readonly backend: MemoryBackend) {}

  async load(): Promise<MemorySnapshot> {
    const [source, session, benchmark] = await Promise.all([
      this.backend.get<SourceMemoryRecord>("source", CURRENT_KEY),
      this.backend.get<SessionMemoryRecord>("session", CURRENT_KEY),
      this.backend.get<BenchmarkMemoryRecord>("benchmark", CURRENT_KEY),
    ]);
    return { source, session, benchmark };
  }

  async save(snapshot: MemorySaveInput): Promise<void> {
    if (snapshot.source.code.length > MEMORY_LIMITS.sourceChars) {
      throw new Error(`La fuente supera el límite local de ${MEMORY_LIMITS.sourceChars.toLocaleString()} caracteres.`);
    }
    if (snapshot.source.traceback.length > MEMORY_LIMITS.tracebackChars) {
      throw new Error(`El traceback supera el límite local de ${MEMORY_LIMITS.tracebackChars.toLocaleString()} caracteres.`);
    }

    const savedAt = snapshot.savedAt ?? new Date().toISOString();
    await Promise.all([
      this.backend.put("source", CURRENT_KEY, { ...snapshot.source, version: 1, savedAt } satisfies SourceMemoryRecord),
      snapshot.session
        ? this.backend.put("session", CURRENT_KEY, { ...snapshot.session, version: 1, savedAt } satisfies SessionMemoryRecord)
        : this.backend.delete("session", CURRENT_KEY),
      snapshot.benchmark
        ? this.backend.put("benchmark", CURRENT_KEY, { ...snapshot.benchmark, version: 1, savedAt } satisfies BenchmarkMemoryRecord)
        : this.backend.delete("benchmark", CURRENT_KEY),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all(BUCKETS.map((bucket) => this.backend.delete(bucket, CURRENT_KEY)));
  }
}
