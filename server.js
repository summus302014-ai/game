const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let players = {};
let drawingHistory = []; // Массив для сохранения всех нарисованных линий

io.on('connection', (socket) => {
  socket.on('user_join', (username) => {
    players[socket.id] = { id: socket.id, name: username };
    
    // Отправляем новому игроку всю историю рисунков, чтобы он видел старое
    socket.emit('init_history', drawingHistory);

    io.emit('update_players', Object.values(players));
  });

  socket.on('draw_line', (data) => {
    // Сохраняем линию в историю
    drawingHistory.push(data);
    // Ограничим историю, например, 10000 линиями, чтобы память не переполнялась
    if (drawingHistory.length > 10000) {
      drawingHistory.shift();
    }

    socket.broadcast.emit('draw_line', data);
  });

  socket.on('clear_canvas', () => {
    drawingHistory = []; // Очищаем историю при стирании холста
    io.emit('clear_canvas');
  });

  socket.on('chat_message', (text) => {
    if (players[socket.id]) {
      io.emit('chat_message', { user: players[socket.id].name, text });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('update_players', Object.values(players));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
