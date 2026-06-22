import { Application, Container, Sprite, Graphics, Assets, Texture, Rectangle } from 'pixi.js';
import {
  HILL_FEATURES,
  MAP_CELLS,
  MAP_SIZE,
  TILE_SIZE,
  isWaterCell,
  isHillCell,
  isCentralIslandCell,
  isBridgeCell,
  terrainVariant
} from './mapLayout.js';

export class RtsRenderer {
  constructor(canvasContainer, options) {
    this.container = canvasContainer;
    this.onSelectionChanged = options.onSelectionChanged; // Callback when selection box is dragged
    this.onRightClick = options.onRightClick;             // Callback when right-clicking terrain/target
    this.onPrimaryAction = options.onPrimaryAction;
    this.selfColor = options.selfColor;
    this.socketId = options.socketId;

    this.app = null;
    this.viewport = null;
    this.mapContainer = null;
    this.entitiesContainer = null;
    this.particlesContainer = null;
    this.weatherContainer = null;
    this.selectionGraphics = null;

    // Sprite and textures cache
    this.textures = {};
    this.pixiEntities = {}; // key: entityId, value: { container, sprite, type, state, frameIndex, frameTimer }
    this.particles = [];
    this.projectiles = [];
    this.animatedWater = [];
    this.animatedWaterRocks = [];
    this.animatedDuck = null;
    this.animatedBushes = [];
    this.clouds = [];
    this.commandMarkers = [];
    this.waterAnimationTick = 0;

    // Camera / panning
    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.viewportStart = { x: 0, y: 0 };
    this.hasDragged = false;
    this.mouseScreen = { x: 0, y: 0 };
    this.cameraSpeed = 15;
    this.keys = {};

    // Box selection
    this.isSelecting = false;
    this.selectionStart = { x: 0, y: 0 };
    this.selectionCurrent = { x: 0, y: 0 };
    this.selectedIds = [];

    this.isLoaded = false;
    this.isInitialized = false;
    this.isDestroyed = false;
    this.pendingGameState = null;
    this.boundListeners = null;
    this.tickerCallback = null;
    this.currentCursorType = 'default';
  }

  async init() {
    // 1. Initialize PixiJS Application
    const app = new Application();
    this.app = app;
    await app.init({
      resizeTo: this.container,
      backgroundColor: 0x05060b,
      antialias: false,
    });
    this.isInitialized = true;

    if (this.isDestroyed) {
      app.destroy({ removeView: true });
      if (this.app === app) this.app = null;
      return;
    }

    this.container.replaceChildren(app.canvas);
    this.container.tabIndex = 0;

    // Disable default context menu on right click
    this.contextMenuHandler = (e) => e.preventDefault();
    app.canvas.addEventListener('contextmenu', this.contextMenuHandler);

    // 2. Set up Containers
    this.viewport = new Container();
    this.app.stage.addChild(this.viewport);

    this.mapContainer = new Container();
    this.viewport.addChild(this.mapContainer);

    this.entitiesContainer = new Container();
    this.entitiesContainer.sortableChildren = true;
    this.viewport.addChild(this.entitiesContainer);

    this.particlesContainer = new Container();
    this.viewport.addChild(this.particlesContainer);

    this.selectionGraphics = new Graphics();
    this.viewport.addChild(this.selectionGraphics);

    this.weatherContainer = new Container();
    this.viewport.addChild(this.weatherContainer);

    // 3. Load all RTS textures from Express server static assets
    await this.loadAssets();

    if (this.isDestroyed || this.app !== app) return;

    // 4. Setup interaction listeners
    this.setupListeners();

    // 5. Start render loop
    this.tickerCallback = () => this.updateLoop();
    app.ticker.add(this.tickerCallback);

    // Center camera on Player 1 spawn (350, 350)
    const screenW = this.app.screen.width || 1200;
    const screenH = this.app.screen.height || 800;
    this.viewport.x = Math.max(-MAP_SIZE + screenW, Math.min(-(350 - screenW / 2), 0));
    this.viewport.y = Math.max(-MAP_SIZE + screenH, Math.min(-(350 - screenH / 2), 0));

    this.isLoaded = true;
    if (this.pendingGameState) {
      const { entities, players } = this.pendingGameState;
      this.pendingGameState = null;
      this.updateGameState(entities, players);
    }
    console.log('RTS Renderer initialized and assets loaded.');
  }

  async loadAssets() {
    const serverUrl = 'http://localhost:3001';
    
    // Load terrains
    for (let i = 1; i <= 5; i++) {
      this.textures[`terrain${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Tileset/Tilemap_color${i}.png`);
    }
    this.textures.grass = this.textures.terrain1;
    this.textures.water = await Assets.load(`${serverUrl}/assets/Terrain/Tileset/Water Background color.png`);
    this.textures.water_foam = await Assets.load(`${serverUrl}/assets/Terrain/Tileset/Water Foam.png`);
    this.textures.terrain_shadow = await Assets.load(`${serverUrl}/assets/Terrain/Tileset/Shadow.png`);

    // Load resources
    for (let i = 1; i <= 4; i++) {
      this.textures[`tree${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Wood/Trees/Tree${i}.png`);
    }
    this.textures.tree = this.textures.tree1;
    this.textures.gold_ore = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Gold/Gold Resource/Gold_Resource.png`);
    this.textures.gold_ore_highlight = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Gold/Gold Resource/Gold_Resource_Highlight.png`);
    this.textures.sheep = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Meat/Sheep/Sheep_Idle.png`);
    this.textures.sheep_grass = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Meat/Sheep/Sheep_Grass.png`);
    this.textures.sheep_move = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Meat/Sheep/Sheep_Move.png`);
    this.textures.wood_resource = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Wood/Wood Resource/Wood Resource.png`);
    this.textures.meat_resource = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Meat/Meat Resource/Meat Resource.png`);
    for (let i = 1; i <= 4; i++) {
      this.textures[`stump${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Wood/Trees/Stump ${i}.png`);
      this.textures[`tool${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Tools/Tool_0${i}.png`);
    }
    for (let i = 1; i <= 6; i++) {
      this.textures[`gold_stone${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Gold/Gold Stones/Gold Stone ${i}.png`);
      this.textures[`gold_stone_highlight${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Resources/Gold/Gold Stones/Gold Stone ${i}_Highlight.png`);
    }

    // Load decorations
    for (let i = 1; i <= 4; i++) {
      this.textures[`bush${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Decorations/Bushes/Bushe${i}.png`);
      this.textures[`rock${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Decorations/Rocks/Rock${i}.png`);
      this.textures[`water_rock${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Decorations/Rocks in the Water/Water Rocks_0${i}.png`);
    }
    for (let i = 1; i <= 8; i++) {
      this.textures[`cloud${i}`] = await Assets.load(`${serverUrl}/assets/Terrain/Decorations/Clouds/Clouds_0${i}.png`);
    }
    this.textures.duck = await Assets.load(`${serverUrl}/assets/Terrain/Decorations/Rubber Duck/Rubber duck.png`);
    this.textures.bush = this.textures.bush1;
    this.textures.rock = this.textures.rock1;

    // Load particles
    this.textures.dust1 = await Assets.load(`${serverUrl}/assets/Particle FX/Dust_01.png`);
    this.textures.dust2 = await Assets.load(`${serverUrl}/assets/Particle FX/Dust_02.png`);
    this.textures.explosion1 = await Assets.load(`${serverUrl}/assets/Particle FX/Explosion_01.png`);
    this.textures.explosion2 = await Assets.load(`${serverUrl}/assets/Particle FX/Explosion_02.png`);
    this.textures.fire1 = await Assets.load(`${serverUrl}/assets/Particle FX/Fire_01.png`);
    this.textures.fire2 = await Assets.load(`${serverUrl}/assets/Particle FX/Fire_02.png`);
    this.textures.fire3 = await Assets.load(`${serverUrl}/assets/Particle FX/Fire_03.png`);
    this.textures.water_splash = await Assets.load(`${serverUrl}/assets/Particle FX/Water Splash.png`);

    // Load buildings across colors
    const colors = ['Blue', 'Red', 'Yellow', 'Purple'];
    for (const color of colors) {
      const lower = color.toLowerCase();
      this.textures[`castle_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/Castle.png`);
      this.textures[`house_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/House1.png`);
      this.textures[`barracks_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/Barracks.png`);
      this.textures[`archery_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/Archery.png`);
      this.textures[`monastery_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/Monastery.png`);
      this.textures[`tower_${lower}`] = await Assets.load(`${serverUrl}/assets/Buildings/${color} Buildings/Tower.png`);

      this.textures[`pawn_idle_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Idle.png`);
      this.textures[`pawn_run_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Run.png`);
      this.textures[`pawn_chop_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Interact Axe.png`);
      this.textures[`pawn_mine_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Interact Pickaxe.png`);
      this.textures[`pawn_build_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Interact Hammer.png`);
      
      this.textures[`pawn_idle_wood_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Idle Wood.png`);
      this.textures[`pawn_run_wood_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Run Wood.png`);
      this.textures[`pawn_idle_gold_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Idle Gold.png`);
      this.textures[`pawn_run_gold_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Run Gold.png`);
      this.textures[`pawn_idle_meat_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Idle Meat.png`);
      this.textures[`pawn_run_meat_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Pawn/Pawn_Run Meat.png`);

      this.textures[`warrior_idle_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Warrior/Warrior_Idle.png`);
      this.textures[`warrior_run_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Warrior/Warrior_Run.png`);
      this.textures[`warrior_attack_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Warrior/Warrior_Attack1.png`);

      this.textures[`archer_idle_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Archer/Archer_Idle.png`);
      this.textures[`archer_run_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Archer/Archer_Run.png`);
      this.textures[`archer_attack_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Archer/Archer_Shoot.png`);

      this.textures[`lancer_idle_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Lancer/Lancer_Idle.png`);
      this.textures[`lancer_run_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Lancer/Lancer_Run.png`);
      this.textures[`lancer_attack_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Lancer/Lancer_Right_Attack.png`);

      this.textures[`monk_idle_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Monk/Idle.png`);
      this.textures[`monk_run_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Monk/Run.png`);
      this.textures[`monk_attack_${lower}`] = await Assets.load(`${serverUrl}/assets/Units/${color} Units/Monk/Heal.png`);
    }

    this.textures.cursor_04 = await Assets.load(`${serverUrl}/assets/UI Elements/UI Elements/Cursors/Cursor_04.png`);

    // Slice sprite sheet frames dynamically into arrays of textures
    this.slicedFrames = {};
    const resourceKeys = [
      'tree', 'tree1', 'tree2', 'tree3', 'tree4',
      'sheep', 'sheep_grass', 'sheep_move',
      'gold_ore_highlight',
      'gold_stone_highlight1', 'gold_stone_highlight2', 'gold_stone_highlight3',
      'gold_stone_highlight4', 'gold_stone_highlight5', 'gold_stone_highlight6',
      'bush', 'bush1', 'bush2', 'bush3', 'bush4',
      'water_rock1', 'water_rock2', 'water_rock3', 'water_rock4',
      'duck'
    ];
    const particleKeys = ['dust1', 'dust2', 'explosion1', 'explosion2', 'fire1', 'fire2', 'fire3', 'water_splash'];
    Object.keys(this.textures).forEach(key => {
      const isUnit = key.includes('pawn_') || key.includes('warrior_') || key.includes('archer_') || key.includes('lancer_') || key.includes('monk_');
      const isResource = resourceKeys.includes(key);
      const isParticle = particleKeys.includes(key);
      
      if (isUnit || isResource || isParticle) {
        const tex = this.textures[key];
        const frames = [];
        const frameWidth = key.startsWith('tree')
          ? 192
          : key.startsWith('bush')
            ? 128
            : key.startsWith('gold_') || key.startsWith('sheep_')
              ? 128
            : tex.height;
        const cols = Math.floor(tex.width / frameWidth);
        
        for (let i = 0; i < cols; i++) {
          const rect = new Rectangle(i * frameWidth, 0, frameWidth, tex.height);
          const frameTex = new Texture({
            source: tex.source,
            frame: rect
          });
          frames.push(frameTex);
        }
        this.slicedFrames[key] = frames;
      }
    });

    this.slicedFrames.water_foam = [];
    for (let i = 0; i < 16; i++) {
      this.slicedFrames.water_foam.push(new Texture({
        source: this.textures.water_foam.source,
        frame: new Rectangle(i * 192, 0, 192, 192)
      }));
    }

    console.log('RtsRenderer Asset Slicing Verification:', {
      bush1: this.slicedFrames.bush1?.length,
      bush2: this.slicedFrames.bush2?.length,
      bush3: this.slicedFrames.bush3?.length,
      bush4: this.slicedFrames.bush4?.length,
      tree1: this.slicedFrames.tree1?.length,
      sheep: this.slicedFrames.sheep?.length,
      water_rock1: this.slicedFrames.water_rock1?.length,
      duck: this.slicedFrames.duck?.length
    });
  }

  // Draw background grass tilemap
  drawMap() {
    this.mapContainer.removeChildren();
    this.weatherContainer.removeChildren();
    this.animatedWater = [];
    this.animatedWaterRocks = [];
    this.animatedDuck = null;
    this.animatedBushes = [];
    this.clouds = [];

    // Helper to get a 64x64px tile texture from a specific terrain sheet
    const getTileTexture = (variant, tx, ty) => {
      const key = `tile_${variant}_${tx}_${ty}`;
      if (!this.textures[key]) {
        const tex = this.textures[`terrain${variant}`];
        this.textures[key] = new Texture({
          source: tex.source,
          frame: new Rectangle(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        });
      }
      return this.textures[key];
    };

    const getAutoTileCoords = (x, y) => {
      const u = (y - 1 < 0) || isWaterCell(x, y - 1) ? 1 : 0;
      const d = (y + 1 >= MAP_CELLS) || isWaterCell(x, y + 1) ? 1 : 0;
      const l = (x - 1 < 0) || isWaterCell(x - 1, y) ? 1 : 0;
      const r = (x + 1 >= MAP_CELLS) || isWaterCell(x + 1, y) ? 1 : 0;

      // 1. All land -> center grass
      if (!u && !d && !l && !r) return { tx: 1, ty: 1 };

      // 2. Corner corners
      if (u && l && !d && !r) return { tx: 0, ty: 0 };
      if (u && r && !d && !l) return { tx: 2, ty: 0 };
      if (d && l && !u && !r) return { tx: 0, ty: 2 };
      if (d && r && !u && !l) return { tx: 2, ty: 2 };

      // 3. Isolated / 1-tile path endings
      if (u && d && l && r) return { tx: 3, ty: 3 }; // Isolated
      if (u && l && r && !d) return { tx: 3, ty: 0 }; // Top end of vertical
      if (d && l && r && !u) return { tx: 3, ty: 2 }; // Bottom end of vertical
      if (u && d && l && !r) return { tx: 0, ty: 3 }; // Left end of horizontal
      if (u && d && r && !l) return { tx: 2, ty: 3 }; // Right end of horizontal

      // 4. Double sided paths
      if (u && d && !l && !r) return { tx: 3, ty: 1 }; // Vertical path middle
      if (l && r && !u && !d) return { tx: 1, ty: 3 }; // Horizontal path middle

      // 5. Single edges
      if (u && !d && !l && !r) return { tx: 1, ty: 0 }; // Top edge
      if (d && !u && !l && !r) return { tx: 1, ty: 2 }; // Bottom edge
      if (l && !r && !u && !d) return { tx: 0, ty: 1 }; // Left edge
      if (r && !l && !u && !d) return { tx: 2, ty: 1 }; // Right edge

      return { tx: 1, ty: 1 };
    };

    // Draw background grid (water or grass with auto-tiling)
    for (let y = 0; y < MAP_CELLS; y++) {
      for (let x = 0; x < MAP_CELLS; x++) {
        const water = isWaterCell(x, y);
        let sprite;

        if (water) {
          sprite = new Sprite(this.textures.water);
          if ((x + y) % 3 === 0) {
            sprite.tint = 0xb9f4ff;
          }
        } else {
          const variant = terrainVariant(x, y);
          const { tx, ty } = getAutoTileCoords(x, y);
          sprite = new Sprite(getTileTexture(variant, tx, ty));
        }

        sprite.x = x * TILE_SIZE;
        sprite.y = y * TILE_SIZE;
        sprite.width = TILE_SIZE + 1;
        sprite.height = TILE_SIZE + 1;
        this.mapContainer.addChild(sprite);
      }
    }

    // Draw tile-based symmetrical cliffs/hills
    HILL_FEATURES.forEach(hill => {
      const variant = hill.variant;

      const shadow = new Sprite(this.textures.terrain_shadow);
      shadow.x = hill.x * TILE_SIZE - 18;
      shadow.y = (hill.y + hill.height) * TILE_SIZE + 18;
      shadow.width = hill.width * TILE_SIZE + 36;
      shadow.height = 96;
      shadow.alpha = 0.42;
      this.mapContainer.addChild(shadow);
      
      // Hill top & bottom transition
      for (let ry = 0; ry < hill.height; ry++) {
        const gy = hill.y + ry;
        const isBottomRow = (ry === hill.height - 1);
        const ty = isBottomRow ? 3 : 1;

        for (let rx = 0; rx < hill.width; rx++) {
          const gx = hill.x + rx;
          const tx = isBottomRow
            ? (rx === 0 ? 5 : (rx === hill.width - 1 ? 7 : 6))
            : 1;

          const sprite = new Sprite(getTileTexture(variant, tx, ty));
          sprite.x = gx * TILE_SIZE;
          sprite.y = gy * TILE_SIZE;
          sprite.width = TILE_SIZE + 1;
          sprite.height = TILE_SIZE + 1;
          this.mapContainer.addChild(sprite);
        }
      }

      // Cliff face row
      const gyFace = hill.y + hill.height;
      for (let rx = 0; rx < hill.width; rx++) {
        const gx = hill.x + rx;
        const tx = (rx === 0) ? 5 : (rx === hill.width - 1) ? 7 : 6;
        const sprite = new Sprite(getTileTexture(variant, tx, 4));
        sprite.x = gx * TILE_SIZE;
        sprite.y = gyFace * TILE_SIZE;
        sprite.width = TILE_SIZE + 1;
        sprite.height = TILE_SIZE + 1;
        this.mapContainer.addChild(sprite);
      }

      // Cliff bottom transition row
      const gyBottom = hill.y + hill.height + 1;
      for (let rx = 0; rx < hill.width; rx++) {
        const gx = hill.x + rx;
        const tx = (rx === 0) ? 5 : (rx === hill.width - 1) ? 7 : 6;
        const sprite = new Sprite(getTileTexture(variant, tx, 5));
        sprite.x = gx * TILE_SIZE;
        sprite.y = gyBottom * TILE_SIZE;
        sprite.width = TILE_SIZE + 1;
        sprite.height = TILE_SIZE + 1;
        this.mapContainer.addChild(sprite);
      }
    });

    // Draw Symmetrical Bridges
    const drawCustomBridge = (bx, by, widthTiles, heightTiles, isVertical) => {
      const bridge = new Graphics();
      const w = widthTiles * TILE_SIZE;
      const h = heightTiles * TILE_SIZE;

      bridge.rect(bx + 4, by + 4, w - 8, h - 8).fill({ color: 0x000000, alpha: 0.4 });

      if (isVertical) {
        for (let py = 6; py < h - 6; py += 12) {
          bridge.rect(bx + 6, by + py, w - 12, 10).fill(0x8c502b);
          bridge.rect(bx + 6, by + py + 10, w - 12, 2).fill(0x45230e);
        }
        bridge.rect(bx + 4, by, 8, h).fill(0x5c3116);
        bridge.rect(bx + w - 12, by, 8, h).fill(0x5c3116);
        const postsY = [0, h / 2 - 6, h - 12];
        postsY.forEach(py => {
          bridge.rect(bx + 2, by + py, 12, 12).fill(0x3d1e0c);
          bridge.rect(bx + w - 14, by + py, 12, 12).fill(0x3d1e0c);
        });
      } else {
        for (let px = 6; px < w - 6; px += 12) {
          bridge.rect(bx + px, by + 6, 10, h - 12).fill(0x8c502b);
          bridge.rect(bx + px + 10, by + 6, 2, h - 12).fill(0x45230e);
        }
        bridge.rect(bx, by + 4, w, 8).fill(0x5c3116);
        bridge.rect(bx, by + h - 12, w, 8).fill(0x5c3116);
        const postsX = [0, w / 2 - 6, w - 12];
        postsX.forEach(px => {
          bridge.rect(bx + px, by + 2, 12, 12).fill(0x3d1e0c);
          bridge.rect(bx + px, by + h - 14, 12, 12).fill(0x3d1e0c);
        });
      }

      this.mapContainer.addChild(bridge);
    };

    drawCustomBridge(10 * TILE_SIZE, 29 * TILE_SIZE, 2, 6, true);
    drawCustomBridge(52 * TILE_SIZE, 29 * TILE_SIZE, 2, 6, true);
    drawCustomBridge(29 * TILE_SIZE, 10 * TILE_SIZE, 6, 2, false);
    drawCustomBridge(29 * TILE_SIZE, 52 * TILE_SIZE, 6, 2, false);
    drawCustomBridge(21 * TILE_SIZE, 28 * TILE_SIZE, 7, 2, false);
    drawCustomBridge(21 * TILE_SIZE, 34 * TILE_SIZE, 7, 2, false);
    drawCustomBridge(36 * TILE_SIZE, 28 * TILE_SIZE, 7, 2, false);
    drawCustomBridge(36 * TILE_SIZE, 34 * TILE_SIZE, 7, 2, false);
    drawCustomBridge(28 * TILE_SIZE, 21 * TILE_SIZE, 2, 7, true);
    drawCustomBridge(34 * TILE_SIZE, 21 * TILE_SIZE, 2, 7, true);
    drawCustomBridge(28 * TILE_SIZE, 36 * TILE_SIZE, 2, 7, true);
    drawCustomBridge(34 * TILE_SIZE, 36 * TILE_SIZE, 2, 7, true);

    // Resource landmarks: small lumber, hunting and mining camps help each
    // quadrant feel authored while reusing the original resource/tool assets.
    const addMapDeco = (texture, x, y, size = 64, alpha = 1) => {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.72);
      sprite.x = x;
      sprite.y = y;
      sprite.width = size;
      sprite.height = size;
      sprite.alpha = alpha;
      this.mapContainer.addChild(sprite);
      return sprite;
    };

    const landmarkCenters = [
      { x: 11, y: 13, flipX: 1, flipY: 1 },
      { x: 53, y: 51, flipX: -1, flipY: -1 },
      { x: 11, y: 51, flipX: 1, flipY: -1 },
      { x: 53, y: 13, flipX: -1, flipY: 1 }
    ];

    landmarkCenters.forEach((camp, campIndex) => {
      const cx = camp.x * TILE_SIZE;
      const cy = camp.y * TILE_SIZE;

      addMapDeco(this.textures.wood_resource, cx, cy, 54);
      addMapDeco(this.textures.meat_resource, cx + camp.flipX * 62, cy + camp.flipY * 18, 50);
      addMapDeco(this.textures[`tool${1 + (campIndex % 4)}`], cx - camp.flipX * 54, cy + camp.flipY * 10, 48);
      addMapDeco(this.textures[`stump${1 + (campIndex % 4)}`], cx + camp.flipX * 20, cy - camp.flipY * 58, 72, 0.92);
    });

    // Old logging clearings and abandoned tool piles around the forest biome.
    const clearingDecorations = [
      [18, 9, 1], [20, 11, 2], [9, 18, 3], [54, 19, 4],
      [45, 54, 2], [19, 53, 1], [54, 45, 3], [45, 10, 4]
    ];
    clearingDecorations.forEach(([gx, gy, variant], index) => {
      addMapDeco(this.textures[`stump${variant}`], gx * TILE_SIZE, gy * TILE_SIZE, 66);
      addMapDeco(this.textures[`tool${1 + (index % 4)}`], gx * TILE_SIZE + 45, gy * TILE_SIZE + 15, 42, 0.9);
    });

    // 5. Bake static elements of mapContainer into a single texture for extreme 60fps performance
    const mapTexture = this.app.renderer.generateTexture(this.mapContainer);
    const mapSprite = new Sprite(mapTexture);
    this.mapContainer.removeChildren();
    this.mapContainer.addChild(mapSprite);

    const seedRandom = (s) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    // 6. Draw dynamic animated shore foam on top of the baked map
    for (let y = 1; y < MAP_CELLS - 1; y++) {
      for (let x = 1; x < MAP_CELLS - 1; x++) {
        if (!isWaterCell(x, y)) continue;
        const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .some(([dx, dy]) => !isWaterCell(x + dx, y + dy));

        if (shore && (x * 7 + y * 11) % 5 === 0) {
          const foamFrame = (x * 3 + y) % 16;
          const foam = new Sprite(this.slicedFrames.water_foam[foamFrame]);
          foam.anchor.set(0.5);
          foam.x = x * TILE_SIZE + 32;
          foam.y = y * TILE_SIZE + 32;
          foam.width = 96;
          foam.height = 96;
          foam.alpha = 0.55;
          this.mapContainer.addChild(foam);
          this.animatedWater.push({
            sprite: foam,
            frameOffset: foamFrame,
            phase: seedRandom(x * 71 + y * 13) * Math.PI * 2
          });
        }
      }
    }

    // 6.5 Draw dynamic animated water rocks on top of the baked map (prevents them from being baked static)
    for (let y = 1; y < MAP_CELLS - 1; y++) {
      for (let x = 1; x < MAP_CELLS - 1; x++) {
        if (!isWaterCell(x, y)) continue;
        if (isBridgeCell(x, y) || isCentralIslandCell(x, y)) continue; // Avoid clipping with bridges or central island
        if ((x * 19 + y * 23) % 37 === 0) {
          const variant = 1 + ((x + y) % 4);
          const frames = this.slicedFrames[`water_rock${variant}`];
          if (frames && frames.length > 0) {
            const rock = new Sprite(frames[0]);
            rock.anchor.set(0.5);
            rock.x = x * TILE_SIZE + 32;
            rock.y = y * TILE_SIZE + 32;
            rock.width = 64;
            rock.height = 64;
            this.mapContainer.addChild(rock);
            this.animatedWaterRocks.push({
              sprite: rock,
              frames: frames,
              frameOffset: (x * 7 + y * 13) % frames.length
            });
          }
        }
      }
    }

    // 7. Rubber Duck in the center lake (animating on top of the map)
    const duckFrames = this.slicedFrames.duck;
    if (duckFrames && duckFrames.length > 0) {
      const duck = new Sprite(duckFrames[0]);
      duck.anchor.set(0.5);
      duck.x = 31.5 * TILE_SIZE;
      duck.y = 31.5 * TILE_SIZE;
      duck.width = 32;
      duck.height = 32;
      this.mapContainer.addChild(duck);
      this.animatedDuck = {
        sprite: duck,
        frames: duckFrames,
        frameOffset: 0
      };
    }

    // Vegetation and stones stay away from bases, water, hills, and bridges.
    // Increased count to 750 to make the battlefield look extremely detailed and organic
    for (let i = 0; i < 750; i++) {
      const rx = seedRandom(i * 15) * 3800 + 100;
      const ry = seedRandom(i * 38) * 3800 + 100;
      const gx = Math.floor(rx / TILE_SIZE);
      const gy = Math.floor(ry / TILE_SIZE);
      
      let validDecoration = !isWaterCell(gx, gy)
        && !isHillCell(gx, gy)
        && !isCentralIslandCell(gx, gy)
        && !isBridgeCell(gx, gy);
      const spawns = [
        { x: 350, y: 350 },
        { x: 3750, y: 3750 },
        { x: 350, y: 3750 },
        { x: 3750, y: 350 }
      ];
      for (const spawn of spawns) {
        if (Math.hypot(rx - spawn.x, ry - spawn.y) < 260) {
          validDecoration = false;
        }
      }
      
      if (validDecoration) {
        const isBush = seedRandom(i * 9) > 0.38;
        const variant = 1 + (i % 4);
        const deco = new Sprite();
        deco.anchor.set(0.5, 0.7);

        if (isBush) {
          const frames = this.slicedFrames[`bush${variant}`];
          if (!frames?.length) continue;
          deco.texture = frames[0];
          deco.width = 72;
          deco.height = 72;
          
          this.animatedBushes.push({
            sprite: deco,
            frames: frames,
            frameOffset: Math.floor(seedRandom(i * 12) * frames.length)
          });
        } else {
          deco.texture = this.textures[`rock${variant}`];
          deco.width = 54;
          deco.height = 54;
        }

        deco.x = rx;
        deco.y = ry;
        deco.zIndex = ry;
        this.entitiesContainer.addChild(deco);
      }
    }

    // Eight cloud variants drift above the battlefield at low opacity.
    for (let i = 0; i < 12; i++) { // Render 12 clouds to cover 4096px map
      const cloud = new Sprite(this.textures[`cloud${1 + (i % 8)}`]);
      cloud.anchor.set(0.5);
      cloud.x = 140 + seedRandom(i * 41 + 2) * 3800;
      cloud.y = 100 + seedRandom(i * 67 + 5) * 3800;
      cloud.width = 300 + seedRandom(i * 29) * 220;
      cloud.height = cloud.width * (256 / 576);
      cloud.alpha = 0.12 + seedRandom(i * 53) * 0.08;
      this.weatherContainer.addChild(cloud);
      this.clouds.push({ sprite: cloud, speed: 0.08 + seedRandom(i * 83) * 0.12 });
    }
  }

  setupListeners() {
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
      if (key === 'escape') {
        this.selectedIds = [];
        if (this.onSelectionChanged) this.onSelectionChanged([]);
      }
    };
    const onKeyUp = (e) => { this.keys[e.key.toLowerCase()] = false; };

    // Panning & Select interactions
    const onMouseDown = (e) => {
      if (this.isTwoFingerPanning) return;
      this.container.focus({ preventScroll: true });
      const coords = this.getEventCoords(e);

      if (e.button === 0) {
        // Left click selection start
        this.isSelecting = true;
        this.selectionStart = this.screenToWorld(coords.x, coords.y);
        this.selectionCurrent = { ...this.selectionStart };
      } else if (e.button === 2) {
        // Right click: start drag-panning
        e.preventDefault();
        this.isPanning = true;
        this.hasDragged = false;
        this.panStart = coords;
        this.viewportStart = { x: this.viewport.x, y: this.viewport.y };
      }
    };

    const onMouseMove = (e) => {
      if (this.isTwoFingerPanning) return;
      // Keep track of screen mouse coordinate for edge panning
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;

      const coords = this.getEventCoords(e);

      if (this.isSelecting) {
        this.selectionCurrent = this.screenToWorld(coords.x, coords.y);
      } else if (this.isPanning) {
        const dx = coords.x - this.panStart.x;
        const dy = coords.y - this.panStart.y;
        
        if (Math.hypot(dx, dy) > 4) {
          this.hasDragged = true;
        }

        this.viewport.x = this.viewportStart.x + dx;
        this.viewport.y = this.viewportStart.y + dy;

        // Constraint camera within map boundaries
        const screenW = this.app.screen.width || 1200;
        const screenH = this.app.screen.height || 800;
        this.viewport.x = Math.max(-MAP_SIZE + screenW, Math.min(this.viewport.x, 0));
        this.viewport.y = Math.max(-MAP_SIZE + screenH, Math.min(this.viewport.y, 0));
      }
    };

    const onMouseUp = (e) => {
      if (this.isTwoFingerPanning) return;
      const coords = this.getEventCoords(e);
      
      if (e.button === 0 && this.isSelecting) {
        this.isSelecting = false;
        this.performSelection();
      } else if (e.button === 2 && this.isPanning) {
        e.preventDefault();
        this.isPanning = false;
        
        // If the user just clicked without dragging, issue right-click unit command!
        if (!this.hasDragged) {
          const worldPos = this.screenToWorld(coords.x, coords.y);
          const targetId = this.findEntityAt(worldPos.x, worldPos.y);
          
          if (this.onRightClick) {
            this.onRightClick(worldPos.x, worldPos.y, targetId);
            this.spawnCommandMarker(worldPos.x, worldPos.y, targetId ? 0xf59e0b : 0x22c55e);
          }
        }
      }
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        this.container.focus({ preventScroll: true });
        this.isTwoFingerPanning = true;
        this.isSelecting = false;
        
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        
        this.panStart = this.getEventCoords({ clientX: mx, clientY: my });
        this.viewportStart = { x: this.viewport.x, y: this.viewport.y };
      }
    };

    const onTouchMove = (e) => {
      if (this.isTwoFingerPanning && e.touches.length === 2) {
        e.preventDefault();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        
        const coords = this.getEventCoords({ clientX: mx, clientY: my });
        const dx = coords.x - this.panStart.x;
        const dy = coords.y - this.panStart.y;
        
        this.viewport.x = this.viewportStart.x + dx;
        this.viewport.y = this.viewportStart.y + dy;

        const screenW = this.app.screen.width || 1200;
        const screenH = this.app.screen.height || 800;
        this.viewport.x = Math.max(-MAP_SIZE + screenW, Math.min(this.viewport.x, 0));
        this.viewport.y = Math.max(-MAP_SIZE + screenH, Math.min(this.viewport.y, 0));
      }
    };

    const onTouchEnd = (e) => {
      if (this.isTwoFingerPanning && e.touches.length < 2) {
        this.isTwoFingerPanning = false;
      }
    };

    this.boundListeners = { onKeyDown, onKeyUp, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }

  isRotated() {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0);
    return isMobile && (window.innerWidth < window.innerHeight);
  }

  getEventCoords(e) {
    if (!this.container) return { x: 0, y: 0 };
    const rect = this.container.getBoundingClientRect();
    const touch = e.touches?.[0] || e.changedTouches?.[0] || e;
    const px = touch.clientX - rect.left;
    const py = touch.clientY - rect.top;

    if (this.isRotated()) {
      return {
        x: py,
        y: rect.width - px
      };
    }
    return { x: px, y: py };
  }

  centerCameraOn(wx, wy) {
    if (!this.app || !this.viewport) return;
    const screenW = this.app.screen.width || 1200;
    const screenH = this.app.screen.height || 800;
    this.viewport.x = Math.max(-MAP_SIZE + screenW, Math.min(-(wx - screenW / 2), 0));
    this.viewport.y = Math.max(-MAP_SIZE + screenH, Math.min(-(wy - screenH / 2), 0));
  }

  screenToWorld(sx, sy) {
    return {
      x: sx - this.viewport.x,
      y: sy - this.viewport.y
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx + this.viewport.x,
      y: wy + this.viewport.y
    };
  }

  getEntityClickRadiusAndCenter(data) {
    let radius;
    let offsetY;

    if (data.type === 'castle') {
      radius = 140;
      offsetY = 50;
    } else if (['barracks', 'archery', 'monastery'].includes(data.type)) {
      radius = 95;
      offsetY = 60;
    } else if (['house', 'tower'].includes(data.type)) {
      radius = 60;
      offsetY = 45;
    } else if (data.type === 'tree') {
      radius = 65;
      offsetY = 70;
    } else if (data.type === 'gold_ore') {
      radius = 65;
      offsetY = 35;
    } else if (data.type === 'sheep') {
      radius = 52;
      offsetY = 28;
    } else {
      // Units
      radius = 35;
      offsetY = data.type === 'lancer' ? 40 : 25;
    }

    return { radius, offsetY };
  }

  findEntityAt(wx, wy) {
    // Return entity under cursor
    let clickedId = null;
    let maxSorting = -Infinity;

    Object.keys(this.pixiEntities).forEach(id => {
      const entity = this.pixiEntities[id];
      const data = entity.lastData;
      if (!data || data.type === 'stump') return;

      const { radius, offsetY } = this.getEntityClickRadiusAndCenter(data);
      const dist = Math.hypot(data.x - wx, (data.y - offsetY) - wy);
      if (dist < radius) {
        if (data.y > maxSorting) {
          maxSorting = data.y;
          clickedId = id;
        }
      }
    });
    return clickedId;
  }

  performSelection() {
    const xMin = Math.min(this.selectionStart.x, this.selectionCurrent.x);
    const xMax = Math.max(this.selectionStart.x, this.selectionCurrent.x);
    const yMin = Math.min(this.selectionStart.y, this.selectionCurrent.y);
    const yMax = Math.max(this.selectionStart.y, this.selectionCurrent.y);

    const isBox = Math.hypot(this.selectionCurrent.x - this.selectionStart.x, this.selectionCurrent.y - this.selectionStart.y) > 8;
    const pointTargetId = isBox ? null : this.findEntityAt(this.selectionStart.x, this.selectionStart.y);
    const pointTarget = pointTargetId ? this.pixiEntities[pointTargetId]?.lastData : null;

    const newSelected = [];

    Object.keys(this.pixiEntities).forEach(id => {
      const pEnt = this.pixiEntities[id];
      const data = pEnt.lastData;
      if (!data) return;

      // Only select player's own military/pawn units
      if (data.ownerId === this.socketId && ['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(data.type)) {
        const { radius, offsetY } = this.getEntityClickRadiusAndCenter(data);
        if (isBox) {
          const centerY = data.y - offsetY;
          if (data.x >= xMin && data.x <= xMax && centerY >= yMin && centerY <= yMax) {
            newSelected.push(id);
          }
        } else {
          // Point click selection
          const clickDist = Math.hypot(data.x - this.selectionStart.x, (data.y - offsetY) - this.selectionStart.y);
          if (clickDist < radius) {
            newSelected.push(id);
          }
        }
      }
    });

    const clickedOwnSelectable = pointTarget
      && pointTarget.ownerId === this.socketId
      && ['pawn', 'warrior', 'lancer', 'archer', 'monk', 'castle', 'house', 'barracks', 'archery', 'monastery', 'tower']
        .includes(pointTarget.type);

    // Trackpad-friendly controls: after selecting units, left click on ground,
    // resources or enemies issues the same command as right click.
    if (!isBox && newSelected.length === 0 && this.selectedIds.length > 0 && !clickedOwnSelectable) {
      if (this.onPrimaryAction) {
        this.onPrimaryAction(this.selectionStart.x, this.selectionStart.y, pointTargetId);
        this.spawnCommandMarker(this.selectionStart.x, this.selectionStart.y, pointTarget ? 0xf59e0b : 0x22c55e);
      }
      return;
    }

    // Fallback: if we didn't select units, check if we clicked a building or resource
    if (newSelected.length === 0 && !isBox && pointTargetId && pointTarget?.type !== 'stump') {
      newSelected.push(pointTargetId);
    }

    this.selectedIds = newSelected;
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.selectedIds);
    }
  }

  spawnParticle(x, y, type, scale = 1.0, speed = 0.2) {
    const frames = this.slicedFrames[type];
    if (!frames || frames.length === 0) return;

    const sprite = new Sprite(frames[0]);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.scale.set(scale);
    this.particlesContainer.addChild(sprite);

    this.particles.push({
      sprite,
      frames,
      frameIndex: 0,
      frameTimer: 0,
      speed
    });
  }

  spawnResourcePopParticle(x, y, texture) {
    if (!texture) return;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = x + (Math.random() - 0.5) * 16;
    sprite.y = y - 40;
    sprite.width = 28;
    sprite.height = 28;
    this.particlesContainer.addChild(sprite);

    const vx = (Math.random() - 0.5) * 1.5;
    const vy = -1.0 - Math.random() * 1.5;
    let life = 40;

    const p = {
      update: () => {
        sprite.x += vx;
        sprite.y += vy;
        life--;
        sprite.alpha = life / 40;
        if (life <= 0) {
          p.frameIndex = 999;
        }
      },
      frameIndex: 0,
      frames: 5,
      destroy: () => {
        this.particlesContainer.removeChild(sprite);
        sprite.destroy();
      }
    };
    this.particles.push(p);
  }

  spawnCommandMarker(x, y, color = 0x22c55e) {
    const graphics = new Graphics();
    graphics.x = x;
    graphics.y = y;
    graphics.circle(0, 0, 13).stroke({ width: 3, color, alpha: 0.95 });
    graphics.moveTo(-7, 0).lineTo(7, 0).stroke({ width: 2, color, alpha: 0.95 });
    graphics.moveTo(0, -7).lineTo(0, 7).stroke({ width: 2, color, alpha: 0.95 });
    this.particlesContainer.addChild(graphics);
    this.commandMarkers.push({ graphics, life: 28, maxLife: 28 });
  }

  spawnProjectile(sx, sy, ex, ey) {
    const graphics = new Graphics();
    this.particlesContainer.addChild(graphics);

    const dist = Math.hypot(ex - sx, ey - sy);
    const speed = 10; // pixels per frame
    const duration = dist / speed;
    
    this.projectiles.push({
      graphics,
      sx, sy, ex, ey,
      x: sx,
      y: sy,
      t: 0,
      duration
    });
  }

  spawnHealingRings(x, y) {
    const graphics = new Graphics();
    this.particlesContainer.addChild(graphics);
    
    this.particles.push({
      graphics,
      x, y,
      frameIndex: 0,
      frames: 15,
      update() {
        this.frameIndex++;
        const percent = this.frameIndex / this.frames;
        this.graphics.clear();
        this.graphics
          .circle(0, 0, 10 + 20 * percent)
          .stroke({ width: 2 * (1 - percent), color: 0x10b981, alpha: 1 - percent });
        this.graphics.x = this.x;
        this.graphics.y = this.y - 10 - 15 * percent;
      },
      destroy: () => {
        this.particlesContainer.removeChild(graphics);
        graphics.destroy();
      }
    });
  }

  updateGameState(entities, players) {
    if (!this.isLoaded) {
      this.pendingGameState = { entities, players };
      return;
    }
    
    const serverPlayers = {};
    players.forEach(p => { serverPlayers[p.id] = p; });

    // Sync entities
    const currentServerIds = new Set(Object.keys(entities));

    // Delete removed entities
    Object.keys(this.pixiEntities).forEach(id => {
      if (!currentServerIds.has(id)) {
        const pEnt = this.pixiEntities[id];
        // If it was killed (not just disconnected/removed), spawn explosion!
        if (pEnt.lastData && pEnt.lastData.hp <= 0) {
          const size = ['castle', 'barracks', 'archery', 'monastery'].includes(pEnt.lastData.type) ? 2.5 : 1.5;
          const exType = size > 2 ? 'explosion2' : 'explosion1';
          this.spawnParticle(pEnt.lastData.x, pEnt.lastData.y, exType, size, 0.18);
        }
        
        this.entitiesContainer.removeChild(pEnt.container);
        pEnt.container.destroy({ children: true });
        delete this.pixiEntities[id];
      }
    });

    // Create or update entities
    Object.keys(entities).forEach(id => {
      const data = entities[id];
      const playerColor = serverPlayers[data.ownerId]?.color || 'blue';

      if (!this.pixiEntities[id]) {
        // Create new Pixi entity
        const container = new Container();
        const sprite = new Sprite();
        container.addChild(sprite);

        // Add health bar graphic
        const hpBar = new Graphics();
        container.addChild(hpBar);

        // Add selected indicator circle
        const circle = new Graphics();
        circle.visible = false;
        container.addChildAt(circle, 0);

        const selectionSprite = new Sprite();
        selectionSprite.anchor.set(0.5, 0.5);
        selectionSprite.visible = false;
        container.addChild(selectionSprite);

        this.entitiesContainer.addChild(container);

        this.pixiEntities[id] = {
          container,
          sprite,
          hpBar,
          circle,
          selectionSprite,
          type: data.type,
          state: 'idle',
          frameIndex: 0,
          frameTimer: 0,
          lastData: data
        };
      }

      const pEnt = this.pixiEntities[id];
      pEnt.lastData = data;

      // Position update
      pEnt.container.x = data.x;
      pEnt.container.y = data.y;
      pEnt.container.zIndex = data.y;

      // Selection circle visibility & drawing
      const isSelected = this.selectedIds.includes(id);
      const isResource = ['tree', 'gold_ore', 'sheep'].includes(data.type);
      
      if (pEnt.selectionSprite) {
        pEnt.selectionSprite.visible = isSelected && isResource;
      }
      pEnt.circle.visible = isSelected && !isResource;

      if (isSelected) {
        if (isResource) {
          if (pEnt.selectionSprite) {
            pEnt.selectionSprite.texture = this.textures.cursor_04;
            
            let size = 110;
            let offsetY = -50;
            if (data.type === 'tree') {
              size = 110;
              offsetY = -70;
            } else if (data.type === 'gold_ore') {
              size = 110;
              offsetY = -25;
            } else if (data.type === 'sheep') {
              size = 96;
              offsetY = -25;
            }
            pEnt.selectionSprite.width = size;
            pEnt.selectionSprite.height = size;
            pEnt.selectionSprite.y = offsetY;
          }
        } else {
          pEnt.circle.clear();
          pEnt.circle.scale.set(1.0);
          
          let radius = 18;
          let scaleY = 0.6;
          let offsetY = 5;
          
          if (data.type === 'castle') {
            radius = 120;
            scaleY = 0.45;
            offsetY = 20;
          } else if (['barracks', 'archery', 'monastery'].includes(data.type)) {
            radius = 80;
            scaleY = 0.45;
            offsetY = 15;
          } else if (['house', 'tower'].includes(data.type)) {
            radius = 50;
            scaleY = 0.45;
            offsetY = 10;
          }
          
          pEnt.circle.y = offsetY;
          pEnt.circle
            .ellipse(0, 0, radius, radius * scaleY)
            .stroke({ width: 2, color: 0xf59e0b });
        }
      }

      // Handle Texture & Animation matching
      if (['pawn', 'warrior', 'lancer', 'archer', 'monk'].includes(data.type)) {
        let action = data.state || 'idle';
        
        let sheetKey;
        if (data.type === 'pawn' && data.task && data.task.carriedAmount > 0 && ['run', 'idle'].includes(action)) {
          let resName = 'wood';
          if (data.task.resourceType === 'gold_ore') resName = 'gold';
          else if (data.task.resourceType === 'sheep') resName = 'meat';
          sheetKey = `pawn_${action}_${resName}_${playerColor}`;
        } else {
          sheetKey = `${data.type}_${action}_${playerColor}`;
        }

        const frames = this.slicedFrames[sheetKey] || this.slicedFrames[`${data.type}_idle_${playerColor}`];

        if (frames) {
          // Animate frames
          pEnt.frameTimer += 0.15;
          if (pEnt.frameTimer >= 1) {
            pEnt.frameTimer = 0;
            pEnt.frameIndex = (pEnt.frameIndex + 1) % frames.length;
          }
          pEnt.sprite.texture = frames[pEnt.frameIndex];
        }

        pEnt.sprite.anchor.set(0.5, 0.7);
        pEnt.sprite.scale.set(0.65); // Scale units down to fit map proportions

        // Adjust flip based on target coordinates
        if (data.waypoints && data.waypoints.length > 0) {
          const wp = data.waypoints[0];
          if (wp.x < data.x) pEnt.sprite.scale.x = -1.0;
          else if (wp.x > data.x) pEnt.sprite.scale.x = 1.0;
        }

        if (action === 'run') {
          // Spawn dust particles at unit's feet periodically
          if (!pEnt.lastDustTime) pEnt.lastDustTime = 0;
          const now = Date.now();
          if (now - pEnt.lastDustTime > 300) {
            pEnt.lastDustTime = now;
            const scaleX = pEnt.sprite.scale.x;
            const dx = data.x - scaleX * 10;
            const dy = data.y + 5;
            this.spawnParticle(dx, dy, 'dust1', 1.0, 0.25);
          }
        }

        if (data.type === 'monk' && action === 'attack') {
          // Monk is healing! Spawn green sparkles at the target coordinates
          if (!pEnt.lastHealSparkTime) pEnt.lastHealSparkTime = 0;
          const now = Date.now();
          if (now - pEnt.lastHealSparkTime > 400) {
            pEnt.lastHealSparkTime = now;
            // Let's spawn sparkles
            this.spawnHealingRings(data.x, data.y);
          }
        }

        // Draw Health bar
        pEnt.hpBar.clear();
        if (data.hp < data.maxHp) {
          pEnt.hpBar.rect(-20, -50, 40, 4);
          pEnt.hpBar.fill(0x333333);
          const hpPercent = data.hp / data.maxHp;
          pEnt.hpBar.rect(-20, -50, 40 * hpPercent, 4);
          pEnt.hpBar.fill(0x10b981);
        }
      } 
      
      // Static/Building rendering
      else if (['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(data.type)) {
        const buildKey = `${data.type}_${playerColor}`;
        pEnt.sprite.texture = this.textures[buildKey];

        let w = 64, h = 64;
        let anchorY = 0.5;
        if (data.type === 'castle') { w = 280; h = 224; anchorY = 0.75; }
        else if (data.type === 'house') { w = 110; h = 165; anchorY = 0.8; }
        else if (data.type === 'barracks') { w = 170; h = 226; anchorY = 0.8; }
        else if (data.type === 'archery') { w = 170; h = 226; anchorY = 0.8; }
        else if (data.type === 'monastery') { w = 170; h = 283; anchorY = 0.8; }
        else if (data.type === 'tower') { w = 90; h = 180; anchorY = 0.85; }

        pEnt.sprite.anchor.set(0.5, anchorY);
        pEnt.sprite.width = w;
        pEnt.sprite.height = h;

        // Completion Explosion trigger
        const wasUnderConstruction = pEnt.wasUnderConstruction;
        pEnt.wasUnderConstruction = data.status === 'under_construction';
        if (wasUnderConstruction && data.status === 'complete') {
          this.spawnParticle(data.x, data.y, 'explosion1', 1.5, 0.2);
        }

        // Dust under construction
        if (data.status === 'under_construction') {
          if (!pEnt.lastBuildDustTime) pEnt.lastBuildDustTime = 0;
          const now = Date.now();
          if (now - pEnt.lastBuildDustTime > 500) {
            pEnt.lastBuildDustTime = now;
            const bx = data.x + (Math.random() - 0.5) * w * 0.5;
            const by = data.y + (Math.random() - 0.5) * 20;
            this.spawnParticle(bx, by, 'dust2', 1.2, 0.15);
          }
        }

        // Burning fire effect for low health buildings
        const isLowHp = data.hp < data.maxHp * 0.5 && data.status === 'complete';
        if (isLowHp) {
          if (!pEnt.fireSprite) {
            pEnt.fireSprite = new Sprite();
            pEnt.fireSprite.anchor.set(0.5, 1.0);
            pEnt.fireSprite.y = -h * 0.25;
            pEnt.fireSprite.scale.set(w / 128);
            pEnt.container.addChild(pEnt.fireSprite);
            pEnt.fireIndex = 0;
            pEnt.fireTimer = 0;
          }
          
          const fireFrames = this.slicedFrames['fire2'];
          if (fireFrames) {
            pEnt.fireTimer += 0.15;
            if (pEnt.fireTimer >= 1) {
              pEnt.fireTimer = 0;
              pEnt.fireIndex = (pEnt.fireIndex + 1) % fireFrames.length;
            }
            pEnt.fireSprite.texture = fireFrames[pEnt.fireIndex];
          }
          pEnt.fireSprite.visible = true;
        } else {
          if (pEnt.fireSprite) {
            pEnt.fireSprite.visible = false;
          }
        }
        
        // Draw progress or health bar
        pEnt.hpBar.clear();
        const barOffsetY = h * (anchorY - 0.1);
        if (data.status === 'under_construction') {
          pEnt.hpBar.rect(-w/2, -barOffsetY, w, 6);
          pEnt.hpBar.fill(0x333333);
          pEnt.hpBar.rect(-w/2, -barOffsetY, w * (data.buildProgress / 100), 6);
          pEnt.hpBar.fill(0xeab308);
        } else if (data.hp < data.maxHp) {
          pEnt.hpBar.rect(-w/2, -barOffsetY, w, 6);
          pEnt.hpBar.fill(0x333333);
          pEnt.hpBar.rect(-w/2, -barOffsetY, w * (data.hp / data.maxHp), 6);
          pEnt.hpBar.fill(0x10b981);
        }
      } 
      
      // Resource rendering
      else if (['tree', 'gold_ore', 'sheep', 'stump'].includes(data.type)) {
        pEnt.sprite.anchor.set(0.5, 0.75);
        
        // Shake and particle pop on harvest
        if (pEnt.lastAmount !== undefined && data.amount < pEnt.lastAmount) {
          pEnt.shakeTimer = 8;
          let popTex = null;
          if (data.type === 'tree') popTex = this.textures.wood_resource;
          else if (data.type === 'gold_ore') popTex = this.textures.gold_stone1 || this.textures.gold_ore;
          else if (data.type === 'sheep') popTex = this.textures.meat_resource;
          
          if (popTex) {
            this.spawnResourcePopParticle(data.x, data.y, popTex);
          }
        }
        pEnt.lastAmount = data.amount;

        // Apply shake offset to sprite (x is local offset, keeping container centered)
        if (pEnt.shakeTimer > 0) {
          pEnt.shakeTimer--;
          pEnt.sprite.x = Math.sin(pEnt.shakeTimer * 2) * 5;
        } else {
          pEnt.sprite.x = 0;
        }
        
        if (data.type === 'tree') {
          pEnt.sprite.width = 140; pEnt.sprite.height = 200;
          const treeVariant = 1 + (Number.parseInt(id.replace(/\D/g, ''), 10) || 0) % 4;
          const treeFrames = this.slicedFrames[`tree${treeVariant}`] || this.slicedFrames.tree;
          if (treeFrames) {
            const frameIndex = Math.min(5, Math.floor((1 - (data.amount / data.maxAmount)) * 6));
            pEnt.sprite.texture = treeFrames[frameIndex];
          }
        } else if (data.type === 'gold_ore') {
          pEnt.sprite.width = 150; pEnt.sprite.height = 150;
          const oreVariant = 1 + (Number.parseInt(id.replace(/\D/g, ''), 10) || 0) % 6;
          const highlightFrames = this.slicedFrames[`gold_stone_highlight${oreVariant}`];
          if (this.selectedIds.includes(id) && highlightFrames?.length) {
            pEnt.frameTimer += 0.15;
            if (pEnt.frameTimer >= 1) {
              pEnt.frameTimer = 0;
              pEnt.frameIndex = (pEnt.frameIndex + 1) % highlightFrames.length;
            }
            pEnt.sprite.texture = highlightFrames[pEnt.frameIndex];
          } else {
            pEnt.sprite.texture = this.textures[`gold_stone${oreVariant}`] || this.textures.gold_ore;
          }
        } else if (data.type === 'sheep') {
          // Sheep use a 128px sheet like the units. 72px made them look
          // miniature beside a 64px terrain tile, so render at 112px and
          // preserve the facing direction sent by the server.
          const sheepFrames = data.state === 'run'
            ? this.slicedFrames.sheep_move
            : (data.state === 'graze'
              ? this.slicedFrames.sheep_grass
              : this.slicedFrames.sheep);
          if (sheepFrames) {
            const frameSpeed = data.state === 'run' ? 0.22 : 0.07;
            pEnt.frameTimer += frameSpeed;
            if (pEnt.frameTimer >= 1) {
              pEnt.frameTimer = 0;
              pEnt.frameIndex = (pEnt.frameIndex + 1) % sheepFrames.length;
            }
            pEnt.sprite.texture = sheepFrames[pEnt.frameIndex];
          }
          const sheepScale = 112 / 128;
          pEnt.sprite.scale.set((data.facing === -1 ? -1 : 1) * sheepScale, sheepScale);
          pEnt.sprite.y = data.state === 'run'
            ? Math.sin((pEnt.frameIndex + pEnt.frameTimer) * Math.PI) * 2
            : 0;
        } else {
          const stumpVariant = data.variant || (1 + (Number.parseInt(id.replace(/\D/g, ''), 10) || 0) % 4);
          pEnt.sprite.texture = this.textures[`stump${stumpVariant}`];
          pEnt.sprite.width = 82;
          pEnt.sprite.height = 105;
        }

        pEnt.hpBar.clear();
        if (data.type !== 'stump' && data.amount < data.maxAmount) {
          const barY = data.type === 'tree' ? -165 : data.type === 'gold_ore' ? -120 : -60;
          pEnt.hpBar.rect(-20, barY, 40, 4);
          pEnt.hpBar.fill(0x333333);
          pEnt.hpBar.rect(-20, barY, 40 * (data.amount / data.maxAmount), 4);
          pEnt.hpBar.fill(0xf59e0b);
        }
      }
    });

    // Redraw map first time
    if (!this.mapDrawn && this.textures.grass) {
      this.drawMap();
      this.mapDrawn = true;
    }
  }

  updateLoop() {
    // 1. WASD camera panning controls
    if (this.keys['w'] || this.keys['arrowup']) this.viewport.y += this.cameraSpeed;
    if (this.keys['s'] || this.keys['arrowdown']) this.viewport.y -= this.cameraSpeed;
    if (this.keys['a'] || this.keys['arrowleft']) this.viewport.x += this.cameraSpeed;
    if (this.keys['d'] || this.keys['arrowright']) this.viewport.x -= this.cameraSpeed;

    // 1b. Mouse Edge Panning (scrolls if cursor is near boundaries) - disabled when rotated or on mobile
    if (this.container && !this.isPanning && !this.isRotated()) {
      const rect = this.container.getBoundingClientRect();
      const edgeSize = 40; // px threshold from boundary
      const mouseX = this.mouseScreen.x;
      const mouseY = this.mouseScreen.y;

      const inside = mouseX >= rect.left && mouseX <= rect.right &&
                     mouseY >= rect.top && mouseY <= rect.bottom;

      if (inside) {
        if (mouseX < rect.left + edgeSize) {
          this.viewport.x += this.cameraSpeed;
        } else if (mouseX > rect.right - edgeSize) {
          this.viewport.x -= this.cameraSpeed;
        }

        if (mouseY < rect.top + edgeSize) {
          this.viewport.y += this.cameraSpeed;
        } else if (mouseY > rect.bottom - edgeSize) {
          this.viewport.y -= this.cameraSpeed;
        }
      }
    }

    // 3. Update active particles & projectiles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.update) {
        p.update();
        if (p.frameIndex >= p.frames) {
          p.destroy();
          this.particles.splice(i, 1);
        }
      } else {
        p.frameTimer += p.speed;
        if (p.frameTimer >= 1) {
          p.frameTimer = 0;
          p.frameIndex++;
          if (p.frameIndex >= p.frames.length) {
            this.particlesContainer.removeChild(p.sprite);
            p.sprite.destroy();
            this.particles.splice(i, 1);
          } else {
            p.sprite.texture = p.frames[p.frameIndex];
          }
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.t++;
      
      if (proj.t >= proj.duration) {
        this.spawnParticle(proj.ex, proj.ey, 'dust1', 0.8, 0.3);
        this.particlesContainer.removeChild(proj.graphics);
        proj.graphics.destroy();
        this.projectiles.splice(i, 1);
      } else {
        const percent = proj.t / proj.duration;
        const currentX = proj.sx + (proj.ex - proj.sx) * percent;
        const currentY = proj.sy + (proj.ey - proj.sy) * percent;
        const arcHeight = 35 * Math.sin(percent * Math.PI);
        
        proj.graphics.clear();
        
        const nextPercent = (proj.t + 1) / proj.duration;
        const nextX = proj.sx + (proj.ex - proj.sx) * nextPercent;
        const nextY = proj.sy + (proj.ey - proj.sy) * nextPercent - 35 * Math.sin(nextPercent * Math.PI);
        const angle = Math.atan2(nextY - (currentY - arcHeight), nextX - currentX);
        
        proj.graphics
          .rect(-8, -1.5, 16, 3)
          .fill({ color: 0xdba159 })
          .rect(8, -2.5, 3, 5)
          .fill({ color: 0xe2e8f0 });
        
        proj.graphics.x = currentX;
        proj.graphics.y = currentY - arcHeight;
        proj.graphics.rotation = angle;
      }
    }

    const waterTime = performance.now() * 0.0015;
    this.waterAnimationTick = (this.waterAnimationTick + 0.12) % 16;
    this.animatedWater.forEach(({ sprite, phase, frameOffset }) => {
      const frame = (Math.floor(this.waterAnimationTick) + frameOffset) % this.slicedFrames.water_foam.length;
      sprite.texture = this.slicedFrames.water_foam[frame];
      sprite.alpha = 0.42 + Math.sin(waterTime + phase) * 0.13;
      sprite.rotation = Math.sin(waterTime * 0.45 + phase) * 0.025;
    });

    // Animate Water Rocks (splashes)
    const rockTick = Math.floor(this.waterAnimationTick) % 16;
    this.animatedWaterRocks.forEach(rock => {
      const idx = (rockTick + rock.frameOffset) % rock.frames.length;
      rock.sprite.texture = rock.frames[idx];
    });

    // Animate Rubber Duck
    if (this.animatedDuck) {
      const duckTick = Math.floor(performance.now() * 0.005) % this.animatedDuck.frames.length;
      this.animatedDuck.sprite.texture = this.animatedDuck.frames[duckTick];
      this.animatedDuck.sprite.y = 31.5 * TILE_SIZE + Math.sin(performance.now() * 0.003) * 4;
    }

    // Animate Bushes (swaying)
    const bushTick = Math.floor(performance.now() * 0.006);
    this.animatedBushes.forEach(bush => {
      const idx = (bushTick + bush.frameOffset) % bush.frames.length;
      bush.sprite.texture = bush.frames[idx];
    });

    this.clouds.forEach(cloud => {
      cloud.sprite.x += cloud.speed;
      if (cloud.sprite.x - cloud.sprite.width / 2 > MAP_SIZE) {
        cloud.sprite.x = -cloud.sprite.width / 2;
      }
    });

    for (let i = this.commandMarkers.length - 1; i >= 0; i--) {
      const marker = this.commandMarkers[i];
      marker.life--;
      const progress = 1 - marker.life / marker.maxLife;
      marker.graphics.alpha = 1 - progress;
      marker.graphics.scale.set(1 + progress * 0.8);
      if (marker.life <= 0) {
        this.particlesContainer.removeChild(marker.graphics);
        marker.graphics.destroy();
        this.commandMarkers.splice(i, 1);
      }
    }

    // 4. Limit camera position to stay within boundaries
    const screenW = this.app.screen.width || 1200;
    const screenH = this.app.screen.height || 800;
    this.viewport.x = Math.max(-MAP_SIZE + screenW, Math.min(this.viewport.x, 0));
    this.viewport.y = Math.max(-MAP_SIZE + screenH, Math.min(this.viewport.y, 0));

    // 2. Draw selection box rectangle
    this.selectionGraphics.clear();
    if (this.isSelecting) {
      this.selectionGraphics
        .rect(
          this.selectionStart.x,
          this.selectionStart.y,
          this.selectionCurrent.x - this.selectionStart.x,
          this.selectionCurrent.y - this.selectionStart.y
        )
        .fill({ color: 0x10b981, alpha: 0.1 })
        .stroke({ width: 1, color: 0x10b981 });
    }

    // 5. Dynamic Cursor Update based on hover entity (optimized to set only on change)
    if (this.container && !this.isTwoFingerPanning) {
      let desiredCursor = 'default';
      let cursorStyle = `url('http://localhost:3001/assets/UI Elements/UI Elements/Cursors/Cursor_01.png') 0 0, auto`;
      
      if (this.container.classList.contains('placement-cursor')) {
        const coords = this.getEventCoords(this.mouseScreen);
        const worldPos = this.screenToWorld(coords.x, coords.y);
        const gx = Math.floor(worldPos.x / TILE_SIZE);
        const gy = Math.floor(worldPos.y / TILE_SIZE);
        
        let isValid = gx >= 0 && gx < MAP_CELLS && gy >= 0 && gy < MAP_CELLS;
        if (isValid) {
          if (isWaterCell(gx, gy) || isHillCell(gx, gy)) {
            isValid = false;
          } else {
            Object.values(this.pixiEntities).forEach(ent => {
              const data = ent.lastData;
              if (data && ['castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(data.type)) {
                const egx = Math.floor(data.x / TILE_SIZE);
                const egy = Math.floor(data.y / TILE_SIZE);
                if (egx === gx && egy === gy) {
                  isValid = false;
                }
              }
            });
          }
        }
        
        if (!isValid) {
          desiredCursor = 'not-allowed';
          cursorStyle = `url('http://localhost:3001/assets/UI Elements/UI Elements/Cursors/Cursor_03.png') 32 32, not-allowed`;
        } else {
          desiredCursor = 'placement';
          cursorStyle = `url('http://localhost:3001/assets/UI Elements/UI Elements/Cursors/Cursor_01.png') 0 0, crosshair`;
        }
      } else {
        const coords = this.getEventCoords(this.mouseScreen);
        const worldPos = this.screenToWorld(coords.x, coords.y);
        const hoverEntityId = this.findEntityAt(worldPos.x, worldPos.y);
        const entity = hoverEntityId ? this.pixiEntities[hoverEntityId]?.lastData : null;
        
        if (entity) {
          if (entity.ownerId !== this.socketId && ['pawn', 'warrior', 'lancer', 'archer', 'monk', 'castle', 'house', 'barracks', 'archery', 'monastery', 'tower'].includes(entity.type)) {
            desiredCursor = 'attack';
            cursorStyle = `url('http://localhost:3001/assets/UI Elements/UI Elements/Cursors/Cursor_04.png') 64 64, pointer`;
          } else if (['tree', 'gold_ore', 'sheep'].includes(entity.type)) {
            desiredCursor = 'gather';
            cursorStyle = `url('http://localhost:3001/assets/UI Elements/UI Elements/Cursors/Cursor_04.png') 64 64, pointer`;
          }
        }
      }
      
      if (this.currentCursorType !== desiredCursor) {
        this.currentCursorType = desiredCursor;
        this.container.style.cursor = cursorStyle;
      }
    }

    // 3. Y-Sorting: handled natively via container.sortableChildren = true and zIndex
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.isLoaded = false;

    if (this.boundListeners) {
      const { onKeyDown, onKeyUp, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd } = this.boundListeners;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (onTouchStart) this.container.removeEventListener('touchstart', onTouchStart);
      if (onTouchMove) window.removeEventListener('touchmove', onTouchMove);
      if (onTouchEnd) window.removeEventListener('touchend', onTouchEnd);
      this.boundListeners = null;
    }

    if (this.app?.canvas && this.contextMenuHandler) {
      this.app.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    }

    if (this.app && this.isInitialized) {
      try {
        if (this.tickerCallback) this.app.ticker.remove(this.tickerCallback);
        this.app.destroy({ removeView: true });
      } catch (err) {
        console.warn('Lỗi khi hủy PixiJS Application:', err);
      }
      this.app = null;
    }
  }
}
