import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { checkKey, PreconditionError } from './storage.ts';
import type { PutOptions, Storage, Stored } from './storage.ts';

async function toBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  const chunks: Buffer[] = [];
  if (!stream) return Buffer.alloc(0);
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number }).statusCode;

/**
 * Azure Blob Storage with the Web App's managed identity (DefaultAzureCredential).
 * The identity needs the "Storage Blob Data Contributor" role on the storage account or container.
 * No keys or connection strings are used.
 */
export class BlobStorage implements Storage {
  private container: ContainerClient;

  constructor(container: ContainerClient) {
    this.container = container;
  }

  static async create(accountUrl: string, containerName: string): Promise<BlobStorage> {
    const service = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
    const container = service.getContainerClient(containerName);
    try {
      await container.createIfNotExists(); // private by default
    } catch {
      // The container may already exist and the identity may lack permission to create containers.
    }
    return new BlobStorage(container);
  }

  async get(key: string): Promise<Stored | null> {
    try {
      const res = await this.container.getBlockBlobClient(checkKey(key)).download();
      return { data: await toBuffer(res.readableStreamBody), etag: res.etag ?? '' };
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  async put(key: string, data: Buffer, contentType: string, opts: PutOptions = {}): Promise<string> {
    const conditions = opts.ifMatch !== undefined ? { ifMatch: opts.ifMatch } : opts.ifNoneMatch ? { ifNoneMatch: '*' } : undefined;
    try {
      const res = await this.container
        .getBlockBlobClient(checkKey(key))
        .upload(data, data.length, { blobHTTPHeaders: { blobContentType: contentType }, conditions });
      return res.etag ?? '';
    } catch (e) {
      if (statusOf(e) === 412 || statusOf(e) === 409) throw new PreconditionError();
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(checkKey(key)).deleteIfExists();
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for await (const b of this.container.listBlobsFlat({ prefix })) out.push(b.name);
    return out.sort();
  }
}
