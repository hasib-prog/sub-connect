/**
 * Notifications Routes — /api/v1/notifications
 */
import { Router } from 'express';
import { prisma } from '../../lib/index';
import { authenticate } from '../../middleware/index';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { cursor, limit = '20', unread } = req.query;
    const take = Math.min(parseInt(limit as string, 10), 50);
    const where: any = { userId: req.userId };
    if (unread === 'true') where.isRead = false;

    const notifs = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: req.userId, isRead: false },
    });

    const hasNextPage = notifs.length > take;
    res.json({
      notifications: hasNextPage ? notifs.slice(0, take) : notifs,
      nextCursor: hasNextPage ? notifs[take - 1].id : null,
      unreadCount,
    });
  } catch (err) { next(err); }
});

router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.userId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) { next(err); }
});

router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { isRead: true },
    });
    res.json({ message: 'Notification read' });
  } catch (err) { next(err); }
});

export default router;
