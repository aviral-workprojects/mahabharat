import hashlib
import random
from typing import Dict, List, Tuple
from dataclasses import dataclass
from terrain import TerrainGenerator

@dataclass
class Chunk:
    x: int
    y: int
    terrain: List[List[str]]
    entities: List[Dict]
    seed: int

class ChunkManager:
    def __init__(self, world_seed: int = None, chunk_size: int = 32):
        self.world_seed = world_seed or random.randint(0, 2**31)
        self.chunk_size = chunk_size
        self.loaded_chunks: Dict[Tuple[int, int], Chunk] = {}
        self.terrain_generator = TerrainGenerator(self.world_seed)

    def get_chunk_seed(self, chunk_x: int, chunk_y: int) -> int:
        hash_input = f"{self.world_seed}:{chunk_x}:{chunk_y}"
        hash_bytes = hashlib.md5(hash_input.encode()).digest()
        return int.from_bytes(hash_bytes[:4], byteorder='big')

    def generate_chunk(self, chunk_x: int, chunk_y: int) -> Chunk:
        chunk_seed = self.get_chunk_seed(chunk_x, chunk_y)
        rng = random.Random(chunk_seed)
        
        terrain = self._generate_terrain(chunk_x, chunk_y)
        entities = self._generate_entities(chunk_x, chunk_y, rng)
        
        chunk = Chunk(
            x=chunk_x,
            y=chunk_y,
            terrain=terrain,
            entities=entities,
            seed=chunk_seed
        )
        
        self.loaded_chunks[(chunk_x, chunk_y)] = chunk
        return chunk

    def _generate_terrain(self, chunk_x: int, chunk_y: int) -> List[List[str]]:
        terrain = []
        
        for local_y in range(self.chunk_size):
            row = []
            for local_x in range(self.chunk_size):
                world_x = chunk_x * self.chunk_size + local_x
                world_y = chunk_y * self.chunk_size + local_y
                
                terrain_type = self.terrain_generator.get_terrain_type(world_x, world_y)
                row.append(terrain_type.value)
            terrain.append(row)
        
        return terrain

    def _generate_entities(self, chunk_x: int, chunk_y: int, rng: random.Random) -> List[Dict]:
        entities = []
        
        ghost_count = rng.randint(0, 3)
        for _ in range(ghost_count):
            local_x = rng.uniform(0, self.chunk_size)
            local_y = rng.uniform(0, self.chunk_size)
            
            entities.append({
                "type": "ghost",
                "x": chunk_x * self.chunk_size + local_x,
                "y": chunk_y * self.chunk_size + local_y,
                "id": f"ghost_{chunk_x}_{chunk_y}_{rng.randint(0, 999999)}"
            })
        
        return entities

    def get_chunk(self, chunk_x: int, chunk_y: int) -> Chunk:
        key = (chunk_x, chunk_y)
        if key in self.loaded_chunks:
            return self.loaded_chunks[key]
        return self.generate_chunk(chunk_x, chunk_y)

    def get_chunk_at_world(self, world_x: float, world_y: float) -> Chunk:
        chunk_x = int(world_x // self.chunk_size)
        chunk_y = int(world_y // self.chunk_size)
        return self.get_chunk(chunk_x, chunk_y)

    def get_surrounding_chunks(self, world_x: float, world_y: float, radius: int = 1) -> List[Chunk]:
        center_chunk_x = int(world_x // self.chunk_size)
        center_chunk_y = int(world_y // self.chunk_size)
        
        chunks = []
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                chunk = self.get_chunk(center_chunk_x + dx, center_chunk_y + dy)
                chunks.append(chunk)
        
        return chunks

    def unload_distant_chunks(self, world_x: float, world_y: float, max_distance: int = 3):
        center_chunk_x = int(world_x // self.chunk_size)
        center_chunk_y = int(world_y // self.chunk_size)
        
        to_unload = []
        for (chunk_x, chunk_y) in self.loaded_chunks:
            distance = max(abs(chunk_x - center_chunk_x), abs(chunk_y - center_chunk_y))
            if distance > max_distance:
                to_unload.append((chunk_x, chunk_y))
        
        for key in to_unload:
            del self.loaded_chunks[key]

    def is_walkable(self, world_x: float, world_y: float) -> bool:
        chunk = self.get_chunk_at_world(world_x, world_y)
        
        local_x = int(world_x - chunk.x * self.chunk_size)
        local_y = int(world_y - chunk.y * self.chunk_size)
        
        if 0 <= local_y < self.chunk_size and 0 <= local_x < self.chunk_size:
            terrain = chunk.terrain[local_y][local_x]
            return terrain not in ['cliff']
        
        return False