import { Router } from 'express';
import { PrismaClient, MessageType } from '@prisma/client';
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

router.get('/:conversationId', requireAuth, async (req: any, res) => {
  const { conversationId } = req.params;
  const messages = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  res.json(messages);
});

router.post('/:conversationId', requireAuth, async (req: any, res) => {
  const { conversationId } = req.params;
  const { text, replyToId } = req.body as { text: string; replyToId?: string };
  const msg = await prisma.message.create({
    data: {
      conversationId,
      senderId: req.userId,
      type: MessageType.TEXT,
      text,
      replyToId: replyToId ?? null,
    },
  });
  res.status(201).json(msg);
});

export default router;

