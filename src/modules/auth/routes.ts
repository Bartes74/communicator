import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

const prisma = new PrismaClient();
const router = Router();

const registerSchema = z.object({
  inviteCode: z.string(),
  email: z.string().email(),
  username: z.string().min(3).max(30),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8),
});

router.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const { inviteCode, email, username, displayName, password } = parse.data;

  const invite = await prisma.invite.findUnique({ where: { code: inviteCode } });
  if (!invite || invite.revoked || (invite.expiresAt < new Date())) {
    return res.status(400).json({ error: 'Invalid or expired invite' });
  }
  if (invite.consumedById) {
    return res.status(400).json({ error: 'Invite already used' });
  }

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) {
    return res.status(409).json({ error: 'Email or username already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      displayName,
      passwordHash,
    },
  });

  await prisma.invite.update({ where: { id: invite.id }, data: { consumedById: user.id, consumedAt: new Date() } });

  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
  return res.status(201).json({ id: user.id, username: user.username, displayName: user.displayName });
});

const loginSchema = z.object({
  emailOrUsername: z.string(),
  password: z.string(),
});

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const { emailOrUsername, password } = parse.data;
  const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
  return res.json({ id: user.id, username: user.username, displayName: user.displayName });
});

router.post('/logout', async (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;

