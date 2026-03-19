class Map {
    constructor(width, height, tileSize = 50) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.grid = [];
    }

    generateSimpleMap(width, height) {
        this.width = width;
        this.height = height;
        this.grid = [];

        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    row.push(1);
                } else {
                    row.push(0);
                }
            }
            this.grid.push(row);
        }
    }

    isWalkable(x, y) {
        const col = Math.floor(x / this.tileSize);
        const row = Math.floor(y / this.tileSize);

        if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
            return false;
        }

        return this.grid[row][col] === 0;
    }
}

export default Map;