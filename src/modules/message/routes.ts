import { Router } from 'express';
import { PrismaClient, MessageType } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { getIO } from '../../realtime';

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
  const { conversationId } = req.params as { conversationId: string };
  const { cursor, take } = (req.query as any) as { cursor?: string; take?: string };
  const pageSize = Math.min(parseInt(take ?? '50', 10) || 50, 100);
  const where = { conversationId } as const;
  const orderBy = { createdAt: 'desc' } as const;
  const messages = await prisma.message.findMany({
    where,
    orderBy,
    take: pageSize,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    include: { reactions: true },
  });
  const nextCursor = messages.length === pageSize ? messages[messages.length - 1].id : null;
  res.json({ items: messages.reverse(), nextCursor });
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
  const io = getIO();
  if (io) {
    io.to(`conv:${conversationId}`).emit('message:new', msg);
  }
  res.status(201).json(msg);
});

// Edit message (sender or admin)
router.patch('/item/:messageId', requireAuth, async (req: any, res) => {
  const { messageId } = req.params as { messageId: string };
  const { text } = req.body as { text: string };
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) return res.status(404).json({ error: 'Not found' });
  const me = await prisma.user.findUnique({ where: { id: req.userId } });
  const isAdmin = me?.role === 'ADMIN';
  if (!isAdmin && msg.senderId !== req.userId) return res.status(403).json({ error: 'Forbidden' });
  const updated = await prisma.message.update({ where: { id: messageId }, data: { text, editedAt: new Date() } });
  const io = getIO();
  if (io) io.to(`conv:${updated.conversationId}`).emit('message:edited', updated);
  res.json(updated);
});

// Delete message (soft delete) - sender or admin
router.delete('/item/:messageId', requireAuth, async (req: any, res) => {
  const { messageId } = req.params as { messageId: string };
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) return res.status(404).json({ error: 'Not found' });
  const me = await prisma.user.findUnique({ where: { id: req.userId } });
  const isAdmin = me?.role === 'ADMIN';
  if (!isAdmin && msg.senderId !== req.userId) return res.status(403).json({ error: 'Forbidden' });
  const updated = await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), text: null } });
  const io = getIO();
  if (io) io.to(`conv:${updated.conversationId}`).emit('message:deleted', { id: updated.id, conversationId: updated.conversationId });
  res.json({ ok: true });
});

// Add reaction
router.post('/item/:messageId/reactions', requireAuth, async (req: any, res) => {
  const { messageId } = req.params as { messageId: string };
  const { emoji } = req.body as { emoji: string };
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });
  const existing = await prisma.reaction.findFirst({ where: { messageId, userId: req.userId, emoji } });
  if (existing) return res.json(existing);
  const created = await prisma.reaction.create({ data: { messageId, userId: req.userId, emoji } });
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  const io = getIO();
  if (io && msg) io.to(`conv:${msg.conversationId}`).emit('reaction:added', created);
  res.status(201).json(created);
});

// Remove reaction
router.delete('/item/:messageId/reactions', requireAuth, async (req: any, res) => {
  const { messageId } = req.params as { messageId: string };
  const { emoji } = (req.query as any) as { emoji?: string };
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });
  const existing = await prisma.reaction.findFirst({ where: { messageId, userId: req.userId, emoji } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await prisma.reaction.delete({ where: { id: existing.id } });
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  const io = getIO();
  if (io && msg) io.to(`conv:${msg.conversationId}`).emit('reaction:removed', { messageId, userId: req.userId, emoji });
  res.json({ ok: true });
});

export default router;

