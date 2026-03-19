import Ghost from './ghost.js';
import BasicAI from './ai_basic.js';
import Lighting from './lighting.js';

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
        if (localY < 0 || localY >= this.chunkSize || localX < 0 || localX >= this.chunkSize) return 'cliff';
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

    findWalkableNear(worldX, worldY, searchRadius = 300) {
        const step = this.tileSize;
        for (let r = step; r <= searchRadius; r += step) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                const tx = worldX + Math.cos(angle) * r;
                const ty = worldY + Math.sin(angle) * r;
                if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
            }
        }
        return { x: worldX, y: worldY };
    }

    getSurroundingChunks(worldX, worldY, radius = 1) {
        const chunkPixels = this.chunkSize * this.tileSize;
        const cx = Math.floor(worldX / chunkPixels);
        const cy = Math.floor(worldY / chunkPixels);
        const chunks = [];
        for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++)
                chunks.push(this.getChunk(cx + dx, cy + dy));
        return chunks;
    }

    unloadDistant(worldX, worldY, maxDistance = 3) {
        const chunkPixels = this.chunkSize * this.tileSize;
        const cx = Math.floor(worldX / chunkPixels);
        const cy = Math.floor(worldY / chunkPixels);
        for (const key of this.loadedChunks.keys()) {
            const [kx, ky] = key.split(',').map(Number);
            if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > maxDistance)
                this.loadedChunks.delete(key);
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
    constructor(renderer) { this.renderer = renderer; }

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
                    if (screenX + tileSize < 0 || screenX > this.renderer.canvas.width ||
                        screenY + tileSize < 0 || screenY > this.renderer.canvas.height) continue;
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
        const nextX = this.x + this.velocity.x * dt;
        const nextY = this.y + this.velocity.y * dt;
        const terrainModifier = chunkManager ? chunkManager.getMovementModifier(nextX, nextY) : 1.0;
        const finalX = this.x + this.velocity.x * dt * terrainModifier;
        const finalY = this.y + this.velocity.y * dt * terrainModifier;

        if (chunkManager) {
            if (chunkManager.isWalkable(finalX, this.y)) this.x = finalX;
            if (chunkManager.isWalkable(this.x, finalY)) this.y = finalY;
        } else {
            this.x = finalX;
            this.y = finalY;
        }
    }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = { x: 0, y: 0 };
        this._shake = { x: 0, y: 0, magnitude: 0, decay: 0.85 };
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    triggerShake(magnitude = 8) {
        this._shake.magnitude = magnitude;
    }

    _updateShake() {
        if (this._shake.magnitude > 0.1) {
            this._shake.x = (Math.random() * 2 - 1) * this._shake.magnitude;
            this._shake.y = (Math.random() * 2 - 1) * this._shake.magnitude;
            this._shake.magnitude *= this._shake.decay;
        } else {
            this._shake.magnitude = 0;
            this._shake.x = 0;
            this._shake.y = 0;
        }
    }

    clear() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setCamera(targetX, targetY) {
        this._updateShake();
        this.camera.x = targetX - this.canvas.width / 2 + this._shake.x;
        this.camera.y = targetY - this.canvas.height / 2 + this._shake.y;
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

    drawDamageFlash(alpha) {
        if (alpha <= 0) return;
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = `rgba(220, 30, 30, ${alpha})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    drawGameOver() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        // Dark backdrop
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, w, h);

        // "Game Over" title
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 72px sans-serif';
        ctx.fillStyle = '#cc2222';
        ctx.fillText('GAME OVER', w / 2, h / 2 - 30);

        // Subtitle
        ctx.font = '24px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText('Refresh to try again', w / 2, h / 2 + 40);

        ctx.restore();
    }
}

// ─── GameState ────────────────────────────────────────────────────────────────

class GameState {
    constructor(player) {
        this.player = player;
        this.ghosts = [];
        this.lighting = null;
        this.particles = [];
        this.projectiles = [];
        this.enemies = [];
        this.chunkManager = null;
        this.timeScale = 1;
        this.cameraShake = false;
        this.ghostsVisible = false;
        this.activeEffects = [];

        // Feedback state
        this.damageFlashAlpha = 0;
        this.isGameOver = false;
    }

    triggerDamageFlash() {
        this.damageFlashAlpha = 0.55;
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
                if (this.lighting) this.lighting.lightRadius *= multiplier;
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
                if (this.lighting) this.lighting.lightRadius /= effect.multiplier;
                break;
        }
        this.activeEffects = this.activeEffects.filter(e => e !== effect);
    }

    update(deltaTime, renderer) {
        if (this.isGameOver) return;

        const now = Date.now();
        const player = this.player;

        // Decay damage flash
        if (this.damageFlashAlpha > 0) {
            this.damageFlashAlpha = Math.max(0, this.damageFlashAlpha - (deltaTime / 16) * 0.06);
        }

        this.particles = this.particles.filter(p => (now - p.created) < p.duration);

        this.projectiles = this.projectiles.filter(p => {
            const dt = deltaTime / 16;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            return (now - p.created) < 2000;
        });

        this.ghosts = this.ghosts.filter(ghost => ghost.health > 0);

        for (const ghost of this.ghosts) {
            ghost.update(player, this.chunkManager, deltaTime);

            if (!player.invulnerable) {
                const dmg = ghost.attack(player);
                if (dmg > 0) {
                    player.health = Math.max(0, player.health - dmg);
                    this.triggerDamageFlash();
                    renderer.triggerShake(7);
                }
            }
        }

        if (player.health <= 0) {
            this.isGameOver = true;
        }

        if (this.lighting) {
            this.lighting.update(deltaTime);
        }

        if (this.chunkManager) {
            this.chunkManager.unloadDistant(player.x, player.y);
        }
    }
}

// ─── Ghost spawner ────────────────────────────────────────────────────────────

function spawnGhosts(count, playerX, playerY, chunkManager) {
    const ghosts = [];
    const minDist = 300;
    const maxDist = 600;

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const dist  = minDist + Math.random() * (maxDist - minDist);
        const wx    = playerX + Math.cos(angle) * dist;
        const wy    = playerY + Math.sin(angle) * dist;
        const pos   = chunkManager.findWalkableNear(wx, wy);

        const ghost = new Ghost(pos.x, pos.y, { speed: 2 + Math.random(), health: 30, damage: 8 });
        ghost.setAI(new BasicAI({ detectionRange: 350, stopDistance: 22 }));
        ghosts.push(ghost);
    }

    return ghosts;
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.input = new InputHandler();

        const chunkManager = new ChunkManager(32, 50);
        const mid    = Math.floor(chunkManager.chunkSize / 2);
        const startX = mid * chunkManager.tileSize + chunkManager.tileSize / 2;
        const startY = mid * chunkManager.tileSize + chunkManager.tileSize / 2;

        const player = new Player(startX, startY);
        this.gameState = new GameState(player);
        this.gameState.chunkManager = chunkManager;
        this.gameState.lighting = new Lighting(this.renderer, {
            lightRadius:      200,
            darknessColor:    'rgba(0, 0, 0, 0.85)',
            flickerIntensity: 0.05
        });

        chunkManager.getSurroundingChunks(startX, startY, 2);
        this.gameState.ghosts = spawnGhosts(4, startX, startY, chunkManager);

        this.chunkRenderer = new ChunkRenderer(this.renderer);
        this.lastTime = null;

        this.bindEvents();
        requestAnimationFrame((ts) => this.loop(ts));
    }

    bindEvents() {
        window.addEventListener('resize', () => this.renderer.resize());
    }

    update(deltaTime) {
        if (this.gameState.isGameOver) return;
        const scaledDelta = deltaTime * this.gameState.timeScale;
        this.gameState.player.update(this.input, scaledDelta, this.gameState.chunkManager);
        this.gameState.update(scaledDelta, this.renderer);
    }

    render() {
        const { player, ghosts, particles, projectiles, chunkManager, lighting,
                damageFlashAlpha, isGameOver } = this.gameState;

        this.renderer.clear();
        this.renderer.setCamera(player.x, player.y);

        // 1. Terrain
        if (chunkManager) {
            const chunks = chunkManager.getSurroundingChunks(player.x, player.y, 1);
            this.chunkRenderer.render(chunks, chunkManager.chunkSize, chunkManager.tileSize);
        }

        // 2. Particles
        particles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, p.radius * 0.3, 'rgba(255, 200, 100, 0.4)');
        });

        // 3. Projectiles
        projectiles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, 5, 'rgba(255, 255, 100, 0.9)');
        });

        // 4. Ghosts
        ghosts.forEach(ghost => { if (ghost.render) ghost.render(this.renderer); });

        // 5. Player
        this.renderer.drawCircle(player.x, player.y, player.radius, '#e94560');

        // 6. Lighting (fog of war)
        if (lighting) lighting.render(player);

        // 7. Damage flash (screen-space, over lighting)
        this.renderer.drawDamageFlash(damageFlashAlpha);

        // 8. Game over overlay (topmost)
        if (isGameOver) this.renderer.drawGameOver();
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