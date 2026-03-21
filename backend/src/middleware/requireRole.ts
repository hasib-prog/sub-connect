import { Request, Response, NextFunction } from 'express';
export function requireRole(roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!roles.includes(req.userRole)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
