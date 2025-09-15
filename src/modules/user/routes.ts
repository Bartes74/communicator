import { Router } from 'express';
import { PrismaClient, UserStatus } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { isOnline } from './presence';

const prisma = new PrismaClient();
const router = Router();

// Multer storage for avatars
const avatarsDir = path.join(process.cwd(), 'uploads', 'avatars');
try { fs.mkdirSync(avatarsDir, { recursive: true }); } catch {}
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Only image files allowed'));
  },
});

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers['authorization'] as string | undefined;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const token = bearer ?? req.cookies?.token;
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
  const user = await prisma.user.update({ where: { id: req.userId }, data: { lastSeenAt: new Date() } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, email: user.email, username: user.username, displayName: user.displayName, status: user.status });
});

router.patch('/me', requireAuth, async (req: any, res) => {
  const { displayName, bio, status, showLastSeen } = req.body as { displayName?: string; bio?: string; status?: UserStatus; showLastSeen?: boolean };
  const updated = await prisma.user.update({ where: { id: req.userId }, data: { displayName, bio, status, showLastSeen } });
  res.json({ id: updated.id, displayName: updated.displayName, bio: updated.bio, status: updated.status, showLastSeen: updated.showLastSeen });
});

// Upload avatar
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const relPath = `/uploads/avatars/${req.file.filename}`;
  const updated = await prisma.user.update({ where: { id: req.userId }, data: { avatarUrl: relPath } });
  res.json({ avatarUrl: updated.avatarUrl });
});

// Presence HTTP endpoints
router.get('/presence', requireAuth, async (req: any, res) => {
  const meOnline = isOnline(req.userId);
  res.json({ userId: req.userId, online: meOnline });
});

router.get('/presence/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const online = isOnline(id);
  res.json({ userId: id, online, lastSeenAt: user.showLastSeen ? user.lastSeenAt : null });
});

// Public profile
router.get('/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    lastSeenAt: user.showLastSeen ? user.lastSeenAt : null,
    bio: user.bio ?? null,
  });
});

export default router;

