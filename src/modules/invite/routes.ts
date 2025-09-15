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

// Summary of own invites
router.get('/summary', requireAuth, async (req: any, res) => {
  const now = new Date();
  const [me, createdTotal, used, pending] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId } }),
    prisma.invite.count({ where: { inviterId: req.userId } }),
    prisma.invite.count({ where: { inviterId: req.userId, consumedById: { not: null } } }),
    prisma.invite.count({
      where: {
        inviterId: req.userId,
        consumedById: null,
        revoked: false,
        expiresAt: { gt: now },
      },
    }),
  ]);
  res.json({ invitesRemaining: me?.invitesRemaining ?? 0, createdTotal, used, pending });
});

// Validate invite code
router.get('/validate/:code', async (req, res) => {
  const { code } = req.params as { code: string };
  const invite = await prisma.invite.findUnique({ where: { code }, include: { inviter: true } });
  if (!invite) return res.status(404).json({ valid: false, reason: 'NOT_FOUND' });
  if (invite.revoked) return res.status(400).json({ valid: false, reason: 'REVOKED' });
  if (invite.consumedById) return res.status(400).json({ valid: false, reason: 'USED' });
  if (invite.expiresAt < new Date()) return res.status(400).json({ valid: false, reason: 'EXPIRED' });
  return res.json({ valid: true, expiresAt: invite.expiresAt, inviter: { id: invite.inviterId, username: invite.inviter.username, displayName: invite.inviter.displayName } });
});

// Build invite tree (who invited whom) for current user or given userId
router.get('/tree', requireAuth, async (req: any, res) => {
  const userId = (req.query.userId as string | undefined) ?? req.userId;
  const invites = await prisma.invite.findMany({
    where: { OR: [{ inviterId: userId }, { consumedById: userId }] },
  });
  // To build full subtree, fetch all invites. For MVP keep limited breadth-first from the chosen root.
  const allInvites = await prisma.invite.findMany({ where: { consumedById: { not: null } } });
  const byInviter = new Map<string, typeof allInvites>();
  allInvites.forEach((inv) => {
    const key = inv.inviterId;
    const list = byInviter.get(key) ?? [];
    list.push(inv);
    byInviter.set(key, list);
  });
  function build(nodeUserId: string): any {
    const children = byInviter.get(nodeUserId) ?? [];
    return {
      userId: nodeUserId,
      invited: children.map((c) => ({ inviteId: c.id, code: c.code, userId: c.consumedById!, children: build(c.consumedById!).invited })),
    };
  }
  const tree = build(userId);
  res.json(tree);
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


