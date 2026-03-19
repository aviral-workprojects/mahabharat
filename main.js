import Ghost from './ghost.js';
import { ARCHETYPES } from './ghost.js';
import BasicAI from './ai_basic.js';
import Lighting from './lighting.js';

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT BUS
// ═══════════════════════════════════════════════════════════════════════════════

class EventBus {
    constructor() { this._handlers = {}; }

    on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        if (!this._handlers[event]) return;
        this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    }

    emit(event, payload) {
        if (!this._handlers[event]) return;
        for (const h of this._handlers[event]) h(payload);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECT POOL — reusable particle / projectile instances
// ═══════════════════════════════════════════════════════════════════════════════

class ObjectPool {
    constructor(factory, reset, maxSize = 512) {
        this._factory  = factory;
        this._reset    = reset;
        this._pool     = [];
        this._maxSize  = maxSize;
    }

    get() {
        return this._pool.length > 0 ? this._pool.pop() : this._factory();
    }

    release(obj) {
        if (this._pool.length < this._maxSize) {
            this._reset(obj);
            this._pool.push(obj);
        }
    }
}

const particlePool = new ObjectPool(
    () => ({ x:0,y:0,vx:0,vy:0,radius:20,color:'',duration:500,created:0,dead:false }),
    o  => { o.dead = false; }
);

function emitParticle(gs, x, y, vx, vy, radius, color, duration) {
    const p = particlePool.get();
    p.x=x; p.y=y; p.vx=vx; p.vy=vy;
    p.radius=radius; p.color=color;
    p.duration=duration; p.created=Date.now(); p.dead=false;
    gs.particles.push(p);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPATIAL HASH — O(1) broad-phase collision
// ═══════════════════════════════════════════════════════════════════════════════

class SpatialHash {
    constructor(cellSize = 100) {
        this._cell = cellSize;
        this._map  = new Map();
    }

    _key(x, y) {
        return `${Math.floor(x/this._cell)},${Math.floor(y/this._cell)}`;
    }

    clear() { this._map.clear(); }

    insert(entity) {
        const key = this._key(entity.x, entity.y);
        if (!this._map.has(key)) this._map.set(key, []);
        this._map.get(key).push(entity);
    }

    nearby(x, y, radius) {
        const results = [];
        const steps = Math.ceil(radius / this._cell);
        for (let dy = -steps; dy <= steps; dy++) {
            for (let dx = -steps; dx <= steps; dx++) {
                const key = this._key(x + dx*this._cell, y + dy*this._cell);
                const cell = this._map.get(key);
                if (cell) for (const e of cell) results.push(e);
            }
        }
        return results;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT SYSTEM — centralized, stackable, typed buffs/debuffs
// ═══════════════════════════════════════════════════════════════════════════════

const EFFECT_TYPES = {
    speed:       { apply: (p,m) => p.speedModifiers.push(m),    revert: (p,m) => { const i=p.speedModifiers.indexOf(m); if(i!==-1)p.speedModifiers.splice(i,1); }, recalc: p => { p.speed = p.baseSpeed * p.speedModifiers.reduce((a,b)=>a*b,1); } },
    lightRadius: { apply: (l,m) => { if(l) l.lightRadius*=m; }, revert: (l,m) => { if(l) l.lightRadius/=m; }, recalc: ()=>{} },
    invulnerable:{ apply: (p)   => { p.invulnerable=true; },    revert: (p)   => { p.invulnerable=false; },  recalc: ()=>{} },
    enemySlow:   { apply: (gs,m)=> { gs.ghosts.forEach(g=>g.speedModifiers.push(m)); }, revert:(gs,m)=>{ gs.ghosts.forEach(g=>{const i=g.speedModifiers.indexOf(m);if(i!==-1)g.speedModifiers.splice(i,1);}); }, recalc:()=>{} }
};

class EffectSystem {
    constructor() { this._active = []; }

    apply(type, target, multiplier, duration, tags=[]) {
        const def = EFFECT_TYPES[type];
        if (!def) return;
        const effect = { type, target, multiplier, duration, tags, startedAt: Date.now(), expired: false };
        def.apply(target, multiplier);
        if (def.recalc) def.recalc(target);
        this._active.push(effect);
        return effect;
    }

    update() {
        const now = Date.now();
        for (const e of this._active) {
            if (e.expired) continue;
            if (now - e.startedAt >= e.duration) {
                e.expired = true;
                const def = EFFECT_TYPES[e.type];
                if (def) { def.revert(e.target, e.multiplier); def.recalc(e.target); }
            }
        }
        this._active = this._active.filter(e => !e.expired);
    }

    hasTag(tag) { return this._active.some(e => e.tags.includes(tag) && !e.expired); }

    activeEffects() { return this._active.filter(e => !e.expired); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNK MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

class ChunkManager {
    constructor(chunkSize=32, tileSize=50) {
        this.chunkSize=chunkSize; this.tileSize=tileSize;
        this.loadedChunks=new Map();
        this.worldSeed=Math.floor(Math.random()*2**31);
    }

    _rng(cx,cy) {
        let h=this.worldSeed^(cx*374761393)^(cy*1057926937);
        h=Math.imul(h^(h>>>13),1540483477); h^=h>>>15;
        return ()=>{ h=Math.imul(h^(h>>>13),1540483477); h^=h>>>15; return(h>>>0)/0xffffffff; };
    }

    _generateChunk(cx,cy) {
        const rng=this._rng(cx,cy), sz=this.chunkSize, terrain=[];
        for(let y=0;y<sz;y++){
            const row=[];
            for(let x=0;x<sz;x++){
                const b=x===0||y===0||x===sz-1||y===sz-1;
                if(b)row.push('cliff'); else if(rng()<0.08)row.push('rock'); else if(rng()<0.12)row.push('dune'); else row.push('plain');
            }
            terrain.push(row);
        }
        if(cx===0&&cy===0){ const m=Math.floor(sz/2); for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)terrain[m+dy][m+dx]='plain'; }
        return { x:cx,y:cy,terrain,seed:this.worldSeed };
    }

    getChunk(cx,cy) {
        const k=`${cx},${cy}`;
        if(!this.loadedChunks.has(k)) this.loadedChunks.set(k,this._generateChunk(cx,cy));
        return this.loadedChunks.get(k);
    }

    _tileAt(wx,wy) {
        const cp=this.chunkSize*this.tileSize, cx=Math.floor(wx/cp), cy=Math.floor(wy/cp);
        const ch=this.getChunk(cx,cy);
        const lx=Math.floor((wx-cx*cp)/this.tileSize), ly=Math.floor((wy-cy*cp)/this.tileSize);
        if(ly<0||ly>=this.chunkSize||lx<0||lx>=this.chunkSize) return 'cliff';
        return ch.terrain[ly][lx];
    }

    isWalkable(wx,wy) { const t=this._tileAt(wx,wy); return t!=='cliff'&&t!=='rock'; }

    getMovementModifier(wx,wy) {
        switch(this._tileAt(wx,wy)){ case 'plain':return 1; case 'dune':return 0.6; case 'rock':return 0.3; case 'cliff':return 0; default:return 1; }
    }

    findWalkableNear(wx,wy,sr=300) {
        const step=this.tileSize;
        for(let r=step;r<=sr;r+=step) for(let a=0;a<Math.PI*2;a+=Math.PI/8){ const tx=wx+Math.cos(a)*r,ty=wy+Math.sin(a)*r; if(this.isWalkable(tx,ty))return{x:tx,y:ty}; }
        return{x:wx,y:wy};
    }

    getSurroundingChunks(wx,wy,r=1) {
        const cp=this.chunkSize*this.tileSize, cx=Math.floor(wx/cp), cy=Math.floor(wy/cp), chunks=[];
        for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++) chunks.push(this.getChunk(cx+dx,cy+dy));
        return chunks;
    }

    unloadDistant(wx,wy,md=3) {
        const cp=this.chunkSize*this.tileSize, cx=Math.floor(wx/cp), cy=Math.floor(wy/cp);
        for(const k of this.loadedChunks.keys()){ const[kx,ky]=k.split(',').map(Number); if(Math.max(Math.abs(kx-cx),Math.abs(ky-cy))>md)this.loadedChunks.delete(k); }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORRUPTION SYSTEM (expanded)
// ═══════════════════════════════════════════════════════════════════════════════

const CORR_TICK      = 800;
const CORR_THRESHOLD = 0.55;
const CORR_SAFE_R    = 140;
const CORR_SAFE_RSQ  = CORR_SAFE_R*CORR_SAFE_R;
const MAX_TILES      = 800;
const TILES_PER_TICK = 60;

class CorruptionSystem {
    constructor(tileSize) {
        this.tileSize=tileSize; this.tiles=new Map();
        this.globalLevel=0; this._accum=0; this._flicker=0;
        this.surgeZones=[];  // { x, y, radius, life }
    }

    _key(tx,ty){return`${tx},${ty}`;}
    _toTile(wx,wy){return{tx:Math.floor(wx/this.tileSize),ty:Math.floor(wy/this.tileSize)};}

    getLevel(wx,wy){ const{tx,ty}=this._toTile(wx,wy); return this.tiles.get(this._key(tx,ty))||0; }

    seed(wx,wy,r=5,lvl=0.3) {
        const{tx,ty}=this._toTile(wx,wy);
        for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
            if(dx*dx+dy*dy<=r*r){ const k=this._key(tx+dx,ty+dy); this.tiles.set(k,Math.min(1,(this.tiles.get(k)||0)+lvl*Math.random())); }
        }
    }

    getMovementOverlay(wx,wy) {
        const l=this.getLevel(wx,wy); if(l<CORR_THRESHOLD)return 1;
        return 1-(l-CORR_THRESHOLD)/(1-CORR_THRESHOLD)*(1-0.45);
    }

    getDamageRate(wx,wy) {
        const l=this.getLevel(wx,wy); if(l<CORR_THRESHOLD+0.2)return 0;
        return Math.min(1,(l-CORR_THRESHOLD-0.2)/0.3)*4;
    }

    // Ghosts standing on corrupted tiles get buffs
    getGhostBuff(wx,wy) {
        const l=this.getLevel(wx,wy); if(l<CORR_THRESHOLD)return null;
        const f=(l-CORR_THRESHOLD)/(1-CORR_THRESHOLD);
        return { speedMult:1+f*0.5, damageMult:1+f*0.3 };
    }

    // Cleanse in radius (called by abilities)
    cleanse(wx,wy,radius=120) {
        const{tx,ty}=this._toTile(wx,wy);
        const tileR=Math.ceil(radius/this.tileSize);
        for(let dy=-tileR;dy<=tileR;dy++) for(let dx=-tileR;dx<=tileR;dx++){
            const k=this._key(tx+dx,ty+dy);
            const existing=this.tiles.get(k);
            if(existing) this.tiles.set(k,Math.max(0,existing-0.4));
        }
    }

    update(dt,player,wave,cm,events) {
        this._flicker+=dt*0.006; this._accum+=dt;
        this.globalLevel=Math.min(1,this.globalLevel+dt*(0.000015+wave*0.000008));

        // Spawn surge zones at high global level
        if(this.globalLevel>0.6&&Math.random()<0.001*dt) {
            const a=Math.random()*Math.PI*2, dist=300+Math.random()*500;
            this.surgeZones.push({ x:player.x+Math.cos(a)*dist, y:player.y+Math.sin(a)*dist, radius:120, life:8000, born:Date.now() });
            events.emit('corruptionSurge',{x:player.x+Math.cos(a)*dist,y:player.y+Math.sin(a)*dist});
        }

        // Age surge zones
        this.surgeZones=this.surgeZones.filter(z=>(Date.now()-z.born)<z.life);

        if(this._accum<CORR_TICK)return;
        this._accum-=CORR_TICK;

        const spread=0.04*(0.5+this.globalLevel), px=player.x, py=player.y;
        const keys=[...this.tiles.keys()];
        const process=keys.length>TILES_PER_TICK ? keys.sort(()=>Math.random()-0.5).slice(0,TILES_PER_TICK) : keys;
        const pending=new Map();

        for(const key of process) {
            const lvl=this.tiles.get(key); if(lvl===undefined)continue;
            const[tx,ty]=key.split(',').map(Number);
            const cx=(tx+0.5)*this.tileSize, cy=(ty+0.5)*this.tileSize;
            const dxp=cx-px,dyp=cy-py;
            if(dxp*dxp+dyp*dyp<CORR_SAFE_RSQ){ const nl=Math.max(0,lvl-0.06); pending.set(key,nl===0?null:nl); continue; }
            if(!cm.isWalkable(cx,cy))continue;
            if(lvl>0.15) for(const[ddx,ddy]of[[1,0],[-1,0],[0,1],[0,-1]]){
                const nk=this._key(tx+ddx,ty+ddy);
                const nwx=(tx+ddx+0.5)*this.tileSize, nwy=(ty+ddy+0.5)*this.tileSize;
                if(!cm.isWalkable(nwx,nwy))continue;
                const ex=this.tiles.get(nk)||pending.get(nk)||0;
                pending.set(nk,Math.min(1,(ex||0)+lvl*spread*(0.5+Math.random()*0.5)));
            }
        }

        // Seed from surge zones
        for(const z of this.surgeZones){
            if(Math.random()<0.3){ const{tx,ty}=this._toTile(z.x+(Math.random()-0.5)*z.radius*2,z.y+(Math.random()-0.5)*z.radius*2); const k=this._key(tx,ty); pending.set(k,Math.min(1,(this.tiles.get(k)||0)+0.12)); }
        }

        // Random new seed
        if(this.globalLevel>0.1&&Math.random()<this.globalLevel*0.4){
            const a=Math.random()*Math.PI*2, dist=CORR_SAFE_R+100+Math.random()*400;
            const sx=px+Math.cos(a)*dist, sy=py+Math.sin(a)*dist;
            if(cm.isWalkable(sx,sy)){const{tx,ty}=this._toTile(sx,sy);const k=this._key(tx,ty);pending.set(k,Math.min(1,(this.tiles.get(k)||0)+0.08+this.globalLevel*0.06));}
        }

        for(const[k,v]of pending){ if(v===null||v===0)this.tiles.delete(k); else this.tiles.set(k,v); }
        if(this.tiles.size>MAX_TILES){ const sorted=[...this.tiles.entries()].sort((a,b)=>a[1]-b[1]); for(const[k]of sorted.slice(0,this.tiles.size-MAX_TILES))this.tiles.delete(k); }
    }

    render(renderer) {
        if(!this.tiles.size&&!this.surgeZones.length)return;
        const ctx=renderer.ctx, cam=renderer.camera, ts=this.tileSize;
        const fl=0.7+Math.sin(this._flicker)*0.15+Math.sin(this._flicker*2.7)*0.07;
        ctx.save(); ctx.globalCompositeOperation='source-over';
        for(const[key,lvl]of this.tiles){
            if(lvl<0.08)continue;
            const[tx,ty]=key.split(',').map(Number);
            const sx=tx*ts-cam.x, sy=ty*ts-cam.y;
            if(sx+ts<0||sx>renderer.canvas.width||sy+ts<0||sy>renderer.canvas.height)continue;
            const alpha=Math.min(0.72,lvl*0.8)*fl;
            ctx.fillStyle=`rgba(${Math.round(80+lvl*60)},0,${Math.round(120-lvl*80)},${alpha})`;
            ctx.fillRect(sx,sy,ts,ts);
            if(lvl>CORR_THRESHOLD){ ctx.strokeStyle=`rgba(40,0,20,${(lvl-CORR_THRESHOLD)*0.5*fl})`; ctx.lineWidth=1; ctx.strokeRect(sx+2,sy+2,ts-4,ts-4); }
        }
        // Render surge zones
        for(const z of this.surgeZones){
            const age=(Date.now()-z.born)/z.life, sx=z.x-cam.x, sy=z.y-cam.y;
            const pulse=0.3+Math.sin(this._flicker*3)*0.15;
            ctx.beginPath(); ctx.arc(sx,sy,z.radius*(0.8+Math.sin(this._flicker*2)*0.1),0,Math.PI*2);
            ctx.strokeStyle=`rgba(180,0,80,${pulse*(1-age*0.5)})`; ctx.lineWidth=3; ctx.stroke();
            ctx.fillStyle=`rgba(100,0,40,${0.06*(1-age)})`; ctx.fill();
        }
        ctx.restore();
    }

    renderVignette(renderer) {
        if(this.globalLevel<0.1)return;
        const ctx=renderer.ctx,w=renderer.canvas.width,h=renderer.canvas.height;
        const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.3,w/2,h/2,Math.min(w,h)*0.8);
        g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(60,0,40,${Math.min(0.35,this.globalLevel*0.35)})`);
        ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.restore();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNK RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

const TERRAIN_COLORS={plain:'#1e2a3a',dune:'#3b2f1e',rock:'#2e2e3e',cliff:'#4a4a5e'};

class ChunkRenderer {
    constructor(r){this.renderer=r;}
    render(chunks,chunkSize,tileSize){
        const ctx=this.renderer.ctx,cam=this.renderer.camera,cp=chunkSize*tileSize;
        for(const ch of chunks){
            const cwx=ch.x*cp,cwy=ch.y*cp;
            for(let ty=0;ty<chunkSize;ty++) for(let tx=0;tx<chunkSize;tx++){
                const tile=ch.terrain[ty][tx],sx=cwx+tx*tileSize-cam.x,sy=cwy+ty*tileSize-cam.y;
                if(sx+tileSize<0||sx>this.renderer.canvas.width||sy+tileSize<0||sy>this.renderer.canvas.height)continue;
                ctx.fillStyle=TERRAIN_COLORS[tile]||TERRAIN_COLORS.plain; ctx.fillRect(sx,sy,tileSize,tileSize);
                ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1; ctx.strokeRect(sx,sy,tileSize,tileSize);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECTIVE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const RELIC_R=18,EXTRACT_R=40,EXTRACT_DUR=3000,RELICS_PER_WAVE=3,MIN_RD=300,MAX_RD=700;

class Relic {
    constructor(x,y,id){this.x=x;this.y=y;this.id=id;this.collected=false;this._p=0;}
    update(dt){this._p+=dt*0.004;}
    render(renderer){
        if(this.collected)return;
        const sx=this.x-renderer.camera.x,sy=this.y-renderer.camera.y,ctx=renderer.ctx,bob=Math.sin(this._p)*4,glow=0.5+Math.sin(this._p*1.3)*0.3;
        ctx.save(); ctx.shadowColor=`rgba(255,200,60,${glow})`; ctx.shadowBlur=20;
        ctx.beginPath(); ctx.arc(sx,sy+bob,RELIC_R+4,0,Math.PI*2); ctx.strokeStyle=`rgba(255,200,60,${glow*0.6})`; ctx.lineWidth=2; ctx.stroke();
        ctx.beginPath(); ctx.arc(sx,sy+bob,RELIC_R,0,Math.PI*2); ctx.fillStyle='rgba(255,180,40,0.85)'; ctx.fill();
        ctx.font='14px sans-serif'; ctx.fillStyle='rgba(255,255,200,0.95)'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✦',sx,sy+bob);
        ctx.shadowBlur=0; ctx.restore();
    }
}

class ExtractionZone {
    constructor(x,y){this.x=x;this.y=y;this.progress=0;this._p=0;this.complete=false;}
    update(inside,dt){
        this._p+=dt*0.003;
        if(inside&&!this.complete){this.progress=Math.min(1,this.progress+dt/EXTRACT_DUR);if(this.progress>=1)this.complete=true;}
        else if(!inside)this.progress=Math.max(0,this.progress-dt/(EXTRACT_DUR*2));
    }
    containsPlayer(p){const dx=p.x-this.x,dy=p.y-this.y;return Math.sqrt(dx*dx+dy*dy)<EXTRACT_R;}
    render(renderer){
        const sx=this.x-renderer.camera.x,sy=this.y-renderer.camera.y,ctx=renderer.ctx,pulse=0.6+Math.sin(this._p)*0.2;
        ctx.save();
        ctx.beginPath(); ctx.arc(sx,sy,EXTRACT_R,0,Math.PI*2); ctx.strokeStyle=`rgba(80,255,160,${pulse*0.7})`; ctx.lineWidth=3; ctx.stroke(); ctx.fillStyle='rgba(80,255,160,0.08)'; ctx.fill();
        if(this.progress>0){ctx.beginPath();ctx.arc(sx,sy,EXTRACT_R-6,-Math.PI/2,-Math.PI/2+this.progress*Math.PI*2);ctx.strokeStyle='rgba(80,255,160,0.9)';ctx.lineWidth=5;ctx.stroke();}
        ctx.font='bold 12px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=`rgba(80,255,160,${pulse})`;
        ctx.shadowColor='rgba(80,255,160,0.8)'; ctx.shadowBlur=10; ctx.fillText('EXTRACT',sx,sy-6);
        ctx.font='10px monospace'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText(`${Math.round(this.progress*100)}%`,sx,sy+8);
        ctx.shadowBlur=0; ctx.restore();
    }
}

class ObjectiveSystem {
    constructor(events){this.events=events;this.relics=[];this.collected=0;this.required=RELICS_PER_WAVE;this.extractionZone=null;this.waveComplete=false;this._idC=0;this._flash=0;}

    spawnRelics(px,py,cm,count=RELICS_PER_WAVE){
        this.relics=[];this.collected=0;this.extractionZone=null;this.waveComplete=false;this.required=count;
        for(let i=0;i<count;i++){
            const a=(i/count)*Math.PI*2+Math.random()*0.8,dist=MIN_RD+Math.random()*(MAX_RD-MIN_RD);
            const pos=cm.findWalkableNear(px+Math.cos(a)*dist,py+Math.sin(a)*dist,400);
            this.relics.push(new Relic(pos.x,pos.y,this._idC++));
        }
    }

    _spawnExtraction(px,py,cm){
        const a=Math.random()*Math.PI*2,dist=350+Math.random()*200;
        const pos=cm.findWalkableNear(px+Math.cos(a)*dist,py+Math.sin(a)*dist,500);
        this.extractionZone=new ExtractionZone(pos.x,pos.y);
    }

    update(player,cm,dt,gs){
        for(const r of this.relics){
            if(r.collected)continue; r.update(dt);
            const dx=player.x-r.x,dy=player.y-r.y;
            if(Math.sqrt(dx*dx+dy*dy)<RELIC_R+player.radius){
                r.collected=true; this.collected++; this._flash=1;
                this.events.emit('relicCollected',{x:r.x,y:r.y,count:this.collected,required:this.required});
                for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2;emitParticle(gs,r.x,r.y,Math.cos(a)*2,Math.sin(a)*2,50,'rgba(255,200,60,0.8)',600);}
                if(this.collected>=this.required&&!this.extractionZone)this._spawnExtraction(player.x,player.y,cm);
            }
        }
        if(this._flash>0)this._flash=Math.max(0,this._flash-dt/400);
        if(this.extractionZone&&!this.waveComplete){
            this.extractionZone.update(this.extractionZone.containsPlayer(player),dt);
            if(this.extractionZone.complete){this.waveComplete=true;this._onComplete(player,gs);}
        }
    }

    _onComplete(player,gs){
        player.health=Math.min(player.maxHealth,player.health+30);
        gs.effects.apply('speed',player,1.4,8000,['reward']);
        const chasers=gs.ghosts.filter(g=>g.type==='chaser');
        const rm=Math.ceil(chasers.length/2);
        for(let i=0;i<rm;i++){const idx=gs.ghosts.indexOf(chasers[i]);if(idx!==-1)gs.ghosts.splice(idx,1);}
        for(let i=0;i<24;i++){const a=(i/24)*Math.PI*2;emitParticle(gs,player.x,player.y,Math.cos(a)*4,Math.sin(a)*4,80,'rgba(80,255,160,0.8)',1000);}
        this.events.emit('waveComplete',{wave:gs.wave});
    }

    renderWorld(r){for(const rel of this.relics)if(!rel.collected)rel.render(r);if(this.extractionZone)this.extractionZone.render(r);}

    renderFlash(renderer){
        if(this._flash<=0)return;
        const ctx=renderer.ctx;ctx.save();ctx.globalCompositeOperation='source-over';
        ctx.fillStyle=`rgba(255,200,60,${this._flash*0.25})`;ctx.fillRect(0,0,renderer.canvas.width,renderer.canvas.height);ctx.restore();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABILITY SYSTEM  — all effects routed through EffectSystem
// ═══════════════════════════════════════════════════════════════════════════════

const ABILITY_ROSTER = [
    {
        name:'Gandiva Dash',cooldown:5000,color:'#44aaff',icon:'⚡',
        tags:['mobility'],
        activate(player,gs){ gs.effects.apply('speed',player,4,300,['mobility']); _burst(gs,player,8,'rgba(100,180,255,0.7)',60); }
    },{
        name:'Divine Guidance',cooldown:8000,color:'#ffdd66',icon:'✦',
        tags:['vision'],
        activate(player,gs){ gs.effects.apply('lightRadius',gs.lighting,2.5,3000,['vision']); _burst(gs,player,12,'rgba(255,220,80,0.7)',100); }
    },{
        name:'Truth Aura',cooldown:10000,color:'#88ffaa',icon:'🛡',
        tags:['defense'],
        activate(player,gs){ gs.effects.apply('invulnerable',player,1,2000,['defense']); _burst(gs,player,10,'rgba(100,255,140,0.7)',80); }
    },{
        name:'Vasavi Shakti',cooldown:15000,color:'#ff8844',icon:'🔥',
        tags:['mobility','vision'],
        activate(player,gs){ gs.effects.apply('lightRadius',gs.lighting,1.5,4000,['vision']); gs.effects.apply('speed',player,1.3,4000,['mobility']); _burst(gs,player,16,'rgba(255,140,60,0.8)',120); }
    },{
        name:'Brahmastra',cooldown:20000,color:'#cc44ff',icon:'★',
        tags:['aoe','vision'],
        activate(player,gs){ gs.effects.apply('lightRadius',gs.lighting,3,2000,['vision']); gs.corruption.cleanse(player.x,player.y,180); _burst(gs,player,20,'rgba(200,80,255,0.8)',150); }
    },{
        name:'Divine Guidance',cooldown:8000,color:'#aaffee',icon:'🌀',
        tags:['cleanse','vision'],
        activate(player,gs){ gs.corruption.cleanse(player.x,player.y,240); gs.effects.apply('lightRadius',gs.lighting,2,4000,['vision']); _burst(gs,player,14,'rgba(100,255,220,0.7)',110); }
    }
];

function _burst(gs,player,count,color,radius){
    for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2;emitParticle(gs,player.x+Math.cos(a)*10,player.y+Math.sin(a)*10,Math.cos(a)*3,Math.sin(a)*3,radius,color,500);}
}

class AbilityController {
    constructor(ability){this.ability=ability;this.lastUsed=-Infinity;this.flashAlpha=0;}
    get cooldownRemaining(){return Math.max(0,this.ability.cooldown-(Date.now()-this.lastUsed));}
    get cooldownFraction(){return 1-this.cooldownRemaining/this.ability.cooldown;}
    get isReady(){return this.cooldownRemaining===0;}
    tryActivate(player,gs){
        if(!this.isReady)return false;
        this.lastUsed=Date.now();this.flashAlpha=0.4;
        this.ability.activate(player,gs);return true;
    }
    update(dt){if(this.flashAlpha>0)this.flashAlpha=Math.max(0,this.flashAlpha-(dt/16)*0.05);}
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAVE / DIFFICULTY MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const WAVE_INTERVAL=20000,BASE_COUNT=4;

function waveComp(wave){const w=wave-1;return{chaser:Math.max(0.20,0.70-w*0.08),tank:Math.min(0.35,0.05+w*0.05),assassin:Math.min(0.30,0.05+w*0.04),orbiter:Math.min(0.25,0.10+w*0.03)};}
function pickArchetype(wave){const c=waveComp(wave);let acc=0,r=Math.random();for(const[t,p]of Object.entries(c)){acc+=p;if(r<acc)return t;}return'chaser';}

function makeGhost(pos,type,wave){
    const arch=ARCHETYPES[type],scale=1+(wave-1)*0.12;
    const g=new Ghost(pos.x,pos.y,{type,speed:Math.min(arch.speed*scale,arch.speed*2),health:Math.round(arch.health*scale),damage:Math.min(Math.round(arch.damage*scale),arch.damage*2)});
    g.setAI(new BasicAI({mode:arch.aiMode,detectionRange:arch.detectionRange+(wave-1)*15,stopDistance:arch.stopDistance,surroundRadius:type==='orbiter'?90+wave*5:90}));
    return g;
}

class WaveManager {
    constructor(events){this.wave=1;this._time=0;this.events=events;}
    get countdown(){return Math.max(0,(WAVE_INTERVAL-this._time)/1000);}
    update(dt,gs,obj){
        if(gs.isGameOver)return;
        this._time+=dt;
        if(this._time>=WAVE_INTERVAL){
            this._time-=WAVE_INTERVAL; this.wave++;
            this._spawnWave(gs);
            obj.spawnRelics(gs.player.x,gs.player.y,gs.chunkManager,RELICS_PER_WAVE);
            this.events.emit('waveStart',{wave:this.wave});
        }
    }
    _spawnWave(gs){
        const count=BASE_COUNT+(this.wave-1)*2,p=gs.player,cm=gs.chunkManager;
        for(let i=0;i<count;i++){
            const a=(i/count)*Math.PI*2+Math.random()*0.4,dist=350+Math.random()*300;
            gs.ghosts.push(makeGhost(cm.findWalkableNear(p.x+Math.cos(a)*dist,p.y+Math.sin(a)*dist),pickArchetype(this.wave),this.wave));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SYSTEM — throttled, group-aware, corruption-boosted
// ═══════════════════════════════════════════════════════════════════════════════

class AISystem {
    constructor(){this._frame=0;this._spatialHash=new SpatialHash(150);}

    update(ghosts,player,cm,corruption,dt,events){
        this._frame++;
        // Rebuild spatial hash every other frame
        if(this._frame%2===0){
            this._spatialHash.clear();
            for(const g of ghosts)this._spatialHash.insert(g);
        }

        for(const g of ghosts){
            // AI updates every 2 frames per ghost (staggered by id hash)
            if((this._frame+(g._id||0))%2!==0)continue;

            // Apply corruption buff if standing on corrupted tile
            const buff=corruption.getGhostBuff(g.x,g.y);
            if(buff){
                g._corrSpeedBuff=buff.speedMult;
                g._corrDamageBuff=buff.damageMult;
            } else {
                g._corrSpeedBuff=1;
                g._corrDamageBuff=1;
            }

            // Nearby allies for group behavior
            const allies=this._spatialHash.nearby(g.x,g.y,200).filter(e=>e!==g&&e.health>0);
            g._alliesNearby=allies.length;

            g.update(player,cm,dt);

            if(!player.invulnerable){
                const dmg=g.attack(player);
                if(dmg>0){
                    const totalDmg=dmg*(g._corrDamageBuff||1);
                    player.health=Math.max(0,player.health-totalDmg);
                    events.emit('playerDamaged',{amount:totalDmg,source:g});
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════════════════════════

class HUD {
    constructor(r){this.renderer=r;this._waveAnnounce=null;}

    onWaveStart(wave){this._waveAnnounce={wave,born:Date.now(),duration:2500};}

    render(player,ghosts,survSecs,wave,countdown,ability,obj,corruption){
        const ctx=this.renderer.ctx,w=this.renderer.canvas.width,h=this.renderer.canvas.height;
        ctx.save(); ctx.globalCompositeOperation='source-over';

        // Health bar
        const bx=20,by=20,bw=180,bh=16,hp=Math.max(0,player.health/player.maxHealth);
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,bx-2,by-2,bw+4,bh+4,4);ctx.fill();
        ctx.fillStyle='rgba(80,20,20,0.7)';this._rr(ctx,bx,by,bw,bh,3);ctx.fill();
        if(hp>0){ctx.fillStyle=`rgb(${Math.round(220-hp*80)},${Math.round(hp*180)},40)`;this._rr(ctx,bx,by,bw*hp,bh,3);ctx.fill();}
        ctx.font='bold 12px monospace';ctx.fillStyle='rgba(255,255,255,0.9)';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText('HP',bx,by+bh+5);ctx.textAlign='right';ctx.fillText(`${Math.ceil(player.health)} / ${player.maxHealth}`,bx+bw,by+bh+5);

        // Enemy breakdown
        const counts={};for(const g of ghosts)counts[g.type]=(counts[g.type]||0)+1;
        const ac={chaser:'rgba(180,200,255,0.9)',tank:'rgba(160,120,240,0.9)',assassin:'rgba(255,120,120,0.9)',orbiter:'rgba(80,220,180,0.9)'};
        const ai={chaser:'👻',tank:'🛡',assassin:'⚔',orbiter:'🌀'};
        let ly=60;ctx.font='bold 11px monospace';ctx.textAlign='left';ctx.textBaseline='top';
        for(const[type,count]of Object.entries(counts)){
            if(!count)continue;const label=`${ai[type]} ${ARCHETYPES[type].label}  ${count}`;const lw=ctx.measureText(label).width+16;
            ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,ly,lw,20,4);ctx.fill();ctx.fillStyle=ac[type];ctx.fillText(label,26,ly+4);ly+=24;
        }

        // Wave
        ctx.font='bold 12px monospace';const wl=`WAVE  ${wave}`,wlW=ctx.measureText(wl).width+16;
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,ly+4,wlW,22,4);ctx.fill();ctx.fillStyle='rgba(255,200,80,0.9)';ctx.fillText(wl,26,ly+8);
        if(countdown>0){ctx.font='11px monospace';const cd=`next wave in ${Math.ceil(countdown)}s`,cdW=ctx.measureText(cd).width+16;ctx.fillStyle='rgba(0,0,0,0.4)';this._rr(ctx,18,ly+30,cdW,20,4);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.45)';ctx.fillText(cd,26,ly+34);}

        // Corruption meter
        const cy=ly+58,cw=180;ctx.font='bold 11px monospace';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,18,cy,cw+4,38,6);ctx.fill();
        ctx.fillStyle='rgba(200,100,200,0.8)';ctx.fillText('☠ KALYUG',26,cy+4);
        ctx.fillStyle='rgba(40,0,30,0.8)';this._rr(ctx,26,cy+18,cw-16,10,4);ctx.fill();
        const cl=corruption.globalLevel,cr=Math.round(80+cl*175);
        ctx.fillStyle=`rgba(${cr},0,${Math.round(120-cl*120)},0.9)`;if(cl>0)this._rr(ctx,26,cy+18,(cw-16)*cl,10,4);ctx.fill();

        // Objective panel
        const px=w-220,oy=70;ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,px,oy,200,obj.waveComplete?80:100,8);ctx.fill();
        ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='rgba(255,255,255,0.7)';ctx.fillText('OBJECTIVE',px+12,oy+10);
        if(obj.waveComplete){ctx.font='bold 13px monospace';ctx.fillStyle='rgba(80,255,160,0.95)';ctx.fillText('✔ Wave Complete!',px+12,oy+32);ctx.font='11px monospace';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText('+30 HP  ·  Speed Buff',px+12,oy+54);}
        else{const rl=obj.required-obj.collected;ctx.font='12px monospace';ctx.fillStyle=rl===0?'rgba(80,255,160,0.9)':'rgba(255,200,60,0.9)';ctx.fillText(`✦ Relics: ${obj.collected} / ${obj.required}`,px+12,oy+32);
            const rw=176,rh=8,rx=px+12,ry=oy+52;ctx.fillStyle='rgba(60,40,0,0.8)';this._rr(ctx,rx,ry,rw,rh,4);ctx.fill();
            if(obj.collected>0){ctx.fillStyle='rgba(255,200,60,0.9)';this._rr(ctx,rx,ry,rw*(obj.collected/obj.required),rh,4);ctx.fill();}
            ctx.font='11px monospace';if(obj.extractionZone){ctx.fillStyle='rgba(80,255,160,0.9)';ctx.fillText('▶ Reach extraction zone!',px+12,oy+72);}else{ctx.fillStyle='rgba(255,255,255,0.35)';ctx.fillText('Collect all relics to extract',px+12,oy+72);}
        }

        // Survival time
        const mins=String(Math.floor(survSecs/60)).padStart(2,'0'),secs=String(Math.floor(survSecs%60)).padStart(2,'0'),ts=`${mins}:${secs}`;
        ctx.font='bold 20px monospace';ctx.textAlign='right';ctx.textBaseline='top';
        const tsW=ctx.measureText(ts).width+24;ctx.fillStyle='rgba(0,0,0,0.5)';this._rr(ctx,w-tsW-10,14,tsW,30,6);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fillText(ts,w-22,20);ctx.font='10px monospace';ctx.fillStyle='rgba(255,255,255,0.4)';ctx.fillText('SURVIVED',w-22,46);

        // Ability bar
        if(ability){
            const ab=ability.ability,ready=ability.isReady,frac=ability.cooldownFraction;
            const abW=200,abH=10,abX=Math.floor(w/2-abW/2),abY=h-54;
            ctx.fillStyle='rgba(0,0,0,0.55)';this._rr(ctx,abX-10,abY-28,abW+20,abH+40,8);ctx.fill();
            ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.textBaseline='top';
            ctx.fillStyle=ready?ab.color:'rgba(150,150,150,0.7)';ctx.fillText(`${ab.icon}  ${ab.name}`,w/2,abY-22);
            ctx.fillStyle='rgba(60,60,60,0.8)';this._rr(ctx,abX,abY,abW,abH,5);ctx.fill();
            if(frac>0){ctx.fillStyle=ready?ab.color:'rgba(180,180,180,0.6)';this._rr(ctx,abX,abY,abW*frac,abH,5);ctx.fill();}
            ctx.font='11px monospace';ctx.textAlign='center';ctx.textBaseline='top';
            if(ready){ctx.fillStyle=ab.color;ctx.fillText('SPACE — READY',w/2,abY+abH+4);}
            else{ctx.fillStyle='rgba(180,180,180,0.6)';ctx.fillText(`${(ability.cooldownRemaining/1000).toFixed(1)}s`,w/2,abY+abH+4);}
            if(player.invulnerable){ctx.font='bold 12px monospace';ctx.fillStyle='rgba(100,255,140,0.9)';ctx.fillText('✦ INVULNERABLE ✦',w/2,abY-42);}
        }

        // Wave announcement banner
        if(this._waveAnnounce){
            const wa=this._waveAnnounce,age=(Date.now()-wa.born)/wa.duration;
            if(age<1){
                const alpha=age<0.2?age/0.2:age>0.8?(1-age)/0.2:1;
                ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.font=`bold ${Math.round(48+age*8)}px sans-serif`;
                ctx.fillStyle=`rgba(255,200,80,${alpha*0.9})`;
                ctx.shadowColor='rgba(255,150,0,0.5)';ctx.shadowBlur=20;
                ctx.fillText(`WAVE ${wa.wave}`,w/2,h*0.35);
                ctx.shadowBlur=0;
            } else { this._waveAnnounce=null; }
        }

        ctx.restore();
    }

    _rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════════════════════════

class InputHandler{
    constructor(){this.keys={};this._pressed=new Set();this.bindEvents();}
    bindEvents(){
        window.addEventListener('keydown',e=>{if(!this.keys[e.code])this._pressed.add(e.code);this.keys[e.code]=true;if(e.code==='Space')e.preventDefault();});
        window.addEventListener('keyup',e=>{this.keys[e.code]=false;});
    }
    isPressed(k){return!!this.keys[k];}
    justPressed(c){return this._pressed.has(c);}
    flushPressed(){this._pressed.clear();}
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER
// ═══════════════════════════════════════════════════════════════════════════════

class Player{
    constructor(x,y){
        this.x=x;this.y=y;this.velocity={x:0,y:0};
        this.speed=5;this.baseSpeed=5;this.speedModifiers=[];
        this.radius=20;this.health=100;this.maxHealth=100;
        this.invulnerable=false;this.angle=0;
        // Stamina system
        this.stamina=100;this.maxStamina=100;this._staminaRegen=8; // per second
    }
    update(input,dt,cm,corruption){
        // Stamina regen
        this.stamina=Math.min(this.maxStamina,this.stamina+this._staminaRegen*(dt/1000));
        this.velocity.x=0;this.velocity.y=0;
        if(input.isPressed('KeyW')||input.isPressed('ArrowUp'))this.velocity.y-=1;
        if(input.isPressed('KeyS')||input.isPressed('ArrowDown'))this.velocity.y+=1;
        if(input.isPressed('KeyA')||input.isPressed('ArrowLeft'))this.velocity.x-=1;
        if(input.isPressed('KeyD')||input.isPressed('ArrowRight'))this.velocity.x+=1;
        const mag=Math.sqrt(this.velocity.x**2+this.velocity.y**2);
        if(mag>0){this.velocity.x=(this.velocity.x/mag)*this.speed;this.velocity.y=(this.velocity.y/mag)*this.speed;this.angle=Math.atan2(this.velocity.y,this.velocity.x);}
        const dt16=dt/16;
        const nx=this.x+this.velocity.x*dt16,ny=this.y+this.velocity.y*dt16;
        const tm=cm?cm.getMovementModifier(nx,ny):1;
        const co=corruption?corruption.getMovementOverlay(nx,ny):1;
        const fx=this.x+this.velocity.x*dt16*tm*co,fy=this.y+this.velocity.y*dt16*tm*co;
        if(cm){if(cm.isWalkable(fx,this.y))this.x=fx;if(cm.isWalkable(this.x,fy))this.y=fy;}
        else{this.x=fx;this.y=fy;}
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

class Renderer{
    constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.camera={x:0,y:0};this._shake={x:0,y:0,magnitude:0,decay:0.85};this.resize();}
    resize(){this.canvas.width=window.innerWidth;this.canvas.height=window.innerHeight;}
    triggerShake(m=8){this._shake.magnitude=Math.max(this._shake.magnitude,m);}
    _updateShake(){if(this._shake.magnitude>0.1){this._shake.x=(Math.random()*2-1)*this._shake.magnitude;this._shake.y=(Math.random()*2-1)*this._shake.magnitude;this._shake.magnitude*=this._shake.decay;}else{this._shake.magnitude=0;this._shake.x=0;this._shake.y=0;}}
    clear(){this.ctx.fillStyle='#111';this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);}
    setCamera(tx,ty){this._updateShake();this.camera.x=tx-this.canvas.width/2+this._shake.x;this.camera.y=ty-this.canvas.height/2+this._shake.y;}
    drawCircle(x,y,r,color){const sx=x-this.camera.x,sy=y-this.camera.y;this.ctx.beginPath();this.ctx.arc(sx,sy,r,0,Math.PI*2);this.ctx.fillStyle=color;this.ctx.fill();this.ctx.closePath();}
    drawFlash(alpha,r,g,b){if(alpha<=0)return;this.ctx.save();this.ctx.globalCompositeOperation='source-over';this.ctx.fillStyle=`rgba(${r},${g},${b},${alpha})`;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();}
    drawGameOver(wave,survSecs){
        const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
        ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(0,0,0,0.78)';ctx.fillRect(0,0,w,h);
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 72px sans-serif';ctx.fillStyle='#cc2222';ctx.fillText('GAME OVER',w/2,h/2-50);
        const mins=String(Math.floor(survSecs/60)).padStart(2,'0'),secs=String(Math.floor(survSecs%60)).padStart(2,'0');
        ctx.font='26px monospace';ctx.fillStyle='rgba(255,200,80,0.9)';ctx.fillText(`Reached Wave ${wave}`,w/2,h/2+10);
        ctx.font='20px sans-serif';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(`Survived ${mins}:${secs}  ·  Refresh to try again`,w/2,h/2+55);
        ctx.restore();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME STATE — system orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

class GameState{
    constructor(player,events){
        this.player=player;
        this.events=events;
        this.ghosts=[];
        this.lighting=null;
        this.particles=[];
        this.projectiles=[];
        this.chunkManager=null;
        this.corruption=null;
        this.timeScale=1;
        this.isGameOver=false;
        this.survivalTime=0;
        this.wave=1;

        // Centralized systems
        this.effects=new EffectSystem();

        // Feedback state
        this.damageFlashAlpha=0;
        this._abilityFlash={alpha:0,color:'#fff'};
    }

    // Legacy compatibility shim — all abilities should use effects.apply() directly
    applyEffect({type,multiplier,duration,tags=[]}){
        const target=type==='lightRadius'?this.lighting:this.player;
        this.effects.apply(type,target,multiplier,duration,tags);
    }

    triggerDamageFlash(){this.damageFlashAlpha=0.55;}
    triggerAbilityFlash(color){this._abilityFlash.alpha=0.4;this._abilityFlash.color=color;}

    update(dt,renderer,ai,corruption,objective){
        if(this.isGameOver)return;
        this.survivalTime+=dt;
        const now=Date.now(),p=this.player;

        this.effects.update();

        if(this.damageFlashAlpha>0)this.damageFlashAlpha=Math.max(0,this.damageFlashAlpha-(dt/16)*0.06);
        if(this._abilityFlash.alpha>0)this._abilityFlash.alpha=Math.max(0,this._abilityFlash.alpha-(dt/16)*0.05);

        // Pool reclaim dead particles
        this.particles=this.particles.filter(pt=>{
            if(now-pt.created>=pt.duration){particlePool.release(pt);return false;}
            return true;
        });
        this.projectiles=this.projectiles.filter(pr=>{const dtt=dt/16;pr.x+=pr.vx*dtt;pr.y+=pr.vy*dtt;return(now-pr.created)<2000;});

        // Ghost updates via AISystem
        this.ghosts=this.ghosts.filter(g=>g.health>0);
        ai.update(this.ghosts,p,this.chunkManager,corruption,dt,this.events);

        // Corruption damage
        if(corruption&&!p.invulnerable){
            const dmg=corruption.getDamageRate(p.x,p.y);
            if(dmg>0){p.health=Math.max(0,p.health-dmg*(dt/1000));if(dmg>2&&Math.random()<0.02)this.triggerDamageFlash();}
        }

        if(p.health<=0){this.isGameOver=true;return;}
        if(this.lighting)this.lighting.update(dt);
        if(this.chunkManager)this.chunkManager.unloadDistant(p.x,p.y);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME — top-level orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

class Game{
    constructor(){
        this.canvas=document.getElementById('gameCanvas');
        this.renderer=new Renderer(this.canvas);
        this.input=new InputHandler();
        this.events=new EventBus();

        const cm=new ChunkManager(32,50);
        const mid=Math.floor(cm.chunkSize/2);
        const sx=mid*cm.tileSize+cm.tileSize/2,sy=mid*cm.tileSize+cm.tileSize/2;

        const player=new Player(sx,sy);
        this.gs=new GameState(player,this.events);
        this.gs.chunkManager=cm;
        this.gs.lighting=new Lighting(this.renderer,{lightRadius:200,darknessColor:'rgba(0,0,0,0.85)',flickerIntensity:0.05});

        // Systems
        this.corruption=new CorruptionSystem(cm.tileSize);
        this.gs.corruption=this.corruption;
        this.aiSystem=new AISystem();
        this.objective=new ObjectiveSystem(this.events);
        this.waveManager=new WaveManager(this.events);
        this.hud=new HUD(this.renderer);
        this.chunkRenderer=new ChunkRenderer(this.renderer);

        const picked=ABILITY_ROSTER[Math.floor(Math.random()*ABILITY_ROSTER.length)];
        this.ability=new AbilityController(picked);

        // Wire event bus
        this.events.on('playerDamaged',({amount})=>{this.gs.triggerDamageFlash();this.renderer.triggerShake(7+(amount>10?4:0));});
        this.events.on('waveStart',({wave})=>{this.hud.onWaveStart(wave);this.corruption.seed(player.x+(Math.random()-.5)*600,player.y+(Math.random()-.5)*600,4,0.25);});
        this.events.on('waveComplete',()=>{this.renderer.triggerShake(3);});

        // Initial setup
        cm.getSurroundingChunks(sx,sy,2);
        this.gs.ghosts=['chaser','chaser','orbiter','chaser'].map((t,i)=>{
            const a=(i/4)*Math.PI*2,pos=cm.findWalkableNear(sx+Math.cos(a)*350,sy+Math.sin(a)*350);
            return makeGhost(pos,t,1);
        });
        this.objective.spawnRelics(sx,sy,cm,RELICS_PER_WAVE);
        for(let i=0;i<4;i++){const a=(i/4)*Math.PI*2,d=500+Math.random()*300;this.corruption.seed(sx+Math.cos(a)*d,sy+Math.sin(a)*d,3,0.2);}

        this.lastTime=null;
        window.addEventListener('resize',()=>this.renderer.resize());
        requestAnimationFrame(ts=>this.loop(ts));
    }

    update(dt){
        const gs=this.gs;
        if(gs.isGameOver){this.input.flushPressed();return;}
        const sd=dt*gs.timeScale;

        // Ability input
        if(this.input.justPressed('Space')){
            if(this.ability.tryActivate(gs.player,gs)){
                this.renderer.triggerShake(4);
                gs.triggerAbilityFlash(this.ability.ability.color);
            }
        }
        this.input.flushPressed();

        gs.player.update(this.input,sd,gs.chunkManager,this.corruption);
        gs.update(sd,this.renderer,this.aiSystem,this.corruption,this.objective);
        this.ability.update(sd);
        this.waveManager.update(sd,gs,this.objective);
        this.objective.update(gs.player,gs.chunkManager,sd,gs);
        this.corruption.update(sd,gs.player,this.waveManager.wave,gs.chunkManager,this.events);
        gs.wave=this.waveManager.wave;

        // Ghosts trail corruption
        if(Math.random()<0.015&&gs.ghosts.length>0){
            const g=gs.ghosts[Math.floor(Math.random()*gs.ghosts.length)];
            this.corruption.seed(g.x,g.y,1,0.05+this.corruption.globalLevel*0.08);
        }
    }

    render(){
        const gs=this.gs;
        const{player,ghosts,particles,projectiles,chunkManager,lighting,damageFlashAlpha,isGameOver,survivalTime,_abilityFlash}=gs;
        const{wave,countdown}=this.waveManager;

        this.renderer.clear();
        this.renderer.setCamera(player.x,player.y);

        // LAYER 1: Terrain
        if(chunkManager){const chunks=chunkManager.getSurroundingChunks(player.x,player.y,1);this.chunkRenderer.render(chunks,chunkManager.chunkSize,chunkManager.tileSize);}

        // LAYER 2: Corruption overlay
        this.corruption.render(this.renderer);

        // LAYER 3: Objective world elements
        this.objective.renderWorld(this.renderer);

        // LAYER 4: Particles
        const now=Date.now();
        for(const p of particles){
            const age=(now-p.created)/p.duration;
            const r=(p.radius||30)*(0.2+age*0.8)*0.15;
            this.renderer.drawCircle(p.x+(p.vx||0)*age*20,p.y+(p.vy||0)*age*20,r,p.color||'rgba(255,200,100,0.5)');
        }

        // LAYER 5: Projectiles
        projectiles.forEach(p=>this.renderer.drawCircle(p.x,p.y,5,'rgba(255,255,100,0.9)'));

        // LAYER 6: Entities (ghosts)
        ghosts.forEach(g=>{if(g.render)g.render(this.renderer);});

        // LAYER 7: Player
        const pc=player.invulnerable?'#88ffaa':'#e94560';
        this.renderer.drawCircle(player.x,player.y,player.radius,pc);
        if(player.invulnerable)this.renderer.drawCircle(player.x,player.y,player.radius+6,'rgba(100,255,140,0.25)');

        // LAYER 8: Lighting / fog of war
        if(lighting)lighting.render(player);

        // LAYER 9: Screen-space FX
        this.corruption.renderVignette(this.renderer);
        this.objective.renderFlash(this.renderer);
        if(_abilityFlash.alpha>0)this.renderer.drawFlash(_abilityFlash.alpha*0.35,..._abilityFlash.color.slice(1).match(/.{2}/g).map(h=>parseInt(h,16)));
        this.renderer.drawFlash(damageFlashAlpha,220,30,30);

        // LAYER 10: HUD
        if(!isGameOver)this.hud.render(player,ghosts,survivalTime/1000,wave,countdown,this.ability,this.objective,this.corruption);

        // LAYER 11: Game over
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