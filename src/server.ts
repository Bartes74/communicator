import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { createApp } from './app';

const app = createApp();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

server.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});

