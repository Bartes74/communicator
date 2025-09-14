import { Router } from 'express';
import { PrismaClient, UserStatus } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

const prisma = new PrismaClient();
const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

router.get('/me', requireAuth, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, email: user.email, username: user.username, displayName: user.displayName, status: user.status });
});

router.patch('/me', requireAuth, async (req: any, res) => {
  const { displayName, bio, status } = req.body as { displayName?: string; bio?: string; status?: UserStatus };
  const updated = await prisma.user.update({ where: { id: req.userId }, data: { displayName, bio, status } });
  res.json({ id: updated.id, displayName: updated.displayName, bio: updated.bio, status: updated.status });
});

export default router;

