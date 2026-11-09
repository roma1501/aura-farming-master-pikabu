// GamePlayer.js — игрок (DESIGN.md §0.4–0.5, §4): движение от экранного джойстика
// относительно камеры, АВТОШЛЕПОК (ближайшая допустимая цель в радиусе шлепка и перчатка
// готова -> разворот к цели и удар с гарантированным попаданием), рывок, падение -> KO ->
// появление в зоне через короткую паузу. Внешность игрока — гардероб (GameWardrobe.lookOfPlayer:
// кожа, пробор, улыбка, футболка «+1», джинсы; надетое — save.cos.equip).
//
// GamePlayer.autoRespawn = false — модуль режимов сам показывает итог («Ты упал») и
// возвращает игрока (Game.respawnPlayer()). GamePlayer.autoSlap = false — выключить
// автошлепок (обучение, катсцены). GamePlayer.frozen = true — игрок стоит (отсчёт раунда):
// без движения, рывка и автошлепка (так же стоит в открытом гардеробе).
// Падение игрока сначала получает GameModes.onPlayerKO(e): true — режим сам показывает итог
// и возвращает игрока (арена, королевская битва, дуэль), иначе — появление через паузу.

/** @satisfies {Record<string, any>} */
const GamePlayer = {
    autoRespawn: true,
    autoSlap: true,
    frozen: false,
    _respawnAt: 0,

    init(game) {
        Game.on('ko', (e) => {
            if (e.victim !== Game.player) return;
            Game.save.stats.falls++;
            Game.saveSoon();
            const gm = typeof GameModes !== 'undefined' ? /** @type {any} */ (GameModes) : null;
            let handled = false;
            try { handled = !!(gm && typeof gm.onPlayerKO === 'function' && gm.onPlayerKO(e) === true); } catch (err) { console.error('GameModes.onPlayerKO:', err); }
            if (this.autoRespawn && !handled) this._respawnAt = Game.realTime + GameCfg.respawnDelay;
        });
        Game.on('slap', (e) => {
            if (e.attacker === Game.player) { Game.save.stats.slaps++; Game.saveSoon(); }
        });
        Game.on('ko', (e) => {
            if (e.killer === Game.player) { Game.save.stats.kos++; Game.saveSoon(); }
        });
        void game;
    },

    update(dt, realDt) {
        const p = Game.player;
        if (!p) return;
        if (this._respawnAt && Game.realTime >= this._respawnAt) {
            this._respawnAt = 0;
            if (p.state === 'dead') Game.respawnPlayer();
        }
        const active = Game.started && GameInput.enabled && !Game.transitioning && !this.frozen;
        // Движение: вектор стика -> направление на карте относительно камеры.
        const v = active ? GameInput.move : { x: 0, y: 0 };
        const az = GameCamera.az;
        const fx = Math.cos(az), fy = Math.sin(az);     // вперёд
        const rx = -fy, ry = fx;                        // вправо на экране
        p.setMove(rx * v.x + fx * v.y, ry * v.x + fy * v.y);
        // Рывок: по стику, иначе по курсу.
        if (GameInput.consumeDash() && active) {
            const l = Math.hypot(p.moveX, p.moveY);
            p.dash(l > 0.1 ? p.moveX : 0, l > 0.1 ? p.moveY : 0);
        }
        GameInput.setDashCooldown(p.dashCooldownLeft(), GameCfg.dashCooldown * p.mods.dashCooldown);
        // Автошлепок.
        if (active && this.autoSlap && p.canSlap()) {
            const t = GameCombat.nearestTarget(p);
            if (t) GameCombat.trySlap(p, t, { forced: true });
        }
        void dt; void realDt;
    },
};
