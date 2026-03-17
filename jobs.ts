/**
 * Jobs Routes — /api/v1/jobs
 * Alumni post jobs; students search, filter, save, apply
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma, AppError, createNotification } from '../../lib/index';
import { authenticate, validate, requireRole } from '../../middleware/index';

const router = Router();

// ─── GET /jobs ────────────────────────────────────────────────────────────────
const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE']).optional(),
  location: z.string().optional(),
  company: z.string().optional(),
  skill: z.string().optional(),
  search: z.string().optional(),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { cursor, limit, type, location, company, skill, search } =
      listQuerySchema.parse(req.query);

    const where: any = { isActive: true };
    if (type) where.type = type;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (company) where.company = { contains: company, mode: 'insensitive' };
    if (skill) where.skills = { has: skill.toLowerCase() };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const jobs = await prisma.job.findMany({
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
  } catch (err) {
    next(err);
  }
});

// ─── POST /jobs (alumni only) ─────────────────────────────────────────────────
const createJobSchema = z.object({
  title: z.string().min(3).max(100),
  company: z.string().min(2).max(100),
  location: z.string().max(100).optional(),
  description: z.string().min(50).max(5000),
  requirements: z.array(z.string().max(200)).max(20).default([]),
  skills: z.array(z.string().max(50)).max(20).default([]),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE']),
  salary: z.string().max(100).optional(),
  deadline: z.string().datetime().optional(),
});

router.post(
  '/',
  authenticate,
  requireRole(['ALUMNI', 'ADMIN']),
  validate(createJobSchema),
  async (req, res, next) => {
    try {
      const { deadline, ...rest } = req.body;
      const job = await prisma.job.create({
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
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /jobs/:id ────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
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

    if (!job) throw new AppError('Job not found', 404);

    res.json({
      job: {
        ...job,
        isSaved: job.savedBy.length > 0,
        myApplication: job.applications[0] ?? null,
        savedBy: undefined,
        applications: undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /jobs/:id/apply (students only) ─────────────────────────────────────
const applySchema = z.object({
  coverLetter: z.string().max(3000).optional(),
  resumeUrl: z.string().url().optional(),
});

router.post(
  '/:id/apply',
  authenticate,
  requireRole(['STUDENT']),
  validate(applySchema),
  async (req, res, next) => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: req.params.id, isActive: true },
      });
      if (!job) throw new AppError('Job not found or no longer active', 404);

      if (job.deadline && new Date(job.deadline) < new Date()) {
        throw new AppError('Application deadline has passed', 400);
      }

      const existing = await prisma.jobApplication.findUnique({
        where: {
          jobId_applicantId: {
            jobId: req.params.id,
            applicantId: req.userId,
          },
        },
      });
      if (existing) throw new AppError('You have already applied to this job', 409);

      const application = await prisma.jobApplication.create({
        data: {
          jobId: req.params.id,
          applicantId: req.userId,
          coverLetter: req.body.coverLetter,
          resumeUrl: req.body.resumeUrl,
        },
      });

      await createNotification({
        userId: job.posterId,
        type: 'JOB_APPLIED',
        title: 'New application received',
        data: { jobId: job.id, applicantId: req.userId },
      });

      res.status(201).json({ application });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /jobs/:id/save ──────────────────────────────────────────────────────
router.post('/:id/save', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedJob.findUnique({
      where: { userId_jobId: { userId: req.userId, jobId: req.params.id } },
    });

    if (existing) {
      await prisma.savedJob.delete({
        where: { userId_jobId: { userId: req.userId, jobId: req.params.id } },
      });
      return res.json({ saved: false });
    }

    await prisma.savedJob.create({
      data: { userId: req.userId, jobId: req.params.id },
    });
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /jobs/poster/mine ────────────────────────────────────────────────────
router.get('/poster/mine', authenticate, requireRole(['ALUMNI', 'ADMIN']), async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { posterId: req.userId },
      include: { _count: { select: { applications: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /jobs/:id/applications (poster views applicants) ─────────────────────
router.get('/:id/applications', authenticate, requireRole(['ALUMNI', 'ADMIN']), async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) throw new AppError('Job not found', 404);
    if (job.posterId !== req.userId) throw new AppError('Not authorized', 403);

    const applications = await prisma.jobApplication.findMany({
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
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /jobs/:id/applications/:appId ─────────────────────────────────────
router.patch('/:id/applications/:appId', authenticate, requireRole(['ALUMNI', 'ADMIN']), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['REVIEWING', 'SHORTLISTED', 'REJECTED', 'ACCEPTED']),
    });
    const { status } = schema.parse(req.body);

    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job || job.posterId !== req.userId) throw new AppError('Not authorized', 403);

    const application = await prisma.jobApplication.update({
      where: { id: req.params.appId },
      data: { status },
    });

    await createNotification({
      userId: application.applicantId,
      type: 'JOB_APPLIED',
      title: `Application update: ${status.toLowerCase()}`,
      body: `Your application status has been updated to ${status.toLowerCase()}.`,
      data: { jobId: req.params.id, status },
    });

    res.json({ application });
  } catch (err) {
    next(err);
  }
});

export default router;
