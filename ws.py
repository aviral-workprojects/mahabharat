from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from pathfinding import get_next_move, astar
import json, math, random, time, asyncio

# ─── State models ─────────────────────────────────────────────────────────────

@dataclass
class Vec2:
    x: float
    y: float

@dataclass
class GhostPayload:
    id:     str
    x:      float
    y:      float
    type:   str   = "chaser"
    health: float = 30
    speed:  float = 2.0

@dataclass
class ClientState:
    player_id:       str
    room_id:         str
    player_position: Vec2
    ghosts:          List[GhostPayload]
    map_grid:        List[List[int]]
    wave:            int
    corruption_level: float
    timestamp:       float

@dataclass
class GhostDecision:
    ghost_id:   str
    direction:  Vec2
    action:     str
    speed_mult: float = 1.0

# ─── Path cache ───────────────────────────────────────────────────────────────

class PathCache:
    """Cache A* paths per ghost. Recompute only when ghost moves >2 tiles or path expires."""

    def __init__(self, ttl_ms: float = 1200, tile_size: float = 1.0):
        self._cache:    Dict[str, dict] = {}
        self._ttl_ms  = ttl_ms
        self._tile_sz = tile_size

    def get(self, ghost_id: str, start: Tuple[int,int], goal: Tuple[int,int]) -> Optional[List[Tuple[int,int]]]:
        entry = self._cache.get(ghost_id)
        if not entry:
            return None
        age = (time.time() * 1000) - entry["ts"]
        if age > self._ttl_ms:
            return None
        if entry["goal"] != goal:
            return None
        # Check ghost hasn't drifted too far from cached start
        ds = abs(start[0] - entry["start"][0]) + abs(start[1] - entry["start"][1])
        if ds > 2:
            return None
        return entry["path"]

    def set(self, ghost_id: str, start: Tuple[int,int], goal: Tuple[int,int], path: List[Tuple[int,int]]):
        self._cache[ghost_id] = {"start": start, "goal": goal, "path": path, "ts": time.time() * 1000}

    def invalidate(self, ghost_id: str):
        self._cache.pop(ghost_id, None)

_path_cache = PathCache(ttl_ms=1200)

# ─── Connection manager ───────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self._connections: Dict[str, WebSocket] = {}   # room_id → ws

    async def connect(self, ws: WebSocket, room_id: str):
        await ws.accept()
        self._connections[room_id] = ws

    def disconnect(self, room_id: str):
        self._connections.pop(room_id, None)

    async def send(self, room_id: str, data: dict):
        ws = self._connections.get(room_id)
        if ws:
            await ws.send_text(json.dumps(data))

manager = ConnectionManager()

# ─── Decision logic ───────────────────────────────────────────────────────────

DETECTION_RANGES = {"chaser": 300, "tank": 280, "assassin": 500, "orbiter": 350}

def _normalize(dx: float, dy: float) -> Tuple[float, float]:
    d = math.sqrt(dx * dx + dy * dy)
    return (dx / d, dy / d) if d > 0 else (0.0, 0.0)

def _speed_mult(ghost: GhostPayload, corr: float) -> float:
    mult = 1.0
    if corr > 0.55:
        mult += (corr - 0.55) / 0.45 * 0.5
    return round(mult, 3)

def _process_ghost(
    ghost: GhostPayload,
    player: Vec2,
    map_grid: List[List[int]],
    wave: int,
    corr: float
) -> GhostDecision:
    gx, gy   = ghost.x, ghost.y
    px, py   = player.x, player.y
    dx, dy   = px - gx, py - gy
    distance = math.sqrt(dx * dx + dy * dy)
    detection = DETECTION_RANGES.get(ghost.type, 300) + (wave - 1) * 15
    speed_m  = _speed_mult(ghost, corr)

    if distance > detection:
        angle = random.uniform(0, 2 * math.pi)
        return GhostDecision(ghost_id=ghost.id, direction=Vec2(math.cos(angle), math.sin(angle)), action="wander", speed_mult=speed_m * 0.3)

    if distance <= 40:
        return GhostDecision(ghost_id=ghost.id, direction=Vec2(0, 0), action="attack", speed_mult=1.0)

    # A* for waves 3+ if map available, with caching
    if map_grid and wave >= 3:
        start = (int(gx), int(gy))
        goal  = (int(px), int(py))
        path  = _path_cache.get(ghost.id, start, goal)
        if path is None:
            path = astar(map_grid, start, goal)
            if path:
                _path_cache.set(ghost.id, start, goal, path)
        if path and len(path) > 1:
            nxt = path[1]
            dx, dy = nxt[0] - gx, nxt[1] - gy

    nx, ny = _normalize(dx, dy)
    action = "surround" if ghost.type == "orbiter" else "chase"
    return GhostDecision(ghost_id=ghost.id, direction=Vec2(nx, ny), action=action, speed_mult=speed_m)

async def _process_decisions_async(state: ClientState) -> List[GhostDecision]:
    """Run ghost decisions in executor to avoid blocking the event loop on large waves."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _process_all_sync, state)

def _process_all_sync(state: ClientState) -> List[GhostDecision]:
    return [
        _process_ghost(g, state.player_position, state.map_grid, state.wave, state.corruption_level)
        for g in state.ghosts
    ]

# ─── WebSocket endpoint ───────────────────────────────────────────────────────

async def websocket_endpoint(ws: WebSocket, room_id: str = "default", player_id: str = "anon"):
    await manager.connect(ws, room_id)

    try:
        while True:
            raw = await ws.receive_text()

            try:
                data = json.loads(raw)

                # Parse incoming payload
                pp = data.get("player_position", {"x": 0, "y": 0})
                state = ClientState(
                    player_id        = data.get("player_id", player_id),
                    room_id          = data.get("room_id",   room_id),
                    player_position  = Vec2(pp["x"], pp["y"]),
                    ghosts           = [
                        GhostPayload(
                            id     = g.get("id", f"ghost_{i}"),
                            x      = g.get("x", 0),
                            y      = g.get("y", 0),
                            type   = g.get("type", "chaser"),
                            health = g.get("health", 30),
                            speed  = g.get("speed", 2.0)
                        )
                        for i, g in enumerate(data.get("ghosts", []))
                    ],
                    map_grid         = data.get("map_grid", []),
                    wave             = data.get("wave", 1),
                    corruption_level = data.get("corruption", {}).get("globalLevel", 0.0),
                    timestamp        = data.get("timestamp", time.time() * 1000)
                )

                decisions = await _process_decisions_async(state)

                response = {
                    "decisions": [
                        {
                            "ghost_id":   d.ghost_id,
                            "direction":  {"x": d.direction.x, "y": d.direction.y},
                            "action":     d.action,
                            "speed_mult": d.speed_mult
                        }
                        for d in decisions
                    ],
                    "timestamp":   state.timestamp,
                    "server_time": time.time() * 1000
                }

                await ws.send_text(json.dumps(response))

            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"error": "Invalid JSON"}))
            except Exception as e:
                await ws.send_text(json.dumps({"error": str(e)}))

    except WebSocketDisconnect:
        manager.disconnect(room_id)