// ─── Behavior Tree primitives ─────────────────────────────────────────────────

const BT_SUCCESS = 'SUCCESS';
const BT_FAILURE = 'FAILURE';
const BT_RUNNING = 'RUNNING';

// Selector — tries children left-to-right, returns SUCCESS on first success
class Selector {
    constructor(...children) { this.children = children; }

    tick(ctx) {
        for (const child of this.children) {
            const result = child.tick(ctx);
            if (result !== BT_FAILURE) return result;
        }
        return BT_FAILURE;
    }
}

// Sequence — runs children in order, stops and returns FAILURE on first failure
class Sequence {
    constructor(...children) { this.children = children; }

    tick(ctx) {
        for (const child of this.children) {
            const result = child.tick(ctx);
            if (result !== BT_SUCCESS) return result;
        }
        return BT_SUCCESS;
    }
}

// Leaf node — wraps a plain function (ctx) => BT_SUCCESS | BT_FAILURE | BT_RUNNING
class Action {
    constructor(fn) { this.fn = fn; }
    tick(ctx)       { return this.fn(ctx); }
}

// Condition leaf — returns SUCCESS/FAILURE based on predicate
class Condition {
    constructor(fn) { this.fn = fn; }
    tick(ctx)       { return this.fn(ctx) ? BT_SUCCESS : BT_FAILURE; }
}

// ─── Shared movement helper ───────────────────────────────────────────────────

function moveToward(ghost, tx, ty, speed, deltaTime, scale = 1) {
    const dx = tx - ghost.x;
    const dy = ty - ghost.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: 0, y: 0 };
    const dt = deltaTime / 16;
    return {
        x: (dx / dist) * speed * scale * dt,
        y: (dy / dist) * speed * scale * dt
    };
}

// ─── BehaviorTree AI ─────────────────────────────────────────────────────────

class BasicAI {
    constructor(options = {}) {
        this.detectionRange  = options.detectionRange  || 300;
        this.attackRange     = options.attackRange     || 40;
        this.stopDistance    = options.stopDistance    || 25;
        this.wanderRadius    = options.wanderRadius    || 80;
        this.wanderInterval  = options.wanderInterval  || 2000;
        this.surroundOffset  = options.surroundOffset  || (Math.random() * Math.PI * 2); // per-ghost angle
        this.surroundRadius  = options.surroundRadius  || 90;
        this.mode            = options.mode            || this._pickMode(); // 'chase' | 'surround'

        // Wander state
        this._wanderTarget = null;
        this._lastWander   = 0;
        // Memory — last known player position
        this._lastKnown    = null;

        this._tree = this._buildTree();
    }

    _pickMode() {
        // ~35 % of ghosts use surround behaviour for variety
        return Math.random() < 0.35 ? 'surround' : 'chase';
    }

    _buildTree() {
        // ctx = { ghost, player, deltaTime, move }
        // Each branch writes into ctx.move when it succeeds.

        const inDetectionRange = new Condition(ctx => {
            const dx = ctx.player.x - ctx.ghost.x;
            const dy = ctx.player.y - ctx.ghost.y;
            return Math.sqrt(dx * dx + dy * dy) <= this.detectionRange;
        });

        const inAttackRange = new Condition(ctx => {
            const dx = ctx.player.x - ctx.ghost.x;
            const dy = ctx.player.y - ctx.ghost.y;
            return Math.sqrt(dx * dx + dy * dy) <= this.attackRange;
        });

        // Attack: stop moving, signal the ghost to deal damage (via ghost.attack())
        const doAttack = new Action(ctx => {
            ctx.move = { x: 0, y: 0 };
            return BT_SUCCESS;
        });

        // Chase: move straight at player
        const doChase = new Action(ctx => {
            const dx = ctx.player.x - ctx.ghost.x;
            const dy = ctx.player.y - ctx.ghost.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= this.stopDistance) {
                ctx.move = { x: 0, y: 0 };
            } else {
                ctx.move = moveToward(ctx.ghost, ctx.player.x, ctx.player.y,
                    ctx.ghost.speed, ctx.deltaTime);
            }
            return BT_SUCCESS;
        });

        // Surround: orbit the player at surroundRadius
        const doSurround = new Action(ctx => {
            // Orbit angle drifts over time
            this.surroundOffset += 0.0008 * ctx.deltaTime;
            const tx = ctx.player.x + Math.cos(this.surroundOffset) * this.surroundRadius;
            const ty = ctx.player.y + Math.sin(this.surroundOffset) * this.surroundRadius;
            const dx = tx - ctx.ghost.x;
            const dy = ty - ctx.ghost.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) {
                ctx.move = { x: 0, y: 0 };
            } else {
                ctx.move = moveToward(ctx.ghost, tx, ty, ctx.ghost.speed, ctx.deltaTime, 0.85);
            }
            return BT_SUCCESS;
        });

        // Investigate: move to last known player position
        const hasLastKnown = new Condition(() => this._lastKnown !== null);
        const doInvestigate = new Action(ctx => {
            const tx = this._lastKnown.x;
            const ty = this._lastKnown.y;
            const dx = tx - ctx.ghost.x;
            const dy = ty - ctx.ghost.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 20) {
                this._lastKnown = null; // reached destination
                ctx.move = { x: 0, y: 0 };
            } else {
                ctx.move = moveToward(ctx.ghost, tx, ty, ctx.ghost.speed, ctx.deltaTime, 0.6);
            }
            return BT_SUCCESS;
        });

        // Wander: pick a random target periodically
        const doWander = new Action(ctx => {
            const now = Date.now();
            if (!this._wanderTarget || now - this._lastWander > this.wanderInterval) {
                const angle = Math.random() * Math.PI * 2;
                this._wanderTarget = {
                    x: ctx.ghost.x + Math.cos(angle) * this.wanderRadius,
                    y: ctx.ghost.y + Math.sin(angle) * this.wanderRadius
                };
                this._lastWander = now;
            }
            const dx = this._wanderTarget.x - ctx.ghost.x;
            const dy = this._wanderTarget.y - ctx.ghost.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) {
                ctx.move = { x: 0, y: 0 };
            } else {
                ctx.move = moveToward(ctx.ghost, this._wanderTarget.x, this._wanderTarget.y,
                    ctx.ghost.speed, ctx.deltaTime, 0.3);
            }
            return BT_SUCCESS;
        });

        // Record last known position when player is detected
        const rememberPlayer = new Action(ctx => {
            this._lastKnown = { x: ctx.player.x, y: ctx.player.y };
            return BT_SUCCESS;
        });

        // Active pursuit branch (attack > chase/surround)
        const pursuitBranch = new Sequence(
            inDetectionRange,
            rememberPlayer,
            new Selector(
                // Attack if close enough
                new Sequence(inAttackRange, doAttack),
                // Otherwise chase or surround
                this.mode === 'surround' ? doSurround : doChase
            )
        );

        // Fallback: investigate last known → wander
        const fallbackBranch = new Selector(
            new Sequence(hasLastKnown, doInvestigate),
            doWander
        );

        return new Selector(pursuitBranch, fallbackBranch);
    }

    // Public interface expected by Ghost class
    getMovement(ghost, player, map, deltaTime) {
        const ctx = { ghost, player, map, deltaTime, move: { x: 0, y: 0 } };
        this._tree.tick(ctx);
        return ctx.move;
    }
}

export default BasicAI;