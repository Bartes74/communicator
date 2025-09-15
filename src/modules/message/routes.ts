import { Router } from 'express';
import { PrismaClient, MessageType } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { getIO } from '../../realtime';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';

const prisma = new PrismaClient();
const router = Router();

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

// Multer storage for media (100MB limit)
const mediaDir = path.join(process.cwd(), 'uploads', 'media');
try { fs.mkdirSync(mediaDir, { recursive: true }); } catch {}
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Basic MIME allow-listing; detailed per-type checks occur after upload
    const mime = file.mimetype || '';
    if (mime.startsWith('image/') || mime.startsWith('audio/')) return cb(null, true);
    const allowed = new Set([
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'text/plain',
    ]);
    if (allowed.has(mime)) return cb(null, true);
    return cb(new Error('Unsupported file type'));
  },
});

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

// Upload media (image/file/voice)
router.post('/:conversationId/media', requireAuth, upload.single('file'), async (req: any, res) => {
  const { conversationId } = req.params as { conversationId: string };
  const file = req.file as Express.Multer.File | undefined;
  const { caption } = (req.body as any) as { caption?: string };
  if (!file) return res.status(400).json({ error: 'No file' });
  const mime = file.mimetype || 'application/octet-stream';
  const relUrl = `/uploads/media/${file.filename}`;
  let type: MessageType = MessageType.FILE;
  if (mime.startsWith('image/')) type = MessageType.IMAGE;
  else if (mime.startsWith('audio/')) type = MessageType.VOICE;

  // Per-type validation sizes and mime
  const maxImage = 10 * 1024 * 1024; // 10MB
  const maxAudio = 20 * 1024 * 1024; // 20MB
  const maxFile = 100 * 1024 * 1024; // 100MB (overall limit)
  const allowedImages = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const allowedAudio = new Set(['audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/mp4']);

  function rejectWithCleanup(message: string, status = 400) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(status).json({ error: message });
  }

  if (type === MessageType.IMAGE) {
    if (!allowedImages.has(mime)) return rejectWithCleanup('Unsupported image type');
    if (file.size > maxImage) return rejectWithCleanup('Image too large (max 10MB)', 413);
  } else if (type === MessageType.VOICE) {
    if (!allowedAudio.has(mime)) return rejectWithCleanup('Unsupported audio type');
    if (file.size > maxAudio) return rejectWithCleanup('Audio too large (max 20MB)', 413);
  } else {
    if (file.size > maxFile) return rejectWithCleanup('File too large (max 100MB)', 413);
    const allowedFiles = new Set(['application/pdf', 'application/zip', 'application/x-zip-compressed', 'text/plain']);
    if (!allowedFiles.has(mime)) {
      // keep conservative for MVP
      return rejectWithCleanup('Unsupported file type');
    }
  }

  let thumbnailUrl: string | null = null;
  let durationSeconds: number | null = null;
  if (type === MessageType.IMAGE) {
    try {
      const thumbsDir = path.join(process.cwd(), 'uploads', 'thumbs');
      try { fs.mkdirSync(thumbsDir, { recursive: true }); } catch {}
      const thumbName = `${path.parse(file.filename).name}-thumb.jpg`;
      const thumbPath = path.join(thumbsDir, thumbName);
      await sharp(file.path).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath);
      thumbnailUrl = `/uploads/thumbs/${thumbName}`;
    } catch (e) {
      console.error('Thumbnail generation failed', e);
    }
  } else if (type === MessageType.VOICE) {
    try {
      const meta = await parseFile(file.path);
      if (meta && meta.format && typeof meta.format.duration === 'number') {
        durationSeconds = Math.round(meta.format.duration);
      }
    } catch (e) {
      console.error('Audio metadata parse failed', e);
    }
  }

  const msg = await prisma.message.create({
    data: {
      conversationId,
      senderId: req.userId,
      type,
      text: caption ?? null,
      mediaUrl: relUrl,
      mediaMime: mime,
      thumbnailUrl,
      durationSeconds,
    },
  });
  const io = getIO();
  if (io) io.to(`conv:${conversationId}`).emit('message:new', msg);
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

