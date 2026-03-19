import Ghost from './ghost.js';
import { ARCHETYPES } from './ghost.js';
import BasicAI from './ai_basic.js';
import Lighting from './lighting.js';

// ─── CorruptionSystem ─────────────────────────────────────────────────────────
// Sparse map of tileKey → corruption [0..1]. Never modifies chunk terrain data.

const CORRUPTION_TICK_MS      = 800;   // how often tiles mutate
const CORRUPTION_SPREAD_RATE  = 0.04;  // per tick base spread
const CORRUPTION_DAMAGE_RATE  = 4;     // HP/s when standing on fully corrupted tile
const CORRUPTION_SLOW_FACTOR  = 0.45;  // movement multiplier on corrupted tile
const CORRUPTION_THRESHOLD    = 0.55;  // above this → visual + gameplay effects
const SAFE_RADIUS             = 140;   // px around player that decays corruption
const SAFE_RADIUS_SQ          = SAFE_RADIUS * SAFE_RADIUS;
const CORRUPTION_DECAY_RATE   = 0.06;  // safe-zone decay per tick
const MAX_ACTIVE_TILES        = 800;   // cap to keep memory bounded
const TILES_UPDATED_PER_TICK  = 60;    // tiles processed per mutation tick

class CorruptionSystem {
    constructor(tileSize) {
        this.tileSize        = tileSize;
        this.tiles           = new Map();   // "tx,ty" → level [0..1]
        this.globalLevel     = 0;           // 0..1, drives spread intensity
        this._accumulator    = 0;
        this._flickerPhase   = 0;
    }

    _key(tx, ty) { return `${tx},${ty}`; }

    _worldToTile(wx, wy) {
        return {
            tx: Math.floor(wx / this.tileSize),
            ty: Math.floor(wy / this.tileSize)
        };
    }

    getLevel(wx, wy) {
        const { tx, ty } = this._worldToTile(wx, wy);
        return this.tiles.get(this._key(tx, ty)) || 0;
    }

    // Seed initial corruption around a world position
    seed(wx, wy, radius = 5, level = 0.3) {
        const { tx, ty } = this._worldToTile(wx, wy);
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy <= radius * radius) {
                    const key = this._key(tx + dx, ty + dy);
                    const existing = this.tiles.get(key) || 0;
                    this.tiles.set(key, Math.min(1, existing + level * Math.random()));
                }
            }
        }
    }

    update(deltaTime, player, wave, chunkManager) {
        this._flickerPhase += deltaTime * 0.006;
        this._accumulator  += deltaTime;

        // Global level rises with time and wave number
        const riseRate = 0.000015 + wave * 0.000008;
        this.globalLevel = Math.min(1, this.globalLevel + deltaTime * riseRate);

        if (this._accumulator < CORRUPTION_TICK_MS) return;
        this._accumulator -= CORRUPTION_TICK_MS;

        const spreadRate = CORRUPTION_SPREAD_RATE * (0.5 + this.globalLevel);
        const px = player.x, py = player.y;

        // ── Spread existing corruption to neighbours ───────────────────────────
        const keys = [...this.tiles.keys()];

        // Only process a random subset per tick for performance
        const toProcess = keys.length > TILES_UPDATED_PER_TICK
            ? keys.sort(() => Math.random() - 0.5).slice(0, TILES_UPDATED_PER_TICK)
            : keys;

        const pending = new Map();

        for (const key of toProcess) {
            const level = this.tiles.get(key);
            if (level === undefined) continue;
            const [tx, ty] = key.split(',').map(Number);

            // Decay inside player safe zone
            const cx = (tx + 0.5) * this.tileSize;
            const cy = (ty + 0.5) * this.tileSize;
            const dxp = cx - px, dyp = cy - py;
            const distSq = dxp * dxp + dyp * dyp;

            if (distSq < SAFE_RADIUS_SQ) {
                const newLevel = Math.max(0, level - CORRUPTION_DECAY_RATE);
                if (newLevel === 0) pending.set(key, null); // mark for deletion
                else pending.set(key, newLevel);
                continue;
            }

            // Skip non-walkable (cliffs/rocks don't corrupt)
            const wx = (tx + 0.5) * this.tileSize;
            const wy = (ty + 0.5) * this.tileSize;
            if (!chunkManager.isWalkable(wx, wy)) continue;

            // Spread to cardinal neighbours if level is significant
            if (level > 0.15) {
                const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                for (const [ddx, ddy] of dirs) {
                    const nk  = this._key(tx + ddx, ty + ddy);
                    const nwx = (tx + ddx + 0.5) * this.tileSize;
                    const nwy = (ty + ddy + 0.5) * this.tileSize;
                    if (!chunkManager.isWalkable(nwx, nwy)) continue;
                    const existing = this.tiles.get(nk) || pending.get(nk) || 0;
                    const bump = level * spreadRate * (0.5 + Math.random() * 0.5);
                    pending.set(nk, Math.min(1, (existing || 0) + bump));
                }
            }
        }

        // ── Seed new corruption away from player driven by globalLevel ─────────
        if (this.globalLevel > 0.1 && Math.random() < this.globalLevel * 0.4) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = SAFE_RADIUS + 100 + Math.random() * 400;
            const sx    = px + Math.cos(angle) * dist;
            const sy    = py + Math.sin(angle) * dist;
            if (chunkManager.isWalkable(sx, sy)) {
                const { tx, ty } = this._worldToTile(sx, sy);
                const key = this._key(tx, ty);
                const existing = this.tiles.get(key) || 0;
                pending.set(key, Math.min(1, existing + 0.08 + this.globalLevel * 0.06));
            }
        }

        // Apply pending updates
        for (const [k, v] of pending) {
            if (v === null || v === 0) this.tiles.delete(k);
            else this.tiles.set(k, v);
        }

        // Prune if too many tiles tracked
        if (this.tiles.size > MAX_ACTIVE_TILES) {
            // Remove lowest-level tiles first
            const sorted = [...this.tiles.entries()].sort((a, b) => a[1] - b[1]);
            const toDelete = sorted.slice(0, this.tiles.size - MAX_ACTIVE_TILES);
            for (const [k] of toDelete) this.tiles.delete(k);
        }
    }

    // Returns movement modifier overlay for a world position (stacks with terrain)
    getMovementOverlay(wx, wy) {
        const level = this.getLevel(wx, wy);
        if (level < CORRUPTION_THRESHOLD) return 1;
        const factor = (level - CORRUPTION_THRESHOLD) / (1 - CORRUPTION_THRESHOLD);
        return 1 - factor * (1 - CORRUPTION_SLOW_FACTOR);
    }

    // Returns damage/s to apply to player standing on this tile
    getDamageRate(wx, wy) {
        const level = this.getLevel(wx, wy);
        if (level < CORRUPTION_THRESHOLD + 0.2) return 0;
        const factor = (level - CORRUPTION_THRESHOLD - 0.2) / 0.3;
        return Math.min(1, factor) * CORRUPTION_DAMAGE_RATE;
    }

    render(renderer, chunkManager) {
        if (this.tiles.size === 0) return;

        const ctx    = renderer.ctx;
        const cam    = renderer.camera;
        const ts     = this.tileSize;
        const flicker = 0.7 + Math.sin(this._flickerPhase) * 0.15
                            + Math.sin(this._flickerPhase * 2.7) * 0.07;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (const [key, level] of this.tiles) {
            if (level < 0.08) continue;
            const [tx, ty] = key.split(',').map(Number);
            const sx = tx * ts - cam.x;
            const sy = ty * ts - cam.y;

            // Cull off-screen
            if (sx + ts < 0 || sx > renderer.canvas.width ||
                sy + ts < 0 || sy > renderer.canvas.height) continue;

            // Colour: low → dark purple tint, high → deep crimson/black
            const t       = Math.min(1, level);
            const alpha   = Math.min(0.72, t * 0.8) * flicker;
            const rComp   = Math.round(80  + t * 60);
            const gComp   = Math.round(0   + t * 0);
            const bComp   = Math.round(120 - t * 80);

            ctx.fillStyle = `rgba(${rComp},${gComp},${bComp},${alpha})`;
            ctx.fillRect(sx, sy, ts, ts);

            // High-corruption: add dark veins
            if (level > CORRUPTION_THRESHOLD) {
                const veinAlpha = (level - CORRUPTION_THRESHOLD) * 0.5 * flicker;
                ctx.strokeStyle = `rgba(40,0,20,${veinAlpha})`;
                ctx.lineWidth   = 1;
                ctx.strokeRect(sx + 2, sy + 2, ts - 4, ts - 4);
            }
        }

        ctx.restore();
    }
}

// ─── ChunkManager ─────────────────────────────────────────────────────────────

class ChunkManager {
    constructor(chunkSize = 32, tileSize = 50) {
        this.chunkSize = chunkSize;
        this.tileSize  = tileSize;
        this.loadedChunks = new Map();
        this.worldSeed = Math.floor(Math.random() * 2 ** 31);
    }

    _chunkRng(chunkX, chunkY) {
        let h = this.worldSeed ^ (chunkX * 374761393) ^ (chunkY * 1057926937);
        h = Math.imul(h ^ (h >>> 13), 1540483477); h ^= h >>> 15;
        return () => { h = Math.imul(h ^ (h >>> 13), 1540483477); h ^= h >>> 15; return (h >>> 0) / 0xffffffff; };
    }

    _generateChunk(chunkX, chunkY) {
        const rng = this._chunkRng(chunkX, chunkY);
        const size = this.chunkSize, terrain = [];
        for (let y = 0; y < size; y++) {
            const row = [];
            for (let x = 0; x < size; x++) {
                const b = x===0||y===0||x===size-1||y===size-1;
                if (b) row.push('cliff');
                else if (rng() < 0.08) row.push('rock');
                else if (rng() < 0.12) row.push('dune');
                else row.push('plain');
            }
            terrain.push(row);
        }
        if (chunkX===0 && chunkY===0) {
            const mid = Math.floor(size/2);
            for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) terrain[mid+dy][mid+dx]='plain';
        }
        return { x:chunkX, y:chunkY, terrain, seed:this.worldSeed };
    }

    getChunk(cx, cy) {
        const key=`${cx},${cy}`;
        if (!this.loadedChunks.has(key)) this.loadedChunks.set(key, this._generateChunk(cx,cy));
        return this.loadedChunks.get(key);
    }

    _getTileAt(wx, wy) {
        const cp=this.chunkSize*this.tileSize;
        const cx=Math.floor(wx/cp), cy=Math.floor(wy/cp);
        const chunk=this.getChunk(cx,cy);
        const lx=Math.floor((wx-cx*cp)/this.tileSize);
        const ly=Math.floor((wy-cy*cp)/this.tileSize);
        if (ly<0||ly>=this.chunkSize||lx<0||lx>=this.chunkSize) return 'cliff';
        return chunk.terrain[ly][lx];
    }

    isWalkable(wx, wy) { const t=this._getTileAt(wx,wy); return t!=='cliff'&&t!=='rock'; }

    getMovementModifier(wx, wy) {
        switch (this._getTileAt(wx,wy)) {
            case 'plain': return 1.0; case 'dune': return 0.6;
            case 'rock':  return 0.3; case 'cliff': return 0.0; default: return 1.0;
        }
    }

    findWalkableNear(wx, wy, sr=300) {
        const step=this.tileSize;
        for (let r=step;r<=sr;r+=step)
            for (let a=0;a<Math.PI*2;a+=Math.PI/8) {
                const tx=wx+Math.cos(a)*r, ty=wy+Math.sin(a)*r;
                if (this.isWalkable(tx,ty)) return {x:tx,y:ty};
            }
        return {x:wx,y:wy};
    }

    getSurroundingChunks(wx, wy, r=1) {
        const cp=this.chunkSize*this.tileSize;
        const cx=Math.floor(wx/cp), cy=Math.floor(wy/cp);
        const chunks=[];
        for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) chunks.push(this.getChunk(cx+dx,cy+dy));
        return chunks;
    }

    unloadDistant(wx, wy, md=3) {
        const cp=this.chunkSize*this.tileSize;
        const cx=Math.floor(wx/cp), cy=Math.floor(wy/cp);
        for (const key of this.loadedChunks.keys()) {
            const [kx,ky]=key.split(',').map(Number);
            if (Math.max(Math.abs(kx-cx),Math.abs(ky-cy))>md) this.loadedChunks.delete(key);
        }
    }
}

// ─── ChunkRenderer ────────────────────────────────────────────────────────────

const TERRAIN_COLORS = {plain:'#1e2a3a',dune:'#3b2f1e',rock:'#2e2e3e',cliff:'#4a4a5e'};

class ChunkRenderer {
    constructor(renderer) { this.renderer=renderer; }
    render(chunks, chunkSize, tileSize) {
        const ctx=this.renderer.ctx, cam=this.renderer.camera, cp=chunkSize*tileSize;
        for (const chunk of chunks) {
            const cwx=chunk.x*cp, cwy=chunk.y*cp;
            for (let ty=0;ty<chunkSize;ty++) for (let tx=0;tx<chunkSize;tx++) {
                const tile=chunk.terrain[ty][tx];
                const sx=cwx+tx*tileSize-cam.x, sy=cwy+ty*tileSize-cam.y;
                if (sx+tileSize<0||sx>this.renderer.canvas.width||sy+tileSize<0||sy>this.renderer.canvas.height) continue;
                ctx.fillStyle=TERRAIN_COLORS[tile]||TERRAIN_COLORS.plain;
                ctx.fillRect(sx,sy,tileSize,tileSize);
                ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
                ctx.strokeRect(sx,sy,tileSize,tileSize);
            }
        }
    }
}

// ─── ObjectiveSystem ──────────────────────────────────────────────────────────

const RELIC_RADIUS=18, EXTRACTION_RADIUS=40, EXTRACTION_DURATION=3000;
const RELICS_PER_WAVE=3, MIN_RELIC_DIST=300, MAX_RELIC_DIST=700;

class Relic {
    constructor(x,y,id){this.x=x;this.y=y;this.id=id;this.collected=false;this._pulse=0;}
    update(dt){this._pulse+=dt*0.004;}
    render(renderer) {
        if(this.collected) return;
        const sx=this.x-renderer.camera.x, sy=this.y-renderer.camera.y;
        const ctx=renderer.ctx, bob=Math.sin(this._pulse)*4, glow=0.5+Math.sin(this._pulse*1.3)*0.3;
        ctx.save();
        ctx.shadowColor=`rgba(255,200,60,${glow})`; ctx.shadowBlur=20;
        ctx.beginPath(); ctx.arc(sx,sy+bob,RELIC_RADIUS+4,0,Math.PI*2);
        ctx.strokeStyle=`rgba(255,200,60,${glow*0.6})`; ctx.lineWidth=2; ctx.stroke(); ctx.closePath();
        ctx.beginPath(); ctx.arc(sx,sy+bob,RELIC_RADIUS,0,Math.PI*2);
        ctx.fillStyle='rgba(255,180,40,0.85)'; ctx.fill(); ctx.closePath();
        ctx.font='14px sans-serif'; ctx.fillStyle='rgba(255,255,200,0.95)';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✦',sx,sy+bob);
        ctx.shadowBlur=0; ctx.restore();
    }
}

class ExtractionZone {
    constructor(x,y){this.x=x;this.y=y;this.progress=0;this._pulse=0;this.complete=false;}
    update(inside,dt) {
        this._pulse+=dt*0.003;
        if(inside&&!this.complete) { this.progress=Math.min(1,this.progress+dt/EXTRACTION_DURATION); if(this.progress>=1) this.complete=true; }
        else if(!inside) this.progress=Math.max(0,this.progress-dt/(EXTRACTION_DURATION*2));
    }
    containsPlayer(p){const dx=p.x-this.x,dy=p.y-this.y;return Math.sqrt(dx*dx+dy*dy)<EXTRACTION_RADIUS;}
    render(renderer) {
        const sx=this.x-renderer.camera.x,sy=this.y-renderer.camera.y,ctx=renderer.ctx;
        const pulse=0.6+Math.sin(this._pulse)*0.2;
        ctx.save();
        ctx.beginPath(); ctx.arc(sx,sy,EXTRACTION_RADIUS,0,Math.PI*2);
        ctx.strokeStyle=`rgba(80,255,160,${pulse*0.7})`; ctx.lineWidth=3; ctx.stroke();
        ctx.fillStyle='rgba(80,255,160,0.08)'; ctx.fill(); ctx.closePath();
        if(this.progress>0){
            ctx.beginPath(); ctx.arc(sx,sy,EXTRACTION_RADIUS-6,-Math.PI/2,-Math.PI/2+this.progress*Math.PI*2);
            ctx.strokeStyle='rgba(80,255,160,0.9)'; ctx.lineWidth=5; ctx.stroke(); ctx.closePath();
        }
        ctx.font='bold 12px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle=`rgba(80,255,160,${pulse})`; ctx.shadowColor='rgba(80,255,160,0.8)'; ctx.shadowBlur=10;
        ctx.fillText('EXTRACT',sx,sy-6); ctx.font='10px monospace';
        ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText(`${Math.round(this.progress*100)}%`,sx,sy+8);
        ctx.shadowBlur=0; ctx.restore();
    }
}

class ObjectiveSystem {
    constructor(){this.relics=[];this.collectedCount=0;this.requiredCount=RELICS_PER_WAVE;this.extractionZone=null;this.waveComplete=false;this._relicIdCounter=0;this._collectFlash=0;}
    spawnRelics(px,py,cm,count=RELICS_PER_WAVE) {
        this.relics=[];this.collectedCount=0;this.extractionZone=null;this.waveComplete=false;this.requiredCount=count;
        for(let i=0;i<count;i++){
            const angle=(i/count)*Math.PI*2+Math.random()*0.8;
            const dist=MIN_RELIC_DIST+Math.random()*(MAX_RELIC_DIST-MIN_RELIC_DIST);
            const pos=cm.findWalkableNear(px+Math.cos(angle)*dist,py+Math.sin(angle)*dist,400);
            this.relics.push(new Relic(pos.x,pos.y,this._relicIdCounter++));
        }
    }
    _spawnExtraction(px,py,cm){
        const angle=Math.random()*Math.PI*2, dist=350+Math.random()*200;
        const pos=cm.findWalkableNear(px+Math.cos(angle)*dist,py+Math.sin(angle)*dist,500);
        this.extractionZone=new ExtractionZone(pos.x,pos.y);
    }
    update(player,cm,dt,gs){
        for(const relic of this.relics){
            if(relic.collected) continue;
            relic.update(dt);
            const dx=player.x-relic.x,dy=player.y-relic.y;
            if(Math.sqrt(dx*dx+dy*dy)<RELIC_RADIUS+player.radius){
                relic.collected=true; this.collectedCount++; this._collectFlash=1;
                const now=Date.now();
                for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2;gs.particles.push({x:relic.x,y:relic.y,vx:Math.cos(a)*2,vy:Math.sin(a)*2,radius:50,color:'rgba(255,200,60,0.8)',duration:600,created:now});}
                if(this.collectedCount>=this.requiredCount&&!this.extractionZone) this._spawnExtraction(player.x,player.y,cm);
            }
        }
        if(this._collectFlash>0) this._collectFlash=Math.max(0,this._collectFlash-dt/400);
        if(this.extractionZone&&!this.waveComplete){
            const inside=this.extractionZone.containsPlayer(player);
            this.extractionZone.update(inside,dt);
            if(this.extractionZone.complete){this.waveComplete=true;this._onWaveComplete(player,gs);}
        }
    }
    _onWaveComplete(player,gs){
        player.health=Math.min(player.maxHealth,player.health+30);
        gs.applyEffect({type:'speed',multiplier:1.4,duration:8000});
        const chasers=gs.ghosts.filter(g=>g.type==='chaser');
        const remove=Math.ceil(chasers.length/2);
        for(let i=0;i<remove;i++){const idx=gs.ghosts.indexOf(chasers[i]);if(idx!==-1)gs.ghosts.splice(idx,1);}
        const now=Date.now();
        for(let i=0;i<24;i++){const a=(i/24)*Math.PI*2;gs.particles.push({x:player.x,y:player.y,vx:Math.cos(a)*4,vy:Math.sin(a)*4,radius:80,color:'rgba(80,255,160,0.8)',duration:1000,created:now});}
    }
    renderWorld(r){for(const rel of this.relics)if(!rel.collected)rel.render(r);if(this.extractionZone)this.extractionZone.render(r);}
    renderScreenFlash(renderer){
        if(this._collectFlash<=0)return;
        const ctx=renderer.ctx;ctx.save();ctx.globalCompositeOperation='source-over';
        ctx.fillStyle=`rgba(255,200,60,${this._collectFlash*0.25})`;ctx.fillRect(0,0,renderer.canvas.width,renderer.canvas.height);ctx.restore();
    }
}

// ─── AbilitySystem ────────────────────────────────────────────────────────────

const ABILITY_ROSTER=[
    {name:'Gandiva Dash',cooldown:5000,color:'#44aaff',icon:'⚡',activate(p,gs){gs.applyEffect({type:'speed',multiplier:4,duration:300});_burst(p,gs,8,'rgba(100,180,255,0.7)',60);}},
    {name:'Divine Guidance',cooldown:8000,color:'#ffdd66',icon:'✦',activate(p,gs){gs.applyEffect({type:'lightRadius',multiplier:2.5,duration:3000});_burst(p,gs,12,'rgba(255,220,80,0.7)',100);}},
    {name:'Truth Aura',cooldown:10000,color:'#88ffaa',icon:'🛡',activate(p,gs){p.invulnerable=true;_burst(p,gs,10,'rgba(100,255,140,0.7)',80);setTimeout(()=>{p.invulnerable=false;},2000);}},
    {name:'Vasavi Shakti',cooldown:15000,color:'#ff8844',icon:'🔥',activate(p,gs){gs.applyEffect({type:'lightRadius',multiplier:1.5,duration:4000});gs.applyEffect({type:'speed',multiplier:1.3,duration:4000});_burst(p,gs,16,'rgba(255,140,60,0.8)',120);}},
    {name:'Brahmastra',cooldown:20000,color:'#cc44ff',icon:'★',activate(p,gs){gs.applyEffect({type:'lightRadius',multiplier:3,duration:2000});_burst(p,gs,20,'rgba(200,80,255,0.8)',150);}}
];
function _burst(player,gs,count,color,radius){const now=Date.now();for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2;gs.particles.push({x:player.x+Math.cos(a)*10,y:player.y+Math.sin(a)*10,vx:Math.cos(a)*3,vy:Math.sin(a)*3,radius,color,duration:500,created:now});}}
class AbilitySystem{
    constructor(ab){this.ability=ab;this.lastUsed=-Infinity;this.flashAlpha=0;}
    get cooldownRemaining(){return Math.max(0,this.ability.cooldown-(Date.now()-this.lastUsed));}
    get cooldownFraction(){return 1-this.cooldownRemaining/this.ability.cooldown;}
    get isReady(){return this.cooldownRemaining===0;}
    tryActivate(p,gs){if(!this.isReady)return false;this.lastUsed=Date.now();this.flashAlpha=0.4;this.ability.activate(p,gs);return true;}
    update(dt){if(this.flashAlpha>0)this.flashAlpha=Math.max(0,this.flashAlpha-(dt/16)*0.05);}
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

class HUD {
    constructor(r){this.renderer=r;}
    render(player,ghosts,survSecs,wave,countdown,as,obj,corruption){
        const ctx=this.renderer.ctx,w=this.renderer.canvas.width,h=this.renderer.canvas.height;
        ctx.save(); ctx.globalCompositeOperation='source-over';
        // Health bar
        const bx=20,by=20,bw=180,bh=16,hp=Math.max(0,player.health/player.maxHealth);
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,bx-2,by-2,bw+4,bh+4,4);ctx.fill();
        ctx.fillStyle='rgba(80,20,20,0.7)';this._rr(ctx,bx,by,bw,bh,3);ctx.fill();
        if(hp>0){ctx.fillStyle=`rgb(${Math.round(220-hp*80)},${Math.round(hp*180)},40)`;this._rr(ctx,bx,by,bw*hp,bh,3);ctx.fill();}
        ctx.font='bold 12px monospace';ctx.fillStyle='rgba(255,255,255,0.9)';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText('HP',bx,by+bh+5);ctx.textAlign='right';ctx.fillText(`${Math.ceil(player.health)} / ${player.maxHealth}`,bx+bw,by+bh+5);
        // Enemy types
        const counts={};for(const g of ghosts)counts[g.type]=(counts[g.type]||0)+1;
        const ac={chaser:'rgba(180,200,255,0.9)',tank:'rgba(160,120,240,0.9)',assassin:'rgba(255,120,120,0.9)',orbiter:'rgba(80,220,180,0.9)'};
        const ai={chaser:'👻',tank:'🛡',assassin:'⚔',orbiter:'🌀'};
        let labelY=60;ctx.font='bold 11px monospace';ctx.textAlign='left';ctx.textBaseline='top';
        for(const [type,count] of Object.entries(counts)){if(!count)continue;const label=`${ai[type]} ${ARCHETYPES[type].label}  ${count}`;const lw=ctx.measureText(label).width+16;ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,labelY,lw,20,4);ctx.fill();ctx.fillStyle=ac[type];ctx.fillText(label,26,labelY+4);labelY+=24;}
        // Wave
        ctx.font='bold 12px monospace';const wl=`WAVE  ${wave}`,wlW=ctx.measureText(wl).width+16;
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,labelY+4,wlW,22,4);ctx.fill();ctx.fillStyle='rgba(255,200,80,0.9)';ctx.fillText(wl,26,labelY+8);
        if(countdown>0){ctx.font='11px monospace';const cd=`next wave in ${Math.ceil(countdown)}s`,cdW=ctx.measureText(cd).width+16;ctx.fillStyle='rgba(0,0,0,0.4)';this._rr(ctx,18,labelY+30,cdW,20,4);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.45)';ctx.fillText(cd,26,labelY+34);}
        // Corruption meter
        const corrY=labelY+58, corrW=180;
        ctx.font='bold 11px monospace';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,corrY,corrW+4,38,6);ctx.fill();
        ctx.fillStyle='rgba(200,100,200,0.8)';ctx.fillText('☠ KALYUG',26,corrY+4);
        ctx.fillStyle='rgba(40,0,30,0.8)';this._rr(ctx,26,corrY+18,corrW-16,10,4);ctx.fill();
        const cLvl=corruption.globalLevel;
        const cR=Math.round(80+cLvl*175),cG=0,cB=Math.round(120-cLvl*120);
        ctx.fillStyle=`rgba(${cR},${cG},${cB},0.9)`;
        if(cLvl>0)this._rr(ctx,26,corrY+18,(corrW-16)*cLvl,10,4);ctx.fill();
        // Objective
        const px=w-220,objY=70;
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,px,objY,200,obj.waveComplete?80:100,8);ctx.fill();
        ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='rgba(255,255,255,0.7)';ctx.fillText('OBJECTIVE',px+12,objY+10);
        if(obj.waveComplete){ctx.font='bold 13px monospace';ctx.fillStyle='rgba(80,255,160,0.95)';ctx.fillText('✔ Wave Complete!',px+12,objY+32);ctx.font='11px monospace';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText('+30 HP  ·  Speed Buff',px+12,objY+54);}
        else{const rl=obj.requiredCount-obj.collectedCount;ctx.font='12px monospace';ctx.fillStyle=rl===0?'rgba(80,255,160,0.9)':'rgba(255,200,60,0.9)';ctx.fillText(`✦ Relics: ${obj.collectedCount} / ${obj.requiredCount}`,px+12,objY+32);const rw=176,rh=8,rx=px+12,ry=objY+52;ctx.fillStyle='rgba(60,40,0,0.8)';this._rr(ctx,rx,ry,rw,rh,4);ctx.fill();if(obj.collectedCount>0){ctx.fillStyle='rgba(255,200,60,0.9)';this._rr(ctx,rx,ry,rw*(obj.collectedCount/obj.requiredCount),rh,4);ctx.fill();}ctx.font='11px monospace';if(obj.extractionZone){ctx.fillStyle='rgba(80,255,160,0.9)';ctx.fillText('▶ Reach extraction zone!',px+12,objY+72);}else{ctx.fillStyle='rgba(255,255,255,0.35)';ctx.fillText('Collect all relics to extract',px+12,objY+72);}}
        // Survival time
        const mins=String(Math.floor(survSecs/60)).padStart(2,'0'),secs=String(Math.floor(survSecs%60)).padStart(2,'0'),ts=`${mins}:${secs}`;
        ctx.font='bold 20px monospace';ctx.textAlign='right';ctx.textBaseline='top';
        const tsW=ctx.measureText(ts).width+24;ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,w-tsW-10,14,tsW,30,6);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fillText(ts,w-22,20);ctx.font='10px monospace';ctx.fillStyle='rgba(255,255,255,0.4)';ctx.fillText('SURVIVED',w-22,46);
        // Ability bar
        if(as){const ab=as.ability,ready=as.isReady,frac=as.cooldownFraction,abW=200,abH=10,abX=Math.floor(w/2-abW/2),abY=h-54;ctx.fillStyle='rgba(0,0,0,0.55)';this._rr(ctx,abX-10,abY-28,abW+20,abH+40,8);ctx.fill();ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=ready?ab.color:'rgba(150,150,150,0.7)';ctx.fillText(`${ab.icon}  ${ab.name}`,w/2,abY-22);ctx.fillStyle='rgba(60,60,60,0.8)';this._rr(ctx,abX,abY,abW,abH,5);ctx.fill();if(frac>0){ctx.fillStyle=ready?ab.color:'rgba(180,180,180,0.6)';this._rr(ctx,abX,abY,abW*frac,abH,5);ctx.fill();}ctx.font='11px monospace';ctx.textAlign='center';ctx.textBaseline='top';if(ready){ctx.fillStyle=ab.color;ctx.fillText('SPACE — READY',w/2,abY+abH+4);}else{ctx.fillStyle='rgba(180,180,180,0.6)';ctx.fillText(`${(as.cooldownRemaining/1000).toFixed(1)}s`,w/2,abY+abH+4);}if(player.invulnerable){ctx.font='bold 12px monospace';ctx.fillStyle='rgba(100,255,140,0.9)';ctx.fillText('✦ INVULNERABLE ✦',w/2,abY-42);}}
        ctx.restore();
    }
    _rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
}

// ─── WaveManager ──────────────────────────────────────────────────────────────

const WAVE_INTERVAL=20000,BASE_GHOST_COUNT=4;
function waveComposition(wave){const w=wave-1;return{chaser:Math.max(0.20,0.70-w*0.08),tank:Math.min(0.35,0.05+w*0.05),assassin:Math.min(0.30,0.05+w*0.04),orbiter:Math.min(0.25,0.10+w*0.03)};}
function pickArchetype(wave){const comp=waveComposition(wave);let acc=0,roll=Math.random();for(const[t,p]of Object.entries(comp)){acc+=p;if(roll<acc)return t;}return 'chaser';}
function makeGhost(pos,type,wave){const arch=ARCHETYPES[type],scale=1+(wave-1)*0.12;const ghost=new Ghost(pos.x,pos.y,{type,speed:Math.min(arch.speed*scale,arch.speed*2),health:Math.round(arch.health*scale),damage:Math.min(Math.round(arch.damage*scale),arch.damage*2)});ghost.setAI(new BasicAI({mode:arch.aiMode,detectionRange:arch.detectionRange+(wave-1)*15,stopDistance:arch.stopDistance,surroundRadius:type==='orbiter'?90+wave*5:90}));return ghost;}

class WaveManager {
    constructor(){this.wave=1;this.timeSinceWave=0;}
    get countdown(){return Math.max(0,(WAVE_INTERVAL-this.timeSinceWave)/1000);}
    update(dt,gs,obj){
        if(gs.isGameOver)return;
        this.timeSinceWave+=dt;
        if(this.timeSinceWave>=WAVE_INTERVAL){
            this.timeSinceWave-=WAVE_INTERVAL;this.wave++;this._spawnWave(gs);
            obj.spawnRelics(gs.player.x,gs.player.y,gs.chunkManager,RELICS_PER_WAVE);
        }
    }
    _spawnWave(gs){const count=BASE_GHOST_COUNT+(this.wave-1)*2,p=gs.player,cm=gs.chunkManager;for(let i=0;i<count;i++){const angle=(i/count)*Math.PI*2+Math.random()*0.4,dist=350+Math.random()*300;const pos=cm.findWalkableNear(p.x+Math.cos(angle)*dist,p.y+Math.sin(angle)*dist);gs.ghosts.push(makeGhost(pos,pickArchetype(this.wave),this.wave));}}
}

// ─── InputHandler ─────────────────────────────────────────────────────────────

class InputHandler{
    constructor(){this.keys={};this._pressed=new Set();this.bindEvents();}
    bindEvents(){window.addEventListener('keydown',e=>{if(!this.keys[e.code])this._pressed.add(e.code);this.keys[e.code]=true;if(e.code==='Space')e.preventDefault();});window.addEventListener('keyup',e=>{this.keys[e.code]=false;});}
    isPressed(k){return!!this.keys[k];}
    justPressed(c){return this._pressed.has(c);}
    flushPressed(){this._pressed.clear();}
}

// ─── Player ───────────────────────────────────────────────────────────────────

class Player {
    constructor(x,y){this.x=x;this.y=y;this.velocity={x:0,y:0};this.speed=5;this.baseSpeed=5;this.speedModifiers=[];this.radius=20;this.health=100;this.maxHealth=100;this.invulnerable=false;this.angle=0;}
    update(input,deltaTime,cm,corruption){
        this.velocity.x=0;this.velocity.y=0;
        if(input.isPressed('KeyW')||input.isPressed('ArrowUp'))this.velocity.y-=1;
        if(input.isPressed('KeyS')||input.isPressed('ArrowDown'))this.velocity.y+=1;
        if(input.isPressed('KeyA')||input.isPressed('ArrowLeft'))this.velocity.x-=1;
        if(input.isPressed('KeyD')||input.isPressed('ArrowRight'))this.velocity.x+=1;
        const mag=Math.sqrt(this.velocity.x**2+this.velocity.y**2);
        if(mag>0){this.velocity.x=(this.velocity.x/mag)*this.speed;this.velocity.y=(this.velocity.y/mag)*this.speed;this.angle=Math.atan2(this.velocity.y,this.velocity.x);}
        const dt=deltaTime/16;
        const nx=this.x+this.velocity.x*dt,ny=this.y+this.velocity.y*dt;
        const tm=cm?cm.getMovementModifier(nx,ny):1;
        // Apply corruption slow on top of terrain modifier
        const corrOverlay=corruption?corruption.getMovementOverlay(nx,ny):1;
        const fx=this.x+this.velocity.x*dt*tm*corrOverlay;
        const fy=this.y+this.velocity.y*dt*tm*corrOverlay;
        if(cm){if(cm.isWalkable(fx,this.y))this.x=fx;if(cm.isWalkable(this.x,fy))this.y=fy;}
        else{this.x=fx;this.y=fy;}
    }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class Renderer{
    constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.camera={x:0,y:0};this._shake={x:0,y:0,magnitude:0,decay:0.85};this.resize();}
    resize(){this.canvas.width=window.innerWidth;this.canvas.height=window.innerHeight;}
    triggerShake(m=8){this._shake.magnitude=m;}
    _updateShake(){if(this._shake.magnitude>0.1){this._shake.x=(Math.random()*2-1)*this._shake.magnitude;this._shake.y=(Math.random()*2-1)*this._shake.magnitude;this._shake.magnitude*=this._shake.decay;}else{this._shake.magnitude=0;this._shake.x=0;this._shake.y=0;}}
    clear(){this.ctx.fillStyle='#111';this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);}
    setCamera(tx,ty){this._updateShake();this.camera.x=tx-this.canvas.width/2+this._shake.x;this.camera.y=ty-this.canvas.height/2+this._shake.y;}
    drawCircle(x,y,r,color){const sx=x-this.camera.x,sy=y-this.camera.y;this.ctx.beginPath();this.ctx.arc(sx,sy,r,0,Math.PI*2);this.ctx.fillStyle=color;this.ctx.fill();this.ctx.closePath();}
    drawDamageFlash(a){if(a<=0)return;this.ctx.save();this.ctx.globalCompositeOperation='source-over';this.ctx.fillStyle=`rgba(220,30,30,${a})`;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();}
    drawAbilityFlash(a,color){if(a<=0)return;this.ctx.save();this.ctx.globalCompositeOperation='source-over';this.ctx.fillStyle=color.replace(')',',' +(a*0.35)+')').replace('rgb(','rgba(');this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();}
    drawCorruptionVignette(level){if(level<0.1)return;const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;const alpha=Math.min(0.35,level*0.35);const grad=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.3,w/2,h/2,Math.min(w,h)*0.8);grad.addColorStop(0,'rgba(0,0,0,0)');grad.addColorStop(1,`rgba(60,0,40,${alpha})`);ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.restore();}
    drawGameOver(wave,survSecs){const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(0,0,0,0.75)';ctx.fillRect(0,0,w,h);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 72px sans-serif';ctx.fillStyle='#cc2222';ctx.fillText('GAME OVER',w/2,h/2-50);const mins=String(Math.floor(survSecs/60)).padStart(2,'0'),secs=String(Math.floor(survSecs%60)).padStart(2,'0');ctx.font='26px monospace';ctx.fillStyle='rgba(255,200,80,0.9)';ctx.fillText(`Reached Wave ${wave}`,w/2,h/2+10);ctx.font='20px sans-serif';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(`Survived ${mins}:${secs}  ·  Refresh to try again`,w/2,h/2+55);ctx.restore();}
}

// ─── GameState ────────────────────────────────────────────────────────────────

class GameState{
    constructor(player){this.player=player;this.ghosts=[];this.lighting=null;this.particles=[];this.projectiles=[];this.enemies=[];this.chunkManager=null;this.timeScale=1;this.cameraShake=false;this.ghostsVisible=false;this.activeEffects=[];this.damageFlashAlpha=0;this.isGameOver=false;this.survivalTime=0;}
    triggerDamageFlash(){this.damageFlashAlpha=0.55;}
    applyEffect({type,multiplier,duration}){const effect={type,multiplier,duration,startedAt:Date.now()};this.activeEffects.push(effect);if(type==='speed'){this.player.speedModifiers.push(multiplier);this._recalcSpeed();}else if(type==='lightRadius'&&this.lighting)this.lighting.lightRadius*=multiplier;setTimeout(()=>this._revertEffect(effect),duration);}
    _recalcSpeed(){this.player.speed=this.player.baseSpeed*this.player.speedModifiers.reduce((a,b)=>a*b,1);}
    _revertEffect(effect){if(effect.type==='speed'){const idx=this.player.speedModifiers.indexOf(effect.multiplier);if(idx!==-1)this.player.speedModifiers.splice(idx,1);this._recalcSpeed();}else if(effect.type==='lightRadius'&&this.lighting)this.lighting.lightRadius/=effect.multiplier;this.activeEffects=this.activeEffects.filter(e=>e!==effect);}
    update(deltaTime,renderer,corruption){
        if(this.isGameOver)return;
        this.survivalTime+=deltaTime;
        const now=Date.now(),p=this.player;
        if(this.damageFlashAlpha>0)this.damageFlashAlpha=Math.max(0,this.damageFlashAlpha-(deltaTime/16)*0.06);
        this.particles=this.particles.filter(pt=>(now-pt.created)<pt.duration);
        this.projectiles=this.projectiles.filter(pr=>{const dt=deltaTime/16;pr.x+=pr.vx*dt;pr.y+=pr.vy*dt;return(now-pr.created)<2000;});
        this.ghosts=this.ghosts.filter(g=>g.health>0);
        for(const ghost of this.ghosts){
            ghost.update(p,this.chunkManager,deltaTime);
            if(!p.invulnerable){const dmg=ghost.attack(p);if(dmg>0){p.health=Math.max(0,p.health-dmg);this.triggerDamageFlash();renderer.triggerShake(7);}}
        }
        // Corruption tile damage
        if(corruption&&!p.invulnerable){
            const dmgRate=corruption.getDamageRate(p.x,p.y);
            if(dmgRate>0){
                p.health=Math.max(0,p.health-dmgRate*(deltaTime/1000));
                if(dmgRate>2&&Math.random()<0.02)this.triggerDamageFlash();
            }
        }
        if(p.health<=0)this.isGameOver=true;
        if(this.lighting)this.lighting.update(deltaTime);
        if(this.chunkManager)this.chunkManager.unloadDistant(p.x,p.y);
    }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    constructor(){
        this.canvas=document.getElementById('gameCanvas');
        this.renderer=new Renderer(this.canvas);
        this.input=new InputHandler();

        const cm=new ChunkManager(32,50);
        const mid=Math.floor(cm.chunkSize/2);
        const sx=mid*cm.tileSize+cm.tileSize/2, sy=mid*cm.tileSize+cm.tileSize/2;

        const player=new Player(sx,sy);
        this.gameState=new GameState(player);
        this.gameState.chunkManager=cm;
        this.gameState.lighting=new Lighting(this.renderer,{lightRadius:200,darknessColor:'rgba(0,0,0,0.85)',flickerIntensity:0.05});

        cm.getSurroundingChunks(sx,sy,2);

        // Initial ghosts
        const initTypes=['chaser','chaser','orbiter','chaser'];
        this.gameState.ghosts=initTypes.map((type,i)=>{
            const angle=(i/initTypes.length)*Math.PI*2;
            const pos=cm.findWalkableNear(sx+Math.cos(angle)*350,sy+Math.sin(angle)*350);
            return makeGhost(pos,type,1);
        });

        this.objective=new ObjectiveSystem();
        this.objective.spawnRelics(sx,sy,cm,RELICS_PER_WAVE);

        // Corruption — seed a few distant patches to start atmosphere
        this.corruption=new CorruptionSystem(cm.tileSize);
        for(let i=0;i<4;i++){
            const angle=(i/4)*Math.PI*2, dist=500+Math.random()*300;
            this.corruption.seed(sx+Math.cos(angle)*dist,sy+Math.sin(angle)*dist,3,0.2);
        }

        this.chunkRenderer=new ChunkRenderer(this.renderer);
        this.hud=new HUD(this.renderer);
        this.waveManager=new WaveManager();
        const picked=ABILITY_ROSTER[Math.floor(Math.random()*ABILITY_ROSTER.length)];
        this.abilitySystem=new AbilitySystem(picked);

        this.lastTime=null;
        window.addEventListener('resize',()=>this.renderer.resize());
        requestAnimationFrame(ts=>this.loop(ts));
    }

    update(deltaTime){
        if(this.gameState.isGameOver){this.input.flushPressed();return;}
        const sd=deltaTime*this.gameState.timeScale;
        if(this.input.justPressed('Space'))
            if(this.abilitySystem.tryActivate(this.gameState.player,this.gameState))
                this.renderer.triggerShake(4);
        this.input.flushPressed();
        this.gameState.player.update(this.input,sd,this.gameState.chunkManager,this.corruption);
        this.gameState.update(sd,this.renderer,this.corruption);
        this.abilitySystem.update(sd);
        this.waveManager.update(sd,this.gameState,this.objective);
        this.objective.update(this.gameState.player,this.gameState.chunkManager,sd,this.gameState);
        // Corruption: seed additional patches around wave-spawned ghosts every so often
        this.corruption.update(sd,this.gameState.player,this.waveManager.wave,this.gameState.chunkManager);
        // Seed corruption near ghost positions occasionally (they trail corruption)
        if(Math.random()<0.015){
            const gs=this.gameState.ghosts;
            if(gs.length>0){const g=gs[Math.floor(Math.random()*gs.length)];this.corruption.seed(g.x,g.y,1,0.05+this.corruption.globalLevel*0.08);}
        }
    }

    render(){
        const gs=this.gameState;
        const {player,ghosts,particles,projectiles,chunkManager,lighting,damageFlashAlpha,isGameOver,survivalTime}=gs;
        const {wave,countdown}=this.waveManager;

        this.renderer.clear();
        this.renderer.setCamera(player.x,player.y);

        // 1. Terrain base
        if(chunkManager){const chunks=chunkManager.getSurroundingChunks(player.x,player.y,1);this.chunkRenderer.render(chunks,chunkManager.chunkSize,chunkManager.tileSize);}

        // 2. Corruption overlay (on top of terrain, under entities)
        this.corruption.render(this.renderer,chunkManager);

        // 3. Relics + extraction zone
        this.objective.renderWorld(this.renderer);

        // 4. Particles
        for(const p of particles){const age=(Date.now()-p.created)/p.duration;const r=(p.radius||30)*(0.2+age*0.8)*0.15;this.renderer.drawCircle(p.x+(p.vx||0)*age*20,p.y+(p.vy||0)*age*20,r,p.color||'rgba(255,200,100,0.5)');}

        // 5. Projectiles
        projectiles.forEach(p=>this.renderer.drawCircle(p.x,p.y,5,'rgba(255,255,100,0.9)'));

        // 6. Ghosts
        ghosts.forEach(g=>{if(g.render)g.render(this.renderer);});

        // 7. Player
        const pColor=player.invulnerable?'#88ffaa':'#e94560';
        this.renderer.drawCircle(player.x,player.y,player.radius,pColor);
        if(player.invulnerable)this.renderer.drawCircle(player.x,player.y,player.radius+6,'rgba(100,255,140,0.25)');

        // 8. Lighting / fog of war
        if(lighting)lighting.render(player);

        // 9. Corruption screen vignette (subtle screen-space darkening at edges)
        this.renderer.drawCorruptionVignette(this.corruption.globalLevel);

        // 10. Collect flash
        this.objective.renderScreenFlash(this.renderer);

        // 11. Ability flash
        if(this.abilitySystem.flashAlpha>0)this.renderer.drawAbilityFlash(this.abilitySystem.flashAlpha,this.abilitySystem.ability.color);

        // 12. Damage flash
        this.renderer.drawDamageFlash(damageFlashAlpha);

        // 13. HUD
        if(!isGameOver)this.hud.render(player,ghosts,survivalTime/1000,wave,countdown,this.abilitySystem,this.objective,this.corruption);

        // 14. Game over
        if(isGameOver)this.renderer.drawGameOver(wave,survivalTime/1000);
    }

    loop(timestamp){
        if(this.lastTime===null)this.lastTime=timestamp;
        const dt=Math.min(timestamp-this.lastTime,100);
        this.lastTime=timestamp;
        this.update(dt);this.render();
        requestAnimationFrame(ts=>this.loop(ts));
    }
}

window.addEventListener('DOMContentLoaded',()=>{new Game();});