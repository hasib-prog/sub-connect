"use strict";
/**
 * Socket.io Handlers — Realtime Layer
 * Chat messaging, typing indicators, seen receipts, online presence
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.createNotification = exports.cache = exports.AppError = exports.logger = exports.prisma = void 0;
exports.setupSocketHandlers = setupSocketHandlers;
exports.isUserOnline = isUserOnline;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_1 = require("../lib/index");
Object.defineProperty(exports, "prisma", { enumerable: true, get: function () { return index_1.prisma; } });
Object.defineProperty(exports, "logger", { enumerable: true, get: function () { return index_1.logger; } });
// userId → Set<socketId> (handles multi-tab)
const onlineUsers = new Map();
function setupSocketHandlers(io) {
    // ─── JWT Auth middleware ──────────────────────────────────────────────────
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization?.replace('Bearer ', '');
        if (!token)
            return next(new Error('Authentication required'));
        try {
            const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            socket.userId = payload.userId;
            socket.userRole = payload.role;
            next();
        }
        catch {
            next(new Error('Invalid or expired token'));
        }
    });
    io.on('connection', (rawSocket) => {
        const socket = rawSocket;
        const { userId } = socket;
        index_1.logger.info(`🔌 Socket connected: ${userId} (${socket.id})`);
        // Track presence
        if (!onlineUsers.has(userId))
            onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socket.id);
        // Personal notification room
        socket.join(`user:${userId}`);
        // Broadcast online to connections
        broadcastPresence(io, userId, true);
        // ─── Join all chat rooms for this user ─────────────────────────────────
        socket.on('join:rooms', async () => {
            try {
                const rooms = await index_1.prisma.chatParticipant.findMany({
                    where: { userId },
                    select: { roomId: true },
                });
                rooms.forEach((r) => socket.join(`room:${r.roomId}`));
                index_1.logger.debug(`User ${userId} joined ${rooms.length} rooms`);
            }
            catch (err) {
                index_1.logger.error('join:rooms error:', err);
            }
        });
        // ─── Send message ──────────────────────────────────────────────────────
        socket.on('message:send', async (data, callback) => {
            try {
                // Verify membership
                const participant = await index_1.prisma.chatParticipant.findUnique({
                    where: { roomId_userId: { roomId: data.roomId, userId } },
                });
                if (!participant) {
                    callback?.({ error: 'Not a member of this room' });
                    return;
                }
                const message = await index_1.prisma.message.create({
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
                await index_1.prisma.chatRoom.update({
                    where: { id: data.roomId },
                    data: { updatedAt: new Date() },
                });
                // Ping offline participants
                const others = await index_1.prisma.chatParticipant.findMany({
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
            }
            catch (err) {
                index_1.logger.error('message:send error:', err);
                callback?.({ error: 'Failed to send message' });
            }
        });
        // ─── Typing indicators ─────────────────────────────────────────────────
        socket.on('typing:start', (data) => {
            socket.to(`room:${data.roomId}`).emit('typing:start', {
                userId,
                roomId: data.roomId,
            });
        });
        socket.on('typing:stop', (data) => {
            socket.to(`room:${data.roomId}`).emit('typing:stop', {
                userId,
                roomId: data.roomId,
            });
        });
        // ─── Mark messages as seen ─────────────────────────────────────────────
        socket.on('message:seen', async (data) => {
            try {
                await index_1.prisma.$transaction([
                    index_1.prisma.message.updateMany({
                        where: {
                            roomId: data.roomId,
                            senderId: { not: userId },
                            status: { not: 'SEEN' },
                        },
                        data: { status: 'SEEN' },
                    }),
                    index_1.prisma.chatParticipant.update({
                        where: { roomId_userId: { roomId: data.roomId, userId } },
                        data: { lastReadAt: new Date() },
                    }),
                ]);
                socket.to(`room:${data.roomId}`).emit('message:seen', {
                    roomId: data.roomId,
                    seenBy: userId,
                    seenAt: new Date().toISOString(),
                });
            }
            catch (err) {
                index_1.logger.error('message:seen error:', err);
            }
        });
        // ─── Open/create DM room ───────────────────────────────────────────────
        socket.on('chat:open-dm', async (data, callback) => {
            try {
                // Try to find existing 1-on-1 room
                const existing = await index_1.prisma.chatRoom.findFirst({
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
                const room = await index_1.prisma.chatRoom.create({
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
            }
            catch (err) {
                index_1.logger.error('chat:open-dm error:', err);
                callback({ error: 'Failed to open conversation' });
            }
        });
        // ─── Check online status ────────────────────────────────────────────────
        socket.on('presence:check', (data, callback) => {
            const statuses = Object.fromEntries(data.userIds.map((id) => [id, (onlineUsers.get(id)?.size ?? 0) > 0]));
            callback(statuses);
        });
        // ─── Disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', async () => {
            const sockets = onlineUsers.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    onlineUsers.delete(userId);
                    broadcastPresence(io, userId, false);
                    await index_1.prisma.user
                        .update({ where: { id: userId }, data: { lastSeen: new Date() } })
                        .catch(() => { });
                }
            }
            index_1.logger.info(`🔌 Socket disconnected: ${userId} (${socket.id})`);
        });
    });
}
async function broadcastPresence(io, userId, isOnline) {
    try {
        const connections = await index_1.prisma.connection.findMany({
            where: {
                OR: [{ fromId: userId }, { toId: userId }],
                status: 'ACCEPTED',
            },
            select: { fromId: true, toId: true },
        });
        const connIds = connections.map((c) => c.fromId === userId ? c.toId : c.fromId);
        connIds.forEach((id) => {
            io.to(`user:${id}`).emit('presence:update', { userId, isOnline });
        });
    }
    catch (err) {
        index_1.logger.error('broadcastPresence error:', err);
    }
}
function isUserOnline(userId) {
    return (onlineUsers.get(userId)?.size ?? 0) > 0;
}
