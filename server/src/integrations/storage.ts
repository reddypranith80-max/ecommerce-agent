import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/** Storage driver interface: swap the local driver for Cloudinary/S3 without touching services. */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  url(key: string): string;
}

class LocalDiskStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async remove(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  url(key: string): string {
    return `/uploads/${key}`;
  }
}

export const storage: StorageDriver = new LocalDiskStorage(env.UPLOAD_DIR);

export function mediaUrl(key: string | null | undefined): string | null {
  return key ? storage.url(key) : null;
}
