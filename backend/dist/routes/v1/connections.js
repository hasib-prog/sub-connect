"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Connections Routes — /api/v1/connections
 */
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
router.post('/', index_2.authenticate, async (req, res, next) => {
    try {
        const { toId } = zod_1.z.object({ toId: zod_1.z.string().cuid() }).parse(req.body);
        if (toId === req.userId)
            throw new index_1.AppError('Cannot connect with yourself', 400);
        const existing = await index_1.prisma.connection.findFirst({
            where: { OR: [{ fromId: req.userId, toId }, { fromId: toId, toId: req.userId }] },
        });
        if (existing)
            throw new index_1.AppError('Connection already exists', 409);
        const connection = await index_1.prisma.connection.create({
            data: { fromId: req.userId, toId },
        });
        await (0, index_1.createNotification)({
            userId: toId,
            type: 'CONNECTION_REQUEST',
            title: 'New connection request',
            data: { connectionId: connection.id, fromId: req.userId },
        });
        res.status(201).json({ connection });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const { status } = zod_1.z.object({ status: zod_1.z.enum(['ACCEPTED', 'REJECTED']) }).parse(req.body);
        const conn = await index_1.prisma.connection.findUnique({ where: { id: req.params.id } });
        if (!conn)
            throw new index_1.AppError('Connection not found', 404);
        if (conn.toId !== req.userId)
            throw new index_1.AppError('Not authorized', 403);
        const updated = await index_1.prisma.connection.update({ where: { id: req.params.id }, data: { status } });
        if (status === 'ACCEPTED') {
            await (0, index_1.createNotification)({
                userId: conn.fromId,
                type: 'CONNECTION_ACCEPTED',
                title: 'Connection accepted',
                data: { connectionId: conn.id },
            });
        }
        res.json({ connection: updated });
    }
    catch (err) {
        next(err);
    }
});
router.get('/', index_2.authenticate, async (req, res, next) => {
    try {
        const status = req.query.status || 'ACCEPTED';
        const connections = await index_1.prisma.connection.findMany({
            where: { OR: [{ fromId: req.userId }, { toId: req.userId }], status: status },
            include: {
                from: { select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, jobTitle: true, department: true } } } },
                to: { select: { id: true, role: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true, jobTitle: true, department: true } } } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ connections });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const conn = await index_1.prisma.connection.findUnique({ where: { id: req.params.id } });
        if (!conn)
            throw new index_1.AppError('Not found', 404);
        if (conn.fromId !== req.userId && conn.toId !== req.userId)
            throw new index_1.AppError('Not authorized', 403);
        await index_1.prisma.connection.delete({ where: { id: req.params.id } });
        res.json({ message: 'Connection removed' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
