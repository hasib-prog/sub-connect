"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success)
            return res.status(400).json({ error: 'Validation failed', details: result.error.errors });
        req.body = result.data;
        next();
    };
}
