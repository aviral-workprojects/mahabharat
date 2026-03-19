const abilities = {
    divineGuidance: {
        name: "Divine Guidance",
        cooldown: 8000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 2.5;
            gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.4)';
            setTimeout(() => {
                gameState.lighting.lightRadius /= 2.5;
                gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.85)';
            }, 3000);
        }
    },

    gandivaDash: {
        name: "Gandiva Dash",
        cooldown: 5000,
        effect: (player, gameState) => {
            player.speed *= 4;
            setTimeout(() => {
                player.speed /= 4;
            }, 300);
        }
    },

    gadaShockwave: {
        name: "Gada Shockwave",
        cooldown: 6000,
        effect: (player, gameState) => {
            const radius = 150;
            gameState.particles.push({
                x: player.x,
                y: player.y,
                radius: radius,
                duration: 500,
                created: Date.now()
            });
        }
    },

    truthAura: {
        name: "Truth Aura",
        cooldown: 10000,
        effect: (player, gameState) => {
            player.invulnerable = true;
            setTimeout(() => {
                player.invulnerable = false;
            }, 2000);
        }
    },

    twinStrike: {
        name: "Twin Strike",
        cooldown: 4000,
        effect: (player, gameState) => {
            player.speed *= 1.5;
            setTimeout(() => {
                player.speed /= 1.5;
            }, 2000);
        }
    },

    futureSight: {
        name: "Future Sight",
        cooldown: 12000,
        effect: (player, gameState) => {
            gameState.timeScale = 0.3;
            setTimeout(() => {
                gameState.timeScale = 1;
            }, 3000);
        }
    },

    vasaviShakti: {
        name: "Vasavi Shakti",
        cooldown: 15000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 1.5;
            player.speed *= 1.3;
            setTimeout(() => {
                gameState.lighting.lightRadius /= 1.5;
                player.speed /= 1.3;
            }, 4000);
        }
    },

    ironMace: {
        name: "Iron Mace Slam",
        cooldown: 7000,
        effect: (player, gameState) => {
            player.speed = 0;
            setTimeout(() => {
                player.speed = 3.8;
            }, 500);
        }
    },

    brahmastra: {
        name: "Brahmastra",
        cooldown: 20000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 3;
            setTimeout(() => {
                gameState.lighting.lightRadius /= 3;
            }, 2000);
        }
    },

    narayanastra: {
        name: "Narayanastra",
        cooldown: 18000,
        effect: (player, gameState) => {
            for (let i = 0; i < 8; i++) {
                setTimeout(() => {
                    gameState.particles.push({
                        x: player.x + Math.cos(i * Math.PI / 4) * 100,
                        y: player.y + Math.sin(i * Math.PI / 4) * 100,
                        radius: 50,
                        duration: 1000,
                        created: Date.now()
                    });
                }, i * 200);
            }
        }
    },

    battleWisdom: {
        name: "Battle Wisdom",
        cooldown: 9000,
        effect: (player, gameState) => {
            player.speed *= 1.2;
            setTimeout(() => {
                player.speed /= 1.2;
            }, 5000);
        }
    },

    confusion: {
        name: "Confusion",
        cooldown: 8000,
        effect: (player, gameState) => {
            gameState.cameraShake = true;
            setTimeout(() => {
                gameState.cameraShake = false;
            }, 2000);
        }
    },

    chakraVyuha: {
        name: "Chakra Vyuha",
        cooldown: 12000,
        effect: (player, gameState) => {
            player.invulnerable = true;
            player.speed *= 2;
            setTimeout(() => {
                player.invulnerable = false;
                player.speed /= 2;
            }, 1500);
        }
    },

    illusions: {
        name: "Rakshasa Illusions",
        cooldown: 10000,
        effect: (player, gameState) => {
            gameState.ghostsVisible = true;
            setTimeout(() => {
                gameState.ghostsVisible = false;
            }, 4000);
        }
    },

    divineProtection: {
        name: "Divine Protection",
        cooldown: 15000,
        effect: (player, gameState) => {
            player.invulnerable = true;
            setTimeout(() => {
                player.invulnerable = false;
            }, 3000);
        }
    },

    counsel: {
        name: "Counsel",
        cooldown: 6000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 1.3;
            setTimeout(() => {
                gameState.lighting.lightRadius /= 1.3;
            }, 5000);
        }
    },

    divineVision: {
        name: "Divine Vision",
        cooldown: 7000,
        effect: (player, gameState) => {
            gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.3)';
            setTimeout(() => {
                gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.85)';
            }, 4000);
        }
    },

    selfTaught: {
        name: "Self Taught",
        cooldown: 5000,
        effect: (player, gameState) => {
            player.speed *= 1.4;
            setTimeout(() => {
                player.speed /= 1.4;
            }, 2000);
        }
    },

    threeArrows: {
        name: "Three Arrows",
        cooldown: 8000,
        effect: (player, gameState) => {
            for (let i = -1; i <= 1; i++) {
                gameState.projectiles.push({
                    x: player.x,
                    y: player.y,
                    vx: Math.cos(player.angle + i * 0.3) * 10,
                    vy: Math.sin(player.angle + i * 0.3) * 10,
                    created: Date.now()
                });
            }
        }
    },

    unyielding: {
        name: "Unyielding",
        cooldown: 6000,
        effect: (player, gameState) => {
            player.invulnerable = true;
            setTimeout(() => {
                player.invulnerable = false;
            }, 1500);
        }
    },

    fireRitual: {
        name: "Fire Ritual",
        cooldown: 9000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 1.8;
            setTimeout(() => {
                gameState.lighting.lightRadius /= 1.8;
            }, 3000);
        }
    },

    rebirth: {
        name: "Rebirth",
        cooldown: 20000,
        effect: (player, gameState) => {
            player.health = Math.min(player.maxHealth, player.health + 50);
        }
    },

    royalPresence: {
        name: "Royal Presence",
        cooldown: 8000,
        effect: (player, gameState) => {
            gameState.enemies.forEach(enemy => {
                enemy.speed *= 0.5;
            });
            setTimeout(() => {
                gameState.enemies.forEach(enemy => {
                    enemy.speed *= 2;
                });
            }, 3000);
        }
    },

    youthfulValor: {
        name: "Youthful Valor",
        cooldown: 5000,
        effect: (player, gameState) => {
            player.speed *= 1.6;
            setTimeout(() => {
                player.speed /= 1.6;
            }, 1500);
        }
    },

    forestCall: {
        name: "Forest Call",
        cooldown: 10000,
        effect: (player, gameState) => {
            gameState.lighting.darknessColor = 'rgba(20, 40, 20, 0.6)';
            setTimeout(() => {
                gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.85)';
            }, 5000);
        }
    },

    singleDay: {
        name: "Single Day",
        cooldown: 15000,
        effect: (player, gameState) => {
            gameState.timeScale = 0.5;
            setTimeout(() => {
                gameState.timeScale = 1;
            }, 3000);
        }
    },

    ancientWisdom: {
        name: "Ancient Wisdom",
        cooldown: 7000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 1.4;
            setTimeout(() => {
                gameState.lighting.lightRadius /= 1.4;
            }, 4000);
        }
    },

    sacrifice: {
        name: "Sacrifice",
        cooldown: 25000,
        effect: (player, gameState) => {
            gameState.lighting.lightRadius *= 2;
            gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.5)';
            setTimeout(() => {
                gameState.lighting.lightRadius /= 2;
                gameState.lighting.darknessColor = 'rgba(0, 0, 0, 0.85)';
            }, 5000);
        }
    },

    serpentArrow: {
        name: "Serpent Arrow",
        cooldown: 8000,
        effect: (player, gameState) => {
            gameState.projectiles.push({
                x: player.x,
                y: player.y,
                vx: Math.cos(player.angle) * 12,
                vy: Math.sin(player.angle) * 12,
                homing: true,
                created: Date.now()
            });
        }
    },

    nagaBlessing: {
        name: "Naga Blessing",
        cooldown: 12000,
        effect: (player, gameState) => {
            player.invulnerable = true;
            player.speed *= 1.3;
            setTimeout(() => {
                player.invulnerable = false;
                player.speed /= 1.3;
            }, 2500);
        }
    }
};

export default abilities;