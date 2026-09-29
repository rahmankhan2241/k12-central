/**
 * Persistent per-academic-year cache of Payment Report rows, stored in
 * IndexedDB. Rows are large (~95k rows / year, tens of MB of JSON), which
 * rules out localStorage — IndexedDB handles them fine.
 *
 * Used for stale-while-revalidate: on a cold start or a year switch we can
 * show the cached snapshot instantly, then refresh from Supabase only when
 * the cache is older than that year's last successful fetch (fetchNow writes
 * new rows, so an old cache entry must be ignored after it).
 */

const DB_NAME = "k12-payment-cache";
const STORE = "years";
const MAX_CACHED_YEARS = 5;

export type PaymentCacheEntry = {
  year: string;
  rows: import("./types").PaymentReportRow[];
  cachedAt: number; // epoch ms when this snapshot was written
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "year" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read one year's cached snapshot, or null. Never throws. */
export async function readPaymentCache(year: string): Promise<PaymentCacheEntry | null> {
  try {
    const db = await openDb();
    return await new Promise<PaymentCacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(year);
      req.onsuccess = () => resolve((req.result as PaymentCacheEntry) ?? null);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  } catch {
    return null; // private mode / storage blocked — app works without cache
  }
}

/** Persist one year's rows; prunes the oldest entries beyond MAX_CACHED_YEARS. Never throws. */
export async function writePaymentCache(year: string, rows: import("./types").PaymentReportRow[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ year, rows, cachedAt: Date.now() } satisfies PaymentCacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    await pruneCache();
  } catch {
    /* cache is best-effort */
  }
}

/** Keep at most MAX_CACHED_YEARS entries, evicting the ones written longest ago. */
async function pruneCache(): Promise<void> {
  const db = await openDb();
  try {
    const all = await new Promise<PaymentCacheEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as PaymentCacheEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    if (all.length <= MAX_CACHED_YEARS) return;
    const evict = all
      .sort((a, b) => a.cachedAt - b.cachedAt)
      .slice(0, all.length - MAX_CACHED_YEARS)
      .map((e) => e.year);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const y of evict) store.delete(y);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Drop one year's cache entry (e.g. after a failed refresh that left bad data). Never throws. */
export async function deletePaymentCache(year: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(year);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
  } catch {
    /* ignore */
  }
}
