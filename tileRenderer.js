class TileRenderer {
    constructor(renderer) {
        this.renderer = renderer;
        this.colors = {
            ground: '#1a1a2e',
            wall: '#4a4a5e'
        };
    }

    render(map) {
        const startCol = Math.floor(this.renderer.camera.x / map.tileSize);
        const endCol = startCol + Math.ceil(this.renderer.canvas.width / map.tileSize) + 1;
        const startRow = Math.floor(this.renderer.camera.y / map.tileSize);
        const endRow = startRow + Math.ceil(this.renderer.canvas.height / map.tileSize) + 1;

        for (let y = Math.max(0, startRow); y < Math.min(map.height, endRow); y++) {
            for (let x = Math.max(0, startCol); x < Math.min(map.width, endCol); x++) {
                const tile = map.grid[y][x];
                const screenX = x * map.tileSize - this.renderer.camera.x;
                const screenY = y * map.tileSize - this.renderer.camera.y;

                if (tile === 0) {
                    this.renderer.ctx.fillStyle = this.colors.ground;
                } else if (tile === 1) {
                    this.renderer.ctx.fillStyle = this.colors.wall;
                }

                this.renderer.ctx.fillRect(screenX, screenY, map.tileSize, map.tileSize);
                
                this.renderer.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
                this.renderer.ctx.lineWidth = 1;
                this.renderer.ctx.strokeRect(screenX, screenY, map.tileSize, map.tileSize);
            }
        }
    }
}

export default TileRenderer;