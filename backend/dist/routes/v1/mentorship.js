"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Mentorship Routes — /api/v1/mentorship
 */
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
// GET /mentorship/available — browse alumni mentors
router.get('/available', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit = '12' } = req.query;
        const take = Math.min(parseInt(limit, 10), 20);
        const mentors = await index_1.prisma.user.findMany({
            where: { role: 'ALUMNI', isActive: true, profile: { isOpenToMentor: true } },
            include: {
                profile: {
                    select: {
                        firstName: true, lastName: true, avatarUrl: true,
                        jobTitle: true, currentCompany: true, bio: true,
                        graduationYear: true, industry: true,
                        skills: { take: 5, include: { skill: true } },
                    },
                },
                _count: { select: { mentorships: { where: { status: 'ACCEPTED' } } } },
            },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasNextPage = mentors.length > take;
        res.json({
            mentors: (hasNextPage ? mentors.slice(0, take) : mentors).map(m => ({
                ...m,
                activeMenteeCount: m._count.mentorships,
                _count: undefined,
            })),
            nextCursor: hasNextPage ? mentors[take - 1].id : null,
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /mentorship/request
router.post('/request', index_2.authenticate, (0, index_2.requireRole)(['STUDENT']), async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            mentorId: zod_1.z.string().cuid(),
            message: zod_1.z.string().max(500).optional(),
        });
        const { mentorId, message } = schema.parse(req.body);
        const mentor = await index_1.prisma.user.findUnique({
            where: { id: mentorId, role: 'ALUMNI', isActive: true },
            include: { profile: { select: { isOpenToMentor: true } } },
        });
        if (!mentor)
            throw new index_1.AppError('Mentor not found', 404);
        if (!mentor.profile?.isOpenToMentor)
            throw new index_1.AppError('This alumni is not accepting mentorship requests', 400);
        const existing = await index_1.prisma.mentorship.findUnique({
            where: { mentorId_menteeId: { mentorId, menteeId: req.userId } },
        });
        if (existing)
            throw new index_1.AppError('You already have a mentorship request with this alumni', 409);
        const mentorship = await index_1.prisma.mentorship.create({
            data: { mentorId, menteeId: req.userId, message },
        });
        await (0, index_1.createNotification)({
            userId: mentorId,
            type: 'MENTORSHIP_REQUEST',
            title: 'New mentorship request',
            data: { mentorshipId: mentorship.id, menteeId: req.userId },
        });
        res.status(201).json({ mentorship });
    }
    catch (err) {
        next(err);
    }
});
// PATCH /mentorship/:id/respond
router.patch('/:id/respond', index_2.authenticate, (0, index_2.requireRole)(['ALUMNI']), async (req, res, next) => {
    try {
        const schema = zod_1.z.object({ status: zod_1.z.enum(['ACCEPTED', 'REJECTED']) });
        const { status } = schema.parse(req.body);
        const mentorship = await index_1.prisma.mentorship.findUnique({ where: { id: req.params.id } });
        if (!mentorship)
            throw new index_1.AppError('Mentorship not found', 404);
        if (mentorship.mentorId !== req.userId)
            throw new index_1.AppError('Not authorized', 403);
        if (mentorship.status !== 'PENDING')
            throw new index_1.AppError('Already responded to this request', 400);
        const updated = await index_1.prisma.mentorship.update({
            where: { id: req.params.id },
            data: { status },
        });
        await (0, index_1.createNotification)({
            userId: mentorship.menteeId,
            type: status === 'ACCEPTED' ? 'MENTORSHIP_ACCEPTED' : 'MENTORSHIP_REQUEST',
            title: `Mentorship request ${status.toLowerCase()}`,
            data: { mentorshipId: mentorship.id, status },
        });
        res.json({ mentorship: updated });
    }
    catch (err) {
        next(err);
    }
});
// GET /mentorship/mine
router.get('/mine', index_2.authenticate, async (req, res, next) => {
    try {
        const [asMentor, asMentee] = await Promise.all([
            index_1.prisma.mentorship.findMany({
                where: { mentorId: req.userId },
                include: {
                    mentee: {
                        select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, department: true, semester: true } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
            index_1.prisma.mentorship.findMany({
                where: { menteeId: req.userId },
                include: {
                    mentor: {
                        select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, jobTitle: true, currentCompany: true } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);
        res.json({ asMentor, asMentee });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
