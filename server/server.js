const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Хранилище всех игроков онлайн
const players = {};

io.on('connection', (socket) => {
  console.log(`Кот присоединился к серверу: ${socket.id}`);

  // Игрок заходит в игру со своими данными (имя, племя, цвет)
  socket.on('join_game', (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Безымянный',
      tribe: data.tribe || 'Грозовое',
      color: data.color || '#b5651d',
      x: 0,
      y: 0.5,
      z: 0,
      rotation: 0
    };

    // Передаем новому игроку список уже существующих игроков
    socket.emit('current_players', players);

    // Оповещаем остальных, что появился новый кот
    socket.broadcast.emit('new_player', players[socket.id]);
  });

  // Обработка движения кота
  socket.on('player_move', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].z = movementData.z;
      players[socket.id].rotation = movementData.rotation;

      // Рассылаем новые координаты всем остальным
      socket.broadcast.emit('player_moved', players[socket.id]);
    }
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    console.log(`Кот покинул угодья: ${socket.id}`);
    delete players[socket.id];
    io.emit('player_disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Сервер племён запущен на порту ${PORT}`);
});
