import React from 'react';

export default function Lobby({ roomId, players, socketId, onToggleReady, onAddBot, onStartGame, onLeave, error }) {
  const isHost = players[0]?.id === socketId;
  const selfPlayer = players.find(p => p.id === socketId);
  const allReady = players.every(p => p.ready);
  const canStart = isHost && allReady && players.length >= 1;

  const colorMapping = {
    blue: '#3b82f6',
    red: '#ef4444',
    yellow: '#eab308',
    purple: '#a855f7',
    black: '#374151'
  };

  return (
    <div className="screen-container">
      <div className="card lobby-card">
        <div className="logo-container">
          <h1 className="logo-text" style={{ fontSize: '28px' }}>Phòng chờ trận đấu</h1>
          <p className="subtitle">Chuẩn bị quân đội trước khi ra trận</p>
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

        <div className="lobby-layout">
          <div className="players-list">
            <h3 style={{ fontSize: '16px', color: 'var(--text-gold)', marginBottom: '8px', textTransform: 'uppercase' }}>
              Danh sách chiến binh ({players.length}/4)
            </h3>
            {players.map((player) => (
              <div
                key={player.id}
                className={`player-item ${player.id === socketId ? 'self' : ''}`}
              >
                <div className="player-info">
                  <div
                    className="color-dot"
                    style={{
                      backgroundColor: colorMapping[player.color] || '#fff',
                      color: colorMapping[player.color] || '#fff'
                    }}
                  />
                  <span className="player-name">
                    {player.name} {player.id === socketId ? '(Bạn)' : ''} {player.isBot ? '[BOT]' : ''}
                  </span>
                </div>

                <span className={`player-status ${player.ready ? 'status-ready' : 'status-waiting'}`}>
                  {player.ready ? 'SẴN SÀNG' : 'CHỜ...'}
                </span>
              </div>
            ))}
          </div>

          <div className="lobby-controls">
            <div className="lobby-info-box">
              <div className="room-id-display">
                <span className="input-label" style={{ textAlign: 'center' }}>Mã phòng đấu</span>
                <span className="room-id-value" style={{ textAlign: 'center' }}>{roomId}</span>
              </div>

              {isHost && players.length < 4 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onAddBot}
                >
                  + Thêm máy (Bot AI)
                </button>
              )}
            </div>

            <button
              type="button"
              className={`btn ${selfPlayer?.ready ? 'btn-secondary' : ''}`}
              onClick={onToggleReady}
            >
              {selfPlayer?.ready ? 'Hủy Sẵn sàng' : 'Sẵn sàng'}
            </button>

            {isHost && (
              <button
                type="button"
                className="btn"
                disabled={!canStart}
                style={{
                  opacity: canStart ? 1 : 0.6,
                  marginTop: '12px'
                }}
                onClick={onStartGame}
              >
                Bắt đầu trận đấu
              </button>
            )}

            <button
              type="button"
              className="btn btn-danger btn-secondary"
              style={{ color: '#fff', border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)', marginTop: '24px' }}
              onClick={onLeave}
            >
              Thoát phòng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
