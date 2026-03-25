"use strict";
/**
 * Auth Routes — /api/v1/auth
 * JWT authentication: register, login, refresh, email verification, password reset
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
// ─── Schemas ──────────────────────────────────────────────────────────────────
const registerSchema = zod_1.z
    .object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z
        .string()
        .min(8)
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and a number'),
    role: zod_1.z.enum(['STUDENT', 'ALUMNI']),
    firstName: zod_1.z.string().min(2).max(50).trim(),
    lastName: zod_1.z.string().min(2).max(50).trim(),
    // Student
    department: zod_1.z.string().min(2).max(100).optional(),
    semester: zod_1.z.number().int().min(1).max(12).optional(),
    // Alumni
    graduationYear: zod_1.z
        .number()
        .int()
        .min(1990)
        .max(new Date().getFullYear())
        .optional(),
    currentCompany: zod_1.z.string().max(100).optional(),
    jobTitle: zod_1.z.string().max(100).optional(),
})
    .refine((d) => d.role !== 'STUDENT' ||
    (d.department !== undefined && d.semester !== undefined), { message: 'Students must provide department and semester' })
    .refine((d) => d.role !== 'ALUMNI' || d.graduationYear !== undefined, { message: 'Alumni must provide graduation year' });
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
const forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
const resetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().min(1),
    password: zod_1.z
        .string()
        .min(8)
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
});
// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTokens(userId, role) {
    const accessToken = jsonwebtoken_1.default.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jsonwebtoken_1.default.sign({ userId, role }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
}
function setRefreshCookie(res, token) {
    res.cookie('refreshToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/v1/auth',
    });
}
function calcProfileStrength(profile, role) {
    let score = 20;
    if (profile.bio)
        score += 15;
    if (profile.avatarUrl)
        score += 10;
    if (profile.location)
        score += 5;
    if (profile.website)
        score += 5;
    if (role === 'STUDENT') {
        if (profile.department)
            score += 15;
        if (profile.semester)
            score += 10;
    }
    else {
        if (profile.currentCompany)
            score += 15;
        if (profile.jobTitle)
            score += 10;
        if (profile.graduationYear)
            score += 10;
    }
    return Math.min(score, 100);
}
// ─── POST /register ───────────────────────────────────────────────────────────
router.post('/register', (0, index_2.validate)(registerSchema), async (req, res, next) => {
    try {
        const { email, password, role, firstName, lastName, department, semester, graduationYear, currentCompany, jobTitle, } = req.body;
        const existing = await index_1.prisma.user.findUnique({ where: { email } });
        if (existing)
            throw new index_1.AppError('Email already registered', 409);
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        const emailVerifyToken = crypto_1.default.randomBytes(32).toString('hex');
        const user = await index_1.prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: { email, password: hashedPassword, role, emailVerifyToken },
            });
            const profileData = { userId: newUser.id, firstName, lastName };
            if (role === 'STUDENT') {
                profileData.department = department;
                profileData.semester = semester;
            }
            else {
                profileData.graduationYear = graduationYear;
                if (currentCompany)
                    profileData.currentCompany = currentCompany;
                if (jobTitle)
                    profileData.jobTitle = jobTitle;
            }
            profileData.profileStrength = calcProfileStrength(profileData, role);
            await tx.profile.create({ data: profileData });
            return newUser;
        });
        // Fire-and-forget verification email
        (0, index_1.sendEmail)({
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
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /login ──────────────────────────────────────────────────────────────
router.post('/login', (0, index_2.validate)(loginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const user = await index_1.prisma.user.findUnique({
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
        if (!user)
            throw new index_1.AppError('Invalid email or password', 401);
        if (!await bcryptjs_1.default.compare(password, user.password)) {
            throw new index_1.AppError('Invalid email or password', 401);
        }
        if (!user.isActive)
            throw new index_1.AppError('Account has been deactivated', 403);
        await index_1.prisma.user.update({
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
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /refresh ────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
    try {
        const token = req.cookies?.refreshToken;
        if (!token)
            throw new index_1.AppError('No refresh token', 401);
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, process.env.JWT_REFRESH_SECRET);
        }
        catch {
            throw new index_1.AppError('Invalid or expired refresh token', 401);
        }
        const user = await index_1.prisma.user.findUnique({
            where: { id: payload.userId, isActive: true },
        });
        if (!user)
            throw new index_1.AppError('User not found', 401);
        const { accessToken, refreshToken } = generateTokens(user.id, user.role);
        setRefreshCookie(res, refreshToken);
        res.json({ accessToken });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /logout ─────────────────────────────────────────────────────────────
router.post('/logout', index_2.authenticate, (_req, res) => {
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ message: 'Logged out successfully' });
});
// ─── GET /verify-email ────────────────────────────────────────────────────────
router.get('/verify-email', async (req, res, next) => {
    try {
        const { token } = req.query;
        if (typeof token !== 'string')
            throw new index_1.AppError('Invalid token', 400);
        const user = await index_1.prisma.user.findFirst({
            where: { emailVerifyToken: token },
        });
        if (!user)
            throw new index_1.AppError('Invalid or expired verification link', 400);
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: { isEmailVerified: true, emailVerifyToken: null },
        });
        res.json({ message: 'Email verified successfully' });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /forgot-password ────────────────────────────────────────────────────
router.post('/forgot-password', (0, index_2.validate)(forgotPasswordSchema), async (req, res, next) => {
    try {
        const { email } = req.body;
        // Always return success to prevent email enumeration
        const user = await index_1.prisma.user.findUnique({ where: { email } });
        if (user) {
            const resetToken = crypto_1.default.randomBytes(32).toString('hex');
            await index_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    resetPasswordToken: resetToken,
                    resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
                },
            });
            await (0, index_1.sendEmail)({
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
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /reset-password ─────────────────────────────────────────────────────
router.post('/reset-password', (0, index_2.validate)(resetPasswordSchema), async (req, res, next) => {
    try {
        const { token, password } = req.body;
        const user = await index_1.prisma.user.findFirst({
            where: {
                resetPasswordToken: token,
                resetTokenExpiry: { gt: new Date() },
            },
        });
        if (!user)
            throw new index_1.AppError('Invalid or expired reset token', 400);
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetPasswordToken: null,
                resetTokenExpiry: null,
            },
        });
        res.json({ message: 'Password reset successfully' });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /me ──────────────────────────────────────────────────────────────────
router.get('/me', index_2.authenticate, async (req, res, next) => {
    try {
        const user = await index_1.prisma.user.findUnique({
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
        if (!user)
            throw new index_1.AppError('User not found', 404);
        res.json({ user });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
