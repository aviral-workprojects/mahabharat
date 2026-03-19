from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import math, random, uuid, time

app = FastAPI(title="Kurukshetra Game Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Session store ────────────────────────────────────────────────────────────

class Session:
    def __init__(self, room_id: str, player_id: str):
        self.room_id   = room_id
        self.player_id = player_id
        self.created   = time.time()
        self.last_ping = time.time()

_sessions: Dict[str, Session] = {}

# ─── Models ──────────────────────────────────────────────────────────────────

class Position(BaseModel):
    x: float
    y: float

class GhostData(BaseModel):
    id: str
    x: float
    y: float
    type: str = "chaser"
    health: float = 30
    speed: float = 2

class CorruptionState(BaseModel):
    globalLevel: float = 0.0

class GameStatePayload(BaseModel):
    player_id:       str
    room_id:         str
    player_position: Position
    ghosts:          List[GhostData]
    corruption:      Optional[CorruptionState] = None
    wave:            int = 1
    map_data:        Optional[List[List[int]]] = None
    timestamp:       float = Field(default_factory=lambda: time.time() * 1000)

class GhostDecision(BaseModel):
    ghost_id:  str
    direction: Position
    action:    str
    speed_mult: float = 1.0

class GameStateResponse(BaseModel):
    decisions:  List[GhostDecision]
    timestamp:  float
    server_time: float

class JoinRequest(BaseModel):
    player_id: Optional[str] = None
    room_id:   Optional[str] = None

class JoinResponse(BaseModel):
    player_id: str
    room_id:   str
    session_id: str

class MapRequest(BaseModel):
    width:  int = 50
    height: int = 50
    seed:   Optional[int] = None

class MapResponse(BaseModel):
    grid:   List[List[int]]
    width:  int
    height: int
    seed:   int

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _dist(ax, ay, bx, by) -> float:
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)

def _normalize(dx, dy):
    d = math.sqrt(dx * dx + dy * dy)
    if d == 0:
        return 0.0, 0.0
    return dx / d, dy / d

def _ghost_speed_mult(ghost: GhostData, corruption_level: float) -> float:
    """Return speed multiplier based on ghost type + corruption."""
    base = 1.0
    if corruption_level > 0.55:
        factor = (corruption_level - 0.55) / 0.45
        base += factor * 0.5
    if ghost.type == "assassin":
        base *= 1.1
    elif ghost.type == "tank":
        base *= 0.95
    return round(base, 3)

def _decide_ghost(
    ghost: GhostData,
    player: Position,
    corruption_level: float,
    wave: int,
    map_data: Optional[List[List[int]]]
) -> GhostDecision:
    """Server-side ghost decision — mirrors client BT logic at high level."""
    from pathfinding import get_next_move

    px, py = player.x, player.y
    gx, gy = ghost.x, ghost.y
    distance = _dist(gx, gy, px, py)

    # Detection range grows with wave
    detection_range = {
        "chaser":   300 + (wave - 1) * 15,
        "tank":     280 + (wave - 1) * 15,
        "assassin": 500 + (wave - 1) * 15,
        "orbiter":  350 + (wave - 1) * 15,
    }.get(ghost.type, 300)

    speed_mult = _ghost_speed_mult(ghost, corruption_level)

    if distance > detection_range:
        # Wander
        angle = random.uniform(0, 2 * math.pi)
        return GhostDecision(
            ghost_id=ghost.id,
            direction=Position(x=math.cos(angle), y=math.sin(angle)),
            action="wander",
            speed_mult=speed_mult * 0.3
        )

    if distance <= 40:
        # Attack range — stay put
        return GhostDecision(
            ghost_id=ghost.id,
            direction=Position(x=0, y=0),
            action="attack",
            speed_mult=1.0
        )

    # Chase with optional A* pathing
    dx, dy = px - gx, py - gy
    if map_data and wave >= 3:
        # Use A* for smarter navigation on later waves
        move = get_next_move(map_data, (gx, gy), (px, py))
        if move:
            dx, dy = move[0], move[1]

    nx, ny = _normalize(dx, dy)

    action = "surround" if ghost.type == "orbiter" else "chase"
    return GhostDecision(
        ghost_id=ghost.id,
        direction=Position(x=nx, y=ny),
        action=action,
        speed_mult=speed_mult
    )

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "Kurukshetra Game Backend",
        "version": "2.0.0",
        "status":  "online",
        "sessions": len(_sessions)
    }

@app.post("/join", response_model=JoinResponse)
async def join(req: JoinRequest):
    player_id = req.player_id or str(uuid.uuid4())
    room_id   = req.room_id   or str(uuid.uuid4())
    session   = Session(room_id, player_id)
    sid       = str(uuid.uuid4())
    _sessions[sid] = session
    return JoinResponse(player_id=player_id, room_id=room_id, session_id=sid)

@app.post("/ghost-decisions", response_model=GameStateResponse)
async def ghost_decisions(payload: GameStatePayload):
    """Batch ghost decision endpoint — returns decisions for all ghosts in one call."""
    corr = payload.corruption.globalLevel if payload.corruption else 0.0
    decisions = []

    for ghost in payload.ghosts:
        try:
            decision = _decide_ghost(ghost, payload.player_position, corr, payload.wave, payload.map_data)
            decisions.append(decision)
        except Exception:
            # Fallback: simple normalize
            dx = payload.player_position.x - ghost.x
            dy = payload.player_position.y - ghost.y
            nx, ny = _normalize(dx, dy)
            decisions.append(GhostDecision(ghost_id=ghost.id, direction=Position(x=nx, y=ny), action="chase"))

    return GameStateResponse(decisions=decisions, timestamp=payload.timestamp, server_time=time.time() * 1000)

@app.post("/generate-map", response_model=MapResponse)
async def generate_map(req: MapRequest):
    seed = req.seed if req.seed is not None else random.randint(0, 2**31)
    rng  = random.Random(seed)
    grid = []

    for y in range(req.height):
        row = []
        for x in range(req.width):
            if x == 0 or x == req.width - 1 or y == 0 or y == req.height - 1:
                row.append(1)
            elif rng.random() < 0.15:
                row.append(1)
            else:
                row.append(0)
        grid.append(row)

    # Clear spawn zone
    mx, my = req.width // 2, req.height // 2
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if 0 <= my + dy < req.height and 0 <= mx + dx < req.width:
                grid[my + dy][mx + dx] = 0

    return MapResponse(grid=grid, width=req.width, height=req.height, seed=seed)

@app.get("/ping")
async def ping():
    return {"pong": True, "ts": time.time() * 1000}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")