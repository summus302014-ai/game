const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {};

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username, carType, color }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { players: {} };
    }

    // Спавним игроков в разных точках старта
    const count = Object.keys(rooms[roomId].players).length;
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: username,
      carType: carType || 'speed',
      color: color || '#f43f5e',
      x: 350 + (count % 2) * 50,
      y: 720 + Math.floor(count / 2) * 60,
      angle: -Math.PI / 2,
      speed: 0,
      drifting: false
    };

    io.to(roomId).emit('update_players', rooms[roomId].players);
  });

  socket.on('player_drive', (data) => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) {
      let p = room.players[socket.id];
      p.x = data.x;
      p.y = data.y;
      p.angle = data.angle;
      p.speed = data.speed;
      p.drifting = data.drifting;

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
  console.log(`Neon Turbo Server running on port ${PORT}`);
});
