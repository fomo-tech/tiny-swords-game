// A* Pathfinding implementation for 2D Grid

export class Pathfinding {
  constructor(width = 32, height = 32, cellSize = 64) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    
    // Initialize empty grid (0: walkable, 1: blocked)
    this.grid = Array(height).fill(null).map(() => Array(width).fill(0));
  }

  setBlocked(gridX, gridY, blocked = true) {
    if (gridX >= 0 && gridX < this.width && gridY >= 0 && gridY < this.height) {
      this.grid[gridY][gridX] = blocked ? 1 : 0;
    }
  }

  isWalkable(gridX, gridY) {
    if (gridX < 0 || gridX >= this.width || gridY < 0 || gridY >= this.height) {
      return false;
    }
    return this.grid[gridY][gridX] === 0;
  }

  worldToGrid(x, y) {
    const gx = Math.max(0, Math.min(this.width - 1, Math.floor(x / this.cellSize)));
    const gy = Math.max(0, Math.min(this.height - 1, Math.floor(y / this.cellSize)));
    return { x: gx, y: gy };
  }

  gridToWorld(gx, gy) {
    return {
      x: gx * this.cellSize + this.cellSize / 2,
      y: gy * this.cellSize + this.cellSize / 2
    };
  }

  // Find path from start (world x, y) to end (world x, y)
  findPath(startX, startY, endX, endY) {
    const start = this.worldToGrid(startX, startY);
    const end = this.worldToGrid(endX, endY);

    if (!this.isWalkable(end.x, end.y)) {
      // If end cell is blocked, find nearest walkable neighbor
      const neighbors = this.getNeighbors(end.x, end.y);
      let closest = null;
      let minDist = Infinity;
      for (const n of neighbors) {
        if (this.isWalkable(n.x, n.y)) {
          const dist = Math.hypot(n.x - start.x, n.y - start.y);
          if (dist < minDist) {
            minDist = dist;
            closest = n;
          }
        }
      }
      if (closest) {
        end.x = closest.x;
        end.y = closest.y;
      } else {
        return []; // No path if end is blocked and no walkable neighbors
      }
    }

    const openList = [];
    const closedSet = new Set();

    const startNode = {
      x: start.x,
      y: start.y,
      g: 0,
      h: Math.abs(start.x - end.x) + Math.abs(start.y - end.y),
      f: 0,
      parent: null
    };
    startNode.f = startNode.g + startNode.h;

    openList.push(startNode);

    const nodeKey = (x, y) => `${x},${y}`;

    while (openList.length > 0) {
      // Get node with lowest f
      openList.sort((a, b) => a.f - b.f);
      const current = openList.shift();

      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path
        const path = [];
        let curr = current;
        while (curr !== null) {
          path.push(this.gridToWorld(curr.x, curr.y));
          curr = curr.parent;
        }
        return path.reverse();
      }

      closedSet.add(nodeKey(current.x, current.y));

      const neighbors = this.getNeighbors(current.x, current.y);
      for (const neighbor of neighbors) {
        if (closedSet.has(nodeKey(neighbor.x, neighbor.y)) || !this.isWalkable(neighbor.x, neighbor.y)) {
          continue;
        }

        const isDiagonal = neighbor.x !== current.x && neighbor.y !== current.y;
        const moveCost = isDiagonal ? 1.414 : 1;
        const g = current.g + moveCost;
        const h = Math.abs(neighbor.x - end.x) + Math.abs(neighbor.y - end.y);
        const f = g + h;

        const existingOpen = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);
        if (existingOpen) {
          if (g < existingOpen.g) {
            existingOpen.g = g;
            existingOpen.f = f;
            existingOpen.parent = current;
          }
        } else {
          openList.push({
            x: neighbor.x,
            y: neighbor.y,
            g,
            h,
            f,
            parent: current
          });
        }
      }
    }

    return []; // No path found
  }

  getNeighbors(x, y) {
    const list = [];
    // 8-directional movement
    const dirs = [
      { dx: 0, dy: -1 }, // N
      { dx: 1, dy: 0 },  // E
      { dx: 0, dy: 1 },  // S
      { dx: -1, dy: 0 }, // W
      { dx: 1, dy: -1 }, // NE
      { dx: 1, dy: 1 },  // SE
      { dx: -1, dy: 1 }, // SW
      { dx: -1, dy: -1 } // NW
    ];

    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        // Prevent corner cutting
        if (d.dx !== 0 && d.dy !== 0) {
          if (!this.isWalkable(x + d.dx, y) || !this.isWalkable(x, y + d.dy)) {
            continue;
          }
        }
        list.push({ x: nx, y: ny });
      }
    }
    return list;
  }
}
