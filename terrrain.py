import random
import math
from typing import List, Tuple
from enum import Enum

class TerrainType(Enum):
    DUNE = "dune"
    PLAIN = "plain"
    ROCK = "rock"
    CLIFF = "cliff"

class PerlinNoise:
    def __init__(self, seed: int = None):
        if seed is not None:
            random.seed(seed)
        
        self.permutation = list(range(256))
        random.shuffle(self.permutation)
        self.permutation += self.permutation

    def fade(self, t: float) -> float:
        return t * t * t * (t * (t * 6 - 15) + 10)

    def lerp(self, t: float, a: float, b: float) -> float:
        return a + t * (b - a)

    def grad(self, hash: int, x: float, y: float) -> float:
        h = hash & 15
        u = x if h < 8 else y
        v = y if h < 4 else (x if h in (12, 14) else 0)
        return (u if (h & 1) == 0 else -u) + (v if (h & 2) == 0 else -v)

    def noise(self, x: float, y: float) -> float:
        X = int(math.floor(x)) & 255
        Y = int(math.floor(y)) & 255

        x -= math.floor(x)
        y -= math.floor(y)

        u = self.fade(x)
        v = self.fade(y)

        A = self.permutation[X] + Y
        B = self.permutation[X + 1] + Y

        return self.lerp(v,
            self.lerp(u,
                self.grad(self.permutation[A], x, y),
                self.grad(self.permutation[B], x - 1, y)
            ),
            self.lerp(u,
                self.grad(self.permutation[A + 1], x, y - 1),
                self.grad(self.permutation[B + 1], x - 1, y - 1)
            )
        )

class TerrainGenerator:
    def __init__(self, seed: int = None):
        self.seed = seed
        self.noise1 = PerlinNoise(seed)
        self.noise2 = PerlinNoise(seed + 1 if seed else 1)
        self.noise3 = PerlinNoise(seed + 2 if seed else 2)

    def get_noise(self, x: float, y: float, scale: float = 1.0) -> float:
        n1 = self.noise1.noise(x * scale, y * scale)
        n2 = self.noise2.noise(x * scale * 2, y * scale * 2) * 0.5
        n3 = self.noise3.noise(x * scale * 4, y * scale * 4) * 0.25
        return (n1 + n2 + n3) / 1.75

    def get_terrain_type(self, x: int, y: int) -> TerrainType:
        elevation = self.get_noise(x, y, 0.01)
        roughness = self.get_noise(x + 1000, y + 1000, 0.02)
        
        if elevation > 0.6:
            return TerrainType.CLIFF
        elif elevation > 0.3 and roughness > 0.2:
            return TerrainType.ROCK
        elif elevation < -0.3:
            return TerrainType.DUNE
        else:
            return TerrainType.PLAIN

    def generate(self, width: int, height: int) -> List[List[str]]:
        terrain = []
        
        for y in range(height):
            row = []
            for x in range(width):
                terrain_type = self.get_terrain_type(x, y)
                row.append(terrain_type.value)
            terrain.append(row)
        
        return terrain

    def get_movement_cost(self, x: int, y: int) -> float:
        terrain_type = self.get_terrain_type(x, y)
        
        costs = {
            TerrainType.PLAIN: 1.0,
            TerrainType.DUNE: 1.5,
            TerrainType.ROCK: 2.0,
            TerrainType.CLIFF: 5.0
        }
        
        return costs.get(terrain_type, 1.0)

    def get_terrain_grid(self, width: int, height: int) -> dict:
        terrain = self.generate(width, height)
        
        return {
            "terrain": terrain,
            "width": width,
            "height": height,
            "seed": self.seed
        }