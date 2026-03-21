/**
 * Chat Routes — /api/v1/chat
 * REST layer for fetching rooms and message history (WS handles realtime)
 */
import { Router } from 'express';
import { prisma, AppError } from '../../lib/index';
import { authenticate } from '../../middleware/index';

const router = Router();

// GET /chat/rooms — list all rooms the user is part of
router.get('/rooms', authenticate, async (req, res, next) => {
  try {
    const memberships = await prisma.chatParticipant.findMany({
      where: { userId: req.userId },
      include: {
        room: {
          include: {
            participants: {
              include: {
                user: {
                  select: {
                    id: true,
                    role: true,
                    lastSeen: true,
                    profile: {
                      select: { firstName: true, lastName: true, avatarUrl: true },
                    },
                  },
                },
              },
            },
            messages: {
              where: { isDeleted: false },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { sender: { select: { profile: { select: { firstName: true } } } } },
            },
            _count: { select: { messages: true } },
          },
        },
      },
      orderBy: { room: { updatedAt: 'desc' } },
    });

    // Attach unread count per room
    const roomsWithUnread = await Promise.all(
      memberships.map(async (m) => {
        const unread = await prisma.message.count({
          where: {
            roomId: m.roomId,
            senderId: { not: req.userId },
            createdAt: { gt: m.lastReadAt },
          },
        });
        return { ...m.room, unreadCount: unread };
      })
    );

    res.json({ rooms: roomsWithUnread });
  } catch (err) { next(err); }
});

// GET /chat/rooms/:id/messages — paginated message history
router.get('/rooms/:id/messages', authenticate, async (req, res, next) => {
  try {
    const { cursor, limit = '30' } = req.query;
    const take = Math.min(parseInt(limit as string, 10), 50);

    const participant = await prisma.chatParticipant.findUnique({
      where: { roomId_userId: { roomId: req.params.id, userId: req.userId } },
    });
    if (!participant) throw new AppError('Not a member of this room', 403);

    const messages = await prisma.message.findMany({
      where: { roomId: req.params.id, isDeleted: false },
      include: {
        sender: {
          select: {
            id: true,
            profile: { select: { firstName: true, lastName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
    });

    const hasNextPage = messages.length > take;
    res.json({
      // Reverse so oldest first for display
      messages: (hasNextPage ? messages.slice(0, take) : messages).reverse(),
      nextCursor: hasNextPage ? messages[take - 1].id : null,
    });
  } catch (err) { next(err); }
});

export default router;
