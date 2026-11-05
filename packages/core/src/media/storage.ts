import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

/**
 * File storage over the S3 API: Cloudflare R2 in production, Supabase Storage locally.
 * Configured with STORAGE_* environment variables (see .env.example).
 */
const envSchema = z.object({
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default('auto'),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  /** Public base URL where files in the bucket are served, without a trailing slash. */
  STORAGE_PUBLIC_URL: z.url(),
});

export type StorageConfig = z.infer<typeof envSchema>;

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`File storage is not configured (${fields}). See .env.example.`);
  }
  return { ...parsed.data, STORAGE_PUBLIC_URL: parsed.data.STORAGE_PUBLIC_URL.replace(/\/+$/, '') };
}

let client: { s3: S3Client; config: StorageConfig } | undefined;

function getClient() {
  if (!client) {
    const config = getStorageConfig();
    client = {
      config,
      s3: new S3Client({
        endpoint: config.STORAGE_ENDPOINT,
        region: config.STORAGE_REGION,
        credentials: {
          accessKeyId: config.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
        },
        // Supabase Storage needs path-style URLs; R2 accepts them too.
        forcePathStyle: true,
      }),
    };
  }
  return client;
}

export async function putFile(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const { s3, config } = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: config.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // File names are unique per upload, so they never change: cache for a year.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function deleteFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { s3, config } = getClient();
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: config.STORAGE_BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

/** Public URL of a stored file. */
export function publicFileUrl(key: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${getStorageConfig(env).STORAGE_PUBLIC_URL}/${key}`;
}
