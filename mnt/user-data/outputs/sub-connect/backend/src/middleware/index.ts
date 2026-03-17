// =============================================================================
// SUB Connect — Middleware Collection
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ZodSchema, ZodError } from 'zod';
import { AppError, logger } from '../lib/index';

// ─── Augment Express Request ──────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      userId: string;
      userRole: string;
    }
  }
}

// ─── JWT Authentication ───────────────────────────────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('No authentication token provided', 401));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role: string;
    };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expired', 401));
    }
    return next(new AppError('Invalid token', 401));
  }
}

// ─── Zod Body Validation ─────────────────────────────────────────────────────
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

// ─── Role-based Access Control ────────────────────────────────────────────────
export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.userRole)) {
      return next(
        new AppError(`This action requires one of: ${roles.join(', ')}`, 403)
      );
    }
    next();
  };
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  // Prisma: unique constraint violation
  if ((err as { code?: string }).code === 'P2002') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  // Prisma: record not found
  if ((err as { code?: string }).code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  logger.error(`[${req.method}] ${req.path} — Unhandled error:`, err);

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && {
      details: (err as Error).message,
    }),
  });
}
