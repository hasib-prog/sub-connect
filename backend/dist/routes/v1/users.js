"use strict";
/**
 * Users Routes — /api/v1/users
 * Profile CRUD, hover-card preview (cached), alumni suggestions
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
// ─── GET /users/:id/preview  ← THE HOVER CARD ENDPOINT ───────────────────────
// Critical: cached 60s, returns only ~8 fields, no heavy joins
router.get('/:id/preview', index_2.authenticate, async (req, res, next) => {
    try {
        const cacheKey = `user:preview:${req.params.id}`;
        const cached = await index_1.cache.get(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(JSON.parse(cached));
        }
        const user = await index_1.prisma.user.findUnique({
            where: { id: req.params.id, isActive: true },
            select: {
                id: true,
                role: true,
                profile: {
                    select: {
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                        isOpenToWork: true,
                        isOpenToMentor: true,
                        // Student
                        department: true,
                        semester: true,
                        // Alumni
                        jobTitle: true,
                        currentCompany: true,
                        graduationYear: true,
                        skills: {
                            take: 5,
                            select: { skill: { select: { name: true } } },
                        },
                    },
                },
            },
        });
        if (!user?.profile)
            throw new index_1.AppError('User not found', 404);
        const preview = {
            id: user.id,
            role: user.role,
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            avatarUrl: user.profile.avatarUrl,
            isOpenToWork: user.profile.isOpenToWork,
            isOpenToMentor: user.profile.isOpenToMentor,
            ...(user.role === 'STUDENT'
                ? {
                    department: user.profile.department,
                    semester: user.profile.semester,
                    skills: user.profile.skills.map((s) => s.skill.name),
                }
                : {
                    jobTitle: user.profile.jobTitle,
                    company: user.profile.currentCompany,
                    graduationYear: user.profile.graduationYear,
                    skills: user.profile.skills.map((s) => s.skill.name),
                }),
        };
        await index_1.cache.set(cacheKey, JSON.stringify(preview), 60);
        res.setHeader('X-Cache', 'MISS');
        res.json(preview);
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /users/:id  (full profile) ──────────────────────────────────────────
router.get('/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const user = await index_1.prisma.user.findUnique({
            where: { id: req.params.id, isActive: true },
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
                _count: {
                    select: {
                        posts: true,
                        connectionsFrom: { where: { status: 'ACCEPTED' } },
                        mentorships: true,
                    },
                },
            },
        });
        if (!user)
            throw new index_1.AppError('User not found', 404);
        // Connection status between viewer and this profile
        let connectionStatus = null;
        if (req.userId !== req.params.id) {
            const connection = await index_1.prisma.connection.findFirst({
                where: {
                    OR: [
                        { fromId: req.userId, toId: req.params.id },
                        { fromId: req.params.id, toId: req.userId },
                    ],
                },
                select: { id: true, status: true, fromId: true },
            });
            connectionStatus = connection
                ? {
                    status: connection.status,
                    isInitiator: connection.fromId === req.userId,
                }
                : null;
        }
        res.json({ user, connectionStatus });
    }
    catch (err) {
        next(err);
    }
});
// ─── PUT /users/profile ───────────────────────────────────────────────────────
const updateProfileSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(2).max(50).optional(),
    lastName: zod_1.z.string().min(2).max(50).optional(),
    bio: zod_1.z.string().max(500).optional(),
    location: zod_1.z.string().max(100).optional(),
    website: zod_1.z.string().url().optional().or(zod_1.z.literal('')),
    phone: zod_1.z.string().optional(),
    avatarUrl: zod_1.z.string().url().optional(),
    coverUrl: zod_1.z.string().url().optional(),
    isOpenToWork: zod_1.z.boolean().optional(),
    isOpenToMentor: zod_1.z.boolean().optional(),
    department: zod_1.z.string().optional(),
    semester: zod_1.z.number().int().min(1).max(12).optional(),
    graduationYear: zod_1.z.number().int().min(1990).optional(),
    currentCompany: zod_1.z.string().max(100).optional(),
    jobTitle: zod_1.z.string().max(100).optional(),
    industry: zod_1.z.string().max(100).optional(),
    yearsExperience: zod_1.z.number().int().min(0).optional(),
    skills: zod_1.z
        .array(zod_1.z.object({
        name: zod_1.z.string().min(1).max(50),
        level: zod_1.z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    }))
        .max(30)
        .optional(),
});
router.put('/profile', index_2.authenticate, (0, index_2.validate)(updateProfileSchema), async (req, res, next) => {
    try {
        const { skills, ...profileFields } = req.body;
        const updatedProfile = await index_1.prisma.$transaction(async (tx) => {
            const profile = await tx.profile.update({
                where: { userId: req.userId },
                data: profileFields,
            });
            if (skills !== undefined) {
                await tx.profileSkill.deleteMany({ where: { profileId: profile.id } });
                for (const { name, level } of skills) {
                    const normalizedName = name.toLowerCase().trim();
                    const skill = await tx.skill.upsert({
                        where: { name: normalizedName },
                        update: {},
                        create: { name: normalizedName },
                    });
                    await tx.profileSkill.create({
                        data: { profileId: profile.id, skillId: skill.id, level },
                    });
                }
            }
            // Recalculate profile strength
            const full = await tx.profile.findUnique({
                where: { id: profile.id },
                include: { skills: true, experiences: true },
            });
            let strength = 20;
            if (full?.bio)
                strength += 15;
            if (full?.avatarUrl)
                strength += 10;
            if (full?.location)
                strength += 5;
            if (full?.website)
                strength += 5;
            if ((full?.skills?.length ?? 0) > 0)
                strength += Math.min((full.skills.length) * 4, 20);
            if ((full?.experiences?.length ?? 0) > 0)
                strength += 15;
            await tx.profile.update({
                where: { id: profile.id },
                data: { profileStrength: Math.min(strength, 100) },
            });
            return tx.profile.findUnique({
                where: { id: profile.id },
                include: { skills: { include: { skill: true } } },
            });
        });
        // Bust preview cache
        await index_1.cache.del(`user:preview:${req.userId}`);
        res.json({ profile: updatedProfile });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /users/suggestions/alumni ───────────────────────────────────────────
// Skill-overlap recommendation algorithm
router.get('/suggestions/alumni', index_2.authenticate, async (req, res, next) => {
    try {
        const [viewer, viewerProfile] = await Promise.all([
            index_1.prisma.user.findUnique({ where: { id: req.userId } }),
            index_1.prisma.profile.findUnique({
                where: { userId: req.userId },
                include: { skills: { include: { skill: true } } },
            }),
        ]);
        if (!viewer || !viewerProfile)
            throw new index_1.AppError('Profile not found', 404);
        // Exclude already-connected users
        const existingConnections = await index_1.prisma.connection.findMany({
            where: { OR: [{ fromId: req.userId }, { toId: req.userId }] },
            select: { fromId: true, toId: true },
        });
        const excludeIds = new Set([
            req.userId,
            ...existingConnections.map((c) => c.fromId),
            ...existingConnections.map((c) => c.toId),
        ]);
        const mySkills = new Set(viewerProfile.skills.map((s) => s.skill.name.toLowerCase()));
        const alumni = await index_1.prisma.user.findMany({
            where: {
                role: 'ALUMNI',
                isActive: true,
                id: { notIn: Array.from(excludeIds) },
            },
            include: {
                profile: {
                    select: {
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                        jobTitle: true,
                        currentCompany: true,
                        graduationYear: true,
                        industry: true,
                        isOpenToMentor: true,
                        skills: { include: { skill: true } },
                    },
                },
            },
            take: 30,
        });
        const scored = alumni
            .filter((u) => u.profile)
            .map((u) => {
            const alumSkills = u.profile.skills.map((s) => s.skill.name.toLowerCase());
            const overlap = alumSkills.filter((s) => mySkills.has(s)).length;
            const mentorBonus = u.profile.isOpenToMentor ? 2 : 0;
            return {
                score: overlap + mentorBonus,
                user: {
                    id: u.id,
                    role: u.role,
                    firstName: u.profile.firstName,
                    lastName: u.profile.lastName,
                    avatarUrl: u.profile.avatarUrl,
                    jobTitle: u.profile.jobTitle,
                    company: u.profile.currentCompany,
                    graduationYear: u.profile.graduationYear,
                    industry: u.profile.industry,
                    isOpenToMentor: u.profile.isOpenToMentor,
                    skills: u.profile.skills.map((s) => s.skill.name),
                    skillOverlap: overlap,
                },
            };
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map(({ user }) => user);
        res.json({ suggestions: scored });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /users/experiences ──────────────────────────────────────────────────
router.post('/experiences', index_2.authenticate, async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            title: zod_1.z.string().min(2).max(100),
            company: zod_1.z.string().min(2).max(100),
            location: zod_1.z.string().optional(),
            startDate: zod_1.z.string().datetime(),
            endDate: zod_1.z.string().datetime().optional(),
            isCurrent: zod_1.z.boolean().default(false),
            description: zod_1.z.string().max(1000).optional(),
        });
        const data = schema.parse(req.body);
        const profile = await index_1.prisma.profile.findUnique({ where: { userId: req.userId } });
        if (!profile)
            throw new index_1.AppError('Profile not found', 404);
        const experience = await index_1.prisma.experience.create({
            data: {
                ...data,
                profileId: profile.id,
                startDate: new Date(data.startDate),
                endDate: data.endDate ? new Date(data.endDate) : undefined,
            },
        });
        res.status(201).json({ experience });
    }
    catch (err) {
        next(err);
    }
});
// ─── DELETE /users/experiences/:id ───────────────────────────────────────────
router.delete('/experiences/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const profile = await index_1.prisma.profile.findUnique({ where: { userId: req.userId } });
        if (!profile)
            throw new index_1.AppError('Profile not found', 404);
        const deleted = await index_1.prisma.experience.deleteMany({
            where: { id: req.params.id, profileId: profile.id },
        });
        if (!deleted.count)
            throw new index_1.AppError('Experience not found', 404);
        res.json({ message: 'Experience deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /users/projects ─────────────────────────────────────────────────────
router.post('/projects', index_2.authenticate, async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            title: zod_1.z.string().min(2).max(100),
            description: zod_1.z.string().max(1000).optional(),
            repoUrl: zod_1.z.string().url().optional(),
            liveUrl: zod_1.z.string().url().optional(),
            techStack: zod_1.z.array(zod_1.z.string()).max(10),
        });
        const data = schema.parse(req.body);
        const profile = await index_1.prisma.profile.findUnique({ where: { userId: req.userId } });
        if (!profile)
            throw new index_1.AppError('Profile not found', 404);
        const project = await index_1.prisma.project.create({ data: { ...data, profileId: profile.id } });
        res.status(201).json({ project });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
