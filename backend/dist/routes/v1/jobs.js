"use strict";
/**
 * Jobs Routes — /api/v1/jobs
 * Alumni post jobs; students search, filter, save, apply
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
// ─── GET /jobs ────────────────────────────────────────────────────────────────
const listQuerySchema = zod_1.z.object({
    cursor: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(20).default(10),
    type: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE']).optional(),
    location: zod_1.z.string().optional(),
    company: zod_1.z.string().optional(),
    skill: zod_1.z.string().optional(),
    search: zod_1.z.string().optional(),
});
router.get('/', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit, type, location, company, skill, search } = listQuerySchema.parse(req.query);
        const where = { isActive: true };
        if (type)
            where.type = type;
        if (location)
            where.location = { contains: location, mode: 'insensitive' };
        if (company)
            where.company = { contains: company, mode: 'insensitive' };
        if (skill)
            where.skills = { has: skill.toLowerCase() };
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { company: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        const jobs = await index_1.prisma.job.findMany({
            where,
            include: {
                poster: {
                    select: {
                        id: true,
                        profile: {
                            select: {
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                                jobTitle: true,
                                currentCompany: true,
                            },
                        },
                    },
                },
                savedBy: { where: { userId: req.userId }, select: { id: true } },
                applications: {
                    where: { applicantId: req.userId },
                    select: { status: true, createdAt: true },
                },
                _count: { select: { applications: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasNextPage = jobs.length > limit;
        const data = hasNextPage ? jobs.slice(0, limit) : jobs;
        res.json({
            jobs: data.map((j) => ({
                ...j,
                isSaved: j.savedBy.length > 0,
                myApplication: j.applications[0] ?? null,
                savedBy: undefined,
                applications: undefined,
            })),
            nextCursor: hasNextPage ? data[data.length - 1].id : null,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /jobs (alumni only) ─────────────────────────────────────────────────
const createJobSchema = zod_1.z.object({
    title: zod_1.z.string().min(3).max(100),
    company: zod_1.z.string().min(2).max(100),
    location: zod_1.z.string().max(100).optional(),
    description: zod_1.z.string().min(50).max(5000),
    requirements: zod_1.z.array(zod_1.z.string().max(200)).max(20).default([]),
    skills: zod_1.z.array(zod_1.z.string().max(50)).max(20).default([]),
    type: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE']),
    salary: zod_1.z.string().max(100).optional(),
    deadline: zod_1.z.string().datetime().optional(),
});
router.post('/', index_2.authenticate, (0, index_2.requireRole)(['ALUMNI', 'ADMIN']), (0, index_2.validate)(createJobSchema), async (req, res, next) => {
    try {
        const { deadline, ...rest } = req.body;
        const job = await index_1.prisma.job.create({
            data: {
                ...rest,
                deadline: deadline ? new Date(deadline) : undefined,
                posterId: req.userId,
            },
            include: {
                poster: {
                    select: {
                        id: true,
                        profile: {
                            select: { firstName: true, lastName: true, avatarUrl: true },
                        },
                    },
                },
            },
        });
        res.status(201).json({ job });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /jobs/:id ────────────────────────────────────────────────────────────
router.get('/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const job = await index_1.prisma.job.findUnique({
            where: { id: req.params.id },
            include: {
                poster: {
                    select: {
                        id: true,
                        role: true,
                        profile: {
                            select: {
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                                jobTitle: true,
                                currentCompany: true,
                                bio: true,
                            },
                        },
                    },
                },
                savedBy: { where: { userId: req.userId }, select: { id: true } },
                applications: {
                    where: { applicantId: req.userId },
                    select: { status: true, createdAt: true },
                },
                _count: { select: { applications: true } },
            },
        });
        if (!job)
            throw new index_1.AppError('Job not found', 404);
        res.json({
            job: {
                ...job,
                isSaved: job.savedBy.length > 0,
                myApplication: job.applications[0] ?? null,
                savedBy: undefined,
                applications: undefined,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /jobs/:id/apply (students only) ─────────────────────────────────────
const applySchema = zod_1.z.object({
    coverLetter: zod_1.z.string().max(3000).optional(),
    resumeUrl: zod_1.z.string().url().optional(),
});
router.post('/:id/apply', index_2.authenticate, (0, index_2.requireRole)(['STUDENT']), (0, index_2.validate)(applySchema), async (req, res, next) => {
    try {
        const job = await index_1.prisma.job.findUnique({
            where: { id: req.params.id, isActive: true },
        });
        if (!job)
            throw new index_1.AppError('Job not found or no longer active', 404);
        if (job.deadline && new Date(job.deadline) < new Date()) {
            throw new index_1.AppError('Application deadline has passed', 400);
        }
        const existing = await index_1.prisma.jobApplication.findUnique({
            where: {
                jobId_applicantId: {
                    jobId: req.params.id,
                    applicantId: req.userId,
                },
            },
        });
        if (existing)
            throw new index_1.AppError('You have already applied to this job', 409);
        const application = await index_1.prisma.jobApplication.create({
            data: {
                jobId: req.params.id,
                applicantId: req.userId,
                coverLetter: req.body.coverLetter,
                resumeUrl: req.body.resumeUrl,
            },
        });
        await (0, index_1.createNotification)({
            userId: job.posterId,
            type: 'JOB_APPLIED',
            title: 'New application received',
            data: { jobId: job.id, applicantId: req.userId },
        });
        res.status(201).json({ application });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /jobs/:id/save ──────────────────────────────────────────────────────
router.post('/:id/save', index_2.authenticate, async (req, res, next) => {
    try {
        const existing = await index_1.prisma.savedJob.findUnique({
            where: { userId_jobId: { userId: req.userId, jobId: req.params.id } },
        });
        if (existing) {
            await index_1.prisma.savedJob.delete({
                where: { userId_jobId: { userId: req.userId, jobId: req.params.id } },
            });
            return res.json({ saved: false });
        }
        await index_1.prisma.savedJob.create({
            data: { userId: req.userId, jobId: req.params.id },
        });
        res.json({ saved: true });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /jobs/poster/mine ────────────────────────────────────────────────────
router.get('/poster/mine', index_2.authenticate, (0, index_2.requireRole)(['ALUMNI', 'ADMIN']), async (req, res, next) => {
    try {
        const jobs = await index_1.prisma.job.findMany({
            where: { posterId: req.userId },
            include: { _count: { select: { applications: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ jobs });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /jobs/:id/applications (poster views applicants) ─────────────────────
router.get('/:id/applications', index_2.authenticate, (0, index_2.requireRole)(['ALUMNI', 'ADMIN']), async (req, res, next) => {
    try {
        const job = await index_1.prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job)
            throw new index_1.AppError('Job not found', 404);
        if (job.posterId !== req.userId)
            throw new index_1.AppError('Not authorized', 403);
        const applications = await index_1.prisma.jobApplication.findMany({
            where: { jobId: req.params.id },
            include: {
                applicant: {
                    select: {
                        id: true,
                        email: true,
                        profile: {
                            select: {
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                                department: true,
                                semester: true,
                                skills: { include: { skill: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ applications });
    }
    catch (err) {
        next(err);
    }
});
// ─── PATCH /jobs/:id/applications/:appId ─────────────────────────────────────
router.patch('/:id/applications/:appId', index_2.authenticate, (0, index_2.requireRole)(['ALUMNI', 'ADMIN']), async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            status: zod_1.z.enum(['REVIEWING', 'SHORTLISTED', 'REJECTED', 'ACCEPTED']),
        });
        const { status } = schema.parse(req.body);
        const job = await index_1.prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job || job.posterId !== req.userId)
            throw new index_1.AppError('Not authorized', 403);
        const application = await index_1.prisma.jobApplication.update({
            where: { id: req.params.appId },
            data: { status },
        });
        await (0, index_1.createNotification)({
            userId: application.applicantId,
            type: 'JOB_APPLIED',
            title: `Application update: ${status.toLowerCase()}`,
            body: `Your application status has been updated to ${status.toLowerCase()}.`,
            data: { jobId: req.params.id, status },
        });
        res.json({ application });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
