const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {}; // Комнаты: { roomId: { players: {}, history: [] } }

io.on('connection', (socket) => {
  
  // Вход в комнату
  socket.on('join_room', ({ roomId, username, color }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        history: []
      };
    }

    rooms[roomId].players[socket.id] = { id: socket.id, name: username, color: color };

    // Отправляем новичку всю историю рисунков
    socket.emit('init_history', rooms[roomId].history);
    
    // Рассылаем обновленный список игроков
    io.to(roomId).emit('update_players', Object.values(rooms[roomId].players));
  });

  // Рисование (линии)
  socket.on('draw_line', (data) => {
    const room = rooms[socket.roomId];
    if (room) {
      room.history.push(data);
      if (room.history.length > 20000) room.history.shift();
      socket.to(socket.roomId).emit('draw_line', data);
    }
  });

  // Синхронизация курсоров мыши
  socket.on('cursor_move', (pos) => {
    socket.to(socket.roomId).emit('cursor_move', { id: socket.id, x: pos.x, y: pos.y });
  });

  // Полная очистка холста
  socket.on('clear_canvas', () => {
    const room = rooms[socket.roomId];
    if (room) {
      room.history = [];
      io.to(socket.roomId).emit('clear_canvas');
    }
  });

  // Чат комнаты
  socket.on('chat_message', (text) => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id]) return;
    io.to(socket.roomId).emit('chat_message', { user: room.players[socket.id].name, text });
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit('update_players', Object.values(rooms[roomId].players));
      socket.to(roomId).emit('remove_cursor', socket.id);

      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
