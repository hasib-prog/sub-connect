/**
 * Socket.io Handlers — Realtime Layer
 * Chat messaging, typing indicators, seen receipts, online presence
 */

import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma, logger } from '../lib/index';

// userId → Set<socketId> (handles multi-tab)
const onlineUsers = new Map<string, Set<string>>();

interface AuthSocket extends Socket {
  userId: string;
  userRole: string;
}

export function setupSocketHandlers(io: Server) {

  // ─── JWT Auth middleware ──────────────────────────────────────────────────
  io.use((socket: any, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.userId = payload.userId;
      socket.userRole = payload.role;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthSocket;
    const { userId } = socket;

    logger.info(`🔌 Socket connected: ${userId} (${socket.id})`);

    // Track presence
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socket.id);

    // Personal notification room
    socket.join(`user:${userId}`);

    // Broadcast online to connections
    broadcastPresence(io, userId, true);

    // ─── Join all chat rooms for this user ─────────────────────────────────
    socket.on('join:rooms', async () => {
      try {
        const rooms = await prisma.chatParticipant.findMany({
          where: { userId },
          select: { roomId: true },
        });
        rooms.forEach((r) => socket.join(`room:${r.roomId}`));
        logger.debug(`User ${userId} joined ${rooms.length} rooms`);
      } catch (err) {
        logger.error('join:rooms error:', err);
      }
    });

    // ─── Send message ──────────────────────────────────────────────────────
    socket.on(
      'message:send',
      async (
        data: {
          roomId: string;
          content: string;
          mediaUrl?: string;
          receiverId?: string;
        },
        callback?: (result: { messageId?: string; error?: string }) => void
      ) => {
        try {
          // Verify membership
          const participant = await prisma.chatParticipant.findUnique({
            where: { roomId_userId: { roomId: data.roomId, userId } },
          });

          if (!participant) {
            callback?.({ error: 'Not a member of this room' });
            return;
          }

          const message = await prisma.message.create({
            data: {
              roomId: data.roomId,
              senderId: userId,
              receiverId: data.receiverId,
              content: data.content,
              mediaUrl: data.mediaUrl,
              status: 'SENT',
            },
            include: {
              sender: {
                select: {
                  id: true,
                  profile: {
                    select: { firstName: true, lastName: true, avatarUrl: true },
                  },
                },
              },
            },
          });

          // Broadcast to all room participants
          io.to(`room:${data.roomId}`).emit('message:received', message);

          // Update room's updatedAt
          await prisma.chatRoom.update({
            where: { id: data.roomId },
            data: { updatedAt: new Date() },
          });

          // Ping offline participants
          const others = await prisma.chatParticipant.findMany({
            where: { roomId: data.roomId, userId: { not: userId } },
            select: { userId: true },
          });

          for (const { userId: otherId } of others) {
            const isOnline = (onlineUsers.get(otherId)?.size ?? 0) > 0;
            if (!isOnline) {
              io.to(`user:${otherId}`).emit('notification:new', {
                type: 'MESSAGE',
                title: 'New message',
                data: { roomId: data.roomId },
              });
            }
          }

          callback?.({ messageId: message.id });
        } catch (err) {
          logger.error('message:send error:', err);
          callback?.({ error: 'Failed to send message' });
        }
      }
    );

    // ─── Typing indicators ─────────────────────────────────────────────────
    socket.on('typing:start', (data: { roomId: string }) => {
      socket.to(`room:${data.roomId}`).emit('typing:start', {
        userId,
        roomId: data.roomId,
      });
    });

    socket.on('typing:stop', (data: { roomId: string }) => {
      socket.to(`room:${data.roomId}`).emit('typing:stop', {
        userId,
        roomId: data.roomId,
      });
    });

    // ─── Mark messages as seen ─────────────────────────────────────────────
    socket.on('message:seen', async (data: { roomId: string }) => {
      try {
        await prisma.$transaction([
          prisma.message.updateMany({
            where: {
              roomId: data.roomId,
              senderId: { not: userId },
              status: { not: 'SEEN' },
            },
            data: { status: 'SEEN' },
          }),
          prisma.chatParticipant.update({
            where: { roomId_userId: { roomId: data.roomId, userId } },
            data: { lastReadAt: new Date() },
          }),
        ]);

        socket.to(`room:${data.roomId}`).emit('message:seen', {
          roomId: data.roomId,
          seenBy: userId,
          seenAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('message:seen error:', err);
      }
    });

    // ─── Open/create DM room ───────────────────────────────────────────────
    socket.on(
      'chat:open-dm',
      async (
        data: { targetUserId: string },
        callback: (result: { roomId?: string; error?: string }) => void
      ) => {
        try {
          // Try to find existing 1-on-1 room
          const existing = await prisma.chatRoom.findFirst({
            where: {
              isGroup: false,
              AND: [
                { participants: { some: { userId } } },
                { participants: { some: { userId: data.targetUserId } } },
              ],
            },
            include: { participants: { select: { userId: true } } },
          });

          if (existing && existing.participants.length === 2) {
            socket.join(`room:${existing.id}`);
            return callback({ roomId: existing.id });
          }

          const room = await prisma.chatRoom.create({
            data: {
              isGroup: false,
              participants: {
                create: [{ userId }, { userId: data.targetUserId }],
              },
            },
          });

          socket.join(`room:${room.id}`);
          // Notify target if online
          io.to(`user:${data.targetUserId}`).emit('chat:room-created', {
            roomId: room.id,
          });

          callback({ roomId: room.id });
        } catch (err) {
          logger.error('chat:open-dm error:', err);
          callback({ error: 'Failed to open conversation' });
        }
      }
    );

    // ─── Check online status ────────────────────────────────────────────────
    socket.on(
      'presence:check',
      (
        data: { userIds: string[] },
        callback: (statuses: Record<string, boolean>) => void
      ) => {
        const statuses = Object.fromEntries(
          data.userIds.map((id) => [id, (onlineUsers.get(id)?.size ?? 0) > 0])
        );
        callback(statuses);
      }
    );

    // ─── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          broadcastPresence(io, userId, false);

          await prisma.user
            .update({ where: { id: userId }, data: { lastSeen: new Date() } })
            .catch(() => {});
        }
      }
      logger.info(`🔌 Socket disconnected: ${userId} (${socket.id})`);
    });
  });
}

async function broadcastPresence(io: Server, userId: string, isOnline: boolean) {
  try {
    const connections = await prisma.connection.findMany({
      where: {
        OR: [{ fromId: userId }, { toId: userId }],
        status: 'ACCEPTED',
      },
      select: { fromId: true, toId: true },
    });

    const connIds = connections.map((c) =>
      c.fromId === userId ? c.toId : c.fromId
    );

    connIds.forEach((id) => {
      io.to(`user:${id}`).emit('presence:update', { userId, isOnline });
    });
  } catch (err) {
    logger.error('broadcastPresence error:', err);
  }
}

export function isUserOnline(userId: string): boolean {
  return (onlineUsers.get(userId)?.size ?? 0) > 0;
}

export { prisma, logger, AppError, cache, createNotification, sendEmail };
