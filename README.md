# Private Communicator - Backend (MVP)

Wymagania:
- Node.js >= 18.18
- Docker & Docker Compose

Uruchomienie (dev):
1. Skonfiguruj plik `.env` (patrz sekcja poniżej)
2. Uruchom usługi: `docker compose up -d`
3. Wygeneruj klienta i migracje: `npm run prisma:generate && npm run prisma:migrate`
4. Start serwera: `npm run dev`

ENV:
```
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/private_communicator?schema=public
JWT_SECRET=change_this_secret_please
REDIS_URL=redis://localhost:6379
```

Endpointy podstawowe:
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/users/me`
- `PATCH /api/users/me`
- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/messages/:conversationId`
- `POST /api/messages/:conversationId`

Socket.IO:
- Rezerwacja pod zdarzenia: wiadomości realtime, typing, itp.

Licencja: ISC

