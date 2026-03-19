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
    }

    update(input) {
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
        }

        this.x += this.velocity.x;
        this.y += this.velocity.y;
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

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.input = new InputHandler();
        this.player = new Player(0, 0);

        this.bindEvents();
        this.loop();
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.renderer.resize();
        });
    }

    update() {
        this.player.update(this.input);
    }

    render() {
        this.renderer.clear();
        this.renderer.setCamera(this.player.x, this.player.y);
        this.renderer.drawGrid();
        this.renderer.drawCircle(
            this.player.x,
            this.player.y,
            this.player.radius,
            '#e94560'
        );
    }

    loop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.loop());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new Game();
});