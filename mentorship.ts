/**
 * Mentorship Routes — /api/v1/mentorship
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, AppError, createNotification } from '../../lib/index';
import { authenticate, requireRole } from '../../middleware/index';

const router = Router();

// GET /mentorship/available — browse alumni mentors
router.get('/available', authenticate, async (req, res, next) => {
  try {
    const { cursor, limit = '12' } = req.query;
    const take = Math.min(parseInt(limit as string, 10), 20);

    const mentors = await prisma.user.findMany({
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
      ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
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
  } catch (err) { next(err); }
});

// POST /mentorship/request
router.post('/request', authenticate, requireRole(['STUDENT']), async (req, res, next) => {
  try {
    const schema = z.object({
      mentorId: z.string().cuid(),
      message: z.string().max(500).optional(),
    });
    const { mentorId, message } = schema.parse(req.body);

    const mentor = await prisma.user.findUnique({
      where: { id: mentorId, role: 'ALUMNI', isActive: true },
      include: { profile: { select: { isOpenToMentor: true } } },
    });
    if (!mentor) throw new AppError('Mentor not found', 404);
    if (!mentor.profile?.isOpenToMentor) throw new AppError('This alumni is not accepting mentorship requests', 400);

    const existing = await prisma.mentorship.findUnique({
      where: { mentorId_menteeId: { mentorId, menteeId: req.userId } },
    });
    if (existing) throw new AppError('You already have a mentorship request with this alumni', 409);

    const mentorship = await prisma.mentorship.create({
      data: { mentorId, menteeId: req.userId, message },
    });

    await createNotification({
      userId: mentorId,
      type: 'MENTORSHIP_REQUEST',
      title: 'New mentorship request',
      data: { mentorshipId: mentorship.id, menteeId: req.userId },
    });

    res.status(201).json({ mentorship });
  } catch (err) { next(err); }
});

// PATCH /mentorship/:id/respond
router.patch('/:id/respond', authenticate, requireRole(['ALUMNI']), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) });
    const { status } = schema.parse(req.body);

    const mentorship = await prisma.mentorship.findUnique({ where: { id: req.params.id } });
    if (!mentorship) throw new AppError('Mentorship not found', 404);
    if (mentorship.mentorId !== req.userId) throw new AppError('Not authorized', 403);
    if (mentorship.status !== 'PENDING') throw new AppError('Already responded to this request', 400);

    const updated = await prisma.mentorship.update({
      where: { id: req.params.id },
      data: { status },
    });

    await createNotification({
      userId: mentorship.menteeId,
      type: status === 'ACCEPTED' ? 'MENTORSHIP_ACCEPTED' : 'MENTORSHIP_REQUEST',
      title: `Mentorship request ${status.toLowerCase()}`,
      data: { mentorshipId: mentorship.id, status },
    });

    res.json({ mentorship: updated });
  } catch (err) { next(err); }
});

// GET /mentorship/mine
router.get('/mine', authenticate, async (req, res, next) => {
  try {
    const [asMentor, asMentee] = await Promise.all([
      prisma.mentorship.findMany({
        where: { mentorId: req.userId },
        include: {
          mentee: {
            select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, department: true, semester: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.mentorship.findMany({
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
  } catch (err) { next(err); }
});

export default router;
