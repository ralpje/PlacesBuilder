import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';

export interface Stored {
  data: Buffer;
  etag: string;
}

export interface PutOptions {
  ifMatch?: string; // only write when the stored version still has this etag
  ifNoneMatch?: '*'; // only write when the key does not exist yet
}

export class PreconditionError extends Error {
  constructor(message = 'The stored version changed.') {
    super(message);
    this.name = 'PreconditionError';
  }
}

export interface Storage {
  get(key: string): Promise<Stored | null>;
  put(key: string, data: Buffer, contentType: string, opts?: PutOptions): Promise<string>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Keys under the prefix with their size in bytes (used for storage limits). */
  listWithSize(prefix: string): Promise<{ key: string; size: number }[]>;
}

/** Keys are plain relative paths made of safe segments. Anything else is a bug or an attack. */
export function checkKey(key: string): string {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(key) || key.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return key;
}

/** Files on disk. Used for development and tests; production uses Azure Blob Storage. */
export class LocalStorage implements Storage {
  private root: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(this.root, checkKey(key));
    if (!p.startsWith(this.root + sep)) throw new Error('Key escapes the data folder.');
    return p;
  }

  private async etagOf(p: string): Promise<string | null> {
    try {
      const s = await stat(p);
      return `${s.size}-${Math.floor(s.mtimeMs * 1000)}`;
    } catch {
      return null;
    }
  }

  /** Serialises writes to the same key inside this process so check-and-write is atomic. */
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next.catch(() => undefined));
    return next;
  }

  async get(key: string): Promise<Stored | null> {
    const p = this.path(key);
    const etag = await this.etagOf(p);
    if (etag === null) return null;
    try {
      return { data: await readFile(p), etag };
    } catch {
      return null;
    }
  }

  async put(key: string, data: Buffer, _contentType: string, opts: PutOptions = {}): Promise<string> {
    const p = this.path(key);
    return this.locked(key, async () => {
      const current = await this.etagOf(p);
      if (opts.ifNoneMatch === '*' && current !== null) throw new PreconditionError('Already exists.');
      if (opts.ifMatch !== undefined && current !== opts.ifMatch) throw new PreconditionError();
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${randomUUID()}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, p);
      return (await this.etagOf(p)) as string;
    });
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.root;
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith('.tmp')) out.push(full.slice(base.length + 1).split(sep).join('/'));
      }
    };
    await walk(base);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async listWithSize(prefix: string): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    for (const key of await this.list(prefix)) {
      try {
        out.push({ key, size: (await stat(this.path(key))).size });
      } catch {
        // removed in the meantime
      }
    }
    return out;
  }
}

export async function createStorage(cfg: Config): Promise<Storage> {
  if (cfg.storageAccountUrl) {
    const { BlobStorage } = await import('./blobStorage.ts');
    return BlobStorage.create(cfg.storageAccountUrl, cfg.container);
  }
  return new LocalStorage(cfg.dataDir);
}
