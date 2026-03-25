"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Notifications Routes — /api/v1/notifications
 */
const express_1 = require("express");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
router.get('/', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit = '20', unread } = req.query;
        const take = Math.min(parseInt(limit, 10), 50);
        const where = { userId: req.userId };
        if (unread === 'true')
            where.isRead = false;
        const notifs = await index_1.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const unreadCount = await index_1.prisma.notification.count({
            where: { userId: req.userId, isRead: false },
        });
        const hasNextPage = notifs.length > take;
        res.json({
            notifications: hasNextPage ? notifs.slice(0, take) : notifs,
            nextCursor: hasNextPage ? notifs[take - 1].id : null,
            unreadCount,
        });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/read-all', index_2.authenticate, async (req, res, next) => {
    try {
        await index_1.prisma.notification.updateMany({
            where: { userId: req.userId, isRead: false },
            data: { isRead: true },
        });
        res.json({ message: 'All notifications marked as read' });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:id/read', index_2.authenticate, async (req, res, next) => {
    try {
        await index_1.prisma.notification.updateMany({
            where: { id: req.params.id, userId: req.userId },
            data: { isRead: true },
        });
        res.json({ message: 'Notification read' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
