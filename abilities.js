// All abilities in this file are data-only definitions.
// Effects MUST be applied through gameState.applyEffect() or gameState.effects.apply()
// to prevent unsafe direct stat mutation.
//
// Tags:  'mobility' | 'defense' | 'vision' | 'aoe' | 'cleanse' | 'heal'
// scaleWith: 'wave' — multiplier increases with wave number
//            'time' — multiplier increases with survival time
//            null   — fixed

const abilities = {

    divineGuidance: {
        name: 'Divine Guidance',
        cooldown: 8000,
        tags: ['vision'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 2.5, 3000, ['vision']);
        }
    },

    gandivaDash: {
        name: 'Gandiva Dash',
        cooldown: 5000,
        tags: ['mobility'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('speed', player, 4, 300, ['mobility']);
        }
    },

    gadaShockwave: {
        name: 'Gada Shockwave',
        cooldown: 6000,
        tags: ['aoe'],
        scaleWith: 'wave',
        effect(player, gameState) {
            const radius = 150;
            const now = Date.now();
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                gameState.particles.push({
                    x: player.x + Math.cos(a) * 10, y: player.y + Math.sin(a) * 10,
                    vx: Math.cos(a) * 3.5, vy: Math.sin(a) * 3.5,
                    radius, color: 'rgba(160,120,255,0.8)', duration: 500, created: now
                });
            }
        }
    },

    truthAura: {
        name: 'Truth Aura',
        cooldown: 10000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('invulnerable', player, 1, 2000, ['defense']);
        }
    },

    twinStrike: {
        name: 'Twin Strike',
        cooldown: 4000,
        tags: ['mobility'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('speed', player, 1.5, 2000, ['mobility']);
        }
    },

    futureSight: {
        name: 'Future Sight',
        cooldown: 12000,
        tags: ['defense', 'vision'],
        scaleWith: null,
        effect(player, gameState) {
            // Slow time scale via GameState; timeScale is safe to set directly (not a stat)
            gameState.timeScale = 0.3;
            setTimeout(() => { gameState.timeScale = 1; }, 3000);
        }
    },

    vasaviShakti: {
        name: 'Vasavi Shakti',
        cooldown: 15000,
        tags: ['mobility', 'vision'],
        scaleWith: 'wave',
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.5, 4000, ['vision']);
            gameState.effects.apply('speed',       player,             1.3, 4000, ['mobility']);
        }
    },

    ironMace: {
        name: 'Iron Mace Slam',
        cooldown: 7000,
        tags: ['aoe'],
        scaleWith: null,
        effect(player, gameState) {
            // Brief stop then re-engage — sets speed multiplier to near-zero then removes it
            gameState.effects.apply('speed', player, 0.01, 500, ['aoe']);
        }
    },

    brahmastra: {
        name: 'Brahmastra',
        cooldown: 20000,
        tags: ['vision', 'aoe', 'cleanse'],
        scaleWith: 'wave',
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 3, 2000, ['vision', 'aoe']);
            if (gameState.corruption) gameState.corruption.cleanse(player.x, player.y, 200);
        }
    },

    narayanastra: {
        name: 'Narayanastra',
        cooldown: 18000,
        tags: ['aoe'],
        scaleWith: 'wave',
        effect(player, gameState) {
            const now = Date.now();
            for (let i = 0; i < 8; i++) {
                setTimeout(() => {
                    const a = i * Math.PI / 4;
                    gameState.particles.push({
                        x: player.x + Math.cos(a) * 100, y: player.y + Math.sin(a) * 100,
                        vx: Math.cos(a) * 2, vy: Math.sin(a) * 2,
                        radius: 50, color: 'rgba(200,80,255,0.8)', duration: 1000, created: Date.now()
                    });
                }, i * 200);
            }
        }
    },

    battleWisdom: {
        name: 'Battle Wisdom',
        cooldown: 9000,
        tags: ['mobility'],
        scaleWith: 'time',
        effect(player, gameState) {
            gameState.effects.apply('speed', player, 1.2, 5000, ['mobility']);
        }
    },

    confusion: {
        name: 'Confusion',
        cooldown: 8000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            // Camera shake is a renderer concern, not a stat mutation
            if (gameState._renderer) gameState._renderer.triggerShake(6);
            setTimeout(() => {}, 2000); // placeholder duration reference
        }
    },

    chakraVyuha: {
        name: 'Chakra Vyuha',
        cooldown: 12000,
        tags: ['mobility', 'defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('invulnerable', player, 1,   1500, ['defense']);
            gameState.effects.apply('speed',        player, 2,   1500, ['mobility']);
        }
    },

    illusions: {
        name: 'Rakshasa Illusions',
        cooldown: 10000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.ghostsVisible = true;
            setTimeout(() => { gameState.ghostsVisible = false; }, 4000);
        }
    },

    divineProtection: {
        name: 'Divine Protection',
        cooldown: 15000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('invulnerable', player, 1, 3000, ['defense']);
        }
    },

    counsel: {
        name: 'Counsel',
        cooldown: 6000,
        tags: ['vision'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.3, 5000, ['vision']);
        }
    },

    divineVision: {
        name: 'Divine Vision',
        cooldown: 7000,
        tags: ['vision'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.6, 4000, ['vision']);
        }
    },

    selfTaught: {
        name: 'Self Taught',
        cooldown: 5000,
        tags: ['mobility'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('speed', player, 1.4, 2000, ['mobility']);
        }
    },

    threeArrows: {
        name: 'Three Arrows',
        cooldown: 8000,
        tags: ['aoe'],
        scaleWith: 'wave',
        effect(player, gameState) {
            const now = Date.now();
            for (let i = -1; i <= 1; i++) {
                gameState.projectiles.push({
                    x: player.x, y: player.y,
                    vx: Math.cos(player.angle + i * 0.3) * 10,
                    vy: Math.sin(player.angle + i * 0.3) * 10,
                    created: now
                });
            }
        }
    },

    unyielding: {
        name: 'Unyielding',
        cooldown: 6000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('invulnerable', player, 1, 1500, ['defense']);
        }
    },

    fireRitual: {
        name: 'Fire Ritual',
        cooldown: 9000,
        tags: ['vision', 'cleanse'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.8, 3000, ['vision']);
            if (gameState.corruption) gameState.corruption.cleanse(player.x, player.y, 150);
        }
    },

    rebirth: {
        name: 'Rebirth',
        cooldown: 20000,
        tags: ['heal'],
        scaleWith: 'time',
        effect(player, gameState) {
            // Health restoration is safe direct mutation (not a multiplier)
            player.health = Math.min(player.maxHealth, player.health + 50);
            gameState.events?.emit('heal', { amount: 50 });
        }
    },

    royalPresence: {
        name: 'Royal Presence',
        cooldown: 8000,
        tags: ['aoe', 'defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('enemySlow', gameState, 0.5, 3000, ['aoe']);
        }
    },

    youthfulValor: {
        name: 'Youthful Valor',
        cooldown: 5000,
        tags: ['mobility'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('speed', player, 1.6, 1500, ['mobility']);
        }
    },

    forestCall: {
        name: 'Forest Call',
        cooldown: 10000,
        tags: ['vision', 'defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.4, 5000, ['vision']);
        }
    },

    singleDay: {
        name: 'Single Day',
        cooldown: 15000,
        tags: ['defense'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.timeScale = 0.5;
            setTimeout(() => { gameState.timeScale = 1; }, 3000);
        }
    },

    ancientWisdom: {
        name: 'Ancient Wisdom',
        cooldown: 7000,
        tags: ['vision'],
        scaleWith: 'time',
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 1.4, 4000, ['vision']);
        }
    },

    sacrifice: {
        name: 'Sacrifice',
        cooldown: 25000,
        tags: ['vision', 'aoe', 'cleanse'],
        scaleWith: 'wave',
        effect(player, gameState) {
            gameState.effects.apply('lightRadius', gameState.lighting, 2, 5000, ['vision', 'aoe']);
            if (gameState.corruption) gameState.corruption.cleanse(player.x, player.y, 300);
        }
    },

    serpentArrow: {
        name: 'Serpent Arrow',
        cooldown: 8000,
        tags: ['aoe'],
        scaleWith: 'wave',
        effect(player, gameState) {
            gameState.projectiles.push({
                x: player.x, y: player.y,
                vx: Math.cos(player.angle) * 12, vy: Math.sin(player.angle) * 12,
                homing: true, created: Date.now()
            });
        }
    },

    nagaBlessing: {
        name: 'Naga Blessing',
        cooldown: 12000,
        tags: ['mobility', 'defense', 'cleanse'],
        scaleWith: null,
        effect(player, gameState) {
            gameState.effects.apply('invulnerable', player, 1,   2500, ['defense']);
            gameState.effects.apply('speed',        player, 1.3, 2500, ['mobility']);
            if (gameState.corruption) gameState.corruption.cleanse(player.x, player.y, 120);
        }
    }
};

export default abilities;