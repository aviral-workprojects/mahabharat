class InputHandler {
    constructor() {
        this.keys = {};
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    isPressed(key) {
        return !!this.keys[key.toLowerCase()];
    }
}

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.velocity = { x: 0, y: 0 };
        this.speed = 5;
        this.radius = 20;
        this.health = 100;
        this.maxHealth = 100;
        this.invulnerable = false;
        this.angle = 0;
    }

    update(input, deltaTime) {
        this.velocity.x = 0;
        this.velocity.y = 0;

        if (input.isPressed('w')) this.velocity.y -= 1;
        if (input.isPressed('s')) this.velocity.y += 1;
        if (input.isPressed('a')) this.velocity.x -= 1;
        if (input.isPressed('d')) this.velocity.x += 1;

        const magnitude = Math.sqrt(
            this.velocity.x ** 2 + this.velocity.y ** 2
        );

        if (magnitude > 0) {
            this.velocity.x = (this.velocity.x / magnitude) * this.speed;
            this.velocity.y = (this.velocity.y / magnitude) * this.speed;
            this.angle = Math.atan2(this.velocity.y, this.velocity.x);
        }

        const dt = deltaTime / 16;
        this.x += this.velocity.x * dt;
        this.y += this.velocity.y * dt;
    }
}

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
        this.ctx.fillStyle = '#1a1a2e';
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

    drawGrid() {
        const gridSize = 50;
        const offsetX = -this.camera.x % gridSize;
        const offsetY = -this.camera.y % gridSize;

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 1;

        for (let x = offsetX; x < this.canvas.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        for (let y = offsetY; y < this.canvas.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }
}

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
        this.map = null;
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
                this.player.speed *= multiplier;
                break;
            case 'lightRadius':
                this.lighting.lightRadius *= multiplier;
                break;
        }

        setTimeout(() => {
            this._revertEffect(effect);
        }, duration);
    }

    _revertEffect(effect) {
        switch (effect.type) {
            case 'speed':
                this.player.speed /= effect.multiplier;
                break;
            case 'lightRadius':
                this.lighting.lightRadius /= effect.multiplier;
                break;
        }
        this.activeEffects = this.activeEffects.filter(e => e !== effect);
    }

    update(deltaTime) {
        const now = Date.now();

        this.particles = this.particles.filter(p => {
            return (now - p.created) < p.duration;
        });

        this.projectiles = this.projectiles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            return (now - p.created) < 2000;
        });

        this.ghosts.forEach(ghost => {
            ghost.update(this.player, this.map, deltaTime);
        });
    }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.input = new InputHandler();

        const player = new Player(0, 0);
        this.gameState = new GameState(player);

        this.lastTime = null;

        this.bindEvents();
        requestAnimationFrame((timestamp) => this.loop(timestamp));
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.renderer.resize();
        });
    }

    update(deltaTime) {
        const scaledDelta = deltaTime * this.gameState.timeScale;
        this.gameState.player.update(this.input, scaledDelta);
        this.gameState.update(scaledDelta);
    }

    render() {
        const { player, ghosts, particles, projectiles } = this.gameState;

        this.renderer.clear();
        this.renderer.setCamera(player.x, player.y);
        this.renderer.drawGrid();

        ghosts.forEach(ghost => {
            if (ghost.render) ghost.render(this.renderer);
        });

        particles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, p.radius * 0.3, 'rgba(255, 200, 100, 0.4)');
        });

        projectiles.forEach(p => {
            this.renderer.drawCircle(p.x, p.y, 5, 'rgba(255, 255, 100, 0.9)');
        });

        this.renderer.drawCircle(
            player.x,
            player.y,
            player.radius,
            '#e94560'
        );
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

window.addEventListener('DOMContentLoaded', () => {
    new Game();
});