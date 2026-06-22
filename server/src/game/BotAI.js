// Lightweight strategic AI for RTS skirmish bots.

const COMBAT_TYPES = ['warrior', 'lancer', 'archer', 'monk'];
const UNIT_TYPES = ['pawn', ...COMBAT_TYPES];
const MILITARY_BUILDINGS = ['barracks', 'archery', 'monastery', 'tower'];
const IMPORTANT_BUILDINGS = ['tower', 'barracks', 'archery', 'monastery', 'castle'];
const RESOURCE_TYPES = ['tree', 'gold_ore', 'sheep'];

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearest(items, origin, filter = () => true) {
  let best = null;
  let bestDist = Infinity;
  for (const item of items) {
    if (!filter(item)) continue;
    const d = distance(item, origin);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

function enemyEntities(entities, botId) {
  return entities.filter(e => e.ownerId && e.ownerId !== botId);
}

function chooseResource(botPlayer, pawn, entities, strategy) {
  const res = botPlayer.resources;
  let targetType = 'tree';

  if (strategy === 'boom' && res.food < 260) targetType = 'sheep';
  else if (strategy === 'defend' && res.wood < 220) targetType = 'tree';
  else if (strategy === 'rush' && res.gold < 180) targetType = 'gold_ore';
  else if (res.food < 120) targetType = 'sheep';
  else if (res.gold < res.wood * 0.65) targetType = 'gold_ore';

  const preferred = nearest(entities, pawn, e => e.type === targetType && e.amount > 0);
  if (preferred) return preferred;
  return nearest(entities, pawn, e => RESOURCE_TYPES.includes(e.type) && e.amount > 0);
}

function evaluateStrategy(botPlayer, botEntities, enemies) {
  const castle = botEntities.find(e => e.type === 'castle');
  const botMilitary = botEntities.filter(e => COMBAT_TYPES.includes(e.type));
  const botPawns = botEntities.filter(e => e.type === 'pawn');
  const enemyMilitary = enemies.filter(e => COMBAT_TYPES.includes(e.type));
  const enemyNearBase = castle
    ? enemies.filter(e => UNIT_TYPES.includes(e.type) && distance(e, castle) < 520)
    : [];

  const militaryRatio = botMilitary.length / Math.max(1, enemyMilitary.length);
  const threat = enemyNearBase.length * 2 + enemyMilitary.length;
  const hasProduction = botEntities.some(e => e.type === 'barracks' || e.type === 'archery');
  const popPressure = botPlayer.resources.population >= botPlayer.resources.maxPopulation - 1;

  if (threat >= 4 || enemyNearBase.length >= 2) return 'defend';
  if (botMilitary.length >= 7 && militaryRatio >= 1.1) return 'all-in';
  if (botMilitary.length >= 3 && hasProduction) return 'rush';
  if (botPawns.length < 7 || popPressure) return 'boom';
  return 'balanced';
}

function pickBuildSpot(castle, kind, attempt = 0) {
  const ring = kind === 'tower' ? 180 : 230;
  const angle = (attempt * 1.9 + (kind.length * 0.7)) % (Math.PI * 2);
  return {
    x: castle.x + Math.cos(angle) * ring,
    y: castle.y + Math.sin(angle) * ring
  };
}

function tryBuild(room, botPlayer, botPawns, botBuildings, type) {
  const castle = botBuildings.find(b => b.type === 'castle');
  const builder = botPawns.find(p => p.task?.type === 'idle' || p.state === 'idle') || botPawns[0];
  if (!castle || !builder) return false;

  const existing = botBuildings.some(b => b.type === type);
  const underConstruction = botBuildings.some(b => b.type === type && b.status === 'under_construction');
  if (existing || underConstruction) return false;

  const costs = {
    house: { wood: 100, gold: 0 },
    barracks: { wood: 175, gold: 0 },
    archery: { wood: 175, gold: 0 },
    tower: { wood: 150, gold: 50 },
    monastery: { wood: 200, gold: 100 }
  };
  const cost = costs[type];
  if (!cost || botPlayer.resources.wood < cost.wood || botPlayer.resources.gold < cost.gold) return false;

  for (let i = 0; i < 8; i++) {
    const spot = pickBuildSpot(castle, type, i);
    const id = room.assignBuildStructure(builder.id, type, spot.x, spot.y);
    if (id) {
      botPlayer.resources.wood -= cost.wood;
      botPlayer.resources.gold -= cost.gold;
      return true;
    }
  }
  return false;
}

function trainFromBuildings(room, botPlayer, botBuildings, strategy, enemies) {
  const enemyMilitary = enemies.filter(e => COMBAT_TYPES.includes(e.type));
  const enemyHasLancers = enemyMilitary.some(e => e.type === 'lancer');
  const enemyHasArchers = enemyMilitary.some(e => e.type === 'archer');

  const castle = botBuildings.find(b => b.type === 'castle' && b.status === 'complete');
  if (castle && castle.trainingQueue.length === 0) {
    const botPawnsTarget = strategy === 'boom' ? 10 : 7;
    const pawns = Object.values(room.entities).filter(e => e.ownerId === botPlayer.id && e.type === 'pawn');
    if (pawns.length < botPawnsTarget && botPlayer.resources.food >= 50) {
      room.assignTrainUnit(castle.id, 'pawn');
    }
  }

  botBuildings
    .filter(b => b.status === 'complete' && b.trainingQueue.length === 0)
    .forEach(building => {
      if (botPlayer.resources.population >= botPlayer.resources.maxPopulation) return;

      if (building.type === 'barracks') {
        const unitType = enemyHasArchers || strategy === 'all-in'
          ? 'lancer'
          : (Math.random() > 0.45 ? 'warrior' : 'lancer');
        room.assignTrainUnit(building.id, unitType);
      } else if (building.type === 'archery') {
        const unitType = enemyHasLancers || strategy === 'defend' ? 'archer' : 'archer';
        room.assignTrainUnit(building.id, unitType);
      } else if (building.type === 'monastery' && strategy === 'defend') {
        room.assignTrainUnit(building.id, 'monk');
      }
    });
}

function chooseAttackTarget(entities, botId, strategy, botMilitary) {
  const enemies = enemyEntities(entities, botId);
  const enemyUnits = enemies.filter(e => UNIT_TYPES.includes(e.type));
  const enemyEco = enemyUnits.filter(e => e.type === 'pawn');
  const enemyMilitary = enemyUnits.filter(e => COMBAT_TYPES.includes(e.type));
  const enemyBuildings = enemies.filter(e => IMPORTANT_BUILDINGS.includes(e.type));

  if (strategy === 'defend') {
    const castle = entities.find(e => e.ownerId === botId && e.type === 'castle');
    return castle ? nearest(enemyUnits, castle) : enemyMilitary[0];
  }

  if (strategy === 'rush') return enemyEco[0] || enemyMilitary[0] || enemyBuildings[0];
  if (strategy === 'all-in') return enemyBuildings.find(e => e.type === 'castle') || enemyBuildings[0] || enemyMilitary[0];

  const leader = botMilitary[0];
  return leader ? nearest([...enemyMilitary, ...enemyEco, ...enemyBuildings], leader) : null;
}

export function updateBot(botPlayer, room) {
  const now = Date.now();
  if (!room.gameStarted) return;

  const botId = botPlayer.id;
  const entities = Object.values(room.entities);
  const botEntities = entities.filter(e => e.ownerId === botId);
  const botPawns = botEntities.filter(e => e.type === 'pawn');
  const botMilitary = botEntities.filter(e => COMBAT_TYPES.includes(e.type));
  const botBuildings = botEntities.filter(e => ['castle', 'house', ...MILITARY_BUILDINGS].includes(e.type));
  const enemies = enemyEntities(entities, botId);

  const hasCastle = botBuildings.some(b => b.type === 'castle');
  if (!hasCastle) return;

  if (!botPlayer.lastStrategyCheck || now - botPlayer.lastStrategyCheck > 5000) {
    botPlayer.lastStrategyCheck = now;
    const nextStrategy = evaluateStrategy(botPlayer, botEntities, enemies);
    if (nextStrategy !== botPlayer.strategy) {
      botPlayer.strategy = nextStrategy;
      room.io.to(room.roomId).emit('chatMessage', {
        sender: 'Bot AI',
        color: 'red',
        message: `Đổi chiến thuật: ${nextStrategy.toUpperCase()}`
      });
    }
  }

  const strategy = botPlayer.strategy || 'balanced';

  botPawns.forEach(pawn => {
    if (pawn.state === 'idle' || !pawn.task || pawn.task.type === 'idle') {
      const resource = chooseResource(botPlayer, pawn, entities, strategy);
      if (resource) room.assignGatherResource(pawn.id, resource.id);
    }
  });

  if (!botPlayer.lastBuildCheck || now - botPlayer.lastBuildCheck > 2500) {
    botPlayer.lastBuildCheck = now;

    const isPopCapped = botPlayer.resources.population >= botPlayer.resources.maxPopulation - 1;
    if (isPopCapped) tryBuild(room, botPlayer, botPawns, botBuildings, 'house');

    if (strategy === 'defend') {
      tryBuild(room, botPlayer, botPawns, botBuildings, 'tower');
      tryBuild(room, botPlayer, botPawns, botBuildings, 'barracks');
    } else if (strategy === 'rush' || strategy === 'all-in') {
      tryBuild(room, botPlayer, botPawns, botBuildings, 'barracks');
      if (botMilitary.length >= 4) tryBuild(room, botPlayer, botPawns, botBuildings, 'archery');
    } else {
      tryBuild(room, botPlayer, botPawns, botBuildings, 'barracks');
      if (botPawns.length >= 7) tryBuild(room, botPlayer, botPawns, botBuildings, 'archery');
    }

    trainFromBuildings(room, botPlayer, botBuildings, strategy, enemies);
  }

  const attackCadence = strategy === 'defend' ? 9000 : strategy === 'all-in' ? 9000 : 14000;
  const armyThreshold = strategy === 'defend' ? 1 : strategy === 'rush' ? 2 : 4;
  if (!botPlayer.lastAttackTime || now - botPlayer.lastAttackTime > attackCadence) {
    botPlayer.lastAttackTime = now;

    if (botMilitary.length >= armyThreshold) {
      const target = chooseAttackTarget(entities, botId, strategy, botMilitary);
      if (target) {
        const limit = strategy === 'all-in' ? botMilitary.length : Math.min(botMilitary.length, strategy === 'defend' ? 3 : 6);
        const unitIds = botMilitary.slice(0, limit).map(m => m.id);
        room.assignAttackTarget(unitIds, target.id);
        room.io.to(room.roomId).emit('chatMessage', {
          sender: 'Trinh sát',
          color: 'red',
          message: `Bot ${strategy} kéo ${unitIds.length} quân đánh ${target.type}!`
        });
      }
    }
  }
}
