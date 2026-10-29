const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {}; // Комнаты для бойцов: { roomId: { players: {} } }

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { players: {} };
    }

    const playerKeys = Object.keys(rooms[roomId].players);
    if (playerKeys.length >= 2) {
      socket.emit('room_full');
      return;
    }

    // Первый игрок — слева (игрок 1), второй — справа (игрок 2)
    const side = playerKeys.length === 0 ? 'left' : 'right';

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: username,
      side: side,
      x: side === 'left' ? 150 : 650,
      y: 350,
      hp: 100,
      state: 'idle' // idle, walk, punch, kick, hit
    };

    io.to(roomId).emit('update_game', rooms[roomId].players);
  });

  socket.on('player_action', (data) => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) {
      let p = room.players[socket.id];
      p.x = data.x;
      p.y = data.y;
      p.state = data.state;

      // Проверка ударов по сопернику
      if (data.action === 'punch' || data.action === 'kick') {
        for (let id in room.players) {
          if (id !== socket.id) {
            let enemy = room.players[id];
            // Если бойцы близко друг к другу — наносим урон
            if (Math.abs(p.x - enemy.x) < 70) {
              enemy.hp = Math.max(0, enemy.hp - (data.action === 'punch' ? 10 : 15));
              enemy.state = 'hit';
            }
          }
        }
      }

      io.to(roomId).emit('update_game', room.players);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit('update_game', rooms[roomId].players);
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Fighting server running on port ${PORT}`);
});
