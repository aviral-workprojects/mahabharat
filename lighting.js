class Lighting {
    constructor(renderer, options = {}) {
        this.renderer = renderer;
        this.lightRadius = options.lightRadius || 200;
        this.darknessColor = options.darknessColor || 'rgba(0, 0, 0, 0.85)';
        this.flickerIntensity = options.flickerIntensity || 0.05;
        this.baseFlicker = 0;
    }

    update(deltaTime) {
        this.baseFlicker += deltaTime * 0.01;
    }

    getFlickerOffset() {
        return Math.sin(this.baseFlicker) * this.flickerIntensity + 
               Math.sin(this.baseFlicker * 2.3) * (this.flickerIntensity * 0.5);
    }

    render(player) {
        const ctx = this.renderer.ctx;
        const canvas = this.renderer.canvas;

        ctx.save();

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = this.darknessColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'destination-out';

        const screenX = player.x - this.renderer.camera.x;
        const screenY = player.y - this.renderer.camera.y;
        const flicker = this.getFlickerOffset();
        const currentRadius = this.lightRadius + (flicker * this.lightRadius);

        const gradient = ctx.createRadialGradient(
            screenX, screenY, 0,
            screenX, screenY, currentRadius
        );

        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.beginPath();
        ctx.arc(screenX, screenY, currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.restore();
    }
}

export default Lighting;