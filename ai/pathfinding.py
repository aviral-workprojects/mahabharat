import heapq
from typing import List, Tuple, Optional
from dataclasses import dataclass

@dataclass
class Node:
    x: int
    y: int
    g: float = 0
    h: float = 0
    parent: Optional['Node'] = None
    
    @property
    def f(self) -> float:
        return self.g + self.h
    
    def __lt__(self, other: 'Node') -> bool:
        return self.f < other.f

def heuristic(a: Tuple[int, int], b: Tuple[int, int]) -> float:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def get_neighbors(grid: List[List[int]], x: int, y: int) -> List[Tuple[int, int]]:
    neighbors = []
    directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
    
    for dx, dy in directions:
        nx, ny = x + dx, y + dy
        if 0 <= ny < len(grid) and 0 <= nx < len(grid[0]):
            if grid[ny][nx] == 0:
                neighbors.append((nx, ny))
    
    return neighbors

def astar(
    grid: List[List[int]],
    start: Tuple[int, int],
    goal: Tuple[int, int]
) -> Optional[List[Tuple[int, int]]]:
    if not grid or not grid[0]:
        return None
    
    if grid[start[1]][start[0]] == 1 or grid[goal[1]][goal[0]] == 1:
        return None
    
    open_set: List[Node] = []
    closed_set: set = set()
    
    start_node = Node(x=start[0], y=start[1], h=heuristic(start, goal))
    heapq.heappush(open_set, start_node)
    
    node_map: dict = {(start[0], start[1]): start_node}
    
    while open_set:
        current = heapq.heappop(open_set)
        current_pos = (current.x, current.y)
        
        if current_pos == goal:
            path = []
            node = current
            while node:
                path.append((node.x, node.y))
                node = node.parent
            return path[::-1]
        
        closed_set.add(current_pos)
        
        for neighbor_pos in get_neighbors(grid, current.x, current.y):
            if neighbor_pos in closed_set:
                continue
            
            g_score = current.g + 1
            
            if neighbor_pos not in node_map:
                neighbor = Node(
                    x=neighbor_pos[0],
                    y=neighbor_pos[1],
                    g=g_score,
                    h=heuristic(neighbor_pos, goal),
                    parent=current
                )
                node_map[neighbor_pos] = neighbor
                heapq.heappush(open_set, neighbor)
            else:
                neighbor = node_map[neighbor_pos]
                if g_score < neighbor.g:
                    neighbor.g = g_score
                    neighbor.parent = current
                    heapq.heapify(open_set)
    
    return None

def get_next_move(
    grid: List[List[int]],
    start: Tuple[float, float],
    goal: Tuple[float, float]
) -> Optional[Tuple[float, float]]:
    start_int = (int(start[0]), int(start[1]))
    goal_int = (int(goal[0]), int(goal[1]))
    
    path = astar(grid, start_int, goal_int)
    
    if path and len(path) > 1:
        next_pos = path[1]
        dx = next_pos[0] - start[0]
        dy = next_pos[1] - start[1]
        distance = (dx ** 2 + dy ** 2) ** 0.5
        
        if distance > 0:
            return (dx / distance, dy / distance)
    
    dx = goal[0] - start[0]
    dy = goal[1] - start[1]
    distance = (dx ** 2 + dy ** 2) ** 0.5
    
    if distance > 0:
        return (dx / distance, dy / distance)
    
    return (0, 0)