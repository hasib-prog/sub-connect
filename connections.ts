/**
 * Connections Routes — /api/v1/connections
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, AppError, createNotification } from '../../lib/index';
import { authenticate } from '../../middleware/index';

const router = Router();

router.post('/', authenticate, async (req, res, next) => {
  try {
    const { toId } = z.object({ toId: z.string().cuid() }).parse(req.body);
    if (toId === req.userId) throw new AppError('Cannot connect with yourself', 400);

    const existing = await prisma.connection.findFirst({
      where: { OR: [{ fromId: req.userId, toId }, { fromId: toId, toId: req.userId }] },
    });
    if (existing) throw new AppError('Connection already exists', 409);

    const connection = await prisma.connection.create({
      data: { fromId: req.userId, toId },
    });

    await createNotification({
      userId: toId,
      type: 'CONNECTION_REQUEST',
      title: 'New connection request',
      data: { connectionId: connection.id, fromId: req.userId },
    });

    res.status(201).json({ connection });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) }).parse(req.body);
    const conn = await prisma.connection.findUnique({ where: { id: req.params.id } });
    if (!conn) throw new AppError('Connection not found', 404);
    if (conn.toId !== req.userId) throw new AppError('Not authorized', 403);

    const updated = await prisma.connection.update({ where: { id: req.params.id }, data: { status } });

    if (status === 'ACCEPTED') {
      await createNotification({
        userId: conn.fromId,
        type: 'CONNECTION_ACCEPTED',
        title: 'Connection accepted',
        data: { connectionId: conn.id },
      });
    }
    res.json({ connection: updated });
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const status = (req.query.status as string) || 'ACCEPTED';
    const connections = await prisma.connection.findMany({
      where: { OR: [{ fromId: req.userId }, { toId: req.userId }], status: status as any },
      include: {
        from: { select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, jobTitle: true, department: true } } } },
        to: { select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, jobTitle: true, department: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ connections });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const conn = await prisma.connection.findUnique({ where: { id: req.params.id } });
    if (!conn) throw new AppError('Not found', 404);
    if (conn.fromId !== req.userId && conn.toId !== req.userId) throw new AppError('Not authorized', 403);
    await prisma.connection.delete({ where: { id: req.params.id } });
    res.json({ message: 'Connection removed' });
  } catch (err) { next(err); }
});

export default router;
