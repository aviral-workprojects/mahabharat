from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import math
import random

app = FastAPI(title="Mahabharata Game Backend")

class Position(BaseModel):
    x: float
    y: float

class GhostDecisionRequest(BaseModel):
    player_position: Position
    ghost_position: Position
    ghost_id: Optional[str] = None
    map_data: Optional[List[List[int]]] = None

class GhostDecisionResponse(BaseModel):
    direction: Position
    action: Optional[str] = "chase"

class MapGenerationRequest(BaseModel):
    width: int = 50
    height: int = 50
    seed: Optional[int] = None

class MapGenerationResponse(BaseModel):
    grid: List[List[int]]
    width: int
    height: int

@app.get("/")
async def root():
    return {"status": "Mahabharata Game Backend Running"}

@app.get("/generate-map", response_model=MapGenerationResponse)
async def generate_map(width: int = 50, height: int = 50, seed: Optional[int] = None):
    if seed is not None:
        random.seed(seed)
    
    grid = []
    
    for y in range(height):
        row = []
        for x in range(width):
            if x == 0 or x == width - 1 or y == 0 or y == height - 1:
                row.append(1)
            else:
                if random.random() < 0.15:
                    row.append(1)
                else:
                    row.append(0)
        grid.append(row)
    
    start_x, start_y = width // 2, height // 2
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if 0 <= start_y + dy < height and 0 <= start_x + dx < width:
                grid[start_y + dy][start_x + dx] = 0
    
    return MapGenerationResponse(
        grid=grid,
        width=width,
        height=height
    )

@app.post("/ghost-decision", response_model=GhostDecisionResponse)
async def ghost_decision(request: GhostDecisionRequest):
    dx = request.player_position.x - request.ghost_position.x
    dy = request.player_position.y - request.ghost_position.y
    distance = math.sqrt(dx ** 2 + dy ** 2)
    
    if distance == 0:
        return GhostDecisionResponse(
            direction=Position(x=0, y=0),
            action="idle"
        )
    
    normalized_x = dx / distance
    normalized_y = dy / distance
    
    action = "chase"
    if distance > 400:
        action = "wander"
        angle = random.uniform(0, 2 * math.pi)
        normalized_x = math.cos(angle)
        normalized_y = math.sin(angle)
    
    return GhostDecisionResponse(
        direction=Position(x=normalized_x, y=normalized_y),
        action=action
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)