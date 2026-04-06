"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    process.exit(1);
});
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
console.log('Loading routes...');
const auth_1 = __importDefault(require("./routes/v1/auth"));
const users_1 = __importDefault(require("./routes/v1/users"));
const posts_1 = __importDefault(require("./routes/v1/posts"));
const jobs_1 = __importDefault(require("./routes/v1/jobs"));
const chat_1 = __importDefault(require("./routes/v1/chat"));
const mentorship_1 = __importDefault(require("./routes/v1/mentorship"));
const search_1 = __importDefault(require("./routes/v1/search"));
const notifications_1 = __importDefault(require("./routes/v1/notifications"));
const connections_1 = __importDefault(require("./routes/v1/connections"));
const sockets_1 = require("./sockets");
const errorHandler_1 = require("./middleware/errorHandler");
console.log('Routes loaded. Setting up Express...');
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    },
});
exports.io = io;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
}));
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/v1/auth', auth_1.default);
app.use('/api/v1/users', users_1.default);
app.use('/api/v1/posts', posts_1.default);
app.use('/api/v1/jobs', jobs_1.default);
app.use('/api/v1/chat', chat_1.default);
app.use('/api/v1/mentorship', mentorship_1.default);
app.use('/api/v1/search', search_1.default);
app.use('/api/v1/notifications', notifications_1.default);
app.use('/api/v1/connections', connections_1.default);
(0, sockets_1.setupSocketHandlers)(io);
app.use(errorHandler_1.errorHandler);
const PORT = parseInt(process.env.PORT || '8080', 10);
console.log('Starting server on port', PORT);
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});
