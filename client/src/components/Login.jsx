import React, { useState } from 'react';

export default function Login({ onCreateRoom, onJoinRoom, error }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreateRoom(name.trim());
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim() || !roomId.trim()) return;
    onJoinRoom(roomId.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="screen-container">
      <div className="card">
        <div className="logo-container">
          <h1 className="logo-text">Tiny Swords</h1>
          <p className="subtitle">Real-Time Strategy Multiplayer Game</p>
        </div>

        {error && (
          <div style={{
            color: '#ef4444',
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '10px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '14px',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} style={{ marginBottom: '24px' }}>
          <div className="input-group">
            <label className="input-label">Nickname của bạn</label>
            <input
              type="text"
              className="text-input"
              placeholder="Nhập tên người chơi..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={15}
            />
          </div>

          <button
            type="submit"
            className="btn"
            disabled={!name.trim()}
            style={{ opacity: name.trim() ? 1 : 0.6 }}
          >
            Tạo phòng đấu mới
          </button>
        </form>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--text-secondary)',
          margin: '20px 0',
          fontSize: '14px'
        }}>
          <hr style={{ flex: 1, borderColor: 'var(--border-light)' }} />
          <span>Hoặc tham gia phòng có sẵn</span>
          <hr style={{ flex: 1, borderColor: 'var(--border-light)' }} />
        </div>

        <form onSubmit={handleJoin}>
          <div className="input-group">
            <label className="input-label">Mã phòng (Room ID)</label>
            <input
              type="text"
              className="text-input"
              placeholder="Nhập mã phòng 5 chữ cái..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
              maxLength={5}
              style={{ textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '1px' }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!name.trim() || !roomId.trim()}
            style={{ opacity: (name.trim() && roomId.trim()) ? 1 : 0.6 }}
          >
            Vào phòng chơi
          </button>
        </form>
      </div>
    </div>
  );
}
