import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * All environment variables are validated once at startup.
 * If something is missing or malformed the server refuses to start
 * with a clear message, instead of failing later in a confusing way.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  STORAGE_QUOTA_MB: z.coerce.number().positive().default(5120),
  // "local" = files are saved on this computer, "r2" = Cloudflare R2.
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  // Folder for local storage (relative paths are relative to the server/ folder).
  LOCAL_STORAGE_DIR: z.string().min(1).default('./storage'),
  // R2 settings are only required when STORAGE_DRIVER=r2.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.STORAGE_DRIVER !== 'r2') return;
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
    if (!v[key] || v[key].startsWith('your-')) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=r2` });
    }
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Copy server/.env.example to server/.env and fill in the values.');
  process.exit(1);
}

// The server/ folder, whether running from src/ (tsx) or dist/ (built).
const serverRoot = fileURLToPath(new URL('../', import.meta.url));

export const env = {
  ...parsed.data,
  localStorageDir: resolve(serverRoot, parsed.data.LOCAL_STORAGE_DIR),
  isProduction: parsed.data.NODE_ENV === 'production',
  maxUploadBytes: Math.floor(parsed.data.MAX_UPLOAD_MB * 1024 * 1024),
  storageQuotaBytes: Math.floor(parsed.data.STORAGE_QUOTA_MB * 1024 * 1024),
  sessionTtlMs: parsed.data.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
};
