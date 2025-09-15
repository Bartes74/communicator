import { Router } from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
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

async function requireAdmin(req: any, res: any, next: any) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Bootstrap admin using one-time secret (env)
const bootstrapSchema = z.object({
  secret: z.string(),
  email: z.string().email(),
  username: z.string().min(3).max(30),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8),
});

router.post('/bootstrap', async (req, res) => {
  const parse = bootstrapSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload' });
  const { secret, email, username, displayName, password } = parse.data;
  if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== env.ADMIN_BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) return res.status(409).json({ error: 'User exists' });
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash(password, 12);
  // Ensure config exists
  const config = await prisma.appConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', defaultInvitesPerUser: 5 },
  }).catch(async () => {
    // Fallback without fixed ID if no unique constraint
    const created = await prisma.appConfig.create({ data: { defaultInvitesPerUser: 5 } });
    return created;
  });
  const admin = await prisma.user.create({
    data: {
      email,
      username,
      displayName,
      passwordHash,
      role: UserRole.ADMIN,
      invitesRemaining: config.defaultInvitesPerUser,
    },
  });
  return res.status(201).json({ id: admin.id, role: admin.role });
});

// Get/set defaultInvitesPerUser
router.get('/config', requireAuth, requireAdmin, async (_req, res) => {
  const cfg = await prisma.appConfig.findFirst();
  res.json({ defaultInvitesPerUser: cfg?.defaultInvitesPerUser ?? 5 });
});

const setCfgSchema = z.object({ defaultInvitesPerUser: z.number().int().min(0).max(100) });
router.patch('/config', requireAuth, requireAdmin, async (req, res) => {
  const parse = setCfgSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload' });
  const { defaultInvitesPerUser } = parse.data;
  const cfg = await prisma.appConfig.findFirst();
  if (!cfg) {
    const created = await prisma.appConfig.create({ data: { defaultInvitesPerUser } });
    return res.json({ defaultInvitesPerUser: created.defaultInvitesPerUser });
  }
  const updated = await prisma.appConfig.update({ where: { id: cfg.id }, data: { defaultInvitesPerUser } });
  res.json({ defaultInvitesPerUser: updated.defaultInvitesPerUser });
});

// Admin adjust user's invitesRemaining
const adjustSchema = z.object({ amount: z.number().int().min(-100).max(100) });
router.post('/users/:userId/invites/adjust', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params as { userId: string };
  const parse = adjustSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload' });
  const { amount } = parse.data;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: amount >= 0 ? { invitesRemaining: { increment: amount } } : { invitesRemaining: { decrement: Math.abs(amount) } },
  });
  res.json({ invitesRemaining: updated.invitesRemaining });
});

export default router;

// Admin-only: list all invites
router.get('/invites', requireAuth, requireAdmin, async (_req, res) => {
  const all = await prisma.invite.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(all);
});

// Admin: reset monthly invitesRemaining for all users to config default
router.post('/invites/reset-monthly', requireAuth, requireAdmin, async (_req, res) => {
  const cfg = await prisma.appConfig.findFirst();
  const value = cfg?.defaultInvitesPerUser ?? 5;
  await prisma.user.updateMany({ data: { invitesRemaining: value } });
  res.json({ ok: true, invitesRemaining: value });
});

// Admin: full invitations tree from a specific root user
router.get('/invites/tree', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = (req.query as any) as { userId?: string };
  const rootId = userId ?? (await prisma.user.findFirst({ where: { role: 'ADMIN' } }))?.id;
  if (!rootId) return res.status(404).json({ error: 'Root not found' });
  const all = await prisma.invite.findMany({ where: { consumedById: { not: null } } });
  const byInviter = new Map<string, typeof all>();
  all.forEach((i) => {
    const list = byInviter.get(i.inviterId) ?? [];
    list.push(i);
    byInviter.set(i.inviterId, list);
  });
  function build(node: string): any {
    const children = byInviter.get(node) ?? [];
    return {
      userId: node,
      invited: children.map((c) => ({ inviteId: c.id, code: c.code, userId: c.consumedById!, children: build(c.consumedById!).invited })),
    };
  }
  res.json(build(rootId));
});



