import TileRenderer from './tileRenderer.js';

// ─── ChunkManager ─────────────────────────────────────────────────────────────

class ChunkManager {
    constructor(chunkSize = 32, tileSize = 50) {
        this.chunkSize = chunkSize;
        this.tileSize = tileSize;
        this.loadedChunks = new Map();
        this.worldSeed = Math.floor(Math.random() * 2 ** 31);
    }

    _chunkRng(chunkX, chunkY) {
        let h = this.worldSeed ^ (chunkX * 374761393) ^ (chunkY * 1057926937);
        h = Math.imul(h ^ (h >>> 13), 1540483477);
        h ^= h >>> 15;
        return () => {
            h = Math.imul(h ^ (h >>> 13), 1540483477);
            h ^= h >>> 15;
            return (h >>> 0) / 0xffffffff;
        };
    }

    _generateChunk(chunkX, chunkY) {
        const rng = this._chunkRng(chunkX, chunkY);
        const size = this.chunkSize;
        const terrain = [];

        for (let y = 0; y < size; y++) {
            const row = [];
            for (let x = 0; x < size; x++) {
                const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
                if (isBorder) {
                    row.push('cliff');
                } else if (rng() < 0.08) {
                    row.push('rock');
                } else if (rng() < 0.12) {
                    row.push('dune');
                } else {
                    row.push('plain');
                }
            }
            terrain.push(row);
        }

        if (chunkX === 0 && chunkY === 0) {
            const mid = Math.floor(size / 2);
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    terrain[mid + dy][mid + dx] = 'plain';
                }
            }
        }

        return { x: chunkX, y: chunkY, terrain, seed: this.worldSeed };
    }

    getChunk(chunkX, chunkY) {
        const key = `${chunkX},${chunkY}`;
        if (!this.loadedChunks.has(key)) {
            this.loadedChunks.set(key, this._generateChunk(chunkX, chunkY));
        }
        return this.loadedChunks.get(key);
    }

    _getTileAt(worldX, worldY) {
        const chunkPixels = this.chunkSize * this.tileSize;
        const chunkX = Math.floor(worldX / chunkPixels);
        const chunkY = Math.floor(worldY / chunkPixels);
        const chunk = this.getChunk(chunkX, chunkY);

        const localX = Math.floor((worldX - chunkX * chunkPixels) / this.tileSize);
        const localY = Math.floor((worldY - chunkY * chunkPixels) / this.tileSize);

        if (localY < 0 || localY >= this.chunkSize || localX < 0 || localX >= this.chunkSize) {
            return 'cliff';
        }

        return chunk.terrain[localY][localX];
    }

    isWalkable(worldX, worldY) {
        const tile = this._getTileAt(worldX, worldY);
        return tile !== 'cliff' && tile !== 'rock';
    }

    getMovementModifier(worldX, worldY) {
        const tile = this._getTileAt(worldX, worldY);
        switch (tile) {
            case 'plain': return 1.0;
            case 'dune':  return 0.6;
            case 'rock':  return 0.3;
            case 'cliff': return 0.0;
            default:      return 1.0;
        }
    }

    getSurroundingChunks(worldX, worldY, radius = 1) {
        const chunkPixels = this.chunkSize * this.tileSize;
        const cx = Math.floor(worldX / chunkPixels);
        const cy = Math.floor(worldY / chunkPixels);
        const chunks = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                chunks.push(this.getChunk(cx + dx, cy + dy));
            }
        }
        return chunks;
    }

    unloadDistant(worldX, worldY, maxDistance = 3) {
        const chunkPixels = this.chunkSize * this.tileSize;
        const cx = Math.floor(worldX / chunkPixels);
        const cy = Math.floor(worldY / chunkPixels);
        for (const key of this.loadedChunks.keys()) {
            const [kx, ky] = key.split(',').map(Number);
            if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > maxDistance) {
                this.loadedChunks.delete(key);
            }
        }
    }
}

// ─── ChunkRenderer ────────────────────────────────────────────────────────────

const TERRAIN_COLORS = {
    plain: '#1e2a3a',
    dune:  '#3b2f1e',
    rock:  '#2e2e3e',
    cliff: '#4a4a5e'
};

class ChunkRenderer {
    constructor(renderer) {
        this.renderer = renderer;
    }

    render(chunks, chunkSize, tileSize) {
        const ctx = this.renderer.ctx;
        const cam = this.renderer.camera;
        const chunkPixels = chunkSize * tileSize;

        for (const chunk of chunks) {
            const chunkWorldX = chunk.x * chunkPixels;
            const chunkWorldY = chunk.y * chunkPixels;

            for (let ty = 0; ty < chunkSize; ty++) {
                for (let tx = 0; tx < chunkSize; tx++) {
                    const tile = chunk.terrain[ty][tx];
                    const screenX = chunkWorldX + tx * tileSize - cam.x;
                    const screenY = chunkWorldY + ty * tileSize - cam.y;

                    if (
                        screenX + tileSize < 0 || screenX > this.renderer.canvas.width ||
                        screenY + tileSize < 0 || screenY > this.renderer.canvas.height
                    ) continue;

                    ctx.fillStyle = TERRAIN_COLORS[tile] || TERRAIN_COLORS.plain;
                    ctx.fillRect(screenX, screenY, tileSize, tileSize);

                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(screenX, screenY, tileSize, tileSize);
                }
            }
        }
    }
}

// ─── InputHandler ─────────────────────────────────────────────────────────────

class InputHandler {
    constructor() {
        this.keys = {};
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => { this.keys[e.key.toLowerCase()] = true; });
        window.addEventListener('keyup',   (e) => { this.keys[e.key.toLowerCase()] = false; });
    }

    isPressed(key) { return !!this.keys[key.toLowerCase()]; }
}

// ─── Player ───────────────────────────────────────────────────────────────────

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.velocity = { x: 0, y: 0 };
        this.speed = 5;
        this.baseSpeed = 5;
        this.speedModifiers = [];
        this.radius = 20;
        this.health = 100;
        this.maxHealth = 100;
        this.invulnerable = false;
        this.angle = 0;
    }

    update(input, deltaTime, chunkManager) {
        this.velocity.x = 0;
        this.velocity.y = 0;

        if (input.isPressed('w')) this.velocity.y -= 1;
        if (input.isPressed('s')) this.velocity.y += 1;
        if (input.isPressed('a')) this.velocity.x -= 1;
        if (input.isPressed('d')) this.velocity.x += 1;

        const magnitude = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
        if (magnitude > 0) {
            this.velocity.x = (this.velocity.x / magnitude) * this.speed;
            this.velocity.y = (this.velocity.y / magnitude) * this.speed;
            this.angle = Math.atan2(this.velocity.y, this.velocity.x);
        }

        const dt = deltaTime / 16;
        const terrainModifier = chunkManager
            ? chunkManager.getMovementModifier(this.x, this.y)
            : 1.0;

        const moveX = this.velocity.x * dt * terrainModifier;
        const moveY = this.velocity.y * dt * terrainModifier;

        const nextX = this.x + moveX;
        const nextY = this.y + moveY;

        if (chunkManager) {
            if (chunkManager.isWalkable(nextX, this.y)) this.x = nextX;
            if (chunkManager.isWalkable(this.x, nextY)) this.y = nextY;
        } else {
            this.x = nextX;
            this.y = nextY;
        }
    }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = { x: 0, y: 0 };
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    clear() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setCamera(targetX, targetY) {
        this.camera.x = targetX - this.canvas.width / 2;
        this.camera.y = targetY - this.canvas.height / 2;
    }

    drawCircle(x, y, radius, color) {
        const screenX = x - this.camera.x;
        const screenY = y - this.camera.y;
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.closePath();
    }
}

// ─── GameState ────────────────────────────────────────────────────────────────

class GameState {
    constructor(player) {
        this.player = player;
        this.ghosts = [];
        this.lighting = {
            lightRadius: 200,
            darknessColor: 'rgba(0, 0, 0, 0.85)'
        };
        this.particles = [];
        this.projectiles = [];
        this.enemies = [];
        this.chunkManager = null;
        this.timeScale = 1;
        this.cameraShake = false;
        this.ghostsVisible = false;
        this.activeEffects = [];
    }

    applyEffect({ type, multiplier, duration }) {
        const effect = { type, multiplier, duration, startedAt: Date.now() };
        this.activeEffects.push(effect);

        switch (type) {
            case 'speed':
                this.player.speedModifiers.push(multiplier);
                this._recalculateSpeed();
                break;
            case 'lightRadius':
                this.lighting.lightRadius *= multiplier;
                break;
        }

        setTimeout(() => this._revertEffect(effect), duration);
    }

    _recalculateSpeed() {
        const total = this.player.speedModifiers.reduce((a, b) => a * b, 1);
        this.player.speed = this.player.baseSpeed * total;
    }

    _revertEffect(effect) {
        switch (effect.type) {
            case 'speed': {
                const idx = this.player.speedModifiers.indexOf(effect.multiplier);
                if (idx !== -1) this.player.speedModifiers.splice(idx, 1);
                this._recalculateSpeed();
                break;
            }
            case 'lightRadius':
                this.lighting.lightRadius /= effect.multiplier;
                break;
        }
        this.activeEffects = this.activeEffects.filter(e => e !== effect);
    }

    update(deltaTime) {
        const now = Date.now();

        this.particles = this.particles.filter(p => (now - p.created) < p.duration);

        this.projectiles = this.projectiles.filter(p => {
            const dt = deltaTime / 16;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            return (now - p.created) < 2000;
        });

        this.ghosts.forEach(ghost => {
            ghost.update(this.player, this.chunkManager, deltaTime);
        });

        if (this.chunkManager) {
            this.chunkManager.unloadDistant(this.player.x, this.player.y);
        }
    }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.input = new InputHandler();

        const chunkManager = new ChunkManager(32, 50);
        const mid = Math.floor(chunkManager.chunkSize / 2);
        const startX = mid * chunkManager.tileSize + chunkManager.tileSize / 2;
        const startY = mid * chunkManager.tileSize + chunkManager.tileSize / 2;

        const player = new Player(startX, startY);
        this.gameState = new GameState(player);
        this.gameState.chunkManager = chunkManager;

        this.chunkRenderer = new ChunkRenderer(this.renderer);

        this.lastTime = null;

        this.bindEvents();
        requestAnimationFrame((ts) => this.loop(ts));
    }

    bindEvents() {
        window.addEventListener('resize', () => this.renderer.resize());
    }

    update(deltaTime) {
        const scaledDelta = deltaTime * this.gameState.timeScale;
        this.gameState.player.update(this.input, scaledDelta, this.gameState.chunkManager);
        this.gameState.update(scaledDelta);
    }

    render() {
        const { player, ghosts, particles, projectiles, chunkManager } = this.gameState;

        this.renderer.clear();
        this.renderer.setCamera(player.x, player.y);

        if (chunkManager) {
            const chunks = chunkManager.getSurroundingChunks(player.x, player.y, 1);
            this.chunkRenderer.render(chunks, chunkManager.chunkSize, chunkManager.tileSize);
        }

        ghosts.forEach(ghost => {
            if (ghost.render) ghost.render(this.renderer);
        });

        particles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, p.radius * 0.3, 'rgba(255, 200, 100, 0.4)');
        });

        projectiles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, 5, 'rgba(255, 255, 100, 0.9)');
        });

        this.renderer.drawCircle(player.x, player.y, player.radius, '#e94560');
    }

    loop(timestamp) {
        if (this.lastTime === null) this.lastTime = timestamp;
        const deltaTime = Math.min(timestamp - this.lastTime, 100);
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame((ts) => this.loop(ts));
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });