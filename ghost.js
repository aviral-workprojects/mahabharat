class Ghost {
    constructor(x, y, options = {}) {
        this.x = x;
        this.y = y;
        this.speed = options.speed || 2;
        this.radius = options.radius || 15;
        this.damage = options.damage || 10;
        this.health = options.health || 30;
        this.maxHealth = this.health;
        this.color = options.color || 'rgba(200, 200, 255, 0.6)';
        this.ai = null;
        this.isVisible = false;
        this.lastAttack = 0;
        this.attackCooldown = 1000;
    }

    setAI(ai) {
        this.ai = ai;
    }

    update(player, map, deltaTime) {
        if (this.ai) {
            const move = this.ai.getMovement(this, player, map, deltaTime);
            this.x += move.x;
            this.y += move.y;
        }
    }

    canAttack(player) {
        const now = Date.now();
        if (now - this.lastAttack < this.attackCooldown) return false;
        
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance <= this.radius + player.radius;
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
        return this.health <= 0;
    }

    render(renderer) {
        const screenX = this.x - renderer.camera.x;
        const screenY = this.y - renderer.camera.y;

        renderer.ctx.beginPath();
        renderer.ctx.arc(screenX, screenY, this.radius, 0, Math.PI * 2);
        renderer.ctx.fillStyle = this.color;
        renderer.ctx.fill();
        
        renderer.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        renderer.ctx.lineWidth = 2;
        renderer.ctx.stroke();
        renderer.ctx.closePath();

        const wispOffset = Math.sin(Date.now() * 0.005) * 5;
        renderer.ctx.beginPath();
        renderer.ctx.arc(screenX + wispOffset, screenY - this.radius - 5, 5, 0, Math.PI * 2);
        renderer.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        renderer.ctx.fill();
        renderer.ctx.closePath();
    }
}

export default Ghost;