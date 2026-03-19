import heapq
from typing import List, Tuple, Optional, Dict
from dataclasses import dataclass, field
import time

# ─── Node ─────────────────────────────────────────────────────────────────────

@dataclass
class Node:
    x:      int
    y:      int
    g:      float = 0.0
    h:      float = 0.0
    parent: Optional['Node'] = field(default=None, compare=False, repr=False)

    @property
    def f(self) -> float:
        return self.g + self.h

    def __lt__(self, other: 'Node') -> bool:
        return self.f < other.f

    def __eq__(self, other) -> bool:
        return self.x == other.x and self.y == other.y

    def __hash__(self):
        return hash((self.x, self.y))

# ─── Heuristic ────────────────────────────────────────────────────────────────

def heuristic(a: Tuple[int, int], b: Tuple[int, int]) -> float:
    """Octile distance — handles both cardinal and diagonal movement cost."""
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (math.sqrt(2) - 1) * min(dx, dy)

import math

# ─── Neighbours ───────────────────────────────────────────────────────────────

_CARDINAL  = [(0,1),(0,-1),(1,0),(-1,0)]
_DIAGONALS = [(1,1),(1,-1),(-1,1),(-1,-1)]

def get_neighbors(
    grid: List[List[int]],
    x: int,
    y: int,
    allow_diagonal: bool = False
) -> List[Tuple[int, int, float]]:
    """Returns (nx, ny, cost) tuples."""
    neighbors = []
    rows, cols = len(grid), len(grid[0])

    for dx, dy in _CARDINAL:
        nx, ny = x + dx, y + dy
        if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == 0:
            neighbors.append((nx, ny, 1.0))

    if allow_diagonal:
        for dx, dy in _DIAGONALS:
            nx, ny = x + dx, y + dy
            if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == 0:
                # Only allow diagonal if both cardinal axes are clear (no corner cutting)
                if grid[y][x + dx] == 0 and grid[y + dy][x] == 0:
                    neighbors.append((nx, ny, math.sqrt(2)))

    return neighbors

# ─── A* ───────────────────────────────────────────────────────────────────────

def astar(
    grid:           List[List[int]],
    start:          Tuple[int, int],
    goal:           Tuple[int, int],
    allow_diagonal: bool = False,
    max_iterations: int  = 2000
) -> Optional[List[Tuple[int, int]]]:
    """Returns the shortest path as a list of (x, y) tuples, or None if unreachable."""
    if not grid or not grid[0]:
        return None

    rows, cols = len(grid), len(grid[0])

    def in_bounds(x, y):
        return 0 <= y < rows and 0 <= x < cols

    if not in_bounds(*start) or not in_bounds(*goal):
        return None
    if grid[start[1]][start[0]] == 1 or grid[goal[1]][goal[0]] == 1:
        return None
    if start == goal:
        return [start]

    open_set: List[Node] = []
    closed_set: set = set()
    node_map: Dict[Tuple[int,int], Node] = {}

    start_node = Node(x=start[0], y=start[1], h=heuristic(start, goal))
    heapq.heappush(open_set, start_node)
    node_map[start] = start_node

    iterations = 0

    while open_set and iterations < max_iterations:
        iterations += 1
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

        for nx, ny, cost in get_neighbors(grid, current.x, current.y, allow_diagonal):
            pos = (nx, ny)
            if pos in closed_set:
                continue
            g_score = current.g + cost

            if pos not in node_map:
                neighbor = Node(x=nx, y=ny, g=g_score, h=heuristic(pos, goal), parent=current)
                node_map[pos] = neighbor
                heapq.heappush(open_set, neighbor)
            else:
                neighbor = node_map[pos]
                if g_score < neighbor.g:
                    neighbor.g = g_score
                    neighbor.parent = current
                    # Re-heapify on update
                    heapq.heapify(open_set)

    return None  # No path found within iteration limit

# ─── Public helper ────────────────────────────────────────────────────────────

def get_next_move(
    grid:  List[List[int]],
    start: Tuple[float, float],
    goal:  Tuple[float, float]
) -> Optional[Tuple[float, float]]:
    """Returns a normalized (dx, dy) direction toward the next A* step."""
    si = (int(start[0]), int(start[1]))
    gi = (int(goal[0]),  int(goal[1]))

    path = astar(grid, si, gi)

    if path and len(path) > 1:
        nxt = path[1]
        dx, dy = nxt[0] - start[0], nxt[1] - start[1]
        dist = math.sqrt(dx * dx + dy * dy)
        if dist > 0:
            return (dx / dist, dy / dist)

    # Fallback: direct vector
    dx, dy = goal[0] - start[0], goal[1] - start[1]
    dist = math.sqrt(dx * dx + dy * dy)
    if dist > 0:
        return (dx / dist, dy / dist)
    return (0.0, 0.0)