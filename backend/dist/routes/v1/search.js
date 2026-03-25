"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Search Routes — /api/v1/search
 * Full-text search for users, posts, jobs with debounce-friendly caching
 */
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
router.get('/', index_2.authenticate, async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            q: zod_1.z.string().min(1).max(100),
            type: zod_1.z.enum(['users', 'posts', 'jobs', 'all']).default('all'),
            role: zod_1.z.enum(['STUDENT', 'ALUMNI']).optional(),
            department: zod_1.z.string().optional(),
            company: zod_1.z.string().optional(),
            skill: zod_1.z.string().optional(),
            jobType: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE']).optional(),
            limit: zod_1.z.coerce.number().min(1).max(20).default(10),
        });
        const params = schema.parse(req.query);
        const cacheKey = `search:${JSON.stringify(params)}`;
        const cached = await index_1.cache.get(cacheKey);
        if (cached)
            return res.json(JSON.parse(cached));
        const q = params.q.trim();
        const results = {};
        if (params.type === 'users' || params.type === 'all') {
            const userWhere = {
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
            if (params.role)
                userWhere.role = params.role;
            results.users = await index_1.prisma.user.findMany({
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
            results.posts = await index_1.prisma.post.findMany({
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
            const jobWhere = {
                isActive: true,
                OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { company: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                ],
            };
            if (params.jobType)
                jobWhere.type = params.jobType;
            results.jobs = await index_1.prisma.job.findMany({
                where: jobWhere,
                include: {
                    poster: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
                    _count: { select: { applications: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: params.limit,
            });
        }
        await index_1.cache.set(cacheKey, JSON.stringify(results), 30);
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
