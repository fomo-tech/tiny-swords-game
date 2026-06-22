export function isCentralIslandCell(x, y) {
  const dx = Math.abs(x - 31.5);
  const dy = Math.abs(y - 31.5);
  return dx <= 4.5 && dy <= 4.5 && dx + dy <= 7;
}

export function isBridgeCell(x, y) {
  // Outer bridges
  const isWestOuter = x >= 10 && x <= 11 && y >= 29 && y <= 34;
  const isEastOuter = x >= 52 && x <= 53 && y >= 29 && y <= 34;
  const isNorthOuter = y >= 10 && y <= 11 && x >= 29 && x <= 34;
  const isSouthOuter = y >= 52 && y <= 53 && x >= 29 && x <= 34;

  // Center island bridges (connecting the quadrants to the central island)
  const isWestIslandTop = (y === 28 || y === 29) && (x >= 21 && x <= 27);
  const isWestIslandBottom = (y === 34 || y === 35) && (x >= 21 && x <= 27);
  const isEastIslandTop = (y === 28 || y === 29) && (x >= 36 && x <= 42);
  const isEastIslandBottom = (y === 34 || y === 35) && (x >= 36 && x <= 42);
  const isNorthIslandLeft = (x === 28 || x === 29) && (y >= 21 && y <= 27);
  const isNorthIslandRight = (x === 34 || x === 35) && (y >= 21 && y <= 27);
  const isSouthIslandLeft = (x === 28 || x === 29) && (y >= 36 && y <= 42);
  const isSouthIslandRight = (x === 34 || x === 35) && (y >= 36 && y <= 42);

  return isWestOuter || isEastOuter || isNorthOuter || isSouthOuter ||
         isWestIslandTop || isWestIslandBottom ||
         isEastIslandTop || isEastIslandBottom ||
         isNorthIslandLeft || isNorthIslandRight ||
         isSouthIslandLeft || isSouthIslandRight;
}

export const HILL_FEATURES = [
  // Quadrant 1
  { x: 10, y: 10, width: 6, height: 4 },
  { x: 6, y: 20, width: 5, height: 3 },
  { x: 20, y: 6, width: 4, height: 5 },

  // Quadrant 2
  { x: 48, y: 10, width: 6, height: 4 },
  { x: 53, y: 20, width: 5, height: 3 },
  { x: 40, y: 6, width: 4, height: 5 },

  // Quadrant 3
  { x: 10, y: 50, width: 6, height: 4 },
  { x: 6, y: 41, width: 5, height: 3 },
  { x: 20, y: 53, width: 4, height: 5 },

  // Quadrant 4
  { x: 48, y: 50, width: 6, height: 4 },
  { x: 53, y: 41, width: 5, height: 3 },
  { x: 40, y: 53, width: 4, height: 5 },

];

export function isWaterCell(x, y) {
  const dx = x - 31.5;
  const dy = y - 31.5;
  const distSq = dx * dx + dy * dy;

  // 1. Symmetrical octagonal central island.
  if (isCentralIslandCell(x, y)) {
    return false;
  }

  // 2. Circular moat around the island.
  if (distSq <= 110) {
    if (isBridgeCell(x, y)) return false;
    return true;
  }

  // 3. Rivers running all the way to the moat to separate player territories.
  const isVerticalRiver = (x === 31 || x === 32) && (y <= 21 || y >= 42);
  const isHorizontalRiver = (y === 31 || y === 32) && (x <= 21 || x >= 42);

  const isWater = isVerticalRiver || isHorizontalRiver;

  if (isBridgeCell(x, y)) {
    return false;
  }
  
  return isWater;
}

export function isHillCell(x, y) {
  return HILL_FEATURES.some(
    hill => x >= hill.x && x < hill.x + hill.width && y >= hill.y && y < hill.y + hill.height
  );
}

export function isBlockedTerrain(x, y) {
  const isWater = isWaterCell(x, y);
  const isHillOrCliffFace = HILL_FEATURES.some(
    hill => x >= hill.x && x < hill.x + hill.width && y >= hill.y && y < hill.y + hill.height + 1
  );
  return isWater || isHillOrCliffFace;
}
