import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { createApp } from './app';
import jwt from 'jsonwebtoken';
import { markOnline, markOffline, isOnline } from './modules/user/presence';
import { PrismaClient } from '@prisma/client';

const app = createApp();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    credentials: true,
  },
});

const prisma = new PrismaClient();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Unauthorized'));
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    (socket as any).userId = payload.sub;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', async (socket) => {
  const userId = (socket as any).userId as string;
  markOnline(userId);
  io.emit('presence:online', { userId, online: true });
  try { await prisma.user.update({ where: { id: userId }, data: { status: 'ONLINE' } }); } catch {}

  socket.on('disconnect', async () => {
    const remaining = markOffline(userId);
    if (remaining === 0) {
      // only mark lastSeen when no more connections
      try { await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(), status: 'AWAY' } }); } catch {}
      io.emit('presence:online', { userId, online: false });
    }
  });
});

server.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});

