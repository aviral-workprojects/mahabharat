// ─── Archetype definitions ────────────────────────────────────────────────────

const ARCHETYPES = {
    chaser: {
        label:          'Chaser',
        speed:          3.2,
        health:         25,
        damage:         8,
        radius:         13,
        attackCooldown: 1000,
        color:          'rgba(180, 200, 255, 0.7)',
        glowColor:      '180,200,255',
        aiMode:         'chase',
        detectionRange: 300,
        stopDistance:   22
    },
    tank: {
        label:          'Bhishma',
        speed:          1.4,
        health:         120,
        damage:         14,
        radius:         22,
        attackCooldown: 1400,
        color:          'rgba(140, 100, 220, 0.75)',
        glowColor:      '140,100,220',
        aiMode:         'chase',
        detectionRange: 280,
        stopDistance:   28
    },
    assassin: {
        label:          'Ashwatthama',
        speed:          5.0,
        health:         20,
        damage:         12,
        radius:         11,
        attackCooldown: 500,
        color:          'rgba(255, 120, 120, 0.75)',
        glowColor:      '255,120,120',
        aiMode:         'chase',
        detectionRange: 500,
        stopDistance:   18
    },
    orbiter: {
        label:          'Krishna',
        speed:          2.4,
        health:         35,
        damage:         6,
        radius:         14,
        attackCooldown: 1200,
        color:          'rgba(80, 220, 180, 0.7)',
        glowColor:      '80,220,180',
        aiMode:         'surround',
        detectionRange: 350,
        stopDistance:   25
    }
};

export { ARCHETYPES };

// ─── Ghost ────────────────────────────────────────────────────────────────────

class Ghost {
    constructor(x, y, options = {}) {
        const type     = options.type || 'chaser';
        const archetype = ARCHETYPES[type] || ARCHETYPES.chaser;

        this.type   = type;
        this.label  = archetype.label;
        this.x      = x;
        this.y      = y;

        // Stats — archetype defaults, overridable via options
        this.speed          = options.speed          ?? archetype.speed;
        this.radius         = options.radius         ?? archetype.radius;
        this.damage         = options.damage         ?? archetype.damage;
        this.health         = options.health         ?? archetype.health;
        this.maxHealth      = this.health;
        this.attackCooldown = options.attackCooldown ?? archetype.attackCooldown;

        // Visual
        this.color     = archetype.color;
        this.glowColor = archetype.glowColor;

        // Runtime
        this.ai          = null;
        this.isVisible   = false;
        this.lastAttack  = 0;
        this._hurtFlash  = 0;

        // Assassin-specific burst state
        this._burstCooldown = 0;
        this._bursting      = false;
    }

    setAI(ai) { this.ai = ai; }

    update(player, map, deltaTime) {
        // Assassin speed burst — activates when near detection edge, sprints in
        if (this.type === 'assassin') {
            const dx   = player.x - this.x;
            const dy   = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            this._burstCooldown = Math.max(0, this._burstCooldown - deltaTime);

            if (!this._bursting && dist < 380 && dist > 120 && this._burstCooldown === 0) {
                this._bursting     = true;
                this._burstCooldown = 4000;
                this.speed         = ARCHETYPES.assassin.speed * 2.2;
                setTimeout(() => {
                    this._bursting = false;
                    this.speed     = ARCHETYPES.assassin.speed;
                }, 600);
            }
        }

        if (this.ai) {
            const move = this.ai.getMovement(this, player, map, deltaTime);
            this.x += move.x;
            this.y += move.y;
        }

        if (this._hurtFlash > 0)
            this._hurtFlash = Math.max(0, this._hurtFlash - deltaTime / 180);
    }

    canAttack(player) {
        const now = Date.now();
        if (now - this.lastAttack < this.attackCooldown) return false;
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        return Math.sqrt(dx * dx + dy * dy) <= this.radius + player.radius;
    }

    attack(player) {
        if (this.canAttack(player)) {
            this.lastAttack = Date.now();
            return this.damage;
        }
        return 0;
    }

    takeDamage(amount) {
        this.health -= amount;
        this._hurtFlash = 1;
        return this.health <= 0;
    }

    render(renderer) {
        const sx  = this.x - renderer.camera.x;
        const sy  = this.y - renderer.camera.y;
        const ctx = renderer.ctx;
        const bob = Math.sin(Date.now() * 0.003 + this.x) * 3;

        ctx.save();

        // Burst glow for assassin
        if (this._bursting) {
            ctx.shadowColor = `rgba(${this.glowColor},1)`;
            ctx.shadowBlur  = 28;
        } else {
            ctx.shadowColor = `rgba(${this.glowColor},0.8)`;
            ctx.shadowBlur  = 14;
        }

        // Body — flash to red on hit
        const fr = Math.round(parseInt(this.glowColor.split(',')[0]) + this._hurtFlash * (255 - parseInt(this.glowColor.split(',')[0])));
        const fg = Math.round(parseInt(this.glowColor.split(',')[1]) * (1 - this._hurtFlash));
        const fb = Math.round(parseInt(this.glowColor.split(',')[2]) * (1 - this._hurtFlash * 0.8));
        const bodyColor = `rgba(${fr},${fg},${fb},0.7)`;

        ctx.beginPath();
        ctx.arc(sx, sy + bob, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.closePath();

        // Tank: extra outer ring
        if (this.type === 'tank') {
            ctx.beginPath();
            ctx.arc(sx, sy + bob, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${this.glowColor},0.3)`;
            ctx.lineWidth   = 3;
            ctx.stroke();
            ctx.closePath();
        }

        // Orbiter: dashed orbit circle preview
        if (this.type === 'orbiter') {
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.arc(sx, sy + bob, this.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${this.glowColor},0.2)`;
            ctx.lineWidth   = 1;
            ctx.stroke();
            ctx.closePath();
            ctx.setLineDash([]);
        }

        // Wisp orb
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(sx, sy + bob - this.radius - 5, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
        ctx.closePath();
        ctx.shadowBlur = 0;

        // Health bar (only when damaged)
        if (this.health < this.maxHealth) {
            const bw  = this.radius * 2 + 4;
            const bh  = 4;
            const bx  = sx - bw / 2;
            const by  = sy + bob - this.radius - 16;
            const pct = Math.max(0, this.health / this.maxHealth);

            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = 'rgba(50,0,0,0.8)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = pct > 0.5 ? 'rgba(80,220,80,0.9)' : 'rgba(220,80,60,0.9)';
            ctx.fillRect(bx, by, bw * pct, bh);
        }

        ctx.restore();
    }
}

export default Ghost;