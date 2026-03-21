import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export function setupSocketHandlers(io: Server) {
  io.use((socket: any, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.userId = payload.userId;
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket: any) => {
    socket.join(`user:${socket.userId}`);

    socket.on('message:send', async (data: any, cb: any) => {
      io.to(`room:${data.roomId}`).emit('message:received', {
        ...data,
        senderId: socket.userId,
        createdAt: new Date()
      });
      cb?.({ success: true });
    });

    socket.on('typing:start', (data: any) =>
      socket.to(`room:${data.roomId}`).emit('typing:start', { userId: socket.userId }));

    socket.on('typing:stop', (data: any) =>
      socket.to(`room:${data.roomId}`).emit('typing:stop', { userId: socket.userId }));
  });
}
