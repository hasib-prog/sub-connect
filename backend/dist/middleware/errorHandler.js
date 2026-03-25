"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
function errorHandler(err, req, res, next) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
}
