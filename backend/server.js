const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(path.join(__dirname, '../frontend')));

// roomClients[ROOM] = { [socketId]: { socketId, userId, name, role, age, joinedAt } }
const ROOM = 'main-room';
const roomClients = { [ROOM]: {} };

function broadcastRoomState() {
  const clients = Object.values(roomClients[ROOM]);
  io.emit('dashboard-update', { clients });
  io.to(ROOM).emit('room-members', { clients });
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Client joins the room with their user info
  socket.on('join-room', (userInfo) => {
    const { userId, name, role, age } = userInfo;

    socket.join(ROOM);
    roomClients[ROOM][socket.id] = {
      socketId: socket.id,
      userId,
      name,
      role,
      age: Number(age),
      joinedAt: new Date().toISOString(),
    };

    console.log(`[join] ${name} (${role}, age ${age}) — room size: ${Object.keys(roomClients[ROOM]).length}`);

    // Confirm to the joining client
    socket.emit('join-ack', {
      message: `Welcome ${name}! You joined "${ROOM}"`,
      yourInfo: roomClients[ROOM][socket.id],
    });

    // Notify everyone of the new member
    io.to(ROOM).emit('room-event', {
      event: 'joined',
      user: { name, role, age },
      timestamp: new Date().toISOString(),
    });

    broadcastRoomState();
  });

  // Dashboard/admin sends a filtered message
  socket.on('send-filtered', ({ filter, message }) => {
    const clients = Object.values(roomClients[ROOM]);

    const targets = clients.filter((c) => {
      if (filter.role && filter.role !== 'all' && c.role !== filter.role) return false;
      if (filter.minAge != null && c.age < Number(filter.minAge)) return false;
      if (filter.maxAge != null && c.age > Number(filter.maxAge)) return false;
      return true;
    });

    const payload = {
      content: message,
      filter,
      sentAt: new Date().toISOString(),
    };

    targets.forEach((c) => io.to(c.socketId).emit('message', payload));

    console.log(`[send-filtered] filter=${JSON.stringify(filter)} | targets=${targets.map((c) => c.name).join(', ')} | msg="${message}"`);

    // Tell everyone (clients + dashboard) what was sent and to whom
    io.emit('message-sent-log', {
      filter,
      message,
      targetCount: targets.length,
      targetNames: targets.map((c) => c.name),
      timestamp: new Date().toISOString(),
    });
  });

  // Dashboard requests current snapshot
  socket.on('get-room-state', () => {
    socket.emit('dashboard-update', { clients: Object.values(roomClients[ROOM]) });
  });

  socket.on('disconnect', () => {
    const user = roomClients[ROOM][socket.id];
    if (user) {
      delete roomClients[ROOM][socket.id];
      console.log(`[leave] ${user.name} — room size: ${Object.keys(roomClients[ROOM]).length}`);

      io.to(ROOM).emit('room-event', {
        event: 'left',
        user: { name: user.name, role: user.role },
        timestamp: new Date().toISOString(),
      });

      broadcastRoomState();
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server → http://localhost:${PORT}`));
