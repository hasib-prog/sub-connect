"use strict";
/**
 * Posts Routes — /api/v1/posts
 * Social feed, cursor-based infinite scroll, likes, comments, reposts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const index_1 = require("../../lib/index");
const index_2 = require("../../middleware/index");
const router = (0, express_1.Router)();
const AUTHOR_SELECT = {
    id: true,
    role: true,
    profile: {
        select: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            jobTitle: true,
            currentCompany: true,
            department: true,
            isOpenToWork: true,
        },
    },
};
// ─── GET /posts/feed ──────────────────────────────────────────────────────────
router.get('/feed', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit = '10' } = req.query;
        const take = Math.min(parseInt(limit, 10), 20);
        // Build personalized feed from connections + public posts
        const connections = await index_1.prisma.connection.findMany({
            where: {
                OR: [
                    { fromId: req.userId, status: 'ACCEPTED' },
                    { toId: req.userId, status: 'ACCEPTED' },
                ],
            },
            select: { fromId: true, toId: true },
        });
        const feedIds = [
            req.userId,
            ...connections.map((c) => (c.fromId === req.userId ? c.toId : c.fromId)),
        ];
        const posts = await index_1.prisma.post.findMany({
            where: {
                OR: [
                    { authorId: { in: feedIds } },
                    { visibility: 'public' },
                ],
            },
            include: {
                author: { select: AUTHOR_SELECT },
                likes: { where: { userId: req.userId }, select: { id: true } },
                _count: { select: { likes: true, comments: true, reposts: true } },
                repostOf: {
                    include: { author: { select: AUTHOR_SELECT } },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasNextPage = posts.length > take;
        const data = hasNextPage ? posts.slice(0, take) : posts;
        res.json({
            posts: data.map((p) => ({
                ...p,
                isLiked: p.likes.length > 0,
                likes: undefined,
            })),
            nextCursor: hasNextPage ? data[data.length - 1].id : null,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /posts ──────────────────────────────────────────────────────────────
const createPostSchema = zod_1.z.object({
    content: zod_1.z.string().min(1, 'Post cannot be empty').max(3000),
    mediaUrls: zod_1.z.array(zod_1.z.string().url()).max(4).optional().default([]),
    tags: zod_1.z.array(zod_1.z.string().max(30)).max(10).optional().default([]),
    visibility: zod_1.z.enum(['public', 'connections', 'private']).default('public'),
    repostOfId: zod_1.z.string().cuid().optional(),
});
router.post('/', index_2.authenticate, (0, index_2.validate)(createPostSchema), async (req, res, next) => {
    try {
        const { repostOfId, ...rest } = req.body;
        if (repostOfId) {
            const original = await index_1.prisma.post.findUnique({ where: { id: repostOfId } });
            if (!original)
                throw new index_1.AppError('Original post not found', 404);
        }
        const post = await index_1.prisma.post.create({
            data: {
                ...rest,
                isRepost: !!repostOfId,
                repostOfId,
                authorId: req.userId,
            },
            include: {
                author: { select: AUTHOR_SELECT },
                _count: { select: { likes: true, comments: true, reposts: true } },
            },
        });
        res.status(201).json({ post: { ...post, isLiked: false } });
    }
    catch (err) {
        next(err);
    }
});
// ─── DELETE /posts/:id ────────────────────────────────────────────────────────
router.delete('/:id', index_2.authenticate, async (req, res, next) => {
    try {
        const post = await index_1.prisma.post.findUnique({ where: { id: req.params.id } });
        if (!post)
            throw new index_1.AppError('Post not found', 404);
        if (post.authorId !== req.userId && req.userRole !== 'ADMIN') {
            throw new index_1.AppError('Not authorized to delete this post', 403);
        }
        await index_1.prisma.post.delete({ where: { id: req.params.id } });
        res.json({ message: 'Post deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /posts/:id/like ─────────────────────────────────────────────────────
router.post('/:id/like', index_2.authenticate, async (req, res, next) => {
    try {
        const post = await index_1.prisma.post.findUnique({ where: { id: req.params.id } });
        if (!post)
            throw new index_1.AppError('Post not found', 404);
        const existing = await index_1.prisma.like.findUnique({
            where: { userId_postId: { userId: req.userId, postId: req.params.id } },
        });
        if (existing) {
            await index_1.prisma.like.delete({
                where: { userId_postId: { userId: req.userId, postId: req.params.id } },
            });
            res.json({ liked: false });
        }
        else {
            await index_1.prisma.like.create({
                data: { userId: req.userId, postId: req.params.id },
            });
            if (post.authorId !== req.userId) {
                await (0, index_1.createNotification)({
                    userId: post.authorId,
                    type: 'LIKE',
                    title: 'Someone liked your post',
                    data: { postId: req.params.id, actorId: req.userId },
                });
            }
            res.json({ liked: true });
        }
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /posts/:id/comments ──────────────────────────────────────────────────
router.get('/:id/comments', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit = '10' } = req.query;
        const take = Math.min(parseInt(limit, 10), 20);
        const comments = await index_1.prisma.comment.findMany({
            where: { postId: req.params.id, parentId: null },
            include: {
                author: { select: AUTHOR_SELECT },
                replies: {
                    include: { author: { select: AUTHOR_SELECT } },
                    orderBy: { createdAt: 'asc' },
                    take: 3,
                },
                _count: { select: { replies: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasNextPage = comments.length > take;
        res.json({
            comments: hasNextPage ? comments.slice(0, take) : comments,
            nextCursor: hasNextPage ? comments[take - 1].id : null,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── POST /posts/:id/comments ─────────────────────────────────────────────────
router.post('/:id/comments', index_2.authenticate, async (req, res, next) => {
    try {
        const schema = zod_1.z.object({
            content: zod_1.z.string().min(1).max(1000),
            parentId: zod_1.z.string().cuid().optional(),
        });
        const { content, parentId } = schema.parse(req.body);
        const post = await index_1.prisma.post.findUnique({ where: { id: req.params.id } });
        if (!post)
            throw new index_1.AppError('Post not found', 404);
        const comment = await index_1.prisma.comment.create({
            data: { content, parentId, postId: req.params.id, authorId: req.userId },
            include: { author: { select: AUTHOR_SELECT } },
        });
        if (post.authorId !== req.userId) {
            await (0, index_1.createNotification)({
                userId: post.authorId,
                type: 'COMMENT',
                title: 'Someone commented on your post',
                data: { postId: req.params.id, commentId: comment.id, actorId: req.userId },
            });
        }
        res.status(201).json({ comment });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /posts/user/:userId ──────────────────────────────────────────────────
router.get('/user/:userId', index_2.authenticate, async (req, res, next) => {
    try {
        const { cursor, limit = '10' } = req.query;
        const take = Math.min(parseInt(limit, 10), 20);
        const posts = await index_1.prisma.post.findMany({
            where: { authorId: req.params.userId },
            include: {
                author: { select: AUTHOR_SELECT },
                likes: { where: { userId: req.userId }, select: { id: true } },
                _count: { select: { likes: true, comments: true, reposts: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const hasNextPage = posts.length > take;
        const data = hasNextPage ? posts.slice(0, take) : posts;
        res.json({
            posts: data.map((p) => ({ ...p, isLiked: p.likes.length > 0, likes: undefined })),
            nextCursor: hasNextPage ? data[data.length - 1].id : null,
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
