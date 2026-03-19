from fastapi import WebSocket, WebSocketDisconnect
import json
import asyncio
from typing import Dict, List
from dataclasses import dataclass, asdict
from ai.pathfinding import get_next_move

@dataclass
class GameState:
    player_position: Dict[str, float]
    ghosts: List[Dict]
    map_grid: List[List[int]]
    timestamp: float

@dataclass
class GhostDecision:
    ghost_id: str
    direction: Dict[str, float]
    action: str

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

manager = ConnectionManager()

def process_ghost_decisions(game_state: GameState) -> List[GhostDecision]:
    decisions = []
    
    for ghost in game_state.ghosts:
        ghost_pos = (ghost["x"], ghost["y"])
        player_pos = (game_state.player_position["x"], game_state.player_position["y"])
        
        dx = player_pos[0] - ghost_pos[0]
        dy = player_pos[1] - ghost_pos[1]
        distance = (dx ** 2 + dy ** 2) ** 0.5
        
        if distance > 500:
            action = "wander"
            import random
            angle = random.uniform(0, 6.28318)
            direction = {"x": random.uniform(-1, 1), "y": random.uniform(-1, 1)}
        else:
            action = "chase"
            if game_state.map_grid:
                move = get_next_move(game_state.map_grid, ghost_pos, player_pos)
                if move:
                    direction = {"x": move[0], "y": move[1]}
                else:
                    direction = {"x": dx / distance, "y": dy / distance}
            else:
                direction = {"x": dx / distance, "y": dy / distance}
        
        decisions.append(GhostDecision(
            ghost_id=ghost["id"],
            direction=direction,
            action=action
        ))
    
    return decisions

async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                game_data = json.loads(data)
                game_state = GameState(
                    player_position=game_data.get("player_position", {"x": 0, "y": 0}),
                    ghosts=game_data.get("ghosts", []),
                    map_grid=game_data.get("map_grid", []),
                    timestamp=game_data.get("timestamp", 0)
                )
                
                decisions = process_ghost_decisions(game_state)
                
                response = {
                    "decisions": [asdict(d) for d in decisions],
                    "timestamp": game_state.timestamp
                }
                
                await websocket.send_text(json.dumps(response))
                
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"error": "Invalid JSON"}))
            except Exception as e:
                await websocket.send_text(json.dumps({"error": str(e)}))
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)