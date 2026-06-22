import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameOver from './components/GameOver';
import GameCanvas from './game/GameCanvas';

let socket;

export default function App() {
  const [screen, setScreen] = useState('login'); // 'login' | 'lobby' | 'game' | 'gameover'
  const [roomId, setRoomId] = useState('');
  const [players, setPlayers] = useState([]);
  const [socketId, setSocketId] = useState('');
  const [winningColor, setWinningColor] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Connect to Node.js/Express socket server on port 3001
    socket = io('http://localhost:3001');

    const handleConnect = () => {
      setSocketId(socket.id);
      console.log('Connected to server, Socket ID:', socket.id);
    };

    if (socket.connected) {
      handleConnect();
    }

    socket.on('connect', handleConnect);

    socket.on('roomCreated', (id) => {
      setRoomId(id);
      setScreen('lobby');
      setError('');
    });

    socket.on('lobbyUpdate', (data) => {
      setPlayers(data.players);
      setRoomId(data.roomId);
      setScreen(data.gameStarted ? 'game' : 'lobby');
    });

    socket.on('startGame', () => {
      setScreen('game');
      setError('');
    });

    socket.on('gameOver', ({ winningColor }) => {
      setWinningColor(winningColor);
      setScreen('gameover');
    });

    socket.on('errorMsg', (msg) => {
      setError(msg);
    });

    socket.on('disconnect', () => {
      setError('Mất kết nối tới server game. Đang thử kết nối lại...');
      setScreen('login');
      setRoomId('');
      setPlayers([]);
    });

    socket.on('connect_error', () => {
      setError('Không thể kết nối tới server game tại cổng 3001.');
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  const handleCreateRoom = (name) => {
    setError('');
    socket.emit('createRoom', { name });
  };

  const handleJoinRoom = (id, name) => {
    setError('');
    socket.emit('joinRoom', { roomId: id, name });
  };

  const handleToggleReady = () => {
    socket.emit('toggleReady', { roomId });
  };

  const handleAddBot = () => {
    socket.emit('addBot', { roomId });
  };

  const handleStartGame = () => {
    socket.emit('startGame', { roomId });
  };

  const handleLeaveRoom = () => {
    // Simply disconnect and reconnect to reset state cleanly
    socket.disconnect();
    socket.connect();
    setScreen('login');
    setRoomId('');
    setPlayers([]);
    setWinningColor(null);
    setError('');
  };

  const handleBackToMenu = () => {
    handleLeaveRoom();
  };

  const selfPlayer = players.find(p => p.id === socketId);
  const selfColor = selfPlayer?.color || 'blue';

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {screen === 'login' && (
        <Login
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          error={error}
        />
      )}

      {screen === 'lobby' && (
        <Lobby
          roomId={roomId}
          players={players}
          socketId={socketId}
          onToggleReady={handleToggleReady}
          onAddBot={handleAddBot}
          onStartGame={handleStartGame}
          onLeave={handleLeaveRoom}
          error={error}
        />
      )}

      {screen === 'game' && (
        <GameCanvas
          socket={socket}
          roomId={roomId}
          socketId={socketId}
          players={players}
          onBackToMenu={handleBackToMenu}
        />
      )}

      {screen === 'gameover' && (
        <GameOver
          winningColor={winningColor}
          selfColor={selfColor}
          onBackToMenu={handleBackToMenu}
        />
      )}
    </div>
  );
}
