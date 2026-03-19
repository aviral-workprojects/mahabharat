// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIOR TREE PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

const BT_SUCCESS = 'SUCCESS';
const BT_FAILURE = 'FAILURE';
const BT_RUNNING = 'RUNNING';

class Selector {
    constructor(...children) { this.children = children; }
    tick(ctx) { for (const c of this.children) { const r = c.tick(ctx); if (r !== BT_FAILURE) return r; } return BT_FAILURE; }
}

class Sequence {
    constructor(...children) { this.children = children; }
    tick(ctx) { for (const c of this.children) { const r = c.tick(ctx); if (r !== BT_SUCCESS) return r; } return BT_SUCCESS; }
}

class Action {
    constructor(fn) { this.fn = fn; }
    tick(ctx) { return this.fn(ctx); }
}

class Condition {
    constructor(fn) { this.fn = fn; }
    tick(ctx) { return this.fn(ctx) ? BT_SUCCESS : BT_FAILURE; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED MOVEMENT HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function moveToward(ghost, tx, ty, speed, deltaTime, scale = 1) {
    const dx = tx - ghost.x, dy = ty - ghost.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: 0, y: 0 };
    const dt = deltaTime / 16;
    return { x: (dx / dist) * speed * scale * dt, y: (dy / dist) * speed * scale * dt };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY — per-AI shared state
// ═══════════════════════════════════════════════════════════════════════════════

class GhostMemory {
    constructor() {
        this.lastSeenPlayer    = null;   // { x, y, time }
        this.lastDamageTaken   = 0;      // timestamp
        this.retreating        = false;
        this.retreatTarget     = null;
        this.threatLevel       = 0;      // 0-1 based on player health + buffs
        this.staggerUntil      = 0;      // ms timestamp — don't attack until
    }

    updateThreat(player, corrGlobalLevel) {
        // Low player health → higher threat (chase more aggressively)
        const healthFactor = 1 - (player.health / player.maxHealth);
        const corrFactor   = corrGlobalLevel * 0.3;
        this.threatLevel   = Math.min(1, healthFactor * 0.7 + corrFactor);
    }

    rememberPlayer(player) {
        this.lastSeenPlayer = { x: player.x, y: player.y, time: Date.now() };
    }

    forgetPlayer(timeout = 6000) {
        if (this.lastSeenPlayer && Date.now() - this.lastSeenPlayer.time > timeout) {
            this.lastSeenPlayer = null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIOR TREE AI
// ═══════════════════════════════════════════════════════════════════════════════

class BasicAI {
    constructor(options = {}) {
        this.detectionRange  = options.detectionRange  || 300;
        this.attackRange     = options.attackRange     || 40;
        this.stopDistance    = options.stopDistance    || 25;
        this.wanderRadius    = options.wanderRadius    || 80;
        this.wanderInterval  = options.wanderInterval  || 2000;
        this.surroundOffset  = options.surroundOffset !== undefined ? options.surroundOffset : Math.random() * Math.PI * 2;
        this.surroundRadius  = options.surroundRadius  || 90;
        this.mode            = options.mode            || (Math.random() < 0.35 ? 'surround' : 'chase');

        this._wanderTarget   = null;
        this._lastWander     = 0;
        this._memory         = new GhostMemory();
        this._frameSkip      = Math.floor(Math.random() * 2); // stagger across frames

        this._tree = this._buildTree();
    }

    _buildTree() {
        const mem = this._memory;

        // ── Conditions ──────────────────────────────────────────────────────────
        const inDetectionRange = new Condition(ctx => {
            const dx = ctx.player.x - ctx.ghost.x, dy = ctx.player.y - ctx.ghost.y;
            // Threat level expands effective detection range
            const boost = 1 + mem.threatLevel * 0.4;
            return Math.sqrt(dx*dx+dy*dy) <= this.detectionRange * boost;
        });

        const inAttackRange = new Condition(ctx => {
            const dx = ctx.player.x - ctx.ghost.x, dy = ctx.player.y - ctx.ghost.y;
            return Math.sqrt(dx*dx+dy*dy) <= this.attackRange;
        });

        const notStaggered = new Condition(() => Date.now() >= mem.staggerUntil);

        const shouldRetreat = new Condition(ctx => {
            // Retreat briefly after taking damage (wounded-retreat pattern)
            if (!mem.retreating) return false;
            const dx = ctx.ghost.x - (mem.retreatTarget?.x || ctx.ghost.x);
            const dy = ctx.ghost.y - (mem.retreatTarget?.y || ctx.ghost.y);
            return Math.sqrt(dx*dx+dy*dy) > 20;
        });

        const hasLastKnown = new Condition(() => mem.lastSeenPlayer !== null);

        const alliesNearby = new Condition(ctx => (ctx.ghost._alliesNearby || 0) >= 2);

        // ── Actions ─────────────────────────────────────────────────────────────
        const rememberPlayer = new Action(ctx => {
            mem.rememberPlayer(ctx.player);
            mem.updateThreat(ctx.player, ctx.corrGlobalLevel || 0);
            return BT_SUCCESS;
        });

        const doAttack = new Action(ctx => {
            // Group stagger: if allies just attacked, delay slightly
            if ((ctx.ghost._alliesNearby || 0) > 0 && Math.random() < 0.3) {
                mem.staggerUntil = Date.now() + 300 + Math.random() * 400;
            }
            ctx.move = { x: 0, y: 0 };
            return BT_SUCCESS;
        });

        const doChase = new Action(ctx => {
            const dx = ctx.player.x - ctx.ghost.x, dy = ctx.player.y - ctx.ghost.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            // Aggressive boost when threat level is high
            const aggro = 1 + mem.threatLevel * 0.25;
            if (dist <= this.stopDistance) { ctx.move = { x:0, y:0 }; }
            else { ctx.move = moveToward(ctx.ghost, ctx.player.x, ctx.player.y, ctx.ghost.speed*aggro, ctx.deltaTime); }
            return BT_SUCCESS;
        });

        const doDashAttack = new Action(ctx => {
            // Short range dash — closes gap fast, used when allies nearby (coordinated)
            const dx = ctx.player.x - ctx.ghost.x, dy = ctx.player.y - ctx.ghost.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist > this.attackRange * 3) return BT_FAILURE;
            ctx.move = moveToward(ctx.ghost, ctx.player.x, ctx.player.y, ctx.ghost.speed, ctx.deltaTime, 2.5);
            return BT_SUCCESS;
        });

        const doSurround = new Action(ctx => {
            this.surroundOffset += 0.0008 * ctx.deltaTime;
            // Tighten orbit under high threat
            const r = this.surroundRadius * (1 - mem.threatLevel * 0.3);
            const tx = ctx.player.x + Math.cos(this.surroundOffset) * r;
            const ty = ctx.player.y + Math.sin(this.surroundOffset) * r;
            const dx = tx - ctx.ghost.x, dy = ty - ctx.ghost.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist < 5) { ctx.move = { x:0, y:0 }; }
            else { ctx.move = moveToward(ctx.ghost, tx, ty, ctx.ghost.speed, ctx.deltaTime, 0.85); }
            return BT_SUCCESS;
        });

        const doRetreat = new Action(ctx => {
            if (!mem.retreatTarget) {
                // Move away from player
                const dx = ctx.ghost.x - ctx.player.x, dy = ctx.ghost.y - ctx.player.y;
                const dist = Math.sqrt(dx*dx+dy*dy)||1;
                mem.retreatTarget = { x: ctx.ghost.x + (dx/dist)*120, y: ctx.ghost.y + (dy/dist)*120 };
                setTimeout(() => { mem.retreating = false; mem.retreatTarget = null; }, 1200);
            }
            ctx.move = moveToward(ctx.ghost, mem.retreatTarget.x, mem.retreatTarget.y, ctx.ghost.speed, ctx.deltaTime, 0.9);
            return BT_SUCCESS;
        });

        const doInvestigate = new Action(ctx => {
            const lsp = mem.lastSeenPlayer;
            const dx = lsp.x - ctx.ghost.x, dy = lsp.y - ctx.ghost.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist < 20) { mem.lastSeenPlayer = null; ctx.move = { x:0, y:0 }; }
            else { ctx.move = moveToward(ctx.ghost, lsp.x, lsp.y, ctx.ghost.speed, ctx.deltaTime, 0.6); }
            return BT_SUCCESS;
        });

        const doWander = new Action(ctx => {
            const now = Date.now();
            if (!this._wanderTarget || now - this._lastWander > this.wanderInterval) {
                const a = Math.random() * Math.PI * 2;
                this._wanderTarget = { x: ctx.ghost.x + Math.cos(a)*this.wanderRadius, y: ctx.ghost.y + Math.sin(a)*this.wanderRadius };
                this._lastWander = now;
            }
            const dx = this._wanderTarget.x - ctx.ghost.x, dy = this._wanderTarget.y - ctx.ghost.y;
            const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist < 5) { ctx.move = { x:0, y:0 }; }
            else { ctx.move = moveToward(ctx.ghost, this._wanderTarget.x, this._wanderTarget.y, ctx.ghost.speed, ctx.deltaTime, 0.3); }
            return BT_SUCCESS;
        });

        // ── Tree construction ───────────────────────────────────────────────────
        // Pursuit: detect → remember → (retreat if wounded OR attack/chase/surround)
        const attackBranch = new Sequence(inAttackRange, notStaggered, doAttack);
        const dashBranch   = new Sequence(alliesNearby,  doDashAttack);  // coordinate with allies
        const moveBranch   = this.mode === 'surround' ? doSurround : doChase;

        const pursuitBranch = new Sequence(
            inDetectionRange,
            rememberPlayer,
            new Selector(
                new Sequence(shouldRetreat, doRetreat),
                new Selector(attackBranch, dashBranch, moveBranch)
            )
        );

        const fallbackBranch = new Selector(
            new Sequence(hasLastKnown, doInvestigate),
            doWander
        );

        return new Selector(pursuitBranch, fallbackBranch);
    }

    // Called by AISystem — throttled externally
    getMovement(ghost, player, map, deltaTime, extras = {}) {
        mem: {
            this._memory.forgetPlayer();
        }
        const ctx = {
            ghost,
            player,
            map,
            deltaTime,
            move: { x: 0, y: 0 },
            corrGlobalLevel: extras.corrGlobalLevel || 0
        };
        this._tree.tick(ctx);
        return ctx.move;
    }

    // Register a damage event — may trigger retreat
    onDamageTaken(ghost, player) {
        this._memory.lastDamageTaken = Date.now();
        // 25% chance to briefly retreat after being hit
        if (!this._memory.retreating && Math.random() < 0.25) {
            this._memory.retreating = true;
        }
    }
}

export default BasicAI;