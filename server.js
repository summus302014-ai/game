const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let players = {};

io.on('connection', (socket) => {
  socket.on('user_join', (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name,
      color: data.color,
      x: 100,
      y: 100,
      angle: 0
    };
    io.emit('update_players', players);
  });

  socket.on('player_move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].angle = data.angle;
      socket.broadcast.emit('update_players', players);
    }
  });

  socket.on('chat_message', (text) => {
    if (players[socket.id]) {
      io.emit('chat_message', { user: players[socket.id].name, text });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Car game server running on port ${PORT}`);
});
