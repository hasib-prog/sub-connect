// =============================================================================
// SUB Connect — Core Library Utilities
// =============================================================================

// ─── Prisma singleton ─────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(level: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export const logger = {
  info: (...a: unknown[]) => log('info', ...a),
  warn: (...a: unknown[]) => log('warn', ...a),
  error: (...a: unknown[]) => log('error', ...a),
  debug: (...a: unknown[]) => {
    if (process.env.NODE_ENV === 'development') log('debug', ...a);
  },
};

// ─── AppError ─────────────────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 500,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Redis Cache (with in-memory fallback) ────────────────────────────────────
import { createClient, type RedisClientType } from 'redis';

let _redis: RedisClientType | null = null;
const _memCache = new Map<string, { value: string; exp: number }>();

async function getRedis(): Promise<RedisClientType | null> {
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) return null;
  try {
    _redis = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
    _redis.on('error', (err: Error) => logger.warn('Redis client error:', err.message));
    await _redis.connect();
    logger.info('✅ Redis connected');
    return _redis;
  } catch (err) {
    logger.warn('Redis unavailable — using in-memory cache fallback');
    return null;
  }
}

export const cache = {
  async get(key: string): Promise<string | null> {
    const redis = await getRedis();
    if (redis) return redis.get(key);
    const item = _memCache.get(key);
    if (!item || item.exp < Date.now()) {
      _memCache.delete(key);
      return null;
    }
    return item.value;
  },

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    const redis = await getRedis();
    if (redis) {
      await redis.setEx(key, ttlSeconds, value);
      return;
    }
    _memCache.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
  },

  async del(key: string): Promise<void> {
    const redis = await getRedis();
    if (redis) { await redis.del(key); return; }
    _memCache.delete(key);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    const redis = await getRedis();
    if (redis) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(keys);
      return;
    }
    for (const key of _memCache.keys()) {
      if (key.includes(pattern.replace('*', ''))) _memCache.delete(key);
    }
  },
};

// ─── Notifications helper ─────────────────────────────────────────────────────
import { NotificationType } from '@prisma/client';

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data ?? {},
    },
  });
}

// ─── Email (Nodemailer) ───────────────────────────────────────────────────────
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const emailTemplate = (content: string) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; }
  .container { max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 32px; text-align: center; }
  .header h1 { color: white; margin: 0; font-size: 24px; }
  .body { padding: 32px; color: #374151; line-height: 1.6; }
  .btn { display: inline-block; background: #3b82f6; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .footer { padding: 16px 32px; background: #f9fafb; font-size: 12px; color: #9ca3af; }
</style></head>
<body>
  <div class="container">
    <div class="header"><h1>SUB Connect</h1></div>
    <div class="body">${content}</div>
    <div class="footer">© ${new Date().getFullYear()} SUB Connect. All rights reserved.</div>
  </div>
</body>
</html>
`;

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!process.env.SMTP_USER) {
    logger.warn(`[Email] Skipped (no SMTP config) → ${params.to}: ${params.subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"SUB Connect" <${process.env.SMTP_FROM || 'noreply@subconnect.edu'}>`,
      to: params.to,
      subject: params.subject,
      html: emailTemplate(params.html),
    });
  } catch (err) {
    logger.error('Email send failed:', err);
  }
}
