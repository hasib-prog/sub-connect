/**
 * Auth Routes — /api/v1/auth
 * JWT authentication: register, login, refresh, email verification, password reset
 */

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma, AppError, sendEmail } from '../../lib/index';
import { validate, authenticate } from '../../middleware/index';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8)
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain uppercase, lowercase, and a number'
      ),
    role: z.enum(['STUDENT', 'ALUMNI']),
    firstName: z.string().min(2).max(50).trim(),
    lastName: z.string().min(2).max(50).trim(),
    // Student
    department: z.string().min(2).max(100).optional(),
    semester: z.number().int().min(1).max(12).optional(),
    // Alumni
    graduationYear: z
      .number()
      .int()
      .min(1990)
      .max(new Date().getFullYear())
      .optional(),
    currentCompany: z.string().max(100).optional(),
    jobTitle: z.string().max(100).optional(),
  })
  .refine(
    (d) =>
      d.role !== 'STUDENT' ||
      (d.department !== undefined && d.semester !== undefined),
    { message: 'Students must provide department and semester' }
  )
  .refine(
    (d) => d.role !== 'ALUMNI' || d.graduationYear !== undefined,
    { message: 'Alumni must provide graduation year' }
  );

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTokens(userId: string, role: string) {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { userId, role },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

function setRefreshCookie(res: any, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  });
}

function calcProfileStrength(profile: any, role: string): number {
  let score = 20;
  if (profile.bio) score += 15;
  if (profile.avatarUrl) score += 10;
  if (profile.location) score += 5;
  if (profile.website) score += 5;
  if (role === 'STUDENT') {
    if (profile.department) score += 15;
    if (profile.semester) score += 10;
  } else {
    if (profile.currentCompany) score += 15;
    if (profile.jobTitle) score += 10;
    if (profile.graduationYear) score += 10;
  }
  return Math.min(score, 100);
}

// ─── POST /register ───────────────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const {
      email,
      password,
      role,
      firstName,
      lastName,
      department,
      semester,
      graduationYear,
      currentCompany,
      jobTitle,
    } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already registered', 409);

    const hashedPassword = await bcrypt.hash(password, 12);
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { email, password: hashedPassword, role, emailVerifyToken },
      });

      const profileData: any = { userId: newUser.id, firstName, lastName };
      if (role === 'STUDENT') {
        profileData.department = department;
        profileData.semester = semester;
      } else {
        profileData.graduationYear = graduationYear;
        if (currentCompany) profileData.currentCompany = currentCompany;
        if (jobTitle) profileData.jobTitle = jobTitle;
      }

      profileData.profileStrength = calcProfileStrength(profileData, role);
      await tx.profile.create({ data: profileData });
      return newUser;
    });

    // Fire-and-forget verification email
    sendEmail({
      to: email,
      subject: 'Verify your SUB Connect email',
      html: `
        <h2>Welcome, ${firstName}!</h2>
        <p>Thanks for joining SUB Connect. Please verify your email to get started.</p>
        <p style="margin: 24px 0;">
          <a href="${process.env.FRONTEND_URL}/verify-email?token=${emailVerifyToken}" class="btn">
            Verify Email Address
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours.</p>
      `,
    }).catch(console.error);

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      message: 'Account created! Please verify your email.',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmailVerified: false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /login ──────────────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        profile: {
          select: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            profileStrength: true,
            isOpenToWork: true,
            department: true,
            semester: true,
            jobTitle: true,
            currentCompany: true,
          },
        },
      },
    });

    if (!user) throw new AppError('Invalid email or password', 401);
    if (!await bcrypt.compare(password, user.password)) {
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.isActive) throw new AppError('Account has been deactivated', 403);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeen: new Date() },
    });

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        profile: user.profile,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /refresh ────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) throw new AppError('No refresh token', 401);

    let payload: { userId: string; role: string };
    try {
      payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
    } catch {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId, isActive: true },
    });
    if (!user) throw new AppError('User not found', 401);

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────
router.post('/logout', authenticate, (_req, res) => {
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  res.json({ message: 'Logged out successfully' });
});

// ─── GET /verify-email ────────────────────────────────────────────────────────
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (typeof token !== 'string') throw new AppError('Invalid token', 400);

    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });
    if (!user) throw new AppError('Invalid or expired verification link', 400);

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifyToken: null },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /forgot-password ────────────────────────────────────────────────────
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body;
      // Always return success to prevent email enumeration
      const user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        const resetToken = crypto.randomBytes(32).toString('hex');
        await prisma.user.update({
          where: { id: user.id },
          data: {
            resetPasswordToken: resetToken,
            resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        await sendEmail({
          to: email,
          subject: 'Reset your SUB Connect password',
          html: `
            <h2>Password Reset Request</h2>
            <p>We received a request to reset your password.</p>
            <p style="margin: 24px 0;">
              <a href="${process.env.FRONTEND_URL}/reset-password?token=${resetToken}" class="btn">
                Reset Password
              </a>
            </p>
            <p style="color: #6b7280; font-size: 14px;">
              This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
            </p>
          `,
        });
      }

      res.json({
        message: 'If that email exists, a reset link has been sent.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /reset-password ─────────────────────────────────────────────────────
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  async (req, res, next) => {
    try {
      const { token, password } = req.body;

      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
          resetTokenExpiry: { gt: new Date() },
        },
      });
      if (!user) throw new AppError('Invalid or expired reset token', 400);

      const hashedPassword = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
          resetTokenExpiry: null,
        },
      });

      res.json({ message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /me ──────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        role: true,
        isEmailVerified: true,
        lastSeen: true,
        createdAt: true,
        profile: {
          include: {
            skills: { include: { skill: true } },
            experiences: { orderBy: { startDate: 'desc' } },
            education: { orderBy: { startYear: 'desc' } },
            projects: true,
          },
        },
      },
    });

    if (!user) throw new AppError('User not found', 404);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
