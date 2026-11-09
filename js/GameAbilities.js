// GameAbilities.js — способности перчаток (DESIGN.md §4, §5, §10) для ВСЕХ персонажей (игрок,
// боты) в зонах с pvp. Активные (огонь, бомба, метеор, плитка, призрак, чёрная дыра) срабатывают
// сами, когда способность готова и есть цель в радиусе способности (боты — со случайной
// задержкой «реакции»); пассивные — на шлепок (GameCombat.hit зовёт onHit до отбрасывания и
// afterHit после +1 ауры) или постоянно (спидстер). Цели — только GameCombat.canAffect (жив,
// виден, без защиты появления, pvp, не своя команда); боты не видят невидимых (char.invisible).
//
// Перчатка -> способность (перезарядка — GameGloves.LIST[].cd):
//   slime     цель скользит дальше (трение ×ABIL_SLIME_FRICTION, зелёные капли)
//   love      каждый 3-й шлепок +2 ауры, сердечки
//   ice       цель замерзает в ice_block.glb на 1 с, потом летит (отложенное отбрасывание)
//   fire      «Ярость»: огненная аура (частицы + ореол GlowLayer), +50% силы на 5 с
//   bomb      бросок bomb.glb по дуге с упреждением, взрыв GameCombat.blast
//   meteor    катящийся лавовый шар meteor.glb: сносит всех на пути, может укатиться в бездну
//   tile      tile.glb падает цели на голову: оглушение (короткий «плюх» + звёздочки)
//   brainrot  Фонк Моменты ×3 (GamePhonk читает phonkMult(char) / GameGloves.get(id).phonk),
//             маска страха на цели
//   ghost     невидимость для ботов на 3 с (char.invisible, полупрозрачность)
//   gravity   цель летит высоко вверх и медленно падает (гравитация ×ABIL_GRAV_FALL на спуске)
//   speed     +35% бега, рывок вдвое чаще (mods), искры на рывке
//   blackhole чёрная дыра у цели затягивает врагов и взрывается
//   giant     дальность ×1.5 (GameGloves), ударная волна по земле
//   golden    каждый 2-й шлепок +1 бонусная аура; diamond — алмазные искры
// Ad-перчатки на механиках существующих (ABIL_BASE: id -> базовая способность):
//   rainbow   как love: каждый 3-й шлепок +2 ауры; радужные искры на шлепке, сердечки + конфетти
//   neon      как speed: +35% бега, рывок вдвое чаще; голубо-розовый неоновый шлейф
//   pixel     как tile: блок падает на голову, перекрашен в яркий «пиксельный» цвет
//   dragon    как fire: «Ярость» (+50% силы на 5 с) с красным ореолом; пламя на каждом шлепке
//
// Множители char.mods (power, speed, dashCooldown, gravity, friction) меняются только на
// разницу своих значений — чужие множители других модулей сохраняются.
// API: cooldownLeft(char), isActive(char), phonkMult(char), cast(char, target?) — применить
// сейчас (отладка), burst(name, x, h, y, force?) — частицы-рецепт 'ab.<name>' в точке (Babylon:
// x, высота, y карты), onHit / afterHit — для GameCombat. Событие ability {char, ability, x, y}.
// HUD: круглая иконка способности игрока над кнопкой «Рывок» с перезарядкой (свой DOM).

// --- Числа способностей (позже — в Constants.js) ---
const ABIL_EQUIP_DELAY = 1.5;        // с: после смены перчатки способность не сразу
const ABIL_SPAWN_DELAY = 1.2;        // с: после появления
const ABIL_BOT_DELAY_MIN = 0.3;      // с: бот «замечает» момент для способности
const ABIL_BOT_DELAY_MAX = 1.6;
const ABIL_FX_DIST = 3400;           // px от камеры: дальше — без частиц
const ABIL_SND_DIST = 2600;          // px от камеры: дальше — без звука
const ABIL_SLIME_FRICTION = 0.2;     // × трение, пока цель «Слизня» скользит
const ABIL_SLIME_SIDE = 1.12;        // × горизонталь отбрасывания «Слизня»
const ABIL_LOVE_EVERY = 3;           // каждый N-й шлепок «Любви» …
const ABIL_LOVE_AURA = 2;            // … + столько ауры
const ABIL_GOLD_EVERY = 2;
const ABIL_GOLD_AURA = 1;
const ABIL_ICE_TIME = 1.0;           // с: заморозка «Льда»
const ABIL_FIRE_RANGE = 420;         // px: враг ближе — «Ярость»
const ABIL_FIRE_TIME = 5;            // с
const ABIL_FIRE_POWER = 1.5;         // × сила шлепка в «Ярости»
const ABIL_BOMB_RANGE = 800;         // px: дальность броска
const ABIL_BOMB_MIN = 140;           // px: ближе — не бросает
const ABIL_BOMB_BLAST = 300;         // px: радиус взрыва
const ABIL_BOMB_POWER = 820;
const ABIL_METEOR_RANGE = 950;
const ABIL_METEOR_SPEED = 950;       // px/с
const ABIL_METEOR_TIME = 1.7;        // с качения
const ABIL_METEOR_POWER = 900;
const ABIL_METEOR_SCALE = 0.85;      // модель 1.84 м -> ~156 px
const ABIL_TILE_RANGE = 650;
const ABIL_TILE_DROP = 620;          // px: высота появления над головой
const ABIL_TILE_STUN = 0.55;         // с полёта/лёжа сверх падения (+ лежит и встаёт ≈ 1.4 с)
const ABIL_TILE_SCALE = 0.75;
const ABIL_BRAIN_MASK_TIME = 1.6;    // с: маска страха на цели «Брейнрота»
const ABIL_GHOST_RANGE = 450;        // px: враг ближе — исчезнуть
const ABIL_GHOST_TIME = 3;
const ABIL_GHOST_ALPHA = 0.28;       // видимость невидимки для игрока
const ABIL_GRAV_UP = 1.8;            // × вертикаль отбрасывания «Гравитации»
const ABIL_GRAV_SIDE = 0.5;          // × горизонталь
const ABIL_GRAV_FALL = 0.22;         // × гравитация на спуске
const ABIL_GRAV_DRAG = 0.8;          // 1/с: торможение по горизонтали на спуске
const ABIL_SPEED_RUN = 1.35;
const ABIL_SPEED_DASH = 0.5;         // × перезарядка рывка
const ABIL_HOLE_RANGE = 800;
const ABIL_HOLE_PULL_R = 650;        // px: радиус затягивания
const ABIL_HOLE_PULL = 340;          // px/с: затягивание у края -> ×(0.4…1) к центру
const ABIL_HOLE_TIME = 1.8;          // с затягивания до взрыва
const ABIL_HOLE_BLAST = 420;
const ABIL_HOLE_POWER = 950;

// Ассеты — литералами (сборщик видит только литералы).
const ABIL_SND = {
    explosion: 'assets/sounds/explosion.mp3', freeze: 'assets/sounds/freeze.mp3', fire: 'assets/sounds/fire_whoosh.mp3',
    hole: 'assets/sounds/blackhole.mp3', whoosh: 'assets/sounds/whoosh_big.mp3', thud: 'assets/sounds/land_thud.mp3',
    slap2: 'assets/sounds/slap_2.mp3', slap4: 'assets/sounds/slap_4.mp3', coin: 'assets/sounds/coin.mp3',
    aura: 'assets/sounds/aura_gain.mp3', pop: 'assets/sounds/bubble_pop.mp3', swing: 'assets/sounds/swing_2.mp3',
    dash: 'assets/sounds/dash.mp3', portal: 'assets/sounds/portal.mp3',
};
const ABIL_TEX = {
    flame: 'assets/textures/fx/flame.png', glow: 'assets/textures/fx/glow_dot.png', heart: 'assets/textures/fx/heart.png',
    shard: 'assets/textures/fx/ice_shard.png', smoke: 'assets/textures/fx/smoke_puff.png', sparkle: 'assets/textures/fx/sparkle.png',
    star: 'assets/textures/fx/star.png', burst: 'assets/textures/fx/impact_burst.png', flash: 'assets/textures/fx/impact_flash.png',
    ring: 'assets/textures/fx/ring_shockwave.png', dust: 'assets/textures/fx/dust.png', confetti: 'assets/textures/fx/confetti_sheet.png',
};
const ABIL_MODELS = {
    bomb: 'assets/models/props/bomb.glb', meteor: 'assets/models/props/meteor.glb',
    ice: 'assets/models/props/ice_block.glb', tile: 'assets/models/props/tile.glb',
};
// Новые перчатки -> способность-основа (своё — только частицы, цвета и тексты).
/** @type {Record<string, string>} */
const ABIL_BASE = { rainbow: 'love', neon: 'speed', pixel: 'tile', dragon: 'fire' };
// «Пиксельный» блок: яркие цвета (emissive), один — случайно на бросок.
const ABIL_PIXEL_COLORS = [[0.95, 0.25, 0.35], [0.25, 0.85, 0.35], [0.25, 0.55, 1], [1, 0.8, 0.15], [0.75, 0.3, 1]];
// Активные способности: радиус поиска цели (px) и минимальная дальность.
const ABIL_ACTIVE = {
    fire: { range: ABIL_FIRE_RANGE, min: 0 }, bomb: { range: ABIL_BOMB_RANGE, min: ABIL_BOMB_MIN },
    meteor: { range: ABIL_METEOR_RANGE, min: 100 }, tile: { range: ABIL_TILE_RANGE, min: 0 },
    ghost: { range: ABIL_GHOST_RANGE, min: 0 }, blackhole: { range: ABIL_HOLE_RANGE, min: 120 },
};

/** @satisfies {Record<string, any>} */
const GameAbilities = {
    /** @type {WeakMap<Character, any>} */
    _st: new WeakMap(),
    /** @type {Set<Character>} */
    _fxChars: new Set(),
    /** @type {Array<{ update: (dt: number) => boolean, dispose?: () => void }>} */
    _live: [],
    /** @type {Record<string, any>} */
    _models: {},
    /** @type {Record<string, BABYLON.Texture>} */
    _tex: {},
    /** @type {HTMLElement | null} */
    hud: null,
    _hudGlove: '',
    _hudState: '',
    _hudFrac: -1,
    _hudPosAt: 0,
    _hudReady: true,

    // --- Жизненный цикл ----------------------------------------------------------------

    async init(game) {
        this._recipes();
        this._buildHud();
        Game.on('despawn', (e) => this._clear(e.char, true));
        Game.on('ko', (e) => this._clear(e.victim, false));
        Game.on('respawn', (e) => {
            const s = this._state(e.char);
            s.next = Math.max(s.next, Game.time + ABIL_SPAWN_DELAY);
            s.wait = 0;
        });
        Game.on('dash', (e) => {
            const c = e.char;
            if (c && this._base(c.glove) === 'speed') {
                this.burst(c.glove === 'neon' ? 'neonBurst' : 'zapBurst', c.x, c.h + 100, c.y);
                this._snd(ABIL_SND.pop, c.x, c.y, 0.5, 1.6, c.isPlayer);
            }
        });
        await Promise.all(Object.keys(ABIL_MODELS).map(k => Model3D.load(ABIL_MODELS[k]).then(m => { this._models[k] = m; }).catch(() => null)));
        void game;
    },

    update(dt, realDt) {
        if (!GameWorld.scene) return;
        for (const c of Game.chars) {
            if (c.disposed) continue;
            const s = this._state(c);
            if (s.glove !== c.glove) this._onGlove(c, s);
            if (c.state === 'dead') continue;
            this._tickChar(c, s, dt);
        }
        // Персонажи с эффектами, которых убрали без события despawn.
        for (const c of this._fxChars) if (c.disposed || Game.chars.indexOf(c) < 0) this._clear(c, true);
        for (let i = this._live.length - 1; i >= 0; i--) {
            const o = this._live[i];
            let alive = false;
            try { alive = o.update(dt); } catch (e) { console.error('GameAbilities:', e); alive = false; }
            if (!alive) {
                this._live.splice(i, 1);
                try { if (o.dispose) o.dispose(); } catch (e) { console.error('GameAbilities dispose:', e); }
            }
        }
        this._hudUpdate(realDt || dt);
    },

    onZone() {
        const p = Game.player;
        if (p) this._clear(p, false);
    },

    _state(c) {
        let s = this._st.get(c);
        if (!s) {
            s = { glove: '', next: 0, wait: 0, hits: 0, rageUntil: 0, rageFx: null, rageMeshes: null, ghostUntil: 0,
                frozen: null, float: null, slide: null, trail: null, mask: null, maskUntil: 0, stars: null,
                mods: { power: 1, speed: 1, dashCooldown: 1, gravity: 1, friction: 1 } };
            this._st.set(c, s);
        }
        return s;
    },

    _onGlove(c, s) {
        this._endRage(c, s);
        this._endGhost(c, s);
        if (s.trail) { s.trail.stop(); s.trail = null; }
        s.glove = c.glove;
        s.hits = 0;
        s.wait = 0;
        s.next = Game.time + ABIL_EQUIP_DELAY;
    },

    // Снять все длящиеся эффекты персонажа (падение, уход из игры, смена зоны игрока).
    _clear(c, gone) {
        const s = this._st.get(c);
        this._fxChars.delete(c);
        if (!s) return;
        if (s.frozen) this._endFreeze(c, s, false);
        this._endRage(c, s);
        this._endGhost(c, s);
        if (s.float) this._endFloat(c, s);
        if (s.slide) this._endSlide(c, s);
        if (s.trail) { s.trail.stop(); s.trail = null; }
        if (s.stars) { s.stars.stop(); s.stars = null; }
        if (s.mask && !c.disposed && c.mask === s.mask) c.setMask(null);
        s.mask = null;
        if (!gone && !c.disposed) this._mods(c, s);
    },

    // --- Публичное ---------------------------------------------------------------------

    // Способность-основа перчатки (новые ad-перчатки — на механиках существующих, ABIL_BASE).
    _base(id) { return ABIL_BASE[id] || id; },

    // Секунд до готовности активной способности (0 — готова или способность пассивная).
    cooldownLeft(ch) {
        if (!ch) return 0;
        const g = GameGloves.get(ch.glove);
        if (!g || g.kind !== 'active') return 0;
        return Math.max(0, this._state(ch).next - Game.time);
    },

    // Идёт ли длящаяся способность («Ярость», невидимость).
    isActive(ch) {
        const s = ch ? this._st.get(ch) : null;
        return !!s && (Game.time < s.rageUntil || Game.time < s.ghostUntil);
    },

    // Множитель шанса Фонк Момента для атакующего («Брейнрот» — ×3).
    phonkMult(ch) {
        const g = ch ? GameGloves.get(ch.glove) : null;
        return g ? g.phonk || 1 : 1;
    },

    // Применить активную способность сейчас (цель — переданная или ближайшая в радиусе).
    cast(ch, target) {
        if (!ch || ch.disposed) return false;
        const base = this._base(ch.glove);
        const g = GameGloves.get(ch.glove), def = ABIL_ACTIVE[base];
        if (!g || g.kind !== 'active' || !def) return false;
        const s = this._state(ch);
        const t = target || this._target(ch, def.range, def.min);
        if (!t && base !== 'ghost' && base !== 'fire') return false;
        s.next = Game.time + (g.cd || 10);
        s.wait = 0;
        switch (base) {
            case 'fire': this._castFire(ch, s); break;
            case 'bomb': this._castBomb(ch, t); break;
            case 'meteor': this._castMeteor(ch, t); break;
            case 'tile': this._castTile(ch, t, ch.glove === 'pixel'); break;
            case 'ghost': this._castGhost(ch, s); break;
            case 'blackhole': this._castHole(ch, t); break;
        }
        Game.emit('ability', { char: ch, ability: ch.glove, x: ch.x, y: ch.y });
        return true;
    },

    // Частицы-рецепт 'ab.<name>' в точке (x, высота h, y карты). force — и вдали от камеры.
    burst(name, x, h, y, force) { return this._play('ab.' + name, x, h, y, null, force); },

    // --- Кадр персонажа ------------------------------------------------------------------

    _tickChar(c, s, dt) {
        const now = Game.time;
        if (s.frozen) this._tickFrozen(c, s, dt);
        if (s.float) {
            const f = s.float;
            f.t += dt;
            if (c.state !== 'ragdoll' || now > f.until || (c.onGround && f.t > 0.15)) this._endFloat(c, s);
            else if (c.vh < 0) { const k = Math.exp(-ABIL_GRAV_DRAG * dt); c.vx *= k; c.vy *= k; }
        }
        if (s.slide) {
            const sl = s.slide;
            if ((c.state !== 'ragdoll' && c.state !== 'down') || now > sl.until) this._endSlide(c, s);
            else this._rate(sl.fx, c.onGround && c.speed > 120 ? 28 : 0);
        }
        if (s.rageUntil && now >= s.rageUntil) this._endRage(c, s);
        if (s.ghostUntil) {
            if (now >= s.ghostUntil) this._endGhost(c, s);
            else this._visibility(c, ABIL_GHOST_ALPHA);
        }
        if (s.mask && (now > s.maskUntil || c.mask !== s.mask)) {
            if (c.mask === s.mask && !this._phonkOn()) c.setMask(null);
            s.mask = null;
        }
        this._mods(c, s);
        this._auto(c, s);
        // Спидстер / Неоновая: искры на бегу у игрока.
        if (c.isPlayer && this._base(c.glove) === 'speed') {
            if (!s.trail) s.trail = this._play(c.glove === 'neon' ? 'ab.neon' : 'ab.zap', c.x, c.h, c.y, { follow: () => new BABYLON.Vector3(c.x, c.h, c.y) }, true);
            this._rate(s.trail, c.onGround && c.speed > 300 ? 30 : 0);
            this._fxChars.add(c);
        } else if (s.trail) { s.trail.stop(); s.trail = null; }
    },

    // Множители персонажа: меняется только своя доля (чужие множители сохраняются).
    _mods(c, s) {
        const now = Game.time, fast = this._base(c.glove) === 'speed';
        const want = {
            power: now < s.rageUntil ? ABIL_FIRE_POWER : 1,
            speed: fast ? ABIL_SPEED_RUN : 1,
            dashCooldown: fast ? ABIL_SPEED_DASH : 1,
            gravity: s.float && c.vh < 0 && !c.onGround ? ABIL_GRAV_FALL : 1,
            friction: s.slide ? ABIL_SLIME_FRICTION : 1,
        };
        /** @type {Record<string, number>} */
        const m = /** @type {any} */ (c.mods);
        for (const k in want) {
            const v = want[k], was = s.mods[k] || 1;
            if (v === was) continue;
            m[k] = (m[k] || 1) / was * v;
            s.mods[k] = v;
        }
    },

    // Автоприменение активной способности.
    _auto(c, s) {
        const def = ABIL_ACTIVE[this._base(c.glove)];
        if (!def || Game.time < s.next || !this._canCast(c, s)) { s.wait = 0; return; }
        const t = this._target(c, def.range, def.min);
        if (!t) { s.wait = 0; return; }
        if (!c.isPlayer) {
            if (!s.wait) { s.wait = Game.time + ABIL_BOT_DELAY_MIN + Math.random() * (ABIL_BOT_DELAY_MAX - ABIL_BOT_DELAY_MIN); return; }
            if (Game.time < s.wait) return;
        }
        this.cast(c, t);
    },

    _canCast(c, s) {
        if (c.hidden || c.isDummy || s.frozen || c.h < -150) return false;
        const st = c.state;
        if (st !== 'idle' && st !== 'run' && st !== 'slap') return false;
        if (!Game.pvp(c.zone)) return false;
        if (c.isPlayer) {
            const gp = /** @type {any} */ (GamePlayer);
            return Game.started && !Game.transitioning && GameInput.enabled && gp.autoSlap !== false && !gp.frozen;
        }
        const gb = typeof GameBots !== 'undefined' ? /** @type {any} */ (GameBots) : null;
        if (gb && typeof gb.isFrozen === 'function' && gb.isFrozen(c.zone)) return false;
        return true;
    },

    // Ближайшая цель способности: canAffect, стоит (не в полёте), та же зона; боты не видят невидимых.
    _target(c, R, minR) {
        let best = null, bd = R * R;
        const m2 = (minR || 0) * (minR || 0);
        for (const o of Game.chars) {
            if (o === c || o.zone !== c.zone || !GameCombat.canAffect(o, c) || !o.canBeSlapped()) continue;
            if (o.invisible && !c.isPlayer) continue;
            if (Math.abs(o.h - c.h) > 300) continue;
            const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy;
            if (d2 < m2 || d2 > bd) continue;
            bd = d2; best = o;
        }
        return best;
    },

    _phonkOn() {
        const gp = typeof GamePhonk !== 'undefined' ? /** @type {any} */ (GamePhonk) : null;
        return !!(gp && gp.active);
    },

    // --- На шлепок (зовёт GameCombat.hit) ----------------------------------------------

    // До отбрасывания: fx { power, stun, up, side, defer } можно менять.
    onHit(attacker, victim, fx, dx, dy) {
        const vs = this._state(victim);
        const wasFrozen = !!vs.frozen;
        if (wasFrozen) this._endFreeze(victim, vs, false);    // удар по льду — лёд разлетается, летит от этого удара
        switch (attacker.glove) {
            case 'slime': fx.side *= ABIL_SLIME_SIDE; break;
            case 'gravity': fx.up *= ABIL_GRAV_UP; fx.side *= ABIL_GRAV_SIDE; break;
            case 'ice':
                if (!wasFrozen && victim.state !== 'ragdoll' && victim.state !== 'dead') { fx.defer = true; this._freeze(attacker, victim, fx, dx, dy); }
                break;
        }
    },

    // После события slap и +1 ауры: бонусная аура, длящиеся эффекты на цели, частицы.
    afterHit(attacker, victim, fx) {
        const as = this._state(attacker), vs = this._state(victim);
        as.hits++;
        const mine = attacker.isPlayer || victim.isPlayer;
        const vx = victim.x, vy = victim.y, vh = victim.h;
        switch (attacker.glove) {
            case 'slime': {
                if (vs.slide) this._endSlide(victim, vs);
                vs.slide = { until: Game.time + 3.5, fx: this._play('ab.gooTrail', vx, vh, vy, { follow: () => new BABYLON.Vector3(victim.x, victim.h + 4, victim.y) }) };
                this._fxChars.add(victim);
                this.burst('goo', vx, vh + 110, vy);
                break;
            }
            case 'love':
                if (as.hits % ABIL_LOVE_EVERY === 0) {
                    Game.addAura(attacker, ABIL_LOVE_AURA);
                    this.burst('hearts', vx, vh + 150, vy);
                    this.burst('hearts', attacker.x, attacker.h + 180, attacker.y);
                    if (attacker.isPlayer && typeof GameUI !== 'undefined') GameUI.popup(victim, '+' + ABIL_LOVE_AURA + ' ❤');
                    this._snd(ABIL_SND.aura, vx, vy, 1, 1.25, attacker.isPlayer);
                }
                break;
            case 'brainrot':
                if (!this._phonkOn() && victim.state !== 'dead') {
                    const keys = ['fearful', 'scream', 'scared_blue'];
                    victim.setMask(keys[Math.floor(Math.random() * keys.length)]);
                    vs.mask = victim.mask;
                    vs.maskUntil = Game.time + ABIL_BRAIN_MASK_TIME;
                }
                this.burst('brain', vx, vh + 170, vy);
                break;
            case 'gravity':
                if (victim.state === 'ragdoll') {
                    if (vs.float) this._endFloat(victim, vs);
                    vs.float = { until: Game.time + 5, t: 0, fx: this._play('ab.float', vx, vh, vy, { follow: () => new BABYLON.Vector3(victim.x, victim.h, victim.y) }) };
                    this._fxChars.add(victim);
                }
                this.burst('gravHit', vx, vh + 60, vy);
                this._snd(ABIL_SND.whoosh, vx, vy, 0.45, 1.25, mine);
                break;
            case 'giant':
                this._ring(vx, (GameWorld.floorAt(vx, vy) ?? vh) + 3, vy, 40, 330, 0.45, new BABYLON.Color3(1, 0.95, 0.85));
                this.burst('dust', vx, vh + 10, vy);
                if (mine) GameCamera.shake(0.45, 0.25);
                break;
            case 'golden':
                if (as.hits % ABIL_GOLD_EVERY === 0) {
                    Game.addAura(attacker, ABIL_GOLD_AURA);
                    this.burst('gold', vx, vh + 150, vy);
                    if (attacker.isPlayer && typeof GameUI !== 'undefined') GameUI.popup(victim, '+' + ABIL_GOLD_AURA);
                    this._snd(ABIL_SND.coin, vx, vy, 1, 1, attacker.isPlayer);
                }
                break;
            case 'diamond':
                this.burst('diamond', vx, vh + 130, vy);
                this._snd(ABIL_SND.coin, vx, vy, 0.45, 1.8, attacker.isPlayer);
                break;
            // Радужная (как «Любовь»): каждый 3-й — +2 ауры, сердечки и конфетти; искры — на каждом.
            case 'rainbow':
                this.burst('rainbow', vx, vh + 140, vy);
                if (as.hits % ABIL_LOVE_EVERY === 0) {
                    Game.addAura(attacker, ABIL_LOVE_AURA);
                    this.burst('hearts', vx, vh + 150, vy);
                    this.burst('confetti', attacker.x, attacker.h + 180, attacker.y);
                    if (attacker.isPlayer && typeof GameUI !== 'undefined') GameUI.popup(victim, '+' + ABIL_LOVE_AURA + ' 🌈');
                    this._snd(ABIL_SND.aura, vx, vy, 1, 1.35, attacker.isPlayer);
                }
                break;
            case 'neon':
                this.burst('neonBurst', vx, vh + 120, vy);
                break;
            case 'pixel':
                this.burst('pixel', vx, vh + 120, vy);
                break;
            // Драконья: огненный шлепок (сила — в статах перчатки, «Ярость» — активная способность).
            case 'dragon':
                this.burst('dragonHit', vx, vh + 110, vy);
                if (mine) GameCamera.shake(0.35, 0.2);
                break;
        }
        void fx;
    },

    // --- Лёд -------------------------------------------------------------------------------

    // Заморозка: персонаж стоит (state 'slap' без замаха: ни шага, ни шлепка, ни рывка) внутри
    // ice_block.glb; через ABIL_ICE_TIME — лёд разлетается и срабатывает отложенное отбрасывание.
    _freeze(attacker, victim, fx, dx, dy) {
        const s = this._state(victim);
        victim.slap = null;
        victim.dashT = 0;
        victim.emoteName = null;
        victim.vx = 0; victim.vy = 0;
        if (victim.onGround) victim.vh = 0;
        victim.state = 'slap';
        const until = Game.time + ABIL_ICE_TIME;
        const prevDash = victim.nextDashAt;
        victim.nextDashAt = Math.max(victim.nextDashAt, until);
        const block = this._model('ice');
        for (const m of block.getChildMeshes(false)) {
            const mat = /** @type {any} */ (m.material);
            for (const x of mat ? (mat.subMaterials || [mat]).filter(Boolean) : []) x.emissiveColor = new BABYLON.Color3(0.22, 0.32, 0.42);
        }
        block.scaling.setAll(0.3);
        s.frozen = { until, dx, dy, power: fx.power, stun: fx.stun, attacker, block, prevDash, t: 0 };
        this._fxChars.add(victim);
        this._placeBlock(victim, s.frozen);
        this.burst('frost', victim.x, victim.h + 20, victim.y);
        this._snd(ABIL_SND.freeze, victim.x, victim.y, 1, 1, attacker.isPlayer || victim.isPlayer);
    },

    _placeBlock(c, f) {
        const u = Math.min(1, f.t / 0.18);
        const k = u < 0.7 ? 0.3 + 0.82 * (u / 0.7) : 1.12 - 0.12 * ((u - 0.7) / 0.3);
        f.block.scaling.setAll(k);
        f.block.position.set(c.x, c.h - 4, c.y);
        f.block.rotation.y = -c.heading;
    },

    _tickFrozen(c, s, dt) {
        const f = s.frozen;
        // Персонажа сбили, телепортировали или он упал — лёд разлетается без отложенного полёта.
        if (c.disposed || c.state !== 'slap' || c.slap) { this._endFreeze(c, s, false); return; }
        c.setMove(0, 0);
        c._faceTo = null;
        f.t += dt;
        this._placeBlock(c, f);
        if (Game.time >= f.until) this._endFreeze(c, s, true);
    },

    _endFreeze(c, s, launch) {
        const f = s.frozen;
        if (!f) return;
        s.frozen = null;
        this._drop(f.block);
        if (!c.disposed) {
            this.burst('ice', c.x, c.h + 110, c.y);
            this._snd(ABIL_SND.freeze, c.x, c.y, 0.7, 1.5, c.isPlayer || (f.attacker && f.attacker.isPlayer));
            if (c.state === 'slap' && !c.slap) c.state = 'idle';
            if (c.nextDashAt <= f.until + 0.001) c.nextDashAt = f.prevDash;
            if (launch && c.state !== 'dead') {
                const att = f.attacker && !f.attacker.disposed ? f.attacker : null;
                GameCombat.push(c, f.dx, f.dy, f.power, { attacker: att, stun: f.stun, up: 1.1 });
            }
        }
    },

    // --- Невесомость / скольжение -----------------------------------------------------------

    _endFloat(c, s) {
        const f = s.float;
        s.float = null;
        if (f && f.fx) f.fx.stop();
        if (!c.disposed) this._mods(c, s);
    },

    _endSlide(c, s) {
        const sl = s.slide;
        s.slide = null;
        if (sl && sl.fx) sl.fx.stop();
        if (!c.disposed) this._mods(c, s);
    },

    // --- Огонь: «Ярость» ----------------------------------------------------------------

    _castFire(c, s) {
        s.rageUntil = Game.time + ABIL_FIRE_TIME;
        if (!s.rageFx) s.rageFx = this._play('ab.rage', c.x, c.h, c.y, { follow: () => new BABYLON.Vector3(c.x, c.h, c.y) });
        // Ореол GlowLayer по силуэту тела (перчатку не трогаем: у неё своё свечение узла Glow).
        // «Драконья» — ореол глубже, красный.
        if (!s.rageMeshes) {
            s.rageMeshes = c.meshes.filter(m => m && !m.isDisposed());
            const col = c.glove === 'dragon' ? new BABYLON.Color3(0.95, 0.12, 0.06) : new BABYLON.Color3(0.95, 0.28, 0.04);
            for (const m of s.rageMeshes) GameWorld.addGlow(m, col);
        }
        this._fxChars.add(c);
        this.burst('fireBurst', c.x, c.h + 90, c.y);
        this._snd(ABIL_SND.fire, c.x, c.y, 1, 1, c.isPlayer);
    },

    _endRage(c, s) {
        s.rageUntil = 0;
        if (s.rageFx) { s.rageFx.stop(); s.rageFx = null; }
        if (s.rageMeshes) { for (const m of s.rageMeshes) GameWorld.removeGlow(m); s.rageMeshes = null; }
        if (!c.disposed) this._mods(c, s);
    },

    // --- Призрак ------------------------------------------------------------------------

    _castGhost(c, s) {
        s.ghostUntil = Game.time + ABIL_GHOST_TIME;
        c.invisible = true;
        this._visibility(c, ABIL_GHOST_ALPHA);
        this._fxChars.add(c);
        this.burst('ghost', c.x, c.h, c.y);
        this._snd(ABIL_SND.portal, c.x, c.y, 0.7, 1.25, c.isPlayer);
    },

    _endGhost(c, s) {
        if (!s.ghostUntil && !c.invisible) return;
        const was = s.ghostUntil > 0;
        s.ghostUntil = 0;
        c.invisible = false;
        if (!c.disposed) {
            this._visibility(c, 1);
            if (was && c.state !== 'dead') this.burst('ghost', c.x, c.h, c.y);
        }
    },

    _visibility(c, a) {
        if (!c.root || c.disposed) return;
        for (const m of c.root.getChildMeshes(false)) if (m.visibility !== a) m.visibility = a;
    },

    // --- Бомба --------------------------------------------------------------------------

    _castBomb(c, t) {
        c.faceTo(t.x, t.y, 0.35);
        const hand = c.grip ? c.grip.getAbsolutePosition().clone() : new BABYLON.Vector3(c.x, c.h + 120, c.y);
        // Упреждение: туда, где цель будет к падению бомбы.
        const d0 = Math.hypot(t.x - hand.x, t.y - hand.z);
        const T = Math.max(0.45, Math.min(0.95, d0 / 900));
        const tx = t.x + t.vx * T * 0.6, ty = t.y + t.vy * T * 0.6;
        const fh = GameWorld.floorAt(tx, ty);
        const th = fh !== null ? fh : t.h;
        const apex = 140 + d0 * 0.22;
        const root = this._model('bomb');
        root.scaling.setAll(1.2);
        root.position.copyFrom(hand);
        let spark = null;
        const sparkMesh = root.getChildMeshes(false).find(m => m.metadata && m.metadata.part === 'Spark');
        if (sparkMesh) {
            const mat = /** @type {any} */ (sparkMesh.material);
            if (mat && 'emissiveColor' in mat) mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
            const piv = (sparkMesh.metadata && sparkMesh.metadata.pivot) || [14, 46, -2];
            const local = new BABYLON.Vector3(piv[0], piv[1], piv[2]);
            spark = this._play('ab.fuse', hand.x, hand.y, hand.z, { follow: () => BABYLON.Vector3.TransformCoordinates(local, root.getWorldMatrix()) });
        }
        this._snd(ABIL_SND.swing, c.x, c.y, 1, 0.8, c.isPlayer);
        const zone = c.zone;
        let tt = 0;
        this._live.push({
            update: (dt) => {
                tt += dt;
                const u = Math.min(1, tt / T);
                root.position.set(hand.x + (tx - hand.x) * u, hand.y + (th + 36 - hand.y) * u + 4 * apex * u * (1 - u), hand.z + (ty - hand.z) * u);
                root.rotation.x += dt * 7;
                root.rotation.z += dt * 4;
                if (u < 1) return true;
                this._explode(tx, ty, th, c, zone, ABIL_BOMB_BLAST, ABIL_BOMB_POWER);
                return false;
            },
            dispose: () => { if (spark) spark.stop(); this._drop(root); },
        });
    },

    // Взрыв: отбрасывание (GameCombat.blast), вспышка, огонь, искры, дым, ударная волна, звук, тряска.
    _explode(x, y, h, attacker, zone, radius, power) {
        GameCombat.blast(x, y, radius, power, attacker && !attacker.disposed ? attacker : null, zone);
        this.burst('boom', x, h + 50, y);
        this._ring(x, h + 4, y, 30, radius * 1.15, 0.5, new BABYLON.Color3(1, 0.75, 0.35));
        this._snd(ABIL_SND.explosion, x, y, 1, 1, this._playerNear(x, y, radius * 1.5));
        this._shake(x, y, 0.75);
    },

    // --- Метеор -------------------------------------------------------------------------

    _castMeteor(c, t) {
        let dx = t.x - c.x, dy = t.y - c.y;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        c.faceTo(t.x, t.y, 0.3);
        const R = 92 * ABIL_METEOR_SCALE;
        const o = { x: c.x + dx * 150, y: c.y + dy * 150, h: c.h + R, vh: 0, t: 0, angle: 0, falling: false, fade: 0 };
        const fh0 = GameWorld.floorAt(o.x, o.y);
        if (fh0 !== null) o.h = fh0 + R;
        const root = this._model('meteor');
        root.scaling.setAll(ABIL_METEOR_SCALE);
        root.rotationQuaternion = BABYLON.Quaternion.Identity();
        for (const m of root.getChildMeshes(false)) {
            if (!(m.metadata && m.metadata.part === 'Glow')) continue;
            const mat = /** @type {any} */ (m.material);
            for (const x of mat ? (mat.subMaterials || [mat]).filter(Boolean) : []) x.emissiveColor = new BABYLON.Color3(1, 1, 1);
            GameWorld.addGlow(m, new BABYLON.Color3(0.95, 0.38, 0.06));
        }
        const axis = new BABYLON.Vector3(dy, 0, -dx);
        const trail = this._play('ab.meteor', o.x, o.h, o.y, { follow: () => new BABYLON.Vector3(o.x, o.h, o.y) });
        const hit = new Set([c]);
        const zone = c.zone;
        this._snd(ABIL_SND.fire, c.x, c.y, 1, 0.8, c.isPlayer);
        this._snd(ABIL_SND.whoosh, c.x, c.y, 0.8, 1, c.isPlayer);
        this._live.push({
            update: (dt) => {
                o.t += dt;
                if (!o.falling) { o.x += dx * ABIL_METEOR_SPEED * dt; o.y += dy * ABIL_METEOR_SPEED * dt; }
                else { o.x += dx * ABIL_METEOR_SPEED * 0.6 * dt; o.y += dy * ABIL_METEOR_SPEED * 0.6 * dt; }
                const fh = GameWorld.floorAt(o.x, o.y);
                if (!o.falling && fh !== null) o.h = fh + R;
                else { o.falling = true; o.vh -= GameCfg.gravity * dt; o.h += o.vh * dt; }
                o.angle += ABIL_METEOR_SPEED * dt / R;
                BABYLON.Quaternion.RotationAxisToRef(axis, o.angle, root.rotationQuaternion);
                root.position.set(o.x, o.h, o.y);
                // Сносит всех на пути (каждого — один раз).
                if (o.fade === 0) {
                    const att = c.disposed ? null : c;
                    for (const ch of Game.chars) {
                        if (hit.has(ch) || ch.zone !== zone || !GameCombat.canAffect(ch, att)) continue;
                        const ex = ch.x - o.x, ey = ch.y - o.y, d = Math.hypot(ex, ey);
                        if (d > R + GameCfg.charRadius + 10 || ch.h > o.h + R || ch.h + 200 < o.h - R) continue;
                        hit.add(ch);
                        let px = dx * 0.75 + (d > 1 ? ex / d : 0) * 0.6, py = dy * 0.75 + (d > 1 ? ey / d : 0) * 0.6;
                        const pl = Math.hypot(px, py) || 1;
                        px /= pl; py /= pl;
                        GameCombat.push(ch, px, py, ABIL_METEOR_POWER, { attacker: att, up: 1.15 });
                        this.burst('meteorHit', ch.x, ch.h + 100, ch.y);
                        this._snd(ABIL_SND.slap4, ch.x, ch.y, 1, 0.9, ch.isPlayer || c.isPlayer);
                        if (ch.isPlayer || c.isPlayer) GameCamera.shake(0.55, 0.3);
                    }
                    // Врезался в препятствие (пальма, моаи, камень) — разлетается.
                    if (!o.falling && GameWorld.colliders.length) {
                        const r = GameWorld.resolveCollision(o.x, o.y, R * 0.55, o.h - R);
                        if (r.hit) { this._explode(o.x, o.y, o.h - R, c, zone, 220, 600); return false; }
                    }
                }
                if (o.h < GameCfg.koHeight) return false;
                if (o.t > ABIL_METEOR_TIME) {
                    o.fade += dt;
                    root.scaling.setAll(ABIL_METEOR_SCALE * Math.max(0.01, 1 - o.fade / 0.3));
                    if (o.fade >= 0.3) { this.burst('meteorHit', o.x, o.h, o.y); return false; }
                }
                return true;
            },
            dispose: () => { if (trail) trail.stop(); this._drop(root); },
        });
    },

    // --- Плитка -------------------------------------------------------------------------

    // pixel — «Пиксельная»: тот же блок, перекрашенный в яркий цвет.
    _castTile(c, t, pixel) {
        const root = this._model('tile');
        root.scaling.setAll(ABIL_TILE_SCALE);
        if (pixel) {
            const rgb = ABIL_PIXEL_COLORS[Math.floor(Math.random() * ABIL_PIXEL_COLORS.length)];
            for (const m of root.getChildMeshes(false).concat([root])) {
                const mat = /** @type {any} */ (m.material);
                for (const x of mat ? (mat.subMaterials || [mat]).filter(Boolean) : []) {
                    if ('diffuseColor' in x) x.diffuseColor = new BABYLON.Color3(rgb[0], rgb[1], rgb[2]);
                    if ('emissiveColor' in x) x.emissiveColor = new BABYLON.Color3(rgb[0] * 0.45, rgb[1] * 0.45, rgb[2] * 0.45);
                }
            }
        }
        const o = { x: t.x, y: t.y, h: t.h + 210 + ABIL_TILE_DROP, vh: -260, done: false, life: 0, vx: 0, vy: 0, spin: 0 };
        root.position.set(o.x, o.h, o.y);
        root.rotation.y = Math.random() * Math.PI;
        this._snd(ABIL_SND.swing, t.x, t.y, 0.8, 0.7, c.isPlayer || t.isPlayer);
        let floorH = GameWorld.floorAt(t.x, t.y);
        this._live.push({
            update: (dt) => {
                if (!o.done) {
                    const ok = !t.disposed && t.state !== 'dead' && t.zone === c.zone;
                    if (ok) { o.x = t.x; o.y = t.y; floorH = GameWorld.floorAt(o.x, o.y); }
                    const top = ok ? t.h + 205 : (floorH !== null ? floorH + 10 : -2000);
                    o.vh -= 3400 * dt;
                    o.h += o.vh * dt;
                    root.rotation.y += dt * 3;
                    root.position.set(o.x, o.h, o.y);
                    if (o.h > top) return true;
                    o.done = true;
                    o.h = top;
                    const att = c.disposed ? null : c;
                    if (ok && GameCombat.canAffect(t, att)) {
                        const a = Math.random() * Math.PI * 2;
                        GameCombat.push(t, Math.cos(a), Math.sin(a), 140, { attacker: att, stun: ABIL_TILE_STUN, up: 0.35 });
                        const ts = this._state(t);
                        if (ts.stars) ts.stars.stop();
                        ts.stars = this._play('ab.stars', t.x, t.h + 150, t.y, { follow: () => new BABYLON.Vector3(t.x, t.h + 150, t.y) });
                        this._fxChars.add(t);
                        this._snd(ABIL_SND.slap2, t.x, t.y, 1, 0.85, t.isPlayer || c.isPlayer);
                        if (t.isPlayer) GameCamera.shake(0.5, 0.25);
                    }
                    this.burst('tileHit', o.x, o.h, o.y);
                    if (pixel) this.burst('pixel', o.x, o.h + 20, o.y);
                    this._snd(ABIL_SND.thud, o.x, o.y, 0.9, 1.2, t.isPlayer || c.isPlayer);
                    const a2 = Math.random() * Math.PI * 2;
                    o.vh = 420; o.vx = Math.cos(a2) * 180; o.vy = Math.sin(a2) * 180; o.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 4);
                    return true;
                }
                o.life += dt;
                o.vh -= 2600 * dt;
                o.h += o.vh * dt;
                o.x += o.vx * dt; o.y += o.vy * dt;
                root.rotation.x += o.spin * dt;
                root.position.set(o.x, o.h, o.y);
                if (o.life > 0.45) root.scaling.setAll(ABIL_TILE_SCALE * Math.max(0.01, 1 - (o.life - 0.45) / 0.35));
                return o.life < 0.8;
            },
            dispose: () => this._drop(root),
        });
    },

    // --- Чёрная дыра --------------------------------------------------------------------

    _castHole(c, t) {
        const scene = GameWorld.scene;
        const fh = GameWorld.floorAt(t.x, t.y);
        const x = t.x, y = t.y, h = (fh !== null ? fh : t.h) + 130;
        const zone = c.zone;
        const core = BABYLON.MeshBuilder.CreateSphere('ab-hole', { diameter: 96, segments: 16 }, scene);
        const coreMat = new BABYLON.StandardMaterial('ab-hole-mat', scene);
        coreMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        coreMat.specularColor = new BABYLON.Color3(0.25, 0.1, 0.3);
        coreMat.emissiveColor = new BABYLON.Color3(0.03, 0, 0.05);
        coreMat.metadata = { toon: false };
        core.material = coreMat;
        core.position.set(x, h, y);
        core.isPickable = false;
        const disk = BABYLON.MeshBuilder.CreateTorus('ab-hole-disk', { diameter: 190, thickness: 20, tessellation: 40 }, scene);
        const diskMat = new BABYLON.StandardMaterial('ab-hole-disk-mat', scene);
        diskMat.disableLighting = true;
        diskMat.emissiveColor = new BABYLON.Color3(0.95, 0.42, 0.9);
        diskMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        diskMat.specularColor = new BABYLON.Color3(0, 0, 0);
        diskMat.metadata = { toon: false };
        disk.material = diskMat;
        disk.parent = core;
        disk.rotation.x = 0.35;
        disk.isPickable = false;
        GameWorld.addGlow(disk, new BABYLON.Color3(0.8, 0.25, 0.72));
        core.scaling.setAll(0.01);
        // Частицы закручиваются к центру: старт на кольце, скорость — внутрь и по касательной.
        const swirl = this._play('ab.void', x, h, y, null);
        if (swirl) {
            for (const hd of swirl.handles) {
                const sys = hd.system;
                sys.startPositionFunction = (wm, pos) => {
                    const a = Math.random() * Math.PI * 2, r = 230 + Math.random() * 130;
                    pos.set(x + Math.cos(a) * r, h + (Math.random() - 0.5) * 140, y + Math.sin(a) * r);
                };
                sys.startDirectionFunction = (wm, dir, particle) => {
                    const px = particle.position.x - x, py = particle.position.y - h, pz = particle.position.z - y;
                    const r = Math.hypot(px, pz) || 1;
                    dir.set(-px / r - pz / r * 0.75, -py / r, -pz / r + px / r * 0.75);
                    dir.normalize();
                };
            }
        }
        this._snd(ABIL_SND.hole, x, y, 1, 1, c.isPlayer || this._playerNear(x, y, ABIL_HOLE_PULL_R));
        let tt = 0;
        this._live.push({
            update: (dt) => {
                tt += dt;
                const grow = Math.min(1, tt / 0.3);
                let sc = grow < 1 ? 1.25 * Math.sin(grow * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) : 1 + Math.sin(tt * 18) * 0.04;
                if (tt > ABIL_HOLE_TIME) sc = Math.max(0.01, 1 - (tt - ABIL_HOLE_TIME) / 0.14);
                core.scaling.setAll(Math.max(0.01, sc));
                disk.rotation.y += dt * 7;
                if (tt <= ABIL_HOLE_TIME) {
                    const att = c.disposed ? null : c;
                    for (const ch of Game.chars) {
                        if (ch.zone !== zone || !GameCombat.canAffect(ch, att) || ch.h < -150) continue;
                        const dx = x - ch.x, dy = y - ch.y, d = Math.hypot(dx, dy);
                        if (d > ABIL_HOLE_PULL_R || d < 25) continue;
                        const k = 0.4 + 0.6 * (1 - d / ABIL_HOLE_PULL_R);
                        if (ch.state === 'ragdoll' || ch.state === 'falling') { ch.vx += dx / d * 1300 * k * dt; ch.vy += dy / d * 1300 * k * dt; }
                        else { const step = Math.min(d - 20, ABIL_HOLE_PULL * k * dt); ch.x += dx / d * step; ch.y += dy / d * step; }
                        if (att) { ch.lastHitBy = att; ch.lastHitTime = Game.time; }
                    }
                    return true;
                }
                if (tt < ABIL_HOLE_TIME + 0.14) return true;
                GameCombat.blast(x, y, ABIL_HOLE_BLAST, ABIL_HOLE_POWER, c.disposed ? null : c, zone);
                this.burst('voidBoom', x, h, y);
                this._ring(x, h - 125, y, 40, ABIL_HOLE_BLAST * 1.2, 0.55, new BABYLON.Color3(0.85, 0.45, 1));
                this._snd(ABIL_SND.explosion, x, y, 1, 0.85, this._playerNear(x, y, ABIL_HOLE_BLAST * 1.5));
                this._shake(x, y, 0.85);
                return false;
            },
            dispose: () => {
                if (swirl) swirl.stop();
                GameWorld.removeGlow(disk);
                disk.dispose(); core.dispose();
                diskMat.dispose(); coreMat.dispose();
            },
        });
    },

    // --- Помощники ----------------------------------------------------------------------

    // Модель реквизита (bomb / meteor / ice / tile) в сцене; нет файла — из примитивов.
    _model(key) {
        const scene = GameWorld.scene;
        const model = this._models[key];
        const root = model ? Model3D.build(model, scene, { name: 'ab-' + key }) : this._fallbackModel(key);
        World3D.addObject(GameWorld.view, root, 'prop');
        return root;
    },

    _fallbackModel(key) {
        const scene = GameWorld.scene;
        const root = new BABYLON.Mesh('ab-' + key, scene);
        const mat = new BABYLON.StandardMaterial('ab-' + key + '-mat', scene);
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        let m;
        if (key === 'bomb') { m = BABYLON.MeshBuilder.CreateSphere('ab-bomb-s', { diameter: 60, segments: 12 }, scene); mat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14); }
        else if (key === 'meteor') { m = BABYLON.MeshBuilder.CreateSphere('ab-meteor-s', { diameter: 184, segments: 12 }, scene); mat.diffuseColor = new BABYLON.Color3(0.25, 0.12, 0.08); mat.emissiveColor = new BABYLON.Color3(0.55, 0.16, 0.02); }
        else if (key === 'ice') { m = BABYLON.MeshBuilder.CreateBox('ab-ice-s', { width: 145, height: 247, depth: 205 }, scene); m.position.y = 123; mat.diffuseColor = new BABYLON.Color3(0.75, 0.92, 1); mat.alpha = 0.5; }
        else { m = BABYLON.MeshBuilder.CreateBox('ab-tile-s', { width: 160, height: 20, depth: 160 }, scene); mat.diffuseColor = new BABYLON.Color3(0.95, 0.97, 1); }
        m.material = mat;
        m.parent = root;
        return root;
    },

    _drop(root) {
        if (!root || root.isDisposed()) return;
        for (const m of root.getChildMeshes(false)) GameWorld.removeGlow(m);
        Model3D.dispose(GameWorld.view, root);
    },

    _texture(url) {
        let t = this._tex[url];
        if (!t) {
            t = this._tex[url] = new BABYLON.Texture(url, GameWorld.scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
            t.hasAlpha = true;
        }
        return t;
    },

    // Ударная волна по земле: плоское кольцо (ring_shockwave.png) растёт r0 -> r1 и гаснет.
    _ring(x, h, y, r0, r1, dur, color) {
        if (!this._near(x, y)) return;
        const scene = GameWorld.scene;
        const m = BABYLON.MeshBuilder.CreatePlane('ab-ring', { size: 2 }, scene);
        m.rotation.x = Math.PI / 2;
        m.position.set(x, h, y);
        m.isPickable = false;
        const mat = new BABYLON.StandardMaterial('ab-ring-mat', scene);
        mat.disableLighting = true;
        mat.emissiveColor = color;
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.opacityTexture = this._texture(ABIL_TEX.ring);
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.metadata = { toon: false };
        m.material = mat;
        let t = 0;
        this._live.push({
            update: (dt) => {
                t += dt;
                const u = Math.min(1, t / dur), e = 1 - (1 - u) * (1 - u);
                const s = r0 + (r1 - r0) * e;
                m.scaling.set(s, s, 1);
                mat.alpha = 1 - u * u;
                return u < 1;
            },
            dispose: () => { m.dispose(); mat.dispose(); },
        });
    },

    _near(x, y) {
        const cam = GameWorld.view && GameWorld.view.camera;
        if (!cam) return false;
        return Math.hypot(x - cam.position.x, y - cam.position.z) < ABIL_FX_DIST;
    },

    _playerNear(x, y, r) {
        const p = Game.player;
        return !!p && p.zone === Game.zone && Math.hypot(p.x - x, p.y - y) < r;
    },

    // Рецепт частиц в точке (Babylon x, высота, y карты); вдали от камеры — нет (кроме force).
    _play(name, x, h, y, opts, force) {
        const fx = Game.app && Game.app.fx;
        if (!fx || (!force && !this._near(x, y))) return null;
        try {
            const g = fx.play(name, new BABYLON.Vector3(x, h, y), opts || {});
            return g && g.handles.length ? g : null;
        } catch (e) { return null; }
    },

    // Частота непрерывного рецепта (первый слой — как есть, остальные — пропорционально).
    _rate(g, n) {
        if (!g) return;
        if (g._rate === n) return;
        g._rate = n;
        for (const h of g.handles) h.setRate(n * (h._base || (h._base = Math.max(1, h.system.emitRate || 1))) / (g.handles[0]._base || 1));
    },

    // Звук в точке: свой (игрок участвует) — полная громкость, чужой — тише и по расстоянию.
    _snd(url, x, y, vol, rate, mine) {
        const cam = GameWorld.view && GameWorld.view.camera;
        if (!cam) return;
        const d = Math.hypot(x - cam.position.x, y - cam.position.z);
        const k = mine ? 1 : Math.max(0, 1 - d / ABIL_SND_DIST);
        if (k < 0.04) return;
        Sound.play(url, { volume: (vol == null ? 1 : vol) * (mine ? 1 : 0.25 + 0.45 * k), rate: rate || 1, detune: 0.05 });
    },

    _shake(x, y, i) {
        const p = Game.player;
        if (!p || p.zone !== Game.zone) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < 1200) GameCamera.shake(i * (1 - d / 1200) + 0.12, 0.35);
    },

    // --- Частицы (рецепты app.fx) ----------------------------------------------------------
    // Цветные текстуры (пламя, сердце, лёд, дым, звезда, вспышка, конфетти) — обычное смешивание,
    // белые свечения (glow_dot, sparkle) — сложение.

    _recipes() {
        const fx = Game.app && Game.app.fx;
        if (!fx) return;
        const T = ABIL_TEX;
        const fade = (c) => [[0, c, 1], [0.75, c, 1], [1, c, 0]];
        fx.register('ab.rage', [
            { rate: 38, capacity: 46, life: [0.35, 0.6], size: [42, 78], speed: [70, 150], direction: [[-0.25, 1, -0.25], [0.25, 1, 0.25]],
                box: [[-38, 10, -38], [38, 175, 38]], texture: T.flame, blend: 'standard', color: '#ffffff', gravity: [0, 60, 0],
                sizeGradient: [[0, 0.5], [0.35, 1], [1, 0.25]], colorGradient: [[0, '#ffffff', 0], [0.15, '#ffffff', 1], [0.7, '#ffd0a0', 0.85], [1, '#ff6a2a', 0]] },
            { rate: 10, capacity: 14, life: [0.35, 0.55], size: [170, 240], speed: [0, 15], box: [[-15, 60, -15], [15, 140, 15]],
                texture: T.glow, color: '#ff4a14', sizeGradient: [[0, 0.7], [1, 1.1]], colorGradient: [[0, '#ff5a1a', 0], [0.3, '#ff4a14', 0.5], [1, '#ff2a0a', 0]] },
        ]);
        fx.register('ab.fireBurst', [
            { burst: 18, capacity: 20, life: [0.3, 0.55], size: [50, 90], speed: [200, 420], direction: [[-1, 0.2, -1], [1, 0.8, 1]], texture: T.flame,
                blend: 'standard', color: '#ffffff', gravity: [0, 300, 0], sizeGradient: [[0, 0.4], [0.3, 1], [1, 0.2]], colorGradient: [[0, '#ffffff', 1], [1, '#ff6a2a', 0]] },
        ]);
        fx.register('ab.boom', [
            { burst: 1, capacity: 1, life: [0.28, 0.28], size: [300, 300], speed: [0, 0], texture: T.burst, blend: 'standard', color: '#ffffff',
                sizeGradient: [[0, 0.35], [0.35, 1.05], [1, 1.25]], colorGradient: [[0, '#ffffff', 1], [0.6, '#ffffff', 0.9], [1, '#ffffff', 0]] },
            { burst: 16, capacity: 18, life: [0.35, 0.7], size: [80, 140], speed: [180, 420], direction: [[-1, 0.15, -1], [1, 1, 1]], texture: T.flame,
                blend: 'standard', color: '#ffffff', gravity: [0, 250, 0], sizeGradient: [[0, 0.5], [0.3, 1], [1, 0.3]], colorGradient: [[0, '#ffffff', 1], [1, '#ff5020', 0]] },
            { burst: 36, capacity: 40, life: [0.4, 0.9], size: [8, 18], speed: [350, 800], texture: T.glow, color: '#ffb040', gravity: [0, -1100, 0] },
            { delay: 0.08, burst: 12, capacity: 14, life: [0.9, 1.6], size: [110, 200], speed: [60, 170], direction: [[-1, 0.3, -1], [1, 1, 1]], texture: T.smoke,
                blend: 'standard', color: '#9a9a9a', gravity: [0, 70, 0], sizeGradient: [[0, 0.4], [1, 1.4]], colorGradient: [[0, '#8f8f8f', 0.85], [1, '#bdbdbd', 0]] },
        ]);
        fx.register('ab.frost', [
            { burst: 12, capacity: 12, life: [0.4, 0.8], size: [50, 90], speed: [30, 90], box: [[-50, 0, -50], [50, 200, 50]], texture: T.smoke,
                blend: 'standard', color: '#e2f6ff', colorGradient: [[0, '#e8f9ff', 0.85], [1, '#ffffff', 0]] },
            { burst: 10, capacity: 10, life: [0.3, 0.6], size: [30, 60], speed: [20, 90], box: [[-50, 20, -50], [50, 220, 50]], texture: T.sparkle, color: '#d8f6ff' },
        ]);
        fx.register('ab.ice', [
            { burst: 16, capacity: 18, life: [0.5, 0.9], size: [22, 44], speed: [220, 480], direction: [[-1, 0.3, -1], [1, 1.2, 1]], texture: T.shard,
                blend: 'standard', color: '#ffffff', gravity: [0, -1300, 0], spin: [-9, 9], colorGradient: fade('#ffffff') },
            { burst: 10, capacity: 10, life: [0.25, 0.5], size: [30, 70], speed: [60, 200], texture: T.sparkle, color: '#d8f6ff' },
        ]);
        fx.register('ab.hearts', [
            { burst: 9, capacity: 10, life: [0.8, 1.3], size: [28, 50], speed: [90, 220], direction: [[-0.7, 0.9, -0.7], [0.7, 1.5, 0.7]], texture: T.heart,
                blend: 'standard', color: '#ffffff', gravity: [0, 60, 0], spin: [-2, 2], sizeGradient: [[0, 0.2], [0.15, 1.15], [0.3, 1], [1, 0.8]], colorGradient: fade('#ffffff') },
        ]);
        fx.register('ab.goo', [
            { burst: 20, capacity: 22, life: [0.4, 0.8], size: [14, 30], speed: [160, 400], direction: [[-1, 0.4, -1], [1, 1.3, 1]], texture: T.glow,
                blend: 'standard', color: '#53e03a', gravity: [0, -1300, 0], colorGradient: [[0, '#6cff4a', 1], [1, '#2fae22', 0]] },
        ]);
        fx.register('ab.gooTrail', [
            { rate: 28, capacity: 30, life: [0.5, 0.9], size: [16, 32], speed: [0, 25], box: [[-28, 0, -28], [28, 8, 28]], direction: [[-1, 0.5, -1], [1, 1, 1]],
                texture: T.glow, blend: 'standard', color: '#4fd636', gravity: [0, -150, 0], colorGradient: [[0, '#69f54a', 0.95], [1, '#2a9a1e', 0]] },
        ]);
        fx.register('ab.gold', [
            { burst: 10, capacity: 10, life: [0.6, 1.0], size: [22, 38], speed: [160, 340], direction: [[-0.8, 0.9, -0.8], [0.8, 1.6, 0.8]], texture: T.star,
                blend: 'standard', color: '#ffd23a', gravity: [0, -900, 0], spin: [-6, 6] },
            { burst: 8, capacity: 8, life: [0.25, 0.5], size: [40, 80], speed: [40, 160], texture: T.sparkle, color: '#fff1a0' },
        ]);
        fx.register('ab.diamond', [
            { burst: 14, capacity: 14, life: [0.3, 0.6], size: [30, 70], speed: [100, 340], texture: T.sparkle, color: '#e8fbff' },
            { burst: 10, capacity: 10, life: [0.5, 0.8], size: [14, 26], speed: [200, 420], direction: [[-1, 0.3, -1], [1, 1.2, 1]], texture: T.shard,
                blend: 'standard', color: '#cdf6ff', gravity: [0, -1000, 0], spin: [-8, 8] },
            { burst: 1, capacity: 1, life: [0.18, 0.18], size: [220, 220], speed: [0, 0], texture: T.glow, color: '#9be8ff', sizeGradient: [[0, 0.4], [1, 1.2]] },
        ]);
        fx.register('ab.confetti', [
            { burst: 34, capacity: 36, life: [1.0, 1.7], size: [16, 28], speed: [260, 560], direction: [[-0.7, 1, -0.7], [0.7, 1.7, 0.7]], texture: T.confetti,
                blend: 'standard', color: '#ffffff', gravity: [0, -900, 0], spin: [-7, 7], sheet: { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true } },
        ]);
        fx.register('ab.brain', [
            { burst: 14, capacity: 14, life: [0.6, 1.0], size: [14, 24], speed: [180, 380], direction: [[-0.8, 0.8, -0.8], [0.8, 1.5, 0.8]], texture: T.confetti,
                blend: 'standard', color: '#ffffff', gravity: [0, -800, 0], spin: [-7, 7], sheet: { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true } },
            { burst: 6, capacity: 6, life: [0.25, 0.45], size: [36, 64], speed: [30, 120], texture: T.sparkle, color: '#ffb0ff' },
        ]);
        fx.register('ab.float', [
            { rate: 22, capacity: 26, life: [0.4, 0.7], size: [14, 28], speed: [10, 50], box: [[-45, 20, -45], [45, 180, 45]], texture: T.glow, color: '#b48cff' },
            { rate: 6, capacity: 8, life: [0.4, 0.7], size: [26, 44], speed: [5, 30], box: [[-45, 20, -45], [45, 180, 45]], texture: T.sparkle, color: '#e0d0ff' },
        ]);
        fx.register('ab.gravHit', [
            { burst: 22, capacity: 24, life: [0.3, 0.6], size: [16, 30], speed: [250, 480], direction: [[-1, 0.05, -1], [1, 0.25, 1]], texture: T.glow, color: '#a070ff' },
            { burst: 10, capacity: 10, life: [0.5, 0.9], size: [20, 34], speed: [200, 420], direction: [[-0.3, 1, -0.3], [0.3, 1, 0.3]], texture: T.sparkle, color: '#d8c8ff' },
        ]);
        fx.register('ab.dust', [
            { burst: 12, capacity: 12, life: [0.5, 0.9], size: [50, 90], speed: [140, 300], direction: [[-1, 0.05, -1], [1, 0.35, 1]], texture: T.dust,
                blend: 'standard', color: '#e2d3b4', gravity: [0, 40, 0], sizeGradient: [[0, 0.5], [1, 1.3]], colorGradient: [[0, '#e8dcc0', 0.9], [1, '#e8dcc0', 0]] },
        ]);
        fx.register('ab.stars', [
            { rate: 9, capacity: 10, life: [0.45, 0.7], size: [18, 30], speed: [40, 80], direction: [[-1, 0.1, -1], [1, 0.4, 1]], box: [[-30, 0, -30], [30, 8, 30]],
                texture: T.star, blend: 'standard', color: '#ffe14a', duration: 1.4, spin: [-4, 4] },
        ]);
        fx.register('ab.tileHit', [
            { burst: 1, capacity: 1, life: [0.2, 0.2], size: [170, 170], speed: [0, 0], texture: T.flash, blend: 'standard', color: '#ffffff',
                sizeGradient: [[0, 0.4], [1, 1.1]], colorGradient: [[0, '#ffffff', 1], [1, '#ffffff', 0]] },
            { burst: 10, capacity: 10, life: [0.4, 0.7], size: [30, 60], speed: [120, 260], direction: [[-1, 0.1, -1], [1, 0.6, 1]], texture: T.dust,
                blend: 'standard', color: '#f2f4f8', gravity: [0, -200, 0], colorGradient: [[0, '#ffffff', 0.9], [1, '#ffffff', 0]] },
        ]);
        fx.register('ab.fuse', [
            { rate: 45, capacity: 16, life: [0.12, 0.28], size: [8, 18], speed: [40, 140], texture: T.glow, color: '#ffc040' },
            { rate: 12, capacity: 6, life: [0.1, 0.2], size: [26, 40], speed: [0, 10], texture: T.sparkle, color: '#fff2b0' },
        ]);
        fx.register('ab.meteor', [
            { rate: 40, capacity: 34, life: [0.3, 0.55], size: [70, 120], speed: [30, 80], direction: [[-0.3, 1, -0.3], [0.3, 1, 0.3]], box: [[-55, -40, -55], [55, 40, 55]],
                texture: T.flame, blend: 'standard', color: '#ffffff', sizeGradient: [[0, 0.5], [0.3, 1], [1, 0.3]], colorGradient: [[0, '#ffffff', 0.9], [1, '#ff5a20', 0]] },
            { rate: 12, capacity: 18, life: [0.7, 1.2], size: [90, 160], speed: [10, 50], direction: [[-0.3, 1, -0.3], [0.3, 1, 0.3]], box: [[-40, -60, -40], [40, 0, 40]],
                texture: T.smoke, blend: 'standard', color: '#5a4a44', sizeGradient: [[0, 0.5], [1, 1.4]], colorGradient: [[0, '#4a3c36', 0.7], [1, '#7a6a64', 0]] },
        ]);
        fx.register('ab.meteorHit', [
            { burst: 10, capacity: 10, life: [0.3, 0.55], size: [60, 110], speed: [150, 330], direction: [[-1, 0.2, -1], [1, 1, 1]], texture: T.flame,
                blend: 'standard', color: '#ffffff', gravity: [0, 200, 0], colorGradient: [[0, '#ffffff', 1], [1, '#ff5020', 0]] },
            { burst: 22, capacity: 24, life: [0.35, 0.7], size: [8, 16], speed: [300, 650], texture: T.glow, color: '#ff9a30', gravity: [0, -1000, 0] },
        ]);
        fx.register('ab.void', [
            { rate: 70, capacity: 80, life: [0.6, 0.85], size: [10, 26], speed: [300, 420], texture: T.glow, color: '#d04ab8',
                colorGradient: [[0, '#ff7ae8', 0], [0.2, '#e050c8', 1], [1, '#7a20ff', 0.2]] },
            { rate: 14, capacity: 16, life: [0.5, 0.8], size: [22, 40], speed: [260, 360], texture: T.sparkle, color: '#f0c8ff' },
        ]);
        fx.register('ab.voidBoom', [
            { burst: 1, capacity: 1, life: [0.25, 0.25], size: [460, 460], speed: [0, 0], texture: T.glow, color: '#ff8af0', sizeGradient: [[0, 0.3], [1, 1.2]] },
            { burst: 44, capacity: 46, life: [0.4, 0.9], size: [18, 40], speed: [450, 950], texture: T.glow, color: '#d860ff', gravity: [0, -400, 0] },
            { burst: 14, capacity: 14, life: [0.4, 0.8], size: [40, 90], speed: [150, 400], texture: T.sparkle, color: '#ffffff' },
            { delay: 0.06, burst: 10, capacity: 10, life: [0.8, 1.4], size: [130, 230], speed: [80, 220], direction: [[-1, 0.2, -1], [1, 0.9, 1]], texture: T.smoke,
                blend: 'standard', color: '#4a2a6a', gravity: [0, 50, 0], sizeGradient: [[0, 0.5], [1, 1.4]], colorGradient: [[0, '#3c2058', 0.8], [1, '#6a4a8a', 0]] },
        ]);
        fx.register('ab.ghost', [
            { burst: 14, capacity: 14, life: [0.6, 1.0], size: [80, 140], speed: [40, 150], box: [[-30, 20, -30], [30, 180, 30]], texture: T.smoke,
                blend: 'standard', color: '#eef4ff', sizeGradient: [[0, 0.5], [1, 1.3]], colorGradient: [[0, '#f4f8ff', 0.8], [1, '#ffffff', 0]] },
            { burst: 8, capacity: 8, life: [0.3, 0.6], size: [30, 60], speed: [40, 160], box: [[-30, 20, -30], [30, 180, 30]], texture: T.sparkle, color: '#cfe0ff' },
        ]);
        fx.register('ab.zap', [
            { rate: 30, capacity: 22, life: [0.18, 0.35], size: [10, 22], speed: [0, 30], box: [[-30, 10, -30], [30, 160, 30]], texture: T.glow, color: '#ffe95a' },
            { rate: 6, capacity: 5, life: [0.12, 0.22], size: [24, 40], speed: [0, 10], box: [[-30, 10, -30], [30, 160, 30]], texture: T.sparkle, color: '#fff7c0' },
        ]);
        fx.register('ab.zapBurst', [
            { burst: 18, capacity: 18, life: [0.2, 0.45], size: [12, 24], speed: [250, 520], texture: T.glow, color: '#ffe14a' },
            { burst: 8, capacity: 8, life: [0.15, 0.3], size: [30, 60], speed: [50, 200], texture: T.sparkle, color: '#fffbd0' },
        ]);
        // --- Ad-перчатки: rainbow, neon, pixel, dragon ---
        fx.register('ab.rainbow', [
            { burst: 12, capacity: 12, life: [0.45, 0.8], size: [14, 26], speed: [180, 380], direction: [[-0.8, 0.6, -0.8], [0.8, 1.4, 0.8]], texture: T.confetti,
                blend: 'standard', color: '#ffffff', gravity: [0, -800, 0], spin: [-7, 7], sheet: { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true } },
            { burst: 4, capacity: 4, life: [0.2, 0.35], size: [34, 56], speed: [40, 140], texture: T.sparkle, color: '#ffc8f4' },
            { burst: 4, capacity: 4, life: [0.2, 0.35], size: [30, 50], speed: [40, 140], texture: T.sparkle, color: '#b8f0ff' },
        ]);
        fx.register('ab.neon', [
            { rate: 26, capacity: 20, life: [0.18, 0.35], size: [10, 22], speed: [0, 30], box: [[-30, 10, -30], [30, 160, 30]], texture: T.glow, color: '#3ff0ff' },
            { rate: 14, capacity: 12, life: [0.18, 0.35], size: [10, 20], speed: [0, 30], box: [[-30, 10, -30], [30, 160, 30]], texture: T.glow, color: '#ff4ad8' },
            { rate: 5, capacity: 5, life: [0.12, 0.22], size: [24, 40], speed: [0, 10], box: [[-30, 10, -30], [30, 160, 30]], texture: T.sparkle, color: '#e0fbff' },
        ]);
        fx.register('ab.neonBurst', [
            { burst: 14, capacity: 14, life: [0.2, 0.45], size: [12, 24], speed: [250, 520], texture: T.glow, color: '#3ff0ff' },
            { burst: 10, capacity: 10, life: [0.2, 0.45], size: [12, 22], speed: [220, 480], texture: T.glow, color: '#ff4ad8' },
            { burst: 6, capacity: 6, life: [0.15, 0.3], size: [30, 56], speed: [50, 200], texture: T.sparkle, color: '#f0fdff' },
        ]);
        fx.register('ab.pixel', [
            { burst: 16, capacity: 16, life: [0.5, 0.85], size: [16, 28], speed: [180, 400], direction: [[-1, 0.4, -1], [1, 1.3, 1]], texture: T.confetti,
                blend: 'standard', color: '#ffffff', gravity: [0, -1200, 0], sheet: { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true } },
        ]);
        fx.register('ab.dragonHit', [
            { burst: 10, capacity: 10, life: [0.3, 0.55], size: [50, 95], speed: [160, 360], direction: [[-1, 0.2, -1], [1, 0.9, 1]], texture: T.flame,
                blend: 'standard', color: '#ffffff', gravity: [0, 260, 0], sizeGradient: [[0, 0.4], [0.3, 1], [1, 0.2]], colorGradient: [[0, '#ffffff', 1], [0.5, '#ff9a5a', 0.9], [1, '#d01a0a', 0]] },
            { burst: 16, capacity: 16, life: [0.3, 0.6], size: [8, 16], speed: [300, 620], texture: T.glow, color: '#ff6a20', gravity: [0, -900, 0] },
        ]);
    },

    // --- HUD способности игрока --------------------------------------------------------------

    _buildHud() {
        const st = document.createElement('style');
        const S = IS_MOBILE ? 54 : 64;
        st.textContent = `
#ab-hud{position:fixed;left:0;top:0;z-index:8;width:${S}px;height:${S}px;pointer-events:none;display:none}
#ab-hud.ab-show{display:block}
#ab-hud .ab-bg{position:absolute;inset:0;border-radius:50%;border:3px solid #14202c;background:radial-gradient(circle at 40% 32%,#7fbcff 0%,#3f7fd8 55%,#2a5bb0 100%);
 box-shadow:0 4px 0 rgba(0,0,0,.28),inset 0 2px 0 rgba(255,255,255,.35)}
#ab-hud.ab-passive .ab-bg{background:radial-gradient(circle at 40% 32%,#9eea8f 0%,#45b54a 55%,#2b8a33 100%)}
#ab-hud.ab-on .ab-bg{background:radial-gradient(circle at 40% 32%,#ffe08a 0%,#ff8a2a 55%,#e0491a 100%);animation:ab-pulse .45s ease-in-out infinite alternate}
#ab-hud img{position:absolute;left:12%;top:10%;width:76%;height:76%;object-fit:contain;filter:drop-shadow(0 2px 1px rgba(0,0,0,.35))}
#ab-hud .ab-cd{position:absolute;inset:3px;border-radius:50%}
#ab-hud .ab-n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:900 ${IS_MOBILE ? 20 : 24}px GameFont,system-ui,sans-serif;color:#fff;
 text-shadow:-2px -2px 0 #14202c,2px -2px 0 #14202c,-2px 2px 0 #14202c,2px 2px 0 #14202c}
#ab-hud.ab-ready{animation:ab-ready .4s ease-out}
@keyframes ab-pulse{from{box-shadow:0 4px 0 rgba(0,0,0,.28),0 0 6px 2px rgba(255,140,40,.6)}to{box-shadow:0 4px 0 rgba(0,0,0,.28),0 0 16px 6px rgba(255,120,30,.85)}}
@keyframes ab-ready{0%{transform:scale(1)}45%{transform:scale(1.22)}100%{transform:scale(1)}}
`;
        document.head.appendChild(st);
        const el = this.hud = document.createElement('div');
        el.id = 'ab-hud';
        el.innerHTML = '<div class="ab-bg"></div><img alt=""><div class="ab-cd"></div><div class="ab-n"></div>';
        document.body.appendChild(el);
    },

    _hudUpdate(rdt) {
        const el = this.hud;
        if (!el) return;
        const p = Game.player;
        const g = p ? GameGloves.get(p.glove) : null;
        const dashEl = GameInput.dashEl;
        const show = !!(p && g && g.kind && Game.started && GameInput.visible && Game.pvp(Game.zone) && p.state !== 'dead' && dashEl);
        el.classList.toggle('ab-show', show);
        if (!show) { this._hudPosAt = 0; return; }
        if (g.id !== this._hudGlove) {
            this._hudGlove = g.id;
            /** @type {HTMLImageElement} */ (el.querySelector('img')).src = g.icon;
            el.classList.toggle('ab-passive', g.kind === 'passive');
            this._hudFrac = -1;
            this._hudState = '';
        }
        // Над кнопкой «Рывок» (её место меняется с размером окна) — раз в 0.3 с.
        this._hudPosAt -= rdt || 0;
        if (this._hudPosAt <= 0) {
            this._hudPosAt = 0.3;
            const r = dashEl.getBoundingClientRect();
            const S = el.offsetWidth || 64;
            if (r.width > 0) {
                el.style.left = Math.round(Math.min(VIEW.w - S - 6, r.left - VIEW.x + r.width / 2 - S / 2)) + 'px';
                el.style.top = Math.round(Math.max(6, r.top - VIEW.y - S - 12)) + 'px';
            }
        }
        const on = this.isActive(p);
        const left = this.cooldownLeft(p);
        const state = g.kind === 'passive' ? 'p' : on ? 'on' : left > 0 ? 'cd' : 'ready';
        if (state !== this._hudState) {
            if (state === 'ready' && this._hudState === 'cd') { el.classList.remove('ab-ready'); void el.offsetWidth; el.classList.add('ab-ready'); }
            this._hudState = state;
            el.classList.toggle('ab-on', state === 'on');
        }
        const cd = /** @type {HTMLElement} */ (el.querySelector('.ab-cd')), n = el.querySelector('.ab-n');
        const frac = state === 'cd' ? Math.min(1, left / Math.max(0.1, g.cd || 1)) : 0;
        if (Math.abs(frac - this._hudFrac) > 0.004 || (frac === 0 && this._hudFrac !== 0)) {
            this._hudFrac = frac;
            cd.style.background = frac > 0 ? 'conic-gradient(rgba(8,16,34,.66) 0turn ' + frac.toFixed(3) + 'turn, rgba(0,0,0,0) ' + frac.toFixed(3) + 'turn 1turn)' : 'none';
        }
        const txt = state === 'cd' ? String(Math.ceil(left)) : '';
        if (n.textContent !== txt) n.textContent = txt;
    },
};
