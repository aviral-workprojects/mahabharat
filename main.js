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
                if (isBorder) row.push('cliff');
                else if (rng() < 0.08) row.push('rock');
                else if (rng() < 0.12) row.push('dune');
                else row.push('plain');
            }
            terrain.push(row);
        }
        if (chunkX === 0 && chunkY === 0) {
            const mid = Math.floor(size / 2);
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    terrain[mid + dy][mid + dx] = 'plain';
        }
        return { x: chunkX, y: chunkY, terrain, seed: this.worldSeed };
    }

    getChunk(chunkX, chunkY) {
        const key = `${chunkX},${chunkY}`;
        if (!this.loadedChunks.has(key))
            this.loadedChunks.set(key, this._generateChunk(chunkX, chunkY));
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
        for (let r = step; r <= searchRadius; r += step)
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                const tx = worldX + Math.cos(angle) * r;
                const ty = worldY + Math.sin(angle) * r;
                if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
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

const TERRAIN_COLORS = { plain: '#1e2a3a', dune: '#3b2f1e', rock: '#2e2e3e', cliff: '#4a4a5e' };

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
                    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(screenX, screenY, tileSize, tileSize);
                }
            }
        }
    }
}

// ─── AbilitySystem ────────────────────────────────────────────────────────────

// Curated ability definitions — each uses GameState.applyEffect() or safe direct
// mutation, keeping the architecture clean.
const ABILITY_ROSTER = [
    {
        name:     'Gandiva Dash',
        key:      'gandivaDash',
        cooldown: 5000,
        color:    '#44aaff',
        icon:     '⚡',
        activate(player, gameState) {
            gameState.applyEffect({ type: 'speed', multiplier: 4, duration: 300 });
            _burst(player, gameState, 8, 'rgba(100,180,255,0.7)', 60);
        }
    },
    {
        name:     'Divine Guidance',
        key:      'divineGuidance',
        cooldown: 8000,
        color:    '#ffdd66',
        icon:     '✦',
        activate(player, gameState) {
            gameState.applyEffect({ type: 'lightRadius', multiplier: 2.5, duration: 3000 });
            _burst(player, gameState, 12, 'rgba(255,220,80,0.7)', 100);
        }
    },
    {
        name:     'Truth Aura',
        key:      'truthAura',
        cooldown: 10000,
        color:    '#88ffaa',
        icon:     '🛡',
        activate(player, gameState) {
            player.invulnerable = true;
            _burst(player, gameState, 10, 'rgba(100,255,140,0.7)', 80);
            setTimeout(() => { player.invulnerable = false; }, 2000);
        }
    },
    {
        name:     'Vasavi Shakti',
        key:      'vasaviShakti',
        cooldown: 15000,
        color:    '#ff8844',
        icon:     '🔥',
        activate(player, gameState) {
            gameState.applyEffect({ type: 'lightRadius', multiplier: 1.5, duration: 4000 });
            gameState.applyEffect({ type: 'speed',       multiplier: 1.3, duration: 4000 });
            _burst(player, gameState, 16, 'rgba(255,140,60,0.8)', 120);
        }
    },
    {
        name:     'Brahmastra',
        key:      'brahmastra',
        cooldown: 20000,
        color:    '#cc44ff',
        icon:     '★',
        activate(player, gameState) {
            gameState.applyEffect({ type: 'lightRadius', multiplier: 3, duration: 2000 });
            _burst(player, gameState, 20, 'rgba(200,80,255,0.8)', 150);
        }
    }
];

// Emit an expanding ring of particles from the player position
function _burst(player, gameState, count, color, radius) {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        gameState.particles.push({
            x:        player.x + Math.cos(angle) * 10,
            y:        player.y + Math.sin(angle) * 10,
            vx:       Math.cos(angle) * 3,
            vy:       Math.sin(angle) * 3,
            radius,
            color,
            duration: 500,
            created:  now
        });
    }
}

class AbilitySystem {
    constructor(ability) {
        this.ability  = ability;   // one of ABILITY_ROSTER
        this.lastUsed = -Infinity; // ms timestamp
        this.active   = false;     // true during activation flash
        this.flashAlpha = 0;
    }

    get cooldownRemaining() {
        return Math.max(0, this.ability.cooldown - (Date.now() - this.lastUsed));
    }

    get cooldownFraction() {
        return 1 - this.cooldownRemaining / this.ability.cooldown;
    }

    get isReady() {
        return this.cooldownRemaining === 0;
    }

    tryActivate(player, gameState) {
        if (!this.isReady) return false;
        this.lastUsed = Date.now();
        this.flashAlpha = 0.4;
        this.ability.activate(player, gameState);
        return true;
    }

    update(deltaTime) {
        if (this.flashAlpha > 0)
            this.flashAlpha = Math.max(0, this.flashAlpha - (deltaTime / 16) * 0.05);
    }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

class HUD {
    constructor(renderer) { this.renderer = renderer; }

    render(player, ghostCount, survivalSeconds, wave, waveCountdown, abilitySystem) {
        const ctx = this.renderer.ctx;
        const w   = this.renderer.canvas.width;
        const h   = this.renderer.canvas.height;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        // ── Health bar ────────────────────────────────────────────────────────
        const barX = 20, barY = 20, barW = 180, barH = 16;
        const hp   = Math.max(0, player.health / player.maxHealth);

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this._rr(ctx, barX - 2, barY - 2, barW + 4, barH + 4, 4); ctx.fill();
        ctx.fillStyle = 'rgba(80,20,20,0.7)';
        this._rr(ctx, barX, barY, barW, barH, 3); ctx.fill();
        if (hp > 0) {
            ctx.fillStyle = `rgb(${Math.round(220 - hp * 80)},${Math.round(hp * 180)},40)`;
            this._rr(ctx, barX, barY, barW * hp, barH, 3); ctx.fill();
        }
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('HP', barX, barY + barH + 5);
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.ceil(player.health)} / ${player.maxHealth}`, barX + barW, barY + barH + 5);

        // ── Ghost count ───────────────────────────────────────────────────────
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const gl = `GHOSTS  ${ghostCount}`;
        const glW = ctx.measureText(gl).width + 16;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this._rr(ctx, 18, 60, glW, 22, 4); ctx.fill();
        ctx.fillStyle = ghostCount > 0 ? 'rgba(200,200,255,0.9)' : 'rgba(120,220,120,0.9)';
        ctx.fillText(gl, 26, 65);

        // ── Wave ──────────────────────────────────────────────────────────────
        const wl = `WAVE  ${wave}`;
        const wlW = ctx.measureText(wl).width + 16;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this._rr(ctx, 18, 88, wlW, 22, 4); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,80,0.9)';
        ctx.fillText(wl, 26, 93);

        if (waveCountdown > 0) {
            ctx.font = '11px monospace';
            const cd = `next wave in ${Math.ceil(waveCountdown)}s`;
            const cdW = ctx.measureText(cd).width + 16;
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            this._rr(ctx, 18, 116, cdW, 20, 4); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText(cd, 26, 120);
        }

        // ── Survival time (top-right) ─────────────────────────────────────────
        const mins = String(Math.floor(survivalSeconds / 60)).padStart(2, '0');
        const secs = String(Math.floor(survivalSeconds % 60)).padStart(2, '0');
        const ts   = `${mins}:${secs}`;
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        const tsW = ctx.measureText(ts).width + 24;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this._rr(ctx, w - tsW - 10, 14, tsW, 30, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(ts, w - 22, 20);
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('SURVIVED', w - 22, 46);

        // ── Ability bar (bottom-centre) ───────────────────────────────────────
        if (abilitySystem) {
            const ab       = abilitySystem.ability;
            const ready    = abilitySystem.isReady;
            const frac     = abilitySystem.cooldownFraction; // 0=empty, 1=full
            const abBarW   = 200;
            const abBarH   = 10;
            const abX      = Math.floor(w / 2 - abBarW / 2);
            const abY      = h - 54;

            // Backdrop pill
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            this._rr(ctx, abX - 10, abY - 28, abBarW + 20, abBarH + 40, 8); ctx.fill();

            // Ability name + icon
            ctx.font = `bold 13px monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillStyle = ready ? ab.color : 'rgba(150,150,150,0.7)';
            ctx.fillText(`${ab.icon}  ${ab.name}`, w / 2, abY - 22);

            // Cooldown track
            ctx.fillStyle = 'rgba(60,60,60,0.8)';
            this._rr(ctx, abX, abY, abBarW, abBarH, 5); ctx.fill();

            // Filled portion
            if (frac > 0) {
                ctx.fillStyle = ready ? ab.color : 'rgba(180,180,180,0.6)';
                this._rr(ctx, abX, abY, abBarW * frac, abBarH, 5); ctx.fill();
            }

            // "READY" label or remaining seconds
            ctx.font = '11px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            if (ready) {
                ctx.fillStyle = ab.color;
                ctx.fillText('SPACE — READY', w / 2, abY + abBarH + 4);
            } else {
                const rem = (abilitySystem.cooldownRemaining / 1000).toFixed(1);
                ctx.fillStyle = 'rgba(180,180,180,0.6)';
                ctx.fillText(`${rem}s`, w / 2, abY + abBarH + 4);
            }

            // Invulnerability indicator
            if (player.invulnerable) {
                ctx.font = 'bold 12px monospace';
                ctx.fillStyle = 'rgba(100,255,140,0.9)';
                ctx.fillText('✦ INVULNERABLE ✦', w / 2, abY - 42);
            }
        }

        ctx.restore();
    }

    _rr(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x,     y + r);
        ctx.arcTo(x,     y,     x + r, y,         r);
        ctx.closePath();
    }
}

// ─── WaveManager ──────────────────────────────────────────────────────────────

const WAVE_INTERVAL    = 20000;
const BASE_GHOST_COUNT = 4;
const BASE_SPEED       = 2;
const BASE_DAMAGE      = 8;

class WaveManager {
    constructor() {
        this.wave          = 1;
        this.timeSinceWave = 0;
    }

    _params(wave) {
        const s = wave - 1;
        return {
            count:  BASE_GHOST_COUNT + s * 2,
            speed:  Math.min(BASE_SPEED  + s * 0.3, 5.5),
            damage: Math.min(BASE_DAMAGE + s * 2,   30)
        };
    }

    get countdown() { return Math.max(0, (WAVE_INTERVAL - this.timeSinceWave) / 1000); }

    update(deltaTime, gameState) {
        if (gameState.isGameOver) return;
        this.timeSinceWave += deltaTime;
        if (this.timeSinceWave >= WAVE_INTERVAL) {
            this.timeSinceWave -= WAVE_INTERVAL;
            this.wave++;
            this._spawnWave(gameState);
        }
    }

    _spawnWave(gameState) {
        const { count, speed, damage } = this._params(this.wave);
        const player = gameState.player;
        const cm     = gameState.chunkManager;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
            const dist  = 350 + Math.random() * 300;
            const pos   = cm.findWalkableNear(
                player.x + Math.cos(angle) * dist,
                player.y + Math.sin(angle) * dist
            );
            const ghost = new Ghost(pos.x, pos.y, { speed, health: 30, damage });
            ghost.setAI(new BasicAI({ detectionRange: 350 + (this.wave - 1) * 20, stopDistance: 22 }));
            gameState.ghosts.push(ghost);
        }
    }
}

// ─── InputHandler ─────────────────────────────────────────────────────────────

class InputHandler {
    constructor() {
        this.keys     = {};
        this._pressed = new Set(); // keys that fired this frame only
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (!this.keys[e.code]) this._pressed.add(e.code);
            this.keys[e.code] = true;
            // Prevent space from scrolling
            if (e.code === 'Space') e.preventDefault();
        });
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    isPressed(key)     { return !!this.keys[key]; }
    justPressed(code)  { return this._pressed.has(code); }
    flushPressed()     { this._pressed.clear(); }
}

// ─── Player ───────────────────────────────────────────────────────────────────

class Player {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.velocity  = { x: 0, y: 0 };
        this.speed     = 5;
        this.baseSpeed = 5;
        this.speedModifiers = [];
        this.radius    = 20;
        this.health    = 100;
        this.maxHealth = 100;
        this.invulnerable = false;
        this.angle = 0;
    }

    update(input, deltaTime, chunkManager) {
        this.velocity.x = 0;
        this.velocity.y = 0;

        if (input.isPressed('KeyW') || input.isPressed('ArrowUp'))    this.velocity.y -= 1;
        if (input.isPressed('KeyS') || input.isPressed('ArrowDown'))  this.velocity.y += 1;
        if (input.isPressed('KeyA') || input.isPressed('ArrowLeft'))  this.velocity.x -= 1;
        if (input.isPressed('KeyD') || input.isPressed('ArrowRight')) this.velocity.x += 1;

        const mag = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
        if (mag > 0) {
            this.velocity.x = (this.velocity.x / mag) * this.speed;
            this.velocity.y = (this.velocity.y / mag) * this.speed;
            this.angle = Math.atan2(this.velocity.y, this.velocity.x);
        }

        const dt = deltaTime / 16;
        const nextX = this.x + this.velocity.x * dt;
        const nextY = this.y + this.velocity.y * dt;
        const tm    = chunkManager ? chunkManager.getMovementModifier(nextX, nextY) : 1;
        const fx    = this.x + this.velocity.x * dt * tm;
        const fy    = this.y + this.velocity.y * dt * tm;

        if (chunkManager) {
            if (chunkManager.isWalkable(fx, this.y)) this.x = fx;
            if (chunkManager.isWalkable(this.x, fy)) this.y = fy;
        } else {
            this.x = fx; this.y = fy;
        }
    }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.camera = { x: 0, y: 0 };
        this._shake = { x: 0, y: 0, magnitude: 0, decay: 0.85 };
        this.resize();
    }

    resize() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }

    triggerShake(m = 8) { this._shake.magnitude = m; }

    _updateShake() {
        if (this._shake.magnitude > 0.1) {
            this._shake.x = (Math.random() * 2 - 1) * this._shake.magnitude;
            this._shake.y = (Math.random() * 2 - 1) * this._shake.magnitude;
            this._shake.magnitude *= this._shake.decay;
        } else { this._shake.magnitude = 0; this._shake.x = 0; this._shake.y = 0; }
    }

    clear() { this.ctx.fillStyle = '#111'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }

    setCamera(tx, ty) {
        this._updateShake();
        this.camera.x = tx - this.canvas.width  / 2 + this._shake.x;
        this.camera.y = ty - this.canvas.height / 2 + this._shake.y;
    }

    drawCircle(x, y, radius, color) {
        const sx = x - this.camera.x, sy = y - this.camera.y;
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.closePath();
    }

    drawDamageFlash(alpha) {
        if (alpha <= 0) return;
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = `rgba(220,30,30,${alpha})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    drawAbilityFlash(alpha, color) {
        if (alpha <= 0) return;
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = color.replace(')', `,${alpha * 0.35})`).replace('rgb(', 'rgba(');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    drawGameOver(wave, survivalSeconds) {
        const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 72px sans-serif';
        ctx.fillStyle = '#cc2222';
        ctx.fillText('GAME OVER', w / 2, h / 2 - 50);
        const mins = String(Math.floor(survivalSeconds / 60)).padStart(2, '0');
        const secs = String(Math.floor(survivalSeconds % 60)).padStart(2, '0');
        ctx.font = '26px monospace'; ctx.fillStyle = 'rgba(255,200,80,0.9)';
        ctx.fillText(`Reached Wave ${wave}`, w / 2, h / 2 + 10);
        ctx.font = '20px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`Survived ${mins}:${secs}  ·  Refresh to try again`, w / 2, h / 2 + 55);
        ctx.restore();
    }
}

// ─── GameState ────────────────────────────────────────────────────────────────

class GameState {
    constructor(player) {
        this.player       = player;
        this.ghosts       = [];
        this.lighting     = null;
        this.particles    = [];
        this.projectiles  = [];
        this.enemies      = [];
        this.chunkManager = null;
        this.timeScale    = 1;
        this.cameraShake  = false;
        this.ghostsVisible = false;
        this.activeEffects = [];
        this.damageFlashAlpha = 0;
        this.isGameOver   = false;
        this.survivalTime = 0;
    }

    triggerDamageFlash() { this.damageFlashAlpha = 0.55; }

    applyEffect({ type, multiplier, duration }) {
        const effect = { type, multiplier, duration, startedAt: Date.now() };
        this.activeEffects.push(effect);
        switch (type) {
            case 'speed':
                this.player.speedModifiers.push(multiplier);
                this._recalcSpeed();
                break;
            case 'lightRadius':
                if (this.lighting) this.lighting.lightRadius *= multiplier;
                break;
        }
        setTimeout(() => this._revertEffect(effect), duration);
    }

    _recalcSpeed() {
        this.player.speed = this.player.baseSpeed *
            this.player.speedModifiers.reduce((a, b) => a * b, 1);
    }

    _revertEffect(effect) {
        switch (effect.type) {
            case 'speed': {
                const idx = this.player.speedModifiers.indexOf(effect.multiplier);
                if (idx !== -1) this.player.speedModifiers.splice(idx, 1);
                this._recalcSpeed();
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
        this.survivalTime += deltaTime;
        const now = Date.now();
        const p   = this.player;

        if (this.damageFlashAlpha > 0)
            this.damageFlashAlpha = Math.max(0, this.damageFlashAlpha - (deltaTime / 16) * 0.06);

        this.particles  = this.particles.filter(pt => (now - pt.created) < pt.duration);
        this.projectiles = this.projectiles.filter(pr => {
            const dt = deltaTime / 16;
            pr.x += pr.vx * dt; pr.y += pr.vy * dt;
            return (now - pr.created) < 2000;
        });

        this.ghosts = this.ghosts.filter(g => g.health > 0);
        for (const ghost of this.ghosts) {
            ghost.update(p, this.chunkManager, deltaTime);
            if (!p.invulnerable) {
                const dmg = ghost.attack(p);
                if (dmg > 0) {
                    p.health = Math.max(0, p.health - dmg);
                    this.triggerDamageFlash();
                    renderer.triggerShake(7);
                }
            }
        }

        if (p.health <= 0) this.isGameOver = true;
        if (this.lighting) this.lighting.update(deltaTime);
        if (this.chunkManager) this.chunkManager.unloadDistant(p.x, p.y);
    }
}

// ─── Ghost spawner (wave 1) ───────────────────────────────────────────────────

function spawnGhosts(count, px, py, cm) {
    const ghosts = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const dist  = 300 + Math.random() * 300;
        const pos   = cm.findWalkableNear(px + Math.cos(angle) * dist, py + Math.sin(angle) * dist);
        const ghost = new Ghost(pos.x, pos.y, { speed: BASE_SPEED + Math.random() * 0.5, health: 30, damage: BASE_DAMAGE });
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
        this.input    = new InputHandler();

        const cm   = new ChunkManager(32, 50);
        const mid  = Math.floor(cm.chunkSize / 2);
        const sx   = mid * cm.tileSize + cm.tileSize / 2;
        const sy   = mid * cm.tileSize + cm.tileSize / 2;

        const player = new Player(sx, sy);
        this.gameState = new GameState(player);
        this.gameState.chunkManager = cm;
        this.gameState.lighting = new Lighting(this.renderer, {
            lightRadius: 200, darknessColor: 'rgba(0,0,0,0.85)', flickerIntensity: 0.05
        });

        cm.getSurroundingChunks(sx, sy, 2);
        this.gameState.ghosts = spawnGhosts(BASE_GHOST_COUNT, sx, sy, cm);

        this.chunkRenderer = new ChunkRenderer(this.renderer);
        this.hud           = new HUD(this.renderer);
        this.waveManager   = new WaveManager();

        // Pick a random ability for this run
        const picked = ABILITY_ROSTER[Math.floor(Math.random() * ABILITY_ROSTER.length)];
        this.abilitySystem = new AbilitySystem(picked);

        this.lastTime = null;
        window.addEventListener('resize', () => this.renderer.resize());
        requestAnimationFrame((ts) => this.loop(ts));
    }

    update(deltaTime) {
        if (this.gameState.isGameOver) {
            this.input.flushPressed();
            return;
        }

        const scaledDelta = deltaTime * this.gameState.timeScale;

        // Ability input (Space — just-pressed, not held)
        if (this.input.justPressed('Space')) {
            const activated = this.abilitySystem.tryActivate(this.gameState.player, this.gameState);
            if (activated) this.renderer.triggerShake(4);
        }
        this.input.flushPressed();

        this.gameState.player.update(this.input, scaledDelta, this.gameState.chunkManager);
        this.gameState.update(scaledDelta, this.renderer);
        this.abilitySystem.update(scaledDelta);
        this.waveManager.update(scaledDelta, this.gameState);
    }

    render() {
        const gs  = this.gameState;
        const as  = this.abilitySystem;
        const { player, ghosts, particles, projectiles, chunkManager,
                lighting, damageFlashAlpha, isGameOver, survivalTime } = gs;
        const { wave, countdown } = this.waveManager;

        this.renderer.clear();
        this.renderer.setCamera(player.x, player.y);

        // 1. Terrain
        if (chunkManager) {
            const chunks = chunkManager.getSurroundingChunks(player.x, player.y, 1);
            this.chunkRenderer.render(chunks, chunkManager.chunkSize, chunkManager.tileSize);
        }

        // 2. Particles (world-space, including ability bursts)
        for (const p of particles) {
            const age    = (Date.now() - p.created) / p.duration;
            const alpha  = 1 - age;
            const radius = (p.radius || 30) * (0.2 + age * 0.8);
            this.renderer.drawCircle(
                p.x + (p.vx || 0) * age * 20,
                p.y + (p.vy || 0) * age * 20,
                radius * 0.15,
                p.color || 'rgba(255,200,100,0.5)'
            );
        }

        // 3. Projectiles
        projectiles.forEach(p =>
            this.renderer.drawCircle(p.x, p.y, 5, 'rgba(255,255,100,0.9)'));

        // 4. Ghosts
        ghosts.forEach(g => { if (g.render) g.render(this.renderer); });

        // 5. Player (glow tint when invulnerable)
        const playerColor = player.invulnerable ? '#88ffaa' : '#e94560';
        this.renderer.drawCircle(player.x, player.y, player.radius, playerColor);
        if (player.invulnerable) {
            this.renderer.drawCircle(player.x, player.y, player.radius + 6,
                'rgba(100,255,140,0.25)');
        }

        // 6. Lighting / fog of war
        if (lighting) lighting.render(player);

        // 7. Ability flash (screen-space glow on activation)
        if (as.flashAlpha > 0)
            this.renderer.drawAbilityFlash(as.flashAlpha, as.ability.color);

        // 8. Damage flash
        this.renderer.drawDamageFlash(damageFlashAlpha);

        // 9. HUD
        if (!isGameOver)
            this.hud.render(player, ghosts.length, survivalTime / 1000, wave, countdown, as);

        // 10. Game over
        if (isGameOver)
            this.renderer.drawGameOver(wave, survivalTime / 1000);
    }

    loop(timestamp) {
        if (this.lastTime === null) this.lastTime = timestamp;
        const dt = Math.min(timestamp - this.lastTime, 100);
        this.lastTime = timestamp;
        this.update(dt);
        this.render();
        requestAnimationFrame((ts) => this.loop(ts));
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });