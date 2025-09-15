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

Zaproszenia:
- `GET /api/invites` – lista własnych zaproszeń
- `GET /api/invites/summary` – podsumowanie (pozostałe, użyte, oczekujące)
- `GET /api/invites/validate/:code` – walidacja kodu (ważność, zapraszający)
- `GET /api/invites/tree` – drzewo „kto kogo zaprosił” od bieżącego użytkownika
- `POST /api/invites` – utworzenie zaproszenia (domyślnie wygasa po 7 dniach)
- `POST /api/invites/:code/revoke` – odwołanie niewykorzystanego zaproszenia

Admin:
- `POST /api/admin/bootstrap` – jednorazowe utworzenie konta admina (ENV: `ADMIN_BOOTSTRAP_SECRET`)
- `GET /api/admin/config` – odczyt `defaultInvitesPerUser`
- `PATCH /api/admin/config` – zmiana `defaultInvitesPerUser`
- `POST /api/admin/users/:userId/invites/adjust` – korekta puli zaproszeń użytkownika
- `GET /api/admin/invites` – lista wszystkich zaproszeń
- `POST /api/admin/invites/reset-monthly` – reset puli wszystkich użytkowników do wartości domyślnej
- `GET /api/admin/invites/tree` – globalne drzewo zaproszeń (opcjonalnie `?userId=` jako root)

Presence i „ostatnio widziany”:
- Socket.IO connect: przekazuj `auth: { token: <JWT> }`. Zdarzenia globalne:
  - `presence:online` payload `{ userId, online: boolean }`
- HTTP:
  - `GET /api/users/presence` – status online dla zalogowanego użytkownika
  - `GET /api/users/presence/:id` – status online oraz `lastSeenAt` (gdy `showLastSeen=true` u danego użytkownika)
- Aktualizacja `lastSeenAt`:
  - na logowaniu i `GET /api/users/me`
  - przy rozłączeniu ostatniego połączenia Socket.IO danego użytkownika

Wiadomości – edycja, usuwanie, reakcje, paginacja:
- HTTP:
  - `GET /api/messages/:conversationId?take=50&cursor=<messageId>` – paginacja (zwraca `{ items, nextCursor }`), element `items[].reactions`
  - `POST /api/messages/:conversationId` – wysyłka wiadomości tekstowej `{ text, replyToId? }`
  - `PATCH /api/messages/item/:messageId` – edycja wiadomości (autor lub admin) `{ text }`
  - `DELETE /api/messages/item/:messageId` – soft delete (autor lub admin)
  - `POST /api/messages/item/:messageId/reactions` – dodanie reakcji `{ emoji }`
  - `DELETE /api/messages/item/:messageId/reactions?emoji=...` – usunięcie własnej reakcji
- Socket.IO (po dołączeniu do pokoju `conversation:join` → `conv:<conversationId>`):
  - `message:new` payload: pełny obiekt wiadomości
  - `message:edited` payload: pełny obiekt wiadomości po edycji
  - `message:deleted` payload: `{ id, conversationId }`
  - `reaction:added` payload: obiekt reakcji
  - `reaction:removed` payload: `{ messageId, userId, emoji }`
  - `typing` payload: `{ conversationId, userId, typing: boolean }` (emitowane po `typing:start/stop`)

Socket.IO:
- Rezerwacja pod zdarzenia: wiadomości realtime, typing, itp.

Licencja: ISC

