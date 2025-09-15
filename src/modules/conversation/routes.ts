import { Router } from 'express';
import { PrismaClient, MemberRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

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

router.get('/', requireAuth, async (req: any, res) => {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: req.userId },
    include: {
      conversation: {
        include: {
          members: { include: { user: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  const conversations = memberships.map((m) => m.conversation);
  res.json(conversations);
});

router.post('/', requireAuth, async (req: any, res) => {
  const { memberIds, name } = req.body as { memberIds: string[]; name?: string };
  const isGroup = memberIds.length > 1;
  const conversation = await prisma.conversation.create({
    data: {
      isGroup,
      name: isGroup ? name ?? 'Group' : null,
      members: {
        create: [
          { userId: req.userId, role: MemberRole.OWNER },
          ...memberIds.filter((id) => id !== req.userId).map((id) => ({ userId: id, role: MemberRole.MEMBER })),
        ],
      },
    },
  });
  res.status(201).json(conversation);
});

export default router;

