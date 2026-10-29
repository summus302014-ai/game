const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {}; // Комнаты для игроков

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username, mode }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { players: {} };
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: username,
      mode: mode, // 'explore' или 'race'
      x: 0,
      y: 1,
      z: 0,
      rx: 0,
      ry: 0
    };

    io.to(roomId).emit('update_players', rooms[roomId].players);
  });

  socket.on('player_move', (data) => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) {
      room.players[socket.id].x = data.x;
      room.players[socket.id].y = data.y;
      room.players[socket.id].z = data.z;
      room.players[socket.id].rx = data.rx;
      room.players[socket.id].ry = data.ry;

      socket.to(socket.roomId).emit('update_players', room.players);
    }
  });

  socket.on('chat_message', (text) => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) {
      io.to(socket.roomId).emit('chat_message', { user: room.players[socket.id].name, text });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit('update_players', rooms[roomId].players);
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`3D Car Server running on port ${PORT}`);
});
