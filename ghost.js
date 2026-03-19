class Ghost {
    constructor(x, y, options = {}) {
        this.x = x;
        this.y = y;
        this.speed        = options.speed        || 2;
        this.radius       = options.radius       || 15;
        this.damage       = options.damage       || 10;
        this.health       = options.health       || 30;
        this.maxHealth    = this.health;
        this.color        = options.color        || 'rgba(200, 200, 255, 0.6)';
        this.ai           = null;
        this.isVisible    = false;
        this.lastAttack   = 0;
        this.attackCooldown = 1000;
        // Visual state
        this._hurtFlash   = 0; // alpha for damage tint
    }

    setAI(ai) { this.ai = ai; }

    update(player, map, deltaTime) {
        if (this.ai) {
            const move = this.ai.getMovement(this, player, map, deltaTime);
            this.x += move.x;
            this.y += move.y;
        }
        // Decay hurt flash
        if (this._hurtFlash > 0)
            this._hurtFlash = Math.max(0, this._hurtFlash - deltaTime / 200);
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
        const sx = this.x - renderer.camera.x;
        const sy = this.y - renderer.camera.y;
        const ctx = renderer.ctx;

        // Wisp float offset
        const bob = Math.sin(Date.now() * 0.003 + this.x) * 3;

        ctx.save();

        // Body glow (hurt flash tints red)
        const flashR = Math.round(200 + this._hurtFlash * 55);
        const flashG = Math.round(200 - this._hurtFlash * 180);
        const flashB = 255;
        const bodyColor = `rgba(${flashR},${flashG},${flashB},0.65)`;

        ctx.shadowColor  = bodyColor;
        ctx.shadowBlur   = 12;

        ctx.beginPath();
        ctx.arc(sx, sy + bob, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor;
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.closePath();

        // Wisp orb on top
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(sx, sy + bob - this.radius - 5, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
        ctx.closePath();

        ctx.shadowBlur = 0;

        // Health bar (only if damaged)
        if (this.health < this.maxHealth) {
            const bw = this.radius * 2;
            const bh = 4;
            const bx = sx - this.radius;
            const by = sy + bob - this.radius - 14;
            const pct = Math.max(0, this.health / this.maxHealth);

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);

            ctx.fillStyle = 'rgba(60,0,0,0.8)';
            ctx.fillRect(bx, by, bw, bh);

            ctx.fillStyle = pct > 0.5 ? 'rgba(80,220,80,0.9)' : 'rgba(220,80,60,0.9)';
            ctx.fillRect(bx, by, bw * pct, bh);
        }

        ctx.restore();
    }
}

export default Ghost;