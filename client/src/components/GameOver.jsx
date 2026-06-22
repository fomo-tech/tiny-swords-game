import React from 'react';

export default function GameOver({ winningColor, selfColor, onBackToMenu }) {
  const isWinner = winningColor === selfColor;
  
  const colorMapping = {
    blue: 'Xanh Lam',
    red: 'Đỏ',
    yellow: 'Vàng',
    purple: 'Tím',
    black: 'Đen'
  };

  const bannerColor = isWinner ? '#10b981' : '#ef4444';

  return (
    <div className="screen-container">
      <div className="card" style={{ maxWidth: '520px' }}>
        <h1 style={{
          fontSize: '48px',
          fontWeight: '800',
          color: bannerColor,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '2px',
          textShadow: `0 4px 20px ${isWinner ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
        }}>
          {isWinner ? 'Chiến Thắng!' : 'Thất Bại!'}
        </h1>
        <p className="subtitle" style={{ fontSize: '16px', marginBottom: '32px' }}>
          Trận chiến thời gian thực đã khép lại.
        </p>

        <div style={{
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--border-gold)',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '32px',
          textAlign: 'center'
        }}>
          <h3 style={{ color: 'var(--text-gold)', fontSize: '15px', textTransform: 'uppercase', marginBottom: '12px' }}>
            Kết quả chung cuộc
          </h3>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '18px' }}>Phe chiến thắng:</span>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(255,255,255,0.05)',
              padding: '6px 16px',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: winningColor || '#fff',
                boxShadow: `0 0 8px ${winningColor || '#fff'}`
              }} />
              <span style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                {winningColor ? colorMapping[winningColor] || winningColor : 'Không xác định'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn"
          onClick={onBackToMenu}
        >
          Trở về trang chủ
        </button>
      </div>
    </div>
  );
}
