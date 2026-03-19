// ─── Archetype definitions ────────────────────────────────────────────────────

const ARCHETYPES = {
    chaser: {
        label:'Chaser', speed:3.2, health:25, damage:8, radius:13,
        attackCooldown:1000, glowColor:'180,200,255', aiMode:'chase',
        detectionRange:300, stopDistance:22
    },
    tank: {
        label:'Bhishma', speed:1.4, health:120, damage:14, radius:22,
        attackCooldown:1400, glowColor:'140,100,220', aiMode:'chase',
        detectionRange:280, stopDistance:28
    },
    assassin: {
        label:'Ashwatthama', speed:5.0, health:20, damage:12, radius:11,
        attackCooldown:500, glowColor:'255,120,120', aiMode:'chase',
        detectionRange:500, stopDistance:18
    },
    orbiter: {
        label:'Krishna', speed:2.4, health:35, damage:6, radius:14,
        attackCooldown:1200, glowColor:'80,220,180', aiMode:'surround',
        detectionRange:350, stopDistance:25
    }
};

export { ARCHETYPES };

// ─── Ghost ────────────────────────────────────────────────────────────────────

let _ghostId = 0;

class Ghost {
    constructor(x, y, options = {}) {
        const type      = options.type || 'chaser';
        const archetype = ARCHETYPES[type] || ARCHETYPES.chaser;

        this._id   = _ghostId++;
        this.type  = type;
        this.label = archetype.label;
        this.x = x; this.y = y;

        // Base stats (archetype defaults, overridable)
        this.speed          = options.speed          ?? archetype.speed;
        this.radius         = options.radius         ?? archetype.radius;
        this.damage         = options.damage         ?? archetype.damage;
        this.health         = options.health         ?? archetype.health;
        this.maxHealth      = this.health;
        this.attackCooldown = options.attackCooldown ?? archetype.attackCooldown;
        this.glowColor      = archetype.glowColor;

        // Effect stacking — matches player system for consistency
        this.speedModifiers = [];

        // Runtime
        this.ai             = null;
        this.lastAttack     = 0;
        this._hurtFlash     = 0;

        // Corruption synergy (set by AISystem each frame)
        this._corrSpeedBuff   = 1;
        this._corrDamageBuff  = 1;

        // Assassin burst state
        this._burstCooldown = 0;
        this._bursting      = false;
        this._alliesNearby  = 0;

        // Evolution state (set by wave manager)
        this._evolved = options.wave > 4;
    }

    setAI(ai) { this.ai = ai; }

    get effectiveSpeed() {
        const base = this.speedModifiers.length
            ? this.speed * this.speedModifiers.reduce((a,b) => a*b, 1)
            : this.speed;
        return base * this._corrSpeedBuff;
    }

    update(player, map, deltaTime) {
        // Assassin speed burst
        if (this.type === 'assassin') {
            const dx = player.x - this.x, dy = player.y - this.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            this._burstCooldown = Math.max(0, this._burstCooldown - deltaTime);
            if (!this._bursting && dist < 380 && dist > 120 && this._burstCooldown === 0) {
                this._bursting = true; this._burstCooldown = 4000;
                this.speed = ARCHETYPES.assassin.speed * 2.2;
                setTimeout(() => { this._bursting = false; this.speed = ARCHETYPES.assassin.speed; }, 600);
            }
        }

        if (this.ai) {
            const move = this.ai.getMovement(this, player, map, deltaTime);
            this.x += move.x;
            this.y += move.y;
        }

        if (this._hurtFlash > 0) this._hurtFlash = Math.max(0, this._hurtFlash - deltaTime / 180);
    }

    canAttack(player) {
        if (Date.now() - this.lastAttack < this.attackCooldown) return false;
        const dx = player.x - this.x, dy = player.y - this.y;
        return Math.sqrt(dx*dx+dy*dy) <= this.radius + player.radius;
    }

    attack(player) {
        if (!this.canAttack(player)) return 0;
        this.lastAttack = Date.now();
        // Corruption multiplies effective damage
        return this.damage * this._corrDamageBuff;
    }

    takeDamage(amount) {
        this.health -= amount; this._hurtFlash = 1;
        if (this.ai?.onDamageTaken) this.ai.onDamageTaken(this);
        return this.health <= 0;
    }

    render(renderer) {
        const sx  = this.x - renderer.camera.x;
        const sy  = this.y - renderer.camera.y;
        const ctx = renderer.ctx;
        const bob = Math.sin(Date.now() * 0.003 + this.x) * 3;

        ctx.save();

        // Glow — brighter during burst or when corruption-buffed
        const glowIntensity = (this._bursting ? 1 : 0.8) * (this._corrSpeedBuff > 1 ? 1.3 : 1);
        ctx.shadowColor = `rgba(${this.glowColor},${Math.min(1, glowIntensity)})`;
        ctx.shadowBlur  = this._bursting ? 30 : this._corrSpeedBuff > 1 ? 20 : 14;

        // Hurt-flash tints body red
        const gc = this.glowColor.split(',').map(Number);
        const fr = Math.round(gc[0] + this._hurtFlash * (255 - gc[0]));
        const fg = Math.round(gc[1] * (1 - this._hurtFlash));
        const fb = Math.round(gc[2] * (1 - this._hurtFlash * 0.8));

        // Evolved ghosts: darker, more ominous tint
        const bodyAlpha = this._evolved ? 0.85 : 0.7;
        const bodyColor = `rgba(${this._evolved ? Math.round(fr*0.7) : fr},${fg},${fb},${bodyAlpha})`;

        ctx.beginPath();
        ctx.arc(sx, sy + bob, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor; ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${this._evolved ? 0.35 : 0.2})`; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.closePath();

        // Tank: double outer ring
        if (this.type === 'tank') {
            ctx.beginPath(); ctx.arc(sx, sy + bob, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${this.glowColor},0.3)`; ctx.lineWidth = 3; ctx.stroke(); ctx.closePath();
            if (this._evolved) {
                ctx.beginPath(); ctx.arc(sx, sy + bob, this.radius + 10, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${this.glowColor},0.15)`; ctx.lineWidth = 1; ctx.stroke(); ctx.closePath();
            }
        }

        // Orbiter: dashed orbit preview
        if (this.type === 'orbiter') {
            ctx.setLineDash([4, 6]);
            ctx.beginPath(); ctx.arc(sx, sy + bob, this.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${this.glowColor},0.2)`; ctx.lineWidth = 1; ctx.stroke(); ctx.closePath();
            ctx.setLineDash([]);
        }

        // Corruption aura ring
        if (this._corrSpeedBuff > 1) {
            const corrAlpha = (this._corrSpeedBuff - 1) * 1.2;
            ctx.beginPath(); ctx.arc(sx, sy + bob, this.radius + 12, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(140,0,80,${Math.min(0.7, corrAlpha)})`; ctx.lineWidth = 2; ctx.stroke(); ctx.closePath();
        }

        // Evolved: eerie inner pulse
        if (this._evolved) {
            const pulse = 0.3 + Math.sin(Date.now() * 0.005 + this.x) * 0.2;
            ctx.beginPath(); ctx.arc(sx, sy + bob, this.radius * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${pulse * 0.25})`; ctx.fill(); ctx.closePath();
        }

        // Wisp orb
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(sx, sy + bob - this.radius - 5, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill(); ctx.closePath();
        ctx.shadowBlur = 0;

        // Health bar (only when damaged)
        if (this.health < this.maxHealth) {
            const bw = this.radius * 2 + 4, bh = 4;
            const bx = sx - bw / 2, by = sy + bob - this.radius - 16;
            const pct = Math.max(0, this.health / this.maxHealth);
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx-1, by-1, bw+2, bh+2);
            ctx.fillStyle = 'rgba(50,0,0,0.8)';  ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = pct > 0.5 ? 'rgba(80,220,80,0.9)' : 'rgba(220,80,60,0.9)';
            ctx.fillRect(bx, by, bw * pct, bh);
        }

        ctx.restore();
    }
}

export default Ghost;