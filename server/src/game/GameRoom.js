// GameRoom manager for Online RTS Game
import fs from 'fs';
import { Pathfinding } from './Pathfinding.js';
import { updateBot } from './BotAI.js';
import { isBlockedTerrain, isCentralIslandCell, isBridgeCell } from './MapLayout.js';

const MAP_WIDTH = 64; // 64 cells * 64px = 4096px
const MAP_HEIGHT = 64;
const CELL_SIZE = 64;

// Default Spawn positions for up to 4 players on a 64x64 grid
const SPAWN_POSITIONS = [
  { x: 350, y: 350, color: 'blue' },     // Player 1 (Top-Left)
  { x: 3750, y: 3750, color: 'red' },    // Player 2 (Bottom-Right)
  { x: 350, y: 3750, color: 'yellow' },  // Player 3 (Bottom-Left)
  { x: 3750, y: 350, color: 'purple' }   // Player 4 (Top-Right)
];

export class GameRoom {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;
    this.players = []; // { id, name, color, ready, isBot, resources: { food, wood, gold, population, maxPopulation } }
    this.entities = {}; // key: entityId, value: Entity object
    this.gameStarted = false;
    this.entityIdCounter = 1;
    this.pathfinding = new Pathfinding(MAP_WIDTH, MAP_HEIGHT, CELL_SIZE);
    
    this.gameInterval = null;
    this.tickCount = 0;
  }

  addPlayer(socketId, name, isBot = false) {
    if (this.gameStarted) return null;
    if (this.players.length >= 4) return null;

    const spawnIndex = this.players.length;
    const config = SPAWN_POSITIONS[spawnIndex];

    const player = {
      id: socketId,
      name: name,
      color: config.color,
      ready: isBot, // Bots are auto-ready
      isBot: isBot,
      resources: {
        food: 200,
        wood: 200,
        gold: 200,
        population: 0,
        maxPopulation: 5 // Castle gives 5 initially, each house adds +5
      }
    };

    this.players.push(player);
    this.broadcastLobby();
    return player;
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.id !== socketId);
    
    // If game started, clean up their entities
    if (this.gameStarted) {
      Object.keys(this.entities).forEach(id => {
        if (this.entities[id].ownerId === socketId) {
          this.removeEntity(id);
        }
      });
    }

    const humanPlayers = this.players.filter(p => !p.isBot);
    if (humanPlayers.length === 0) {
      this.endGame();
    } else {
      this.broadcastLobby();
    }
  }

  addBot() {
    if (this.players.length >= 4) return;
    const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
    const botNames = ['Lancelot [Bot]', 'Arthur [Bot]', 'Galahad [Bot]', 'Robin [Bot]'];
    const botName = botNames[this.players.length % botNames.length];
    this.addPlayer(botId, botName, true);
  }

  toggleReady(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (player && !this.gameStarted) {
      player.ready = !player.ready;
      this.broadcastLobby();
    }
  }

  broadcastLobby() {
    this.io.to(this.roomId).emit('lobbyUpdate', {
      roomId: this.roomId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        ready: p.ready,
        isBot: p.isBot
      })),
      gameStarted: this.gameStarted
    });
  }

  startGame() {
    if (this.gameStarted) return;
    if (this.players.filter(p => !p.isBot).length === 1 && this.players.length === 1) {
      this.addBot();
    }

    this.gameStarted = true;
    
    // Initialize map grid
    this.pathfinding = new Pathfinding(MAP_WIDTH, MAP_HEIGHT, CELL_SIZE);
    this.applyTerrainCollision();
    this.entities = {};
    this.entityIdCounter = 1;

    // Seed resources
    this.seedResources();

    // Spawn Town Center (Castle) and 3 starting Pawns for each player
    this.players.forEach((p, idx) => {
      const spawn = SPAWN_POSITIONS[idx];
      
      // Castle (Town Center) size 128x128, blocks 2x2 grid cell
      const castleId = this.spawnBuilding('castle', spawn.x, spawn.y, p.id, true);
      
      // Starting Pawns
      this.spawnUnit('pawn', spawn.x - 80, spawn.y + 60, p.id);
      this.spawnUnit('pawn', spawn.x + 80, spawn.y + 60, p.id);
      this.spawnUnit('pawn', spawn.x, spawn.y + 90, p.id);

      if (p.isBot) {
        const barracksId = this.spawnBuilding('barracks', spawn.x - 180, spawn.y + 120, p.id, true);
        const towerId = this.spawnBuilding('tower', spawn.x + 180, spawn.y + 80, p.id, true);
        this.spawnUnit('warrior', spawn.x - 110, spawn.y + 170, p.id);
        this.spawnUnit('warrior', spawn.x - 70, spawn.y + 195, p.id);
        this.spawnUnit('archer', spawn.x - 130, spawn.y + 215, p.id);
        this.spawnUnit('lancer', spawn.x - 90, spawn.y + 235, p.id);
        if (!barracksId || !towerId) {
          // Spawned entities above are best-effort; blocked defensive buildings
          // should not prevent the skirmish enemy from existing.
        }
      }

      // Reset resources
      p.resources = {
        food: p.isBot ? 500 : 200,
        wood: p.isBot ? 600 : 200,
        gold: p.isBot ? 450 : 200,
        population: p.isBot ? 7 : 3,
        maxPopulation: p.isBot ? 12 : 5
      };
    });

    this.io.to(this.roomId).emit('startGame', {
      players: this.players,
      entities: this.entities
    });

    // Broadcast system message guiding about Bot location
    setTimeout(() => {
      this.io.to(this.roomId).emit('chatMessage', {
        sender: 'Hệ thống',
        color: 'yellow',
        message: 'Trận đấu bắt đầu! Nếu chơi một mình, game tự thêm Bot Skirmish. Bot có quân tấn công sớm; hãy xây tháp và kéo quân phòng thủ!'
      });
    }, 1000);

    // Start 30Hz game loop tick
    this.gameInterval = setInterval(() => this.tick(), 33);
  }

  applyTerrainCollision() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (isBlockedTerrain(x, y)) this.pathfinding.setBlocked(x, y, true);
      }
    }
  }

  endGame(winningColor = null) {
    if (this.gameInterval) {
      clearInterval(this.gameInterval);
      this.gameInterval = null;
    }
    this.gameStarted = false;
    this.io.to(this.roomId).emit('gameOver', { winningColor });
  }

  seedResources() {
    // Symmetrical starting spawn configurations for 64x64 grid:
    // P1 (blue)   : spawn (350, 350)   -> grid (5, 5)
    // P2 (red)    : spawn (3750, 3750) -> grid (58, 58)
    // P3 (yellow) : spawn (350, 3750)  -> grid (5, 58)
    // P4 (purple) : spawn (3750, 250)  -> grid (58, 5) -> Wait! 3750/64 = 58.59 -> grid (58, 5)
    const spawnGrids = [
      { x: 5, y: 5 },
      { x: 58, y: 58 },
      { x: 5, y: 58 },
      { x: 58, y: 5 }
    ];

    const spawnResAtGrid = (type, gx, gy, amount) => {
      if (gx < 1 || gx >= MAP_WIDTH - 1 || gy < 1 || gy >= MAP_HEIGHT - 1) return;
      if (!this.pathfinding.isWalkable(gx, gy)) return;

      const worldPos = this.pathfinding.gridToWorld(gx, gy);
      const id = `res_${this.entityIdCounter++}`;

      this.entities[id] = {
        id,
        type,
        x: worldPos.x,
        y: worldPos.y,
        gridX: gx,
        gridY: gy,
        amount: amount,
        maxAmount: amount
      };

      if (type === 'sheep') {
        this.entities[id].state = 'idle';
        this.entities[id].speed = 0.8;
        this.entities[id].facing = (Number.parseInt(id.replace(/\D/g, ''), 10) || 0) % 2 === 0 ? 1 : -1;
        this.entities[id].wanderOrigin = { x: worldPos.x, y: worldPos.y };
        this.entities[id].wanderCooldown = 45 + Math.floor(Math.random() * 120);
        this.entities[id].waypoints = [];
      }

      if (type === 'tree' || type === 'gold_ore') {
        this.pathfinding.setBlocked(gx, gy, true);
      }
    };

    // 1. Spawn starting clusters symmetrically for each player (5 Trees, 3 Gold, 3 Sheep)
    this.players.forEach((player, idx) => {
      const grid = spawnGrids[idx];
      if (!grid) return;

      const isLeft = grid.x < 32;
      const isTop = grid.y < 32;

      // Symmetric offsets relative to player starting castle (grid.x, grid.y)
      const tx1 = isLeft ? 2 : 61;
      const ty1 = isTop ? 5 : 58;
      const ty2 = isTop ? 6 : 57;
      const ty3 = isTop ? 7 : 56;
      const tx2 = isLeft ? 3 : 60;
      const tx3 = isLeft ? 4 : 59;

      const gx1 = isLeft ? 7 : 56;
      const gy1 = isTop ? 2 : 61;
      const gy2 = isTop ? 3 : 60;
      const gy3 = isTop ? 4 : 59;

      const sx1 = isLeft ? 4 : 59;
      const sy1 = isTop ? 2 : 61;
      const sx2 = isLeft ? 5 : 58;
      const sx3 = isLeft ? 6 : 57;

      // 5 Trees
      spawnResAtGrid('tree', tx1, ty1, 400);
      spawnResAtGrid('tree', tx1, ty2, 400);
      spawnResAtGrid('tree', tx1, ty3, 400);
      spawnResAtGrid('tree', tx2, ty3, 400);
      spawnResAtGrid('tree', tx3, ty3, 400);

      // 3 Gold Ores
      spawnResAtGrid('gold_ore', gx1, gy1, 800);
      spawnResAtGrid('gold_ore', gx1, gy2, 800);
      spawnResAtGrid('gold_ore', gx1, gy3, 800);

      // 3 Sheep
      spawnResAtGrid('sheep', sx1, sy1, 250);
      spawnResAtGrid('sheep', sx2, sy1, 250);
      spawnResAtGrid('sheep', sx3, sy1, 250);
    });

    // 2. Spawn neutral contested items (100 Trees, 30 Gold Ores, 20 Sheep)
    const seedContestedItem = (type, count, baseAmount) => {
      for (let i = 0; i < count; i++) {
        let gx, gy;
        let attempts = 0;
        let foundSpot = false;
        
        while (attempts < 150) {
          gx = Math.floor(2 + Math.random() * (MAP_WIDTH - 4));
          gy = Math.floor(2 + Math.random() * (MAP_HEIGHT - 4));

          let farFromBases = true;
          for (const grid of spawnGrids) {
            if (Math.hypot(gx - grid.x, gy - grid.y) < 10) {
              farFromBases = false;
              break;
            }
          }

          if (farFromBases && !isCentralIslandCell(gx, gy) && !isBridgeCell(gx, gy) && this.pathfinding.isWalkable(gx, gy)) {
            foundSpot = true;
            break;
          }
          attempts++;
        }

        if (foundSpot) {
          spawnResAtGrid(type, gx, gy, baseAmount);
        }
      }
    };

    seedContestedItem('tree', 100, 400);
    seedContestedItem('gold_ore', 30, 800);
    seedContestedItem('sheep', 20, 250);

    // Four equal gold deposits define the contested island corners while
    // leaving the center and all bridge entrances clear for battles.
    [
      [29, 29], [34, 29],
      [29, 34], [34, 34]
    ].forEach(([gx, gy]) => spawnResAtGrid('gold_ore', gx, gy, 1200));
  }

  spawnBuilding(type, x, y, ownerId, forceComplete = false) {
    // Find building stats
    let hp = 500;
    let size = 1; // grid size (1x1 or 2x2)
    if (type === 'castle') { hp = 2000; size = 2; }
    else if (type === 'house') { hp = 300; size = 1; }
    else if (type === 'barracks') { hp = 800; size = 2; }
    else if (type === 'archery') { hp = 700; size = 2; }
    else if (type === 'monastery') { hp = 600; size = 2; }
    else if (type === 'tower') { hp = 500; size = 1; }

    const grid = this.pathfinding.worldToGrid(x, y);
    const worldPos = this.pathfinding.gridToWorld(grid.x, grid.y);

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (!this.pathfinding.isWalkable(grid.x + dx, grid.y + dy)) return null;
      }
    }

    const id = `build_${this.entityIdCounter++}`;
    this.entities[id] = {
      id,
      type,
      x: size === 2 ? worldPos.x + 32 : worldPos.x,
      y: size === 2 ? worldPos.y + 32 : worldPos.y,
      gridX: grid.x,
      gridY: grid.y,
      size,
      ownerId,
      hp: forceComplete ? hp : 10,
      maxHp: hp,
      status: forceComplete ? 'complete' : 'under_construction',
      buildProgress: forceComplete ? 100 : 0,
      trainingQueue: []
    };

    // Block grid cell(s)
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.pathfinding.setBlocked(grid.x + dx, grid.y + dy, true);
      }
    }

    // Recalculate population limit if house is completed instantly
    if (type === 'house' && forceComplete) {
      const player = this.players.find(p => p.id === ownerId);
      if (player) player.resources.maxPopulation += 5;
    }

    return id;
  }

  spawnUnit(type, x, y, ownerId) {
    const id = `unit_${this.entityIdCounter++}`;
    
    let hp = 100;
    let speed = 2.5;
    let range = 40;
    let damage = 10;
    let cooldown = 30; // ~1s at 30fps

    if (type === 'pawn') { hp = 80; speed = 2.0; range = 35; damage = 5; }
    else if (type === 'warrior') { hp = 120; speed = 2.4; range = 40; damage = 12; }
    else if (type === 'lancer') { hp = 110; speed = 3.2; range = 45; damage = 15; }
    else if (type === 'archer') { hp = 75; speed = 2.6; range = 250; damage = 8; }
    else if (type === 'monk') { hp = 70; speed = 2.2; range = 120; damage = -8; } // negative damage is healing

    this.entities[id] = {
      id,
      type,
      x,
      y,
      ownerId,
      hp,
      maxHp: hp,
      speed,
      range,
      damage,
      cooldown,
      attackCooldown: 0,
      state: 'idle',
      waypoints: [],
      task: { type: 'idle' } // type: 'idle'|'moving'|'harvesting'|'building'|'attacking'
    };

    return id;
  }

  removeEntity(id) {
    const entity = this.entities[id];
    if (!entity) return;

    // Unblock cells if it was a building or resource
    if (['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(entity.type)) {
      const size = entity.size || 1;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          this.pathfinding.setBlocked(entity.gridX + dx, entity.gridY + dy, false);
        }
      }

      // If it was a house, reduce maxPopulation cap
      if (entity.type === 'house' && entity.status === 'complete') {
        const player = this.players.find(p => p.id === entity.ownerId);
        if (player) player.resources.maxPopulation = Math.max(5, player.resources.maxPopulation - 5);
      }

      // Check if player lost their castle (defeated)
      if (entity.type === 'castle') {
        const player = this.players.find(p => p.id === entity.ownerId);
        if (player) {
          this.io.to(this.roomId).emit('chatMessage', {
            sender: 'Hệ thống',
            message: `Nhà chính của người chơi ${player.name} (${player.color.toUpperCase()}) đã bị tiêu diệt!`
          });

          // Check if game over
          const remainingCastles = Object.values(this.entities).filter(e => e.type === 'castle' && e.id !== id);
          if (remainingCastles.length === 1) {
            const winner = this.players.find(p => p.id === remainingCastles[0].ownerId);
            this.endGame(winner ? winner.color : null);
          } else if (remainingCastles.length === 0) {
            this.endGame(null); // Draw
          }
        }
      }
    } else if (entity.type === 'tree' || entity.type === 'gold_ore') {
      this.pathfinding.setBlocked(entity.gridX, entity.gridY, false);
    } else if (['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(entity.type)) {
      // Reduce player population
      const player = this.players.find(p => p.id === entity.ownerId);
      if (player) player.resources.population = Math.max(0, player.resources.population - 1);
    }

    delete this.entities[id];
  }

  depleteResource(entity) {
    if (!entity) return;

    if (entity.type === 'tree') {
      this.pathfinding.setBlocked(entity.gridX, entity.gridY, false);
      entity.type = 'stump';
      entity.amount = 0;
      entity.maxAmount = 0;
      entity.variant = 1 + (Number.parseInt(entity.id.replace(/\D/g, ''), 10) || 0) % 4;
      return;
    }

    this.removeEntity(entity.id);
  }

  // Handle player input commands
  handlePlayerCommand(socketId, command, data) {
    try {
      const logMsg = `[CMD] Time: ${new Date().toISOString()} | Socket: ${socketId} | Cmd: ${command} | Data: ${JSON.stringify(data)}\n`;
      fs.appendFileSync('/Users/nguyenthanhloc/Documents/TinySwords/server/server_debug.log', logMsg);
    } catch (err) {}

    if (!this.gameStarted) return;

    if (command === 'move') {
      const { unitIds, targetX, targetY } = data;
      unitIds.forEach(id => {
        const unit = this.entities[id];
        let status = 'not_found';
        if (unit) {
          status = `owner_match: ${unit.ownerId === socketId} (unit: ${unit.ownerId}, socket: ${socketId})`;
          if (unit.ownerId === socketId && ['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(unit.type)) {
            // Clear current tasks
            unit.task = { type: 'moving' };
            unit.state = 'run';
            const path = this.pathfinding.findPath(unit.x, unit.y, targetX, targetY);
            unit.waypoints = path;
            status += ` | path_len: ${path.length} | start: (${unit.x.toFixed(1)}, ${unit.y.toFixed(1)}) -> target: (${targetX.toFixed(1)}, ${targetY.toFixed(1)})`;
          }
        }
        try {
          const logMsg = `  -> Unit ${id} status: ${status}\n`;
          fs.appendFileSync('/Users/nguyenthanhloc/Documents/TinySwords/server/server_debug.log', logMsg);
        } catch (err) {}
      });
    }

    else if (command === 'gather') {
      const { pawnId, resourceId } = data;
      const pawn = this.entities[pawnId];
      const resource = this.entities[resourceId];
      if (pawn && pawn.ownerId === socketId && pawn.type === 'pawn' && resource && resource.amount > 0) {
        this.assignGatherResource(pawnId, resourceId);
      }
    }

    else if (command === 'build') {
      const { pawnId, type, x, y } = data;
      const pawn = this.entities[pawnId];
      const player = this.players.find(p => p.id === socketId);

      if (pawn && pawn.ownerId === socketId && pawn.type === 'pawn' && player) {
        // Validate costs
        let costWood = 100;
        let costGold = 0;
        if (type === 'house') costWood = 100;
        else if (type === 'barracks') costWood = 175;
        else if (type === 'archery') costWood = 175;
        else if (type === 'monastery') { costWood = 200; costGold = 100; }
        else if (type === 'tower') { costWood = 150; costGold = 50; }

        if (player.resources.wood >= costWood && player.resources.gold >= costGold) {
          const buildingId = this.assignBuildStructure(pawnId, type, x, y);
          if (buildingId) {
            player.resources.wood -= costWood;
            player.resources.gold -= costGold;
          } else {
            this.io.to(socketId).emit('systemMessage', 'Không thể xây ở đây: địa hình bị chặn hoặc đã có vật thể!');
          }
        } else {
          this.io.to(socketId).emit('systemMessage', 'Không đủ tài nguyên để xây dựng!');
        }
      }
    }

    else if (command === 'build_existing') {
      const { pawnId, buildingId } = data;
      const pawn = this.entities[pawnId];
      const building = this.entities[buildingId];
      if (pawn && pawn.ownerId === socketId && pawn.type === 'pawn' && building) {
        if (building.status === 'under_construction' || building.hp < building.maxHp) {
          pawn.task = {
            type: 'building',
            targetId: buildingId
          };
          pawn.state = 'run';
          pawn.waypoints = this.pathfinding.findPath(pawn.x, pawn.y, building.x, building.y);
        }
      }
    }

    else if (command === 'train') {
      const { buildingId, unitType } = data;
      const building = this.entities[buildingId];
      if (building?.ownerId === socketId) this.assignTrainUnit(buildingId, unitType);
    }

    else if (command === 'attack') {
      const { unitIds, targetId } = data;
      this.assignAttackTarget(unitIds, targetId, socketId);
    }
  }

  // --- Assign task helpers ---
  assignGatherResource(pawnId, resourceId) {
    const pawn = this.entities[pawnId];
    const resource = this.entities[resourceId];
    if (!pawn || !resource) return;

    pawn.task = {
      type: 'harvesting',
      targetId: resourceId,
      resourceType: resource.type,
      carriedAmount: pawn.task.carriedAmount || 0,
      maxCarried: 10
    };
    pawn.state = 'run';
    pawn.waypoints = this.pathfinding.findPath(pawn.x, pawn.y, resource.x, resource.y);
  }

  assignBuildStructure(pawnId, structureType, x, y) {
    const pawn = this.entities[pawnId];
    if (!pawn) return null;

    // Spawn the building móng
    const buildingId = this.spawnBuilding(structureType, x, y, pawn.ownerId, false);
    if (!buildingId) return null;
    const building = this.entities[buildingId];

    pawn.task = {
      type: 'building',
      targetId: buildingId
    };
    pawn.state = 'run';
    pawn.waypoints = this.pathfinding.findPath(pawn.x, pawn.y, building.x, building.y);
    return buildingId;
  }

  assignTrainUnit(buildingId, unitType) {
    const building = this.entities[buildingId];
    if (!building || building.status !== 'complete') return;

    const allowedTraining = {
      castle: ['pawn'],
      barracks: ['warrior', 'lancer'],
      archery: ['archer'],
      monastery: ['monk']
    };
    if (!allowedTraining[building.type]?.includes(unitType)) return;

    const player = this.players.find(p => p.id === building.ownerId);
    if (!player) return;

    // Validate pop limit & costs
    let costFood = 0, costWood = 0, costGold = 0, duration = 150; // ~5s
    if (unitType === 'pawn') { costFood = 50; duration = 120; }
    else if (unitType === 'warrior') { costWood = 50; costGold = 20; duration = 180; }
    else if (unitType === 'lancer') { costWood = 80; costGold = 30; duration = 240; }
    else if (unitType === 'archer') { costWood = 70; costGold = 25; duration = 210; }
    else if (unitType === 'monk') { costFood = 100; duration = 300; }

    const hasResources = player.resources.food >= costFood && player.resources.wood >= costWood && player.resources.gold >= costGold;
    const hasSpace = player.resources.population < player.resources.maxPopulation;

    if (hasResources && hasSpace) {
      player.resources.food -= costFood;
      player.resources.wood -= costWood;
      player.resources.gold -= costGold;
      player.resources.population += 1; // reserve space

      building.trainingQueue.push({
        unitType,
        progress: 0,
        duration
      });
    } else {
      this.io.to(player.id).emit('systemMessage', 'Không đủ tài nguyên hoặc dân số đạt giới hạn!');
    }
  }

  assignAttackTarget(unitIds, targetId, commanderId = null) {
    const target = this.entities[targetId];
    if (!target) return;

    unitIds.forEach(id => {
      const unit = this.entities[id];
      const canCommand = unit && (!commanderId || unit.ownerId === commanderId);
      const validTarget = unit?.type === 'monk'
        ? target.ownerId === unit.ownerId && target.hp < target.maxHp
        : target.ownerId !== unit?.ownerId;

      if (canCommand && validTarget && ['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(unit.type)) {
        unit.task = {
          type: 'attacking',
          targetId
        };
        unit.state = 'run';
        unit.waypoints = this.pathfinding.findPath(unit.x, unit.y, target.x, target.y);
      }
    });
  }

  // --- Main 30Hz game room update tick ---
  tick() {
    this.tickCount++;
    const now = Date.now();

    // 1. Run Bot AI Updates (once every 45 ticks ~ 1.5s)
    if (this.tickCount % 45 === 0) {
      this.players.forEach(p => {
        if (p.isBot) {
          updateBot(p, this);
        }
      });
    }

    // 2. Update all Buildings (Huấn luyện quân & Xây dựng)
    Object.values(this.entities).forEach(entity => {
      if (['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(entity.type)) {
        // Handle Training Queue
        if (entity.status === 'complete' && entity.trainingQueue.length > 0) {
          const item = entity.trainingQueue[0];
          item.progress++;
          if (item.progress >= item.duration) {
            // Spawn the unit near the building
            const spawnX = entity.x + (Math.random() > 0.5 ? 60 : -60);
            const spawnY = entity.y + (Math.random() > 0.5 ? 60 : -60);
            this.spawnUnit(item.unitType, spawnX, spawnY, entity.ownerId);
            
            // Remove from queue
            entity.trainingQueue.shift();
          }
        }
        // Handle Defensive buildings shooting
        if ((entity.type === 'tower' || entity.type === 'castle') && entity.status === 'complete') {
          if (!entity.shootCooldown) entity.shootCooldown = 0;
          if (entity.shootCooldown > 0) {
            entity.shootCooldown--;
          } else {
            const range = entity.type === 'castle' ? 310 : 250;
            // Find nearest enemy unit or building
            const enemies = Object.values(this.entities).filter(
              e => e.ownerId && e.ownerId !== entity.ownerId && e.hp > 0 && 
              ['pawn', 'warrior', 'lancer', 'archer', 'monk', 'castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(e.type)
            );
            
            let target = null;
            let minDist = Infinity;
            for (const enemy of enemies) {
              const dist = Math.hypot(enemy.x - entity.x, enemy.y - entity.y);
              if (dist <= range && dist < minDist) {
                minDist = dist;
                target = enemy;
              }
            }

            if (target) {
              // Shoot!
              target.hp -= entity.type === 'castle' ? 9 : 12;
              entity.shootCooldown = entity.type === 'castle' ? 55 : 45;
              
              // Broadcast projectile shot
              this.io.to(this.roomId).emit('projectileShot', {
                startX: entity.x,
                startY: entity.y - (entity.type === 'castle' ? 70 : 45),
                endX: target.x,
                endY: target.y
              });

              if (target.hp <= 0) {
                this.removeEntity(target.id);
              }
            }
          }
        }
      }
    });

    // 3. Wildlife: sheep wander locally using the same server pathfinding
    // as units, so their location and animation state stay identical for
    // every connected player.
    Object.values(this.entities).forEach(entity => {
      if (entity.type !== 'sheep' || entity.amount <= 0) return;

      if (entity.waypoints?.length > 0) {
        const target = entity.waypoints[0];
        const dist = Math.hypot(target.x - entity.x, target.y - entity.y);
        if (dist < 2) {
          entity.waypoints.shift();
        } else {
          const angle = Math.atan2(target.y - entity.y, target.x - entity.x);
          entity.x += Math.cos(angle) * entity.speed;
          entity.y += Math.sin(angle) * entity.speed;
          entity.facing = Math.cos(angle) < 0 ? -1 : 1;
          entity.state = 'run';
          return;
        }
      }

      entity.state = this.tickCount % 180 < 110 ? 'graze' : 'idle';
      entity.wanderCooldown--;
      if (entity.wanderCooldown > 0) return;

      const origin = entity.wanderOrigin || { x: entity.x, y: entity.y };
      const wanderRadius = CELL_SIZE * 2.5;
      const targetX = origin.x + (Math.random() - 0.5) * wanderRadius * 2;
      const targetY = origin.y + (Math.random() - 0.5) * wanderRadius * 2;
      const targetGrid = this.pathfinding.worldToGrid(targetX, targetY);
      const path = this.pathfinding.isWalkable(targetGrid.x, targetGrid.y)
        ? this.pathfinding.findPath(entity.x, entity.y, targetX, targetY)
        : [];

      entity.waypoints = path.length > 1 ? path.slice(1) : [];
      entity.wanderCooldown = 90 + Math.floor(Math.random() * 150);
    });

    // 4. Update all Units (Di chuyển, Khai thác, Chiến đấu)
    Object.values(this.entities).forEach(entity => {
      if (['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(entity.type)) {
        
        // Attack Cooldown decrement
        if (entity.attackCooldown > 0) {
          entity.attackCooldown--;
        }

        if (this.tickCount % 20 === 0) {
          this.tryAutoAcquireTarget(entity);
        }

        // Process Move along waypoints
        if (entity.waypoints.length > 0) {
          const target = entity.waypoints[0];
          const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

          if (dist < 4) {
            entity.waypoints.shift();
          } else {
            const angle = Math.atan2(target.y - entity.y, target.x - entity.x);
            entity.x += Math.cos(angle) * entity.speed;
            entity.y += Math.sin(angle) * entity.speed;
            entity.state = 'run';
          }
        } else {
          // Reached destination or idle, evaluate task
          this.evaluateEntityTask(entity);
        }
      }
    });

    // Broadcast state to room clients
    this.io.to(this.roomId).emit('gameStateUpdate', {
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        resources: p.resources
      })),
      entities: this.entities
    });
  }

  evaluateEntityTask(entity) {
    if (!entity.task || entity.task.type === 'idle') {
      entity.state = 'idle';
      return;
    }

    // 1. Moving task completed
    if (entity.task.type === 'moving') {
      entity.task = { type: 'idle' };
      entity.state = 'idle';
    }

    // 2. Harvesting & Delivering task
    else if (entity.task.type === 'harvesting') {
      if (entity.task.delivering) {
        const castle = this.findNearestCastle(entity.x, entity.y, entity.ownerId);
        const dropoff = castle ? this.getDropoffPoint(castle, entity.x, entity.y) : null;
        if (castle && this.isAtDropoff(entity, castle)) {
          // Unload
          const player = this.players.find(p => p.id === entity.ownerId);
          if (player) {
            if (entity.task.resourceType === 'tree') player.resources.wood += entity.task.carriedAmount;
            else if (entity.task.resourceType === 'gold_ore') player.resources.gold += entity.task.carriedAmount;
            else if (entity.task.resourceType === 'sheep') player.resources.food += entity.task.carriedAmount;
          }

          entity.task.carriedAmount = 0;
          entity.task.delivering = false;

          // Go back to resource node if it still exists
          const resource = this.entities[entity.task.targetId];
          if (resource && resource.amount > 0) {
            entity.waypoints = this.pathfinding.findPath(entity.x, entity.y, resource.x, resource.y);
            entity.state = 'run';
          } else {
            // Find next nearest resource of same type
            const resources = Object.values(this.entities).filter(e => e.type === entity.task.resourceType && e.amount > 0);
            let nearest = null;
            let minDist = Infinity;
            for (const res of resources) {
              const d = Math.hypot(res.x - entity.x, res.y - entity.y);
              if (d < minDist) {
                minDist = d;
                nearest = res;
              }
            }
            if (nearest) {
              entity.task.targetId = nearest.id;
              entity.waypoints = this.pathfinding.findPath(entity.x, entity.y, nearest.x, nearest.y);
              entity.state = 'run';
            } else {
              entity.task = { type: 'idle' };
              entity.state = 'idle';
            }
          }
        } else {
          // Keep moving to a walkable dropoff tile beside the castle if path got cleared/empty
          if (dropoff) {
            if (!entity.waypoints || entity.waypoints.length === 0) {
              const path = this.pathfinding.findPath(entity.x, entity.y, dropoff.x, dropoff.y);
              entity.waypoints = path.length > 1 ? path.slice(1) : path;
            }
            entity.state = 'run';
          } else {
            entity.task = { type: 'idle' };
            entity.state = 'idle';
          }
        }
      } else {
        const target = this.entities[entity.task.targetId];

        if (target && target.amount > 0) {
          const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

          if (dist <= 120) {
            // Close enough to harvest
            entity.state = entity.task.resourceType === 'tree' ? 'chop' : (entity.task.resourceType === 'gold_ore' ? 'mine' : 'hunt'); // 'chop' animation for sheep as well

            // Mine tick (every 30 frames ~ 1s)
            if (this.tickCount % 30 === 0) {
              const harvestRate = 2;
              const amountHarvested = Math.min(harvestRate, target.amount, entity.task.maxCarried - entity.task.carriedAmount);
              
              target.amount -= amountHarvested;
              entity.task.carriedAmount += amountHarvested;

              // Resource depleted
              if (target.amount <= 0) {
                this.depleteResource(target);
              }

              // Bag full: go back to Castle
              if (entity.task.carriedAmount >= entity.task.maxCarried) {
                const castle = this.findNearestCastle(entity.x, entity.y, entity.ownerId);
                const dropoff = castle ? this.getDropoffPoint(castle, entity.x, entity.y) : null;
                if (dropoff) {
                  const path = this.pathfinding.findPath(entity.x, entity.y, dropoff.x, dropoff.y);
                  entity.waypoints = path.length > 1 ? path.slice(1) : path;
                  entity.state = 'run';
                  entity.task.delivering = true;
                } else {
                  entity.task = { type: 'idle' };
                  entity.state = 'idle';
                }
              }
            }
          } else {
            // Move towards resource again if path broke
            entity.waypoints = this.pathfinding.findPath(entity.x, entity.y, target.x, target.y);
            entity.state = 'run';
          }
        } else {
          // Target resource depleted, try to unload current resource
          if (entity.task.carriedAmount > 0) {
            const castle = this.findNearestCastle(entity.x, entity.y, entity.ownerId);
            const dropoff = castle ? this.getDropoffPoint(castle, entity.x, entity.y) : null;
            if (dropoff) {
              const path = this.pathfinding.findPath(entity.x, entity.y, dropoff.x, dropoff.y);
              entity.waypoints = path.length > 1 ? path.slice(1) : path;
              entity.state = 'run';
              entity.task.delivering = true;
            } else {
              entity.task = { type: 'idle' };
              entity.state = 'idle';
            }
          } else {
            // Idle
            entity.task = { type: 'idle' };
            entity.state = 'idle';
          }
        }
      }
    }

    // 4. Building task
    else if (entity.task.type === 'building') {
      const building = this.entities[entity.task.targetId];
      if (building && (building.status === 'under_construction' || building.hp < building.maxHp)) {
        const dist = Math.hypot(building.x - entity.x, building.y - entity.y);
        const buildSize = building.size || 1;
        const maxBuildDist = buildSize === 2 ? 160 : 120;
        
        if (dist <= maxBuildDist) {
          entity.state = 'build';
          
          if (this.tickCount % 15 === 0) {
            building.hp = Math.min(building.maxHp, building.hp + 20);
            building.buildProgress = Math.floor((building.hp / building.maxHp) * 100);

            if (building.hp >= building.maxHp) {
              if (building.status !== 'complete') {
                building.status = 'complete';
                building.buildProgress = 100;
                // If it was a house, add max Population
                if (building.type === 'house') {
                  const player = this.players.find(p => p.id === building.ownerId);
                  if (player) player.resources.maxPopulation += 5;
                }
              }
              entity.task = { type: 'idle' };
              entity.state = 'idle';
            }
          }
        } else {
          entity.waypoints = this.pathfinding.findPath(entity.x, entity.y, building.x, building.y);
          entity.state = 'run';
        }
      } else {
        entity.task = { type: 'idle' };
        entity.state = 'idle';
      }
    }

    // 5. Attacking task
    else if (entity.task.type === 'attacking') {
      const target = this.entities[entity.task.targetId];
      if (target && target.hp > 0) {
        const dist = Math.hypot(target.x - entity.x, target.y - entity.y);
        const maxAttackDist = (entity.type === 'archer' || entity.type === 'monk') ? entity.range : entity.range + 65;
        
        if (dist <= maxAttackDist) {
          // Stop moving, do attack animation
          entity.state = 'attack';
          
          if (entity.attackCooldown <= 0) {
            entity.attackCooldown = entity.cooldown;
            
            // Apply damage or healing
            const multiplier = this.getDamageMultiplier(entity.type, target.type);
            const finalDamage = Math.floor(entity.damage * multiplier);
            
            target.hp -= finalDamage;
            if (entity.damage < 0) {
              // Healing limits
              target.hp = Math.min(target.maxHp, target.hp);
            }

            if (entity.type === 'archer') {
              this.io.to(this.roomId).emit('projectileShot', {
                startX: entity.x,
                startY: entity.y - 15,
                endX: target.x,
                endY: target.y
              });
            }

            if (target.hp <= 0) {
              this.removeEntity(target.id);
              entity.task = { type: 'idle' };
              entity.state = 'idle';
            }
          }
        } else {
          // Keep chasing
          if (this.tickCount % 15 === 0) { // recalculate path every 15 frames
            entity.waypoints = this.pathfinding.findPath(entity.x, entity.y, target.x, target.y);
          }
          entity.state = 'run';
        }
      } else {
        entity.task = { type: 'idle' };
        entity.state = 'idle';
      }
    }
  }

  tryAutoAcquireTarget(entity) {
    if (!entity || !['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(entity.type)) return;
    if (entity.task?.type === 'attacking' || entity.task?.type === 'building' || entity.task?.delivering) return;
    if (entity.type === 'pawn' && entity.task?.type === 'harvesting') return;
    if (entity.type === 'monk') return;

    const isCombatUnit = ['warrior', 'lancer', 'archer'].includes(entity.type);
    const aggroRange = isCombatUnit
      ? (entity.type === 'archer' ? 280 : 170)
      : 85;

    const enemies = Object.values(this.entities).filter(e =>
      e.ownerId
      && e.ownerId !== entity.ownerId
      && e.hp > 0
      && ['pawn', 'warrior', 'lancer', 'archer', 'monk', 'castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(e.type)
    );

    let target = null;
    let minDist = Infinity;
    for (const enemy of enemies) {
      const dist = Math.hypot(enemy.x - entity.x, enemy.y - entity.y);
      const preferUnits = ['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(enemy.type) ? -80 : 0;
      const scoreDist = dist + preferUnits;
      if (dist <= aggroRange && scoreDist < minDist) {
        minDist = scoreDist;
        target = enemy;
      }
    }

    if (target) {
      this.assignAttackTarget([entity.id], target.id, entity.ownerId);
    }
  }

  getDamageMultiplier(attackerType, defenderType) {
    if (attackerType === 'monk') return 1; // healing
    
    // Warrior counters Archer (1.5x)
    if (attackerType === 'warrior' && defenderType === 'archer') return 1.5;
    // Archer counters Lancer (1.5x)
    if (attackerType === 'archer' && defenderType === 'lancer') return 1.5;
    // Lancer counters Warrior (1.5x)
    if (attackerType === 'lancer' && defenderType === 'warrior') return 1.5;

    return 1.0;
  }

  findNearestCastle(x, y, ownerId) {
    const castles = Object.values(this.entities).filter(e => e.type === 'castle' && e.ownerId === ownerId);
    let nearest = null;
    let minDist = Infinity;
    for (const castle of castles) {
      const d = Math.hypot(castle.x - x, castle.y - y);
      if (d < minDist) {
        minDist = d;
        nearest = castle;
      }
    }
    return nearest;
  }

  getDropoffPoint(building, fromX, fromY) {
    if (!building) return null;

    const size = building.size || 1;
    const cells = [];
    const minX = building.gridX - 1;
    const maxX = building.gridX + size;
    const minY = building.gridY - 1;
    const maxY = building.gridY + size;

    for (let gx = minX; gx <= maxX; gx++) {
      cells.push({ x: gx, y: minY });
      cells.push({ x: gx, y: maxY });
    }
    for (let gy = building.gridY; gy < building.gridY + size; gy++) {
      cells.push({ x: minX, y: gy });
      cells.push({ x: maxX, y: gy });
    }

    let best = null;
    let minDist = Infinity;
    for (const cell of cells) {
      if (!this.pathfinding.isWalkable(cell.x, cell.y)) continue;
      const world = this.pathfinding.gridToWorld(cell.x, cell.y);
      const dist = Math.hypot(world.x - fromX, world.y - fromY);
      if (dist < minDist) {
        minDist = dist;
        best = world;
      }
    }

    return best || { x: building.x, y: building.y };
  }

  isAtDropoff(entity, building) {
    if (!entity || !building) return false;
    const size = building.size || 1;
    const gx = Math.floor(entity.x / CELL_SIZE);
    const gy = Math.floor(entity.y / CELL_SIZE);
    const adjacent = gx >= building.gridX - 1
      && gx <= building.gridX + size
      && gy >= building.gridY - 1
      && gy <= building.gridY + size;

    return adjacent || Math.hypot(building.x - entity.x, building.y - entity.y) <= 155;
  }
}
