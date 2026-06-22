// Bot AI behavior logic for RTS Game

export function updateBot(botPlayer, room) {
  const now = Date.now();
  if (!room.gameStarted) return;

  // Bot configuration
  const botId = botPlayer.id;
  const entities = Object.values(room.entities);
  const botEntities = entities.filter(e => e.ownerId === botId);
  const botPawns = botEntities.filter(e => e.type === 'pawn');
  const botMilitary = botEntities.filter(e => ['warrior', 'lancer', 'archer', 'monk'].includes(e.type));
  const botBuildings = botEntities.filter(e => ['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(e.type));

  const hasCastle = botBuildings.some(b => b.type === 'castle');
  if (!hasCastle) return; // If castle is destroyed, bot is defeated/inactive

  // 1. Manage Pawns
  botPawns.forEach(pawn => {
    if (pawn.state === 'idle' || !pawn.task || pawn.task.type === 'idle') {
      // Decide resource to harvest
      let targetType = 'tree';
      if (botPlayer.resources.food < 150) {
        targetType = 'sheep';
      } else if (botPlayer.resources.gold < botPlayer.resources.wood) {
        targetType = 'gold_ore';
      }

      // Find nearest resource of targetType
      const resources = entities.filter(e => e.type === targetType && e.amount > 0);
      let nearestRes = null;
      let minDist = Infinity;
      for (const res of resources) {
        const dist = Math.hypot(res.x - pawn.x, res.y - pawn.y);
        if (dist < minDist) {
          minDist = dist;
          nearestRes = res;
        }
      }

      if (nearestRes) {
        room.assignGatherResource(pawn.id, nearestRes.id);
      } else {
        // Fallback to any resource
        const anyResource = entities.filter(e => ['tree', 'gold_ore', 'sheep'].includes(e.type) && e.amount > 0);
        if (anyResource.length > 0) {
          room.assignGatherResource(pawn.id, anyResource[0].id);
        }
      }
    }
  });

  // 2. Manage Building Construction & Unit Training
  // Run this check less frequently (e.g., every 3 seconds)
  if (!botPlayer.lastBuildCheck || now - botPlayer.lastBuildCheck > 3000) {
    botPlayer.lastBuildCheck = now;

    // Check population cap
    const isPopCapped = botPlayer.resources.population >= botPlayer.resources.maxPopulation - 1;
    const underConstructionHouse = botBuildings.find(b => b.type === 'house' && b.status === 'under_construction');

    if (isPopCapped && !underConstructionHouse && botPlayer.resources.wood >= 100) {
      // Build a house
      // Find a location near the castle
      const castle = botBuildings.find(b => b.type === 'castle');
      if (castle) {
        const offsetX = (Math.random() > 0.5 ? 1 : -1) * (150 + Math.random() * 100);
        const offsetY = (Math.random() > 0.5 ? 1 : -1) * (150 + Math.random() * 100);
        const bx = castle.x + offsetX;
        const by = castle.y + offsetY;

        // Command an idle/harvesting pawn to build it
        const builderPawn = botPawns[0];
        if (builderPawn) {
          room.assignBuildStructure(builderPawn.id, 'house', bx, by);
        }
      }
    } else {
      // Check if we need Barracks
      const hasBarracks = botBuildings.some(b => b.type === 'barracks');
      const underConstructionBarracks = botBuildings.find(b => b.type === 'barracks' && b.status === 'under_construction');

      if (!hasBarracks && !underConstructionBarracks && botPlayer.resources.wood >= 175) {
        // Build barracks near castle
        const castle = botBuildings.find(b => b.type === 'castle');
        if (castle) {
          const offsetX = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 50);
          const offsetY = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 50);
          const bx = castle.x + offsetX;
          const by = castle.y + offsetY;

          const builderPawn = botPawns[0];
          if (builderPawn) {
            room.assignBuildStructure(builderPawn.id, 'barracks', bx, by);
          }
        }
      }
    }

    // Train units in barracks if complete
    const completeBarracks = botBuildings.filter(b => b.type === 'barracks' && b.status === 'complete');
    completeBarracks.forEach(barracks => {
      if (barracks.trainingQueue.length === 0) {
        const unitType = Math.random() > 0.5 ? 'warrior' : 'lancer';
        const costWood = unitType === 'warrior' ? 50 : 80;
        const costGold = unitType === 'warrior' ? 20 : 30;
        if (botPlayer.resources.wood >= costWood && botPlayer.resources.gold >= costGold && botPlayer.resources.population < botPlayer.resources.maxPopulation) {
          room.assignTrainUnit(barracks.id, unitType);
        }
      }
    });

    // Train pawns in Castle
    const castle = botBuildings.find(b => b.type === 'castle' && b.status === 'complete');
    if (castle && castle.trainingQueue.length === 0 && botPawns.length < 8) {
      if (botPlayer.resources.food >= 50 && botPlayer.resources.population < botPlayer.resources.maxPopulation) {
        room.assignTrainUnit(castle.id, 'pawn');
      }
    }
  }

  // 3. Attack Player (Military Command)
  // AI gathers army and attacks the player's base periodically
  if (!botPlayer.lastAttackTime || now - botPlayer.lastAttackTime > 45000) {
    botPlayer.lastAttackTime = now;

    if (botMilitary.length >= 4) {
      // Find a real player's castle to attack
      const playerCastles = entities.filter(e => e.type === 'castle' && e.ownerId !== botId);
      if (playerCastles.length > 0) {
        const targetCastle = playerCastles[0];
        const unitIds = botMilitary.map(m => m.id);
        room.assignAttackTarget(unitIds, targetCastle.id);
      }
    }
  }
}
