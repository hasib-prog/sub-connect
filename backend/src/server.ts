import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { setupSocketHandlers } from './sockets';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/v1/auth';
import userRoutes from './routes/v1/users';
import postRoutes from './routes/v1/posts';
import jobRoutes from './routes/v1/jobs';
import chatRoutes from './routes/v1/chat';
import mentorshipRoutes from './routes/v1/mentorship';
import searchRoutes from './routes/v1/search';
import notificationRoutes from './routes/v1/notifications';
import connectionRoutes from './routes/v1/connections';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || '*', credentials: true },
});

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/mentorship', mentorshipRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/connections', connectionRoutes);

setupSocketHandlers(io);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '8080', 10);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

export { io };
