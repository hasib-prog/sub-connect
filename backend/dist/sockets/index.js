"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketHandlers = setupSocketHandlers;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function setupSocketHandlers(io) {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token)
            return next(new Error('No token'));
        try {
            const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            socket.userId = payload.userId;
            next();
        }
        catch {
            next(new Error('Invalid token'));
        }
    });
    io.on('connection', (socket) => {
        socket.join(`user:${socket.userId}`);
        socket.on('message:send', async (data, cb) => {
            io.to(`room:${data.roomId}`).emit('message:received', {
                ...data,
                senderId: socket.userId,
                createdAt: new Date()
            });
            cb?.({ success: true });
        });
        socket.on('typing:start', (data) => socket.to(`room:${data.roomId}`).emit('typing:start', { userId: socket.userId }));
        socket.on('typing:stop', (data) => socket.to(`room:${data.roomId}`).emit('typing:stop', { userId: socket.userId }));
    });
}
