import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { randomUUID } from 'crypto';

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

// List own invites
router.get('/', requireAuth, async (req: any, res) => {
  const invites = await prisma.invite.findMany({
    where: { inviterId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invites);
});

// Create invite
const createSchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

router.post('/', requireAuth, async (req: any, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload' });
  const { email, expiresInDays } = parse.data;

  const me = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!me) return res.status(401).json({ error: 'Unauthorized' });
  if (me.invitesRemaining <= 0) return res.status(403).json({ error: 'No invites remaining' });

  const code = randomUUID();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);
  const invite = await prisma.invite.create({
    data: {
      code,
      expiresAt,
      inviterId: me.id,
      inviteeEmail: email ?? null,
    },
  });
  // reserve one invite from remaining
  await prisma.user.update({ where: { id: me.id }, data: { invitesRemaining: { decrement: 1 } } });
  res.status(201).json(invite);
});

// Revoke invite if unused
router.post('/:code/revoke', requireAuth, async (req: any, res) => {
  const { code } = req.params;
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.inviterId !== req.userId) return res.status(404).json({ error: 'Not found' });
  if (invite.consumedById) return res.status(400).json({ error: 'Already consumed' });
  if (invite.revoked) return res.status(400).json({ error: 'Already revoked' });
  await prisma.invite.update({ where: { id: invite.id }, data: { revoked: true } });
  // return the reserved invite back
  await prisma.user.update({ where: { id: invite.inviterId }, data: { invitesRemaining: { increment: 1 } } });
  res.json({ ok: true });
});

export default router;


