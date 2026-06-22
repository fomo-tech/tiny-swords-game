import { useEffect, useRef, useState } from 'react';
import { RtsRenderer } from './RtsRenderer.js';
import { MAP_CELLS, TILE_SIZE, isWaterCell, isHillCell } from './mapLayout.js';

export default function GameCanvas({ socket, roomId, socketId, players, onBackToMenu }) {
  const canvasRef = useRef(null);
  const minimapRef = useRef(null);
  const rendererRef = useRef(null);
  const isDraggingMinimapRef = useRef(false);

  const [gameState, setGameState] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [placementMode, setPlacementMode] = useState(null); // null or { type: 'house'|'barracks' }
  const [chatMessage, setChatMessage] = useState('');
  const [chatList, setChatList] = useState([]);

  // Self player object & color
  const selfPlayer = players.find(p => p.id === socketId);
  const selfColor = selfPlayer?.color || 'blue';

  const latestGameStateRef = useRef(null);
  const selectedIdsRef = useRef([]);
  const placementModeRef = useRef(null);

  // Synchronize selection changes into ref and renderer
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    if (rendererRef.current) {
      rendererRef.current.selectedIds = selectedIds;
    }
  }, [selectedIds]);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const issueContextCommand = (wx, wy, targetId) => {
      if (placementModeRef.current) return;
      const currentSelectedIds = selectedIdsRef.current;
      const currentGameState = latestGameStateRef.current;
      if (currentSelectedIds.length === 0 || !currentGameState) return;

      if (targetId) {
        const target = currentGameState.entities[targetId];
        if (target) {
          if (['tree', 'gold_ore', 'sheep'].includes(target.type)) {
            currentSelectedIds.forEach(id => {
              const unit = currentGameState.entities[id];
              if (unit?.type === 'pawn') {
                socket.emit('gameCommand', {
                  roomId,
                  command: 'gather',
                  data: { pawnId: id, resourceId: targetId }
                });
              }
            });
            return;
          }

          if (target.ownerId !== socketId) {
            socket.emit('gameCommand', {
              roomId,
              command: 'attack',
              data: { unitIds: currentSelectedIds, targetId }
            });
            return;
          }
        }
      }

      socket.emit('gameCommand', {
        roomId,
        command: 'move',
        data: { unitIds: currentSelectedIds, targetX: wx, targetY: wy }
      });
    };

    // Initialize renderer
    const renderer = new RtsRenderer(canvasRef.current, {
      selfColor,
      socketId,
      onSelectionChanged: (ids) => {
        setSelectedIds(ids);
      },
      onRightClick: issueContextCommand,
      onPrimaryAction: issueContextCommand
    });

    renderer.init().catch((error) => {
      console.error('Không thể khởi tạo bản đồ:', error);
      setChatList(prev => [...prev, {
        sender: 'Hệ thống',
        message: 'Không tải được bản đồ. Hãy tải lại trang hoặc kiểm tra server game.'
      }].slice(-15));
    });
    rendererRef.current = renderer;

    // Listen to network game state updates
    socket.on('gameStateUpdate', (state) => {
      latestGameStateRef.current = state;
      setGameState(state);
      if (rendererRef.current) {
        rendererRef.current.updateGameState(state.entities, state.players);
      }
    });

    socket.on('projectileShot', (data) => {
      if (rendererRef.current) {
        rendererRef.current.spawnProjectile(data.startX, data.startY, data.endX, data.endY);
      }
    });

    socket.on('chatMessage', (msg) => {
      setChatList(prev => [...prev, msg].slice(-15)); // Keep last 15 messages
    });

    socket.on('systemMessage', (msg) => {
      setChatList(prev => [...prev, { sender: 'Hệ thống', message: msg }].slice(-15));
    });

    return () => {
      socket.off('gameStateUpdate');
      socket.off('projectileShot');
      socket.off('chatMessage');
      socket.off('systemMessage');
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [socket, roomId, socketId, selfColor]);

  // Handle placement mode click
  const handleCanvasClick = (e) => {
    if (!placementMode || !rendererRef.current || !gameState) return;

    const coords = rendererRef.current.getEventCoords(e);
    const worldPos = rendererRef.current.screenToWorld(coords.x, coords.y);

    // Find the selected pawn to build
    const pawnId = selectedIds.find(id => {
      const unit = gameState.entities[id];
      return unit && unit.type === 'pawn' && unit.ownerId === socketId;
    });

    if (pawnId) {
      socket.emit('gameCommand', {
        roomId,
        command: 'build',
        data: {
          pawnId,
          type: placementMode.type,
          x: worldPos.x,
          y: worldPos.y
        }
      });
    }

    setPlacementMode(null);
  };

  // Global listener to release minimap dragging
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isDraggingMinimapRef.current = false;
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, []);

  const handleMinimapAction = (e) => {
    if (!minimapRef.current || !rendererRef.current) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const touch = e.touches?.[0] || e.changedTouches?.[0] || e;
    const px = touch.clientX - rect.left;
    const py = touch.clientY - rect.top;
    
    let mx, my;
    if (rendererRef.current.isRotated()) {
      mx = py;
      my = rect.width - px;
    } else {
      mx = px;
      my = py;
    }
    
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
    const finalMx = clamp(mx, 0, 116);
    const finalMy = clamp(my, 0, 116);
    
    const wx = (finalMx / 116) * 4096;
    const wy = (finalMy / 116) * 4096;
    
    rendererRef.current.centerCameraOn(wx, wy);
  };

  const handleMinimapPointerDown = (e) => {
    isDraggingMinimapRef.current = true;
    handleMinimapAction(e);
  };

  const handleMinimapPointerMove = (e) => {
    if (isDraggingMinimapRef.current) {
      handleMinimapAction(e);
    }
  };

  const handleMinimapPointerUp = () => {
    isDraggingMinimapRef.current = false;
  };

  // Render Minimap onto overlay canvas
  useEffect(() => {
    if (!minimapRef.current || !gameState) return;

    const ctx = minimapRef.current.getContext('2d');
    ctx.clearRect(0, 0, 116, 116);

    const miniTile = 116 / MAP_CELLS;
    for (let y = 0; y < MAP_CELLS; y++) {
      for (let x = 0; x < MAP_CELLS; x++) {
        ctx.fillStyle = isWaterCell(x, y)
          ? '#176c87'
          : isHillCell(x, y)
            ? '#65733f'
            : ((x + y) % 3 === 0 ? '#3f713c' : '#477d42');
        ctx.fillRect(x * miniTile, y * miniTile, miniTile + 0.5, miniTile + 0.5);
      }
    }

    const scale = 116 / (MAP_CELLS * TILE_SIZE);

    // Draw entities as colored dots
    Object.values(gameState.entities).forEach(entity => {
      if (entity.type === 'stump') return;
      const mx = entity.x * scale;
      const my = entity.y * scale;

      if (['tree', 'sheep'].includes(entity.type)) {
        ctx.fillStyle = '#065f46'; // forest/green
        ctx.fillRect(mx - 1, my - 1, 2, 2);
      } else if (entity.type === 'gold_ore') {
        ctx.fillStyle = '#fbbf24'; // gold
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else if (['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(entity.type)) {
        // Draw buildings as slightly larger colored squares
        const owner = players.find(p => p.id === entity.ownerId);
        ctx.fillStyle = owner?.color === 'blue' ? '#3b82f6' : (owner?.color === 'red' ? '#ef4444' : (owner?.color === 'yellow' ? '#eab308' : '#a855f7'));
        ctx.fillRect(mx - 3, my - 3, 6, 6);
      } else {
        // Units
        const owner = players.find(p => p.id === entity.ownerId);
        ctx.fillStyle = owner?.color === 'blue' ? '#93c5fd' : (owner?.color === 'red' ? '#fca5a5' : (owner?.color === 'yellow' ? '#fef08a' : '#c084fc'));
        ctx.beginPath();
        ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }, [gameState, players]);

  // Send Chat
  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    socket.emit('chatMessage', { roomId, message: chatMessage.trim() });
    setChatMessage('');
  };

  // Get selected details
  const getSelectedDetails = () => {
    if (selectedIds.length === 0 || !gameState) return null;

    if (selectedIds.length === 1) {
      const entity = gameState.entities[selectedIds[0]];
      if (!entity) return null;

      const colorMapping = {
        blue: 'Xanh Lam',
        red: 'Đỏ',
        yellow: 'Vàng',
        purple: 'Tím'
      };

      const owner = players.find(p => p.id === entity.ownerId);
      const isResource = ['tree', 'gold_ore', 'sheep'].includes(entity.type);

      return (
        <div className="selection-info-container">
          <div className="selection-avatar">
            {entity.type === 'pawn' && '🧑‍🌾'}
            {entity.type === 'warrior' && '⚔️'}
            {entity.type === 'lancer' && '🐎'}
            {entity.type === 'archer' && '🏹'}
            {entity.type === 'monk' && '✝️'}
            {entity.type === 'tree' && '🌲'}
            {entity.type === 'gold_ore' && '🪙'}
            {entity.type === 'sheep' && '🐑'}
            {['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(entity.type) && '🏰'}
          </div>
          <div className="selection-details">
            <span className="selection-title">{entity.type}</span>
            <span className="selection-hp-text">
              {isResource
                ? `Trữ lượng: ${entity.amount} / ${entity.maxAmount}`
                : `HP: ${entity.hp} / ${entity.maxHp}`}
            </span>
            <div className="selection-hp-bar-bg">
              <div
                className="selection-hp-bar-fg"
                style={{
                  width: `${Math.min(100, Math.max(0,
                    isResource
                      ? (entity.amount / entity.maxAmount) * 100
                      : (entity.hp / entity.maxHp) * 100
                  ))}%`
                }}
              />
            </div>
            {owner && (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Phe: {colorMapping[owner.color] || owner.color} {owner.isBot ? '[Bot]' : ''}
              </span>
            )}
            {entity.type === 'pawn' && entity.task?.type === 'harvesting' && (
              <span style={{ fontSize: '11px', color: '#fbbf24' }}>
                Khai thác: {entity.task.carriedAmount} / {entity.task.maxCarried}
              </span>
            )}
          </div>
        </div>
      );
    }

    // Multiple units selected
    return (
      <div className="selection-info-container">
        <div className="selection-avatar">👥</div>
        <div className="selection-details">
          <span className="selection-title">Nhóm quân</span>
          <span className="selection-hp-text">Đã chọn {selectedIds.length} đơn vị</span>
        </div>
      </div>
    );
  };

  // Actions based on selection
  const renderActions = () => {
    if (selectedIds.length === 0 || !gameState) return null;

    // Check if we selected building owned by player
    if (selectedIds.length === 1) {
      const entity = gameState.entities[selectedIds[0]];
      if (entity && entity.ownerId === socketId) {
        if (entity.type === 'castle' && entity.status === 'complete') {
          return (
            <div className="actions-grid">
              <div
                className="action-card"
                onClick={() => socket.emit('gameCommand', { roomId, command: 'train', data: { buildingId: entity.id, unitType: 'pawn' } })}
              >
                <span>🧑‍🌾</span>
                <span className="action-label">Dân</span>
                <div className="action-cost-tooltip">Huấn luyện Dân<br />Cost: 50 Food</div>
              </div>
            </div>
          );
        }

        if (entity.type === 'barracks' && entity.status === 'complete') {
          return (
            <div className="actions-grid">
              <div
                className="action-card"
                onClick={() => socket.emit('gameCommand', { roomId, command: 'train', data: { buildingId: entity.id, unitType: 'warrior' } })}
              >
                <span>⚔️</span>
                <span className="action-label">Warrior</span>
                <div className="action-cost-tooltip">Chiến Binh cận chiến<br />Cost: 50 Wood, 20 Gold</div>
              </div>

              <div
                className="action-card"
                onClick={() => socket.emit('gameCommand', { roomId, command: 'train', data: { buildingId: entity.id, unitType: 'lancer' } })}
              >
                <span>🐎</span>
                <span className="action-label">Lancer</span>
                <div className="action-cost-tooltip">Kỵ Binh cơ động<br />Cost: 80 Wood, 30 Gold</div>
              </div>
            </div>
          );
        }

        if (entity.type === 'archery' && entity.status === 'complete') {
          return (
            <div className="actions-grid">
              <div
                className="action-card"
                onClick={() => socket.emit('gameCommand', { roomId, command: 'train', data: { buildingId: entity.id, unitType: 'archer' } })}
              >
                <span>🏹</span>
                <span className="action-label">Archer</span>
                <div className="action-cost-tooltip">Cung Thủ tầm xa<br />Cost: 70 Wood, 25 Gold</div>
              </div>
            </div>
          );
        }

        if (entity.type === 'monastery' && entity.status === 'complete') {
          return (
            <div className="actions-grid">
              <div
                className="action-card"
                onClick={() => socket.emit('gameCommand', { roomId, command: 'train', data: { buildingId: entity.id, unitType: 'monk' } })}
              >
                <span>✝️</span>
                <span className="action-label">Monk</span>
                <div className="action-cost-tooltip">Thầy Tu hồi máu<br />Cost: 100 Food</div>
              </div>
            </div>
          );
        }
      }

      // Check if selected is a Pawn owned by player (allow building options)
      if (entity && entity.type === 'pawn' && entity.ownerId === socketId) {
        return (
          <div className="actions-grid">
            <div
              className={`action-card ${placementMode?.type === 'house' ? 'action-active' : ''}`}
              style={{ borderColor: placementMode?.type === 'house' ? '#fbbf24' : 'var(--border-gold)' }}
              onClick={() => setPlacementMode({ type: 'house' })}
            >
              <span>🏠</span>
              <span className="action-label">Nhà dân</span>
              <div className="action-cost-tooltip">Xây Nhà dân (+5 dân)<br />Cost: 100 Wood</div>
            </div>

            <div
              className={`action-card ${placementMode?.type === 'barracks' ? 'action-active' : ''}`}
              style={{ borderColor: placementMode?.type === 'barracks' ? '#fbbf24' : 'var(--border-gold)' }}
              onClick={() => setPlacementMode({ type: 'barracks' })}
            >
              <span>⚔️</span>
              <span className="action-label">Barracks</span>
              <div className="action-cost-tooltip">Xây Nhà lính cận chiến<br />Cost: 175 Wood</div>
            </div>

            <div
              className={`action-card ${placementMode?.type === 'archery' ? 'action-active' : ''}`}
              style={{ borderColor: placementMode?.type === 'archery' ? '#fbbf24' : 'var(--border-gold)' }}
              onClick={() => setPlacementMode({ type: 'archery' })}
            >
              <span>🏹</span>
              <span className="action-label">Archery</span>
              <div className="action-cost-tooltip">Xây Nhà lính bắn cung<br />Cost: 175 Wood</div>
            </div>

            <div
              className={`action-card ${placementMode?.type === 'monastery' ? 'action-active' : ''}`}
              style={{ borderColor: placementMode?.type === 'monastery' ? '#fbbf24' : 'var(--border-gold)' }}
              onClick={() => setPlacementMode({ type: 'monastery' })}
            >
              <span>✝️</span>
              <span className="action-label">Monastery</span>
              <div className="action-cost-tooltip">Xây Tu viện (Monk)<br />Cost: 200 Wood, 100 Gold</div>
            </div>

            <div
              className={`action-card ${placementMode?.type === 'tower' ? 'action-active' : ''}`}
              style={{ borderColor: placementMode?.type === 'tower' ? '#fbbf24' : 'var(--border-gold)' }}
              onClick={() => setPlacementMode({ type: 'tower' })}
            >
              <span>🗼</span>
              <span className="action-label">Tower</span>
              <div className="action-cost-tooltip">Xây Tháp canh bắn tên<br />Cost: 150 Wood, 50 Gold</div>
            </div>
          </div>
        );
      }
    }

    return null;
  };

  const currentPlayer = gameState?.players?.find(p => p.id === socketId);

  return (
    <div className="game-screen">
      {/* Canvas Layer */}
      <div
        ref={canvasRef}
        className={`canvas-container ${placementMode ? 'placement-cursor' : ''}`}
        onClick={handleCanvasClick}
      />

      {/* Ghost placement UI overlay warning */}
      {placementMode && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)',
          border: '1px solid #fbbf24',
          padding: '8px 20px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 'bold',
          color: '#fbbf24',
          zIndex: 20,
          pointerEvents: 'none'
        }}>
          Chế độ xây dựng: Click chuột trái lên đất để đặt công trình [{placementMode.type.toUpperCase()}]
        </div>
      )}

      {/* Top Resources HUD */}
      <div className="hud-top">
        <div className="resource-item food-text">
          <span>🍗</span>
          <span>Thịt: {currentPlayer?.resources?.food ?? 0}</span>
        </div>
        <div className="resource-item wood-text">
          <span>🌲</span>
          <span>Gỗ: {currentPlayer?.resources?.wood ?? 0}</span>
        </div>
        <div className="resource-item gold-text">
          <span>🪙</span>
          <span>Vàng: {currentPlayer?.resources?.gold ?? 0}</span>
        </div>
        <div className="resource-item pop-text">
          <span>👥</span>
          <span>Dân số: {currentPlayer?.resources?.population ?? 0} / {currentPlayer?.resources?.maxPopulation ?? 0}</span>
        </div>

        <button
          type="button"
          onClick={onBackToMenu}
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fff',
            fontSize: '11px',
            fontWeight: 'bold',
            padding: '4px 12px',
            borderRadius: '12px',
            cursor: 'pointer',
            marginLeft: '20px'
          }}
        >
          Đầu hàng
        </button>
      </div>

      {/* Chat messages overlay */}
      <div className="hud-chat">
        <div className="chat-messages">
          {chatList.map((c, i) => (
            <div key={i} className="chat-msg" style={{ color: c.color ? (c.color === 'blue' ? '#93c5fd' : '#fca5a5') : '#f3f4f6' }}>
              <strong>{c.sender}:</strong> {c.message}
            </div>
          ))}
        </div>
        <form onSubmit={handleSendChat} className="chat-input-wrapper">
          <input
            type="text"
            className="chat-input"
            placeholder="Gõ tin nhắn và Enter..."
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
          />
        </form>
      </div>

      {/* Bottom Panel HUD */}
      <div className="hud-bottom">
        {/* Left: Minimap */}
        <div className="hud-panel-left">
          <div
            className="minimap-wrapper"
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onPointerUp={handleMinimapPointerUp}
            onPointerLeave={handleMinimapPointerUp}
            style={{ touchAction: 'none' }}
          >
            <canvas ref={minimapRef} width="116" height="116" className="minimap-canvas" />
          </div>
        </div>

        {/* Center: Selected object status */}
        <div className="hud-panel-center">
          {getSelectedDetails() || (
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Click chọn dân/lính, sau đó click trái hoặc phải vào đất, tài nguyên hay kẻ địch để ra lệnh. Nhấn Esc để bỏ chọn.
            </span>
          )}
        </div>

        {/* Right: Actions menu */}
        <div className="hud-panel-right">
          <h4 style={{ fontSize: '11px', color: 'var(--text-gold)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Bảng điều khiển
          </h4>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            {renderActions() || (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Không có hành động</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
