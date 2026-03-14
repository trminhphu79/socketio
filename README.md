# Socket.IO — Room Filter Demo

A minimal full-stack demo showing how to:
- Subscribe multiple clients to a **named room** with user metadata
- Store client info on the server for later use
- **Filter and emit** messages to specific clients based on conditions (role, age range)
- Monitor everything in real-time from a dashboard UI

---

## Project Structure

```
socketio/
├── backend/
│   ├── server.js       ← Node.js + Socket.IO server
│   └── package.json
└── frontend/
    └── index.html      ← 4 client panels + dashboard (pure HTML/CSS/JS)
```

---

## Quick Start

```bash
cd backend
npm install
npm start
# → Server running at http://localhost:3000
```

Open **http://localhost:3000** in your browser.
> Do not open `index.html` directly — the page must be served from the Express server (or VS Code Live Server + explicit server URL).

---

## Core Concept: The Full Flow

```
CLIENT                          SERVER
  │                               │
  │── connect ──────────────────> │  socket assigned a unique socketId
  │                               │
  │── join-room { userInfo } ───> │  server stores userInfo + socketId
  │                               │  server adds socket to "main-room"
  │<─ join-ack ─────────────────  │  confirmation sent back to this client
  │<─ room-event (joined) ──────  │  broadcast to all in the room
  │<─ room-members ─────────────  │  updated member list sent to room
  │                               │
  │  (later)                      │
  │                               │<── new-conversation-publish { filter, message }
  │                               │    server loops stored clients
  │                               │    applies filter conditions
  │<─ message ──────────────────  │    emit ONLY to matched socketIds
  │                               │
  │── disconnect ───────────────> │  server removes from store + room
  │                               │  broadcast room-event (left)
```

---

## Phase 1 — Client Subscribes (Join Room)

When a client clicks **Join Room**, the frontend opens a socket connection and immediately emits `join-room` with the user's metadata:

```js
// frontend — index.html
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  socket.emit('join-room', {
    userId: 'u001',
    name:   'Bao Nguyen',
    role:   'admin',
    age:    30,
  });
});
```

### What the server does on `join-room`

```js
// backend — server.js
socket.on('join-room', (userInfo) => {
  // 1. Add socket to the Socket.IO room
  socket.join(ROOM);

  // 2. Store user info keyed by socketId
  roomClients[ROOM][socket.id] = {
    socketId: socket.id,   // ← used later to target this client
    userId:   userInfo.userId,
    name:     userInfo.name,
    role:     userInfo.role,
    age:      Number(userInfo.age),
    joinedAt: new Date().toISOString(),
  };

  // 3. Confirm to the joining client
  socket.emit('join-ack', { message: `Welcome ${userInfo.name}!` });

  // 4. Notify everyone in the room
  io.to(ROOM).emit('room-event', { event: 'joined', user: userInfo });
});
```

**Key point:** `socket.join(ROOM)` is Socket.IO's built-in room mechanism. The manual `roomClients` store is separate — it's your application-level registry that holds the metadata you need for filtering later.

---

## Phase 2 — Server Stores Client State

After all 4 clients join, `roomClients['main-room']` looks like this:

```js
{
  "abc123": { socketId: "abc123", name: "Bao Nguyen",  role: "admin",     age: 30 },
  "def456": { socketId: "def456", name: "Phu Tran",    role: "moderator", age: 26 },
  "ghi789": { socketId: "ghi789", name: "Khoi Tran",   role: "user",      age: 25 },
  "jkl012": { socketId: "jkl012", name: "Hieu Nguyen", role: "user",      age: 28 },
}
```

This is a plain in-memory object — a dictionary from `socketId → userInfo`. It is the source of truth for all filtering decisions.

---

## Phase 3 — Filtered Emit

When the dashboard sends a `new-conversation-publish` event, the server evaluates each stored client against the filter conditions:

```js
socket.on('new-conversation-publish', ({ filter, message }) => {
  const clients = Object.values(roomClients[ROOM]);  // all stored clients

  const targets = clients.filter((c) => {
    // Rule 1: role must match (skip check if "all")
    if (filter.role && filter.role !== 'all' && c.role !== filter.role) return false;

    // Rule 2: age must be >= minAge
    if (filter.minAge != null && c.age < Number(filter.minAge)) return false;

    // Rule 3: age must be <= maxAge
    if (filter.maxAge != null && c.age > Number(filter.maxAge)) return false;

    return true;  // passed all conditions → include this client
  });

  // Emit ONLY to matched clients, one by one
  targets.forEach((c) => {
    io.to(c.socketId).emit('message', { content: message, filter });
  });
});
```

### Filter examples

| Filter config | Who receives it |
|---|---|
| `role: "all"` | Bao, Phu, Khoi, Hieu |
| `role: "admin"` | Bao Nguyen only |
| `role: "moderator"` | Phu Tran only |
| `role: "user"` | Khoi Tran, Hieu Nguyen |
| `minAge: 27` | Bao (30), Hieu (28) |
| `maxAge: 26` | Phu (26), Khoi (25) |
| `role: "user", minAge: 27` | Hieu Nguyen (user, 28) |
| `minAge: 25, maxAge: 28` | Phu (26), Khoi (25), Hieu (28) |

### Why `io.to(socketId)` and not `io.to(ROOM)`?

| Method | Behavior |
|---|---|
| `io.to(ROOM).emit(...)` | Sends to **all** sockets in the room — no filtering possible |
| `io.to(socketId).emit(...)` | Sends to **exactly one** socket — used after your filter loop |

By filtering first (app level) and then emitting per `socketId` (transport level), you get precise targeting without broadcasting noise to unintended clients.

---

## Socket Events Reference

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join-room` | `{ userId, name, role, age }` | Subscribe to the room with user metadata |
| `new-conversation-publish` | `{ filter, message }` | Publish a conversation to clients matching filter |
| `get-room-state` | _(none)_ | Request current connected clients snapshot |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `join-ack` | `{ message, yourInfo }` | Confirmation sent only to the joining client |
| `room-event` | `{ event, user, timestamp }` | Broadcast when anyone joins or leaves |
| `room-members` | `{ clients[] }` | Updated member list sent to all in room |
| `message` | `{ content, filter, sentAt }` | Targeted message (only filtered clients receive this) |
| `dashboard-update` | `{ clients[] }` | Sent to all connections (for dashboard display) |
| `message-sent-log` | `{ filter, message, targetNames[], targetCount }` | Audit log of what was sent and to whom |

---

## Disconnect Handling

When a client disconnects (closes tab, network drop, explicit `.disconnect()`):

```js
socket.on('disconnect', () => {
  const user = roomClients[ROOM][socket.id];
  if (user) {
    delete roomClients[ROOM][socket.id];   // remove from filter registry
    io.to(ROOM).emit('room-event', { event: 'left', user });
    broadcastRoomState();                  // refresh dashboard
  }
});
```

Socket.IO automatically removes the socket from its internal rooms on disconnect. You are responsible for cleaning up your own `roomClients` store.

---

## Architecture Notes

```
┌─────────────────────────────────────────────────────────┐
│                      SERVER MEMORY                       │
│                                                          │
│  Socket.IO rooms (internal)      Your store (app level)  │
│  ┌──────────────────────┐        ┌────────────────────┐  │
│  │ "main-room"          │        │ roomClients        │  │
│  │   Set<socketId>      │        │  [socketId]:       │  │
│  │   ├ abc123 (Bao)     │        │    name, role, age │  │
│  │   ├ def456 (Phu)     │        │    userId, etc.    │  │
│  │   ├ ghi789 (Khoi)    │        └────────────────────┘  │
│  │   └ jkl012 (Hieu)    │                                 │
│  └──────────────────────┘                                │
│         used for room broadcasts        used for filters  │
└─────────────────────────────────────────────────────────┘
```

Socket.IO's rooms handle **transport-level grouping** (fast broadcast to all).
Your `roomClients` store handles **application-level targeting** (selective emit based on data).
Both work together — rooms for membership, your store for metadata.
