/**
 * Search Routes — /api/v1/search
 * Full-text search for users, posts, jobs with debounce-friendly caching
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, cache } from '../../lib/index';
import { authenticate } from '../../middleware/index';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      q: z.string().min(1).max(100),
      type: z.enum(['users', 'posts', 'jobs', 'all']).default('all'),
      role: z.enum(['STUDENT', 'ALUMNI']).optional(),
      department: z.string().optional(),
      company: z.string().optional(),
      skill: z.string().optional(),
      jobType: z.enum(['FULL_TIME','PART_TIME','INTERNSHIP','CONTRACT','REMOTE']).optional(),
      limit: z.coerce.number().min(1).max(20).default(10),
    });

    const params = schema.parse(req.query);
    const cacheKey = `search:${JSON.stringify(params)}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const q = params.q.trim();
    const results: Record<string, unknown> = {};

    if (params.type === 'users' || params.type === 'all') {
      const userWhere: any = {
        isActive: true,
        OR: [
          { profile: { firstName: { contains: q, mode: 'insensitive' } } },
          { profile: { lastName: { contains: q, mode: 'insensitive' } } },
          { profile: { department: { contains: q, mode: 'insensitive' } } },
          { profile: { currentCompany: { contains: q, mode: 'insensitive' } } },
          { profile: { jobTitle: { contains: q, mode: 'insensitive' } } },
          { profile: { skills: { some: { skill: { name: { contains: q, mode: 'insensitive' } } } } } },
        ],
      };
      if (params.role) userWhere.role = params.role;

      results.users = await prisma.user.findMany({
        where: userWhere,
        select: {
          id: true, role: true,
          profile: {
            select: {
              firstName: true, lastName: true, avatarUrl: true,
              department: true, semester: true, jobTitle: true,
              currentCompany: true, isOpenToWork: true,
              skills: { take: 4, select: { skill: { select: { name: true } } } },
            },
          },
        },
        take: params.limit,
      });
    }

    if (params.type === 'posts' || params.type === 'all') {
      results.posts = await prisma.post.findMany({
        where: {
          visibility: 'public',
          OR: [
            { content: { contains: q, mode: 'insensitive' } },
            { tags: { has: q.toLowerCase() } },
          ],
        },
        include: {
          author: { select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: params.limit,
      });
    }

    if (params.type === 'jobs' || params.type === 'all') {
      const jobWhere: any = {
        isActive: true,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      };
      if (params.jobType) jobWhere.type = params.jobType;

      results.jobs = await prisma.job.findMany({
        where: jobWhere,
        include: {
          poster: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: params.limit,
      });
    }

    await cache.set(cacheKey, JSON.stringify(results), 30);
    res.json(results);
  } catch (err) { next(err); }
});

export default router;
