import hashlib, random
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
from terrrain import TerrainGenerator

# ─── Chunk ────────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    x:       int
    y:       int
    terrain: List[List[str]]
    entities: List[Dict]
    seed:    int

# ─── Chunk Manager ────────────────────────────────────────────────────────────

class ChunkManager:
    """
    Deterministic chunk manager.
    Uses the same seed and RNG strategy as the frontend ChunkManager so
    backend and frontend terrain always agree given the same world_seed.
    """

    CHUNK_SIZE: int = 32

    def __init__(self, world_seed: Optional[int] = None, chunk_size: int = 32):
        self.world_seed  = world_seed if world_seed is not None else random.randint(0, 2 ** 31)
        self.chunk_size  = chunk_size
        self.loaded_chunks: Dict[Tuple[int, int], Chunk] = {}
        self.terrain_generator = TerrainGenerator(self.world_seed)

    # ── Seeding ───────────────────────────────────────────────────────────────

    def get_chunk_seed(self, chunk_x: int, chunk_y: int) -> int:
        """Deterministic hash — matches frontend _chunkRng logic."""
        h = self.world_seed ^ (chunk_x * 374761393) ^ (chunk_y * 1057926937)
        h = ((h ^ (h >> 13)) * 1540483477) & 0xFFFFFFFF
        h ^= h >> 15
        return h

    def _rng(self, chunk_x: int, chunk_y: int) -> random.Random:
        return random.Random(self.get_chunk_seed(chunk_x, chunk_y))

    # ── Generation ────────────────────────────────────────────────────────────

    def generate_chunk(self, chunk_x: int, chunk_y: int) -> Chunk:
        rng      = self._rng(chunk_x, chunk_y)
        terrain  = self._generate_terrain(chunk_x, chunk_y, rng)
        entities = self._generate_entities(chunk_x, chunk_y, rng)
        chunk = Chunk(x=chunk_x, y=chunk_y, terrain=terrain, entities=entities, seed=self.get_chunk_seed(chunk_x, chunk_y))
        self.loaded_chunks[(chunk_x, chunk_y)] = chunk
        return chunk

    def _generate_terrain(self, chunk_x: int, chunk_y: int, rng: random.Random) -> List[List[str]]:
        terrain = []
        sz = self.chunk_size

        for local_y in range(sz):
            row = []
            for local_x in range(sz):
                is_border = local_x == 0 or local_y == 0 or local_x == sz - 1 or local_y == sz - 1
                if is_border:
                    row.append('cliff')
                elif rng.random() < 0.08:
                    row.append('rock')
                elif rng.random() < 0.12:
                    row.append('dune')
                else:
                    row.append('plain')
            terrain.append(row)

        # Clear safe zone in the origin chunk
        if chunk_x == 0 and chunk_y == 0:
            mid = sz // 2
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    terrain[mid + dy][mid + dx] = 'plain'

        return terrain

    def _generate_entities(self, chunk_x: int, chunk_y: int, rng: random.Random) -> List[Dict]:
        entities = []
        ghost_count = rng.randint(0, 3)
        for _ in range(ghost_count):
            lx = rng.uniform(1, self.chunk_size - 1)
            ly = rng.uniform(1, self.chunk_size - 1)
            entities.append({
                "type": "ghost",
                "x":    chunk_x * self.chunk_size + lx,
                "y":    chunk_y * self.chunk_size + ly,
                "id":   f"ghost_{chunk_x}_{chunk_y}_{rng.randint(0, 999999)}"
            })
        return entities

    # ── Access ────────────────────────────────────────────────────────────────

    def get_chunk(self, chunk_x: int, chunk_y: int) -> Chunk:
        key = (chunk_x, chunk_y)
        if key not in self.loaded_chunks:
            return self.generate_chunk(chunk_x, chunk_y)
        return self.loaded_chunks[key]

    def get_chunk_at_world(self, world_x: float, world_y: float) -> Chunk:
        return self.get_chunk(int(world_x // self.chunk_size), int(world_y // self.chunk_size))

    def get_surrounding_chunks(self, world_x: float, world_y: float, radius: int = 1) -> List[Chunk]:
        cx = int(world_x // self.chunk_size)
        cy = int(world_y // self.chunk_size)
        return [self.get_chunk(cx + dx, cy + dy) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1)]

    def unload_distant_chunks(self, world_x: float, world_y: float, max_distance: int = 3):
        cx = int(world_x // self.chunk_size)
        cy = int(world_y // self.chunk_size)
        to_remove = [(kx, ky) for kx, ky in self.loaded_chunks if max(abs(kx - cx), abs(ky - cy)) > max_distance]
        for key in to_remove:
            del self.loaded_chunks[key]

    # ── Queries ───────────────────────────────────────────────────────────────

    def is_walkable(self, world_x: float, world_y: float) -> bool:
        chunk  = self.get_chunk_at_world(world_x, world_y)
        lx     = int(world_x - chunk.x * self.chunk_size)
        ly     = int(world_y - chunk.y * self.chunk_size)
        if 0 <= ly < self.chunk_size and 0 <= lx < self.chunk_size:
            return chunk.terrain[ly][lx] not in ('cliff', 'rock')
        return False

    def get_movement_cost(self, world_x: float, world_y: float) -> float:
        chunk  = self.get_chunk_at_world(world_x, world_y)
        lx     = int(world_x - chunk.x * self.chunk_size)
        ly     = int(world_y - chunk.y * self.chunk_size)
        if 0 <= ly < self.chunk_size and 0 <= lx < self.chunk_size:
            tile = chunk.terrain[ly][lx]
            return {'plain': 1.0, 'dune': 1.5, 'rock': 2.0, 'cliff': 99.0}.get(tile, 1.0)
        return 99.0

    def build_grid_around(self, world_x: float, world_y: float, radius: int = 2) -> List[List[int]]:
        """Build a 0/1 walkability grid for pathfinding, centred on world_x/y."""
        chunks  = self.get_surrounding_chunks(world_x, world_y, radius)
        sz      = self.chunk_size
        span    = radius * 2 + 1
        total   = span * sz
        grid    = [[0] * total for _ in range(total)]
        cx_base = int(world_x // sz) - radius
        cy_base = int(world_y // sz) - radius

        for chunk in chunks:
            col_off = (chunk.x - cx_base) * sz
            row_off = (chunk.y - cy_base) * sz
            for ty in range(sz):
                for tx in range(sz):
                    tile = chunk.terrain[ty][tx]
                    grid[row_off + ty][col_off + tx] = 0 if tile in ('plain', 'dune') else 1

        return grid