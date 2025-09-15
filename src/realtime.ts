import type { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}


