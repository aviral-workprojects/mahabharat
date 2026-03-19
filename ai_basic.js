class BasicAI {
    constructor(options = {}) {
        this.detectionRange = options.detectionRange || 300;
        this.stopDistance = options.stopDistance || 25;
        this.wanderRadius = options.wanderRadius || 50;
        this.wanderTime = options.wanderTime || 2000;
        this.lastWander = 0;
        this.wanderTarget = null;
    }

    getMovement(ghost, player, map, deltaTime) {
        const dx = player.x - ghost.x;
        const dy = player.y - ghost.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= this.detectionRange) {
            return this.chase(dx, dy, distance, ghost.speed, deltaTime);
        } else {
            return this.wander(ghost, deltaTime);
        }
    }

    chase(dx, dy, distance, speed, deltaTime) {
        if (distance < this.stopDistance) {
            return { x: 0, y: 0 };
        }

        const normalizedX = dx / distance;
        const normalizedY = dy / distance;

        return {
            x: normalizedX * speed * (deltaTime / 16),
            y: normalizedY * speed * (deltaTime / 16)
        };
    }

    wander(ghost, deltaTime) {
        const now = Date.now();

        if (!this.wanderTarget || now - this.lastWander > this.wanderTime) {
            const angle = Math.random() * Math.PI * 2;
            this.wanderTarget = {
                x: Math.cos(angle) * this.wanderRadius,
                y: Math.sin(angle) * this.wanderRadius
            };
            this.lastWander = now;
        }

        const dx = this.wanderTarget.x;
        const dy = this.wanderTarget.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5) {
            return { x: 0, y: 0 };
        }

        return {
            x: (dx / distance) * ghost.speed * 0.3 * (deltaTime / 16),
            y: (dy / distance) * ghost.speed * 0.3 * (deltaTime / 16)
        };
    }
}

export default BasicAI;