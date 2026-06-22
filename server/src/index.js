import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './game/GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve assets directory (the parent workspace containing Buildings, Units, etc.)
// __dirname is TinySwords/server/src, so../../ points to TinySwords root
const assetsPath = path.resolve(__dirname, '../../');
app.use('/assets', express.static(assetsPath));
console.log(`Serving assets from: ${assetsPath}`);

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = {}; // key: roomId, value: GameRoom

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room = new GameRoom(roomId, io);
    rooms[roomId] = room;
    
    socket.join(roomId);
    room.addPlayer(socket.id, name);
    socket.emit('roomCreated', roomId);
    console.log(`Room created: ${roomId} by ${name}`);
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (room) {
      if (room.players.length >= 4) {
        socket.emit('errorMsg', 'Phòng đã đầy (Tối đa 4 người)!');
        return;
      }
      if (room.gameStarted) {
        socket.emit('errorMsg', 'Trận đấu trong phòng này đã bắt đầu!');
        return;
      }
      socket.join(roomId);
      room.addPlayer(socket.id, name);
      console.log(`User ${name} (${socket.id}) joined room ${roomId}`);
    } else {
      socket.emit('errorMsg', 'Không tìm thấy mã phòng này!');
    }
  });

  socket.on('addBot', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && !room.gameStarted) {
      // Only room owner (first player in list) can add bots
      if (room.players[0] && room.players[0].id === socket.id) {
        room.addBot();
      }
    }
  });

  socket.on('toggleReady', ({ roomId }) => {
    const room = rooms[roomId];
    if (room) {
      room.toggleReady(socket.id);
    }
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && !room.gameStarted) {
      // Check if all players are ready
      const allReady = room.players.every(p => p.ready);
      if (allReady) {
        room.startGame();
      } else {
        socket.emit('errorMsg', 'Tất cả người chơi phải Sẵn sàng để bắt đầu!');
      }
    }
  });

  socket.on('gameCommand', ({ roomId, command, data }) => {
    const room = rooms[roomId];
    if (room) {
      room.handlePlayerCommand(socket.id, command, data);
    }
  });

  socket.on('chatMessage', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        io.to(roomId).emit('chatMessage', {
          sender: player.name,
          color: player.color,
          message
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Find room containing player and remove them
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        room.removePlayer(socket.id);
        
        // Clean up empty rooms
        const activeHumanPlayers = room.players.filter(p => !p.isBot);
        if (activeHumanPlayers.length === 0) {
          if (room.gameInterval) {
            clearInterval(room.gameInterval);
          }
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted as it has no active players.`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`RTS Server listening on port ${PORT}`);
});
