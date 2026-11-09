// GameFX.js — эффекты «Ауры Шлепка» (DESIGN.md §5, §9): частицы по событиям игры, звуки
// событий (громкость ботов — по расстоянию до камеры), тряска камеры и короткий hit-stop,
// свечение деталей перчаток (узлы Glow — рецепт tools/blender/gloves/README.md), качество
// графики (high | low) и автопонижение на слабом устройстве.
//
// API:
//   GameFX.play(name, pos, opts) -> { handles, stop(), dispose(), setPosition(pos) } | null
//     name — рецепт (RECIPES ниже): 'slapHit', 'dashTrail', 'landDust', 'auraGain', 'koPoof',
//       'confetti', 'portalSwirl', 'sparkle', 'spawnPoof', 'portalArrive', 'gloveEquip',
//       'explosion', 'hearts', 'iceBurst', 'flame', 'smoke', 'stars', 'glowBurst'.
//     pos — Character (точка над ногами на opts.height, по умолчанию 100 px), точка карты
//       { x, y, h } (или { x, y } — на высоте opts.height || 0), BABYLON.Vector3 / [x, y, z] /
//       { x, y, z } — координаты Babylon (y — высота).
//     opts — общие: follow (Character | mesh | () => Vector3 — эмиттер следует), height,
//       scale (размер), count (множитель количества), color ('#rrggbb' — оттенок, где уместно),
//       duration (с — для непрерывных: flame, dashTrail), force (не отсекать по расстоянию);
//       свои у рецептов: slapHit { dir: {x, y}, power, glove }, landDust { power }, koPoof
//       { small }, portalSwirl { plane } (GameWorld.portalPlanes()), sparkle { points, rate }.
//     Эффект дальше FX_CULL_DIST от камеры не создаётся (null). Непрерывный эффект без
//     duration останавливает владелец: handle.stop().
//   GameFX.sfx(url, volume, opts) — звук с ограничением повторов ({ key, max, window, detune, rate }).
//   GameFX.volumeAt(pos, char?) — громкость события: игрок — 1, остальные 0.6…0.3 по расстоянию.
//   GameFX.lightGlove(root, id) — свечение перчатки (emissive узла Glow + ореол GlowLayer).
//   GameFX.quality ('high' | 'low'), GameFX.setQuality(q) — синхронно с GameWorld.setQuality.
//   GameFX.stats() — fps, draw calls, меши, частицы (отладка; Game.debug.fxStats()).
//   Game.debug: fx(name, opts) — эффект у игрока, quality('high'|'low'), fxStats().
//
// Частицы — свой менеджер (наследник ParticleFX): время эффектов — игровое (slow-mo Фонк
// Момента и hit-stop замедляют и частицы), слой рендера 1 (поверх прозрачных плоскостей
// порталов, с глубиной мира), плотность на low — FX_LOW_SCALE.

// --- Числа модуля ---
const FX_CULL_DIST = 4500;        // px от камеры: дальше эффекты не создаются
const FX_FAR_DIST = 2200;         // px: дальше — упрощённый эффект шлепка (вспышка и кольцо)
const FX_SND_NEAR = 600;          // px: до этого расстояния звук бота — FX_SND_VOL_NEAR
const FX_SND_FAR = 3600;          // px: дальше звуки ботов не играют
const FX_SND_VOL_NEAR = 0.6;      // громкость события бота вблизи
const FX_SND_VOL_FAR = 0.3;       // громкость события бота вдали
const FX_HEAVY_POWER = 880;       // сила шлепка: тяжёлый звук и большая вспышка
const FX_SLAP_HEAVY_CHANCE = 0.12; // доля обычных шлепков со звуком slap_4 (разнообразие)
const FX_SHAKE_SLAP = 0.2;        // тряска: игрок шлёпнул
const FX_SHAKE_HIT = 0.5;         // тряска: игрока шлёпнули
const FX_SHAKE_NEAR = 0.14;       // тряска: шлепок рядом (сила у самого игрока)
const FX_SHAKE_RADIUS = 700;      // px: шлепки ботов ближе — лёгкая тряска
const FX_HITSTOP = 0.035;         // с: заморозка удара игрока
const FX_HITSTOP_HEAVY = 0.06;    // с: заморозка тяжёлого удара / удара по игроку
const FX_LAND_DUST = 300;         // px/с: приземление быстрее — пыль
const FX_LAND_THUD = 650;         // px/с: приземление быстрее — звук удара о землю
const FX_LOW_SCALE = 0.6;         // плотность частиц на low
const FX_PORTAL_RATE = 36;        // частиц/с: завихрение портала
const FX_RING_RATE = 4;           // частиц/с: искры колец пьедесталов (на все кольца)
const FX_AUTO_LOW_FPS = 30;       // средний fps ниже — один раз переключить на low
const FX_AUTO_LOW_TIME = 6;       // с: окно замера fps (после 2 с разогрева)

// Текстуры частиц (литералы — для сборщика).
const FX_TEX = {
    star: 'assets/textures/fx/star.png',
    sparkle: 'assets/textures/fx/sparkle.png',
    glow: 'assets/textures/fx/glow_dot.png',
    ring: 'assets/textures/fx/ring_shockwave.png',
    line: 'assets/textures/fx/speed_line.png',
    flash: 'assets/textures/fx/impact_flash.png',
    burst: 'assets/textures/fx/impact_burst.png',
    heart: 'assets/textures/fx/heart.png',
    ice: 'assets/textures/fx/ice_shard.png',
    flame: 'assets/textures/fx/flame.png',
    confetti: 'assets/textures/fx/confetti_sheet.png',
    smoke: 'assets/textures/fx/smoke_puff.png',
    dust: 'assets/textures/fx/dust.png',
};
const FX_CONFETTI_SHEET = { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true };

// Звуки событий (assets/sounds/SOUNDS.md — громкость выровнена в файлах).
const FX_SND = {
    slap: ['assets/sounds/slap_1.mp3', 'assets/sounds/slap_2.mp3', 'assets/sounds/slap_3.mp3'],
    slapHeavy: 'assets/sounds/slap_4.mp3',
    swing: ['assets/sounds/swing_1.mp3', 'assets/sounds/swing_2.mp3'],
    dash: 'assets/sounds/dash.mp3',
    land: 'assets/sounds/land_thud.mp3',
    ko: 'assets/sounds/ko_fall.mp3',
    aura: 'assets/sounds/aura_gain.mp3',
    portal: 'assets/sounds/portal.mp3',
    whoosh: 'assets/sounds/whoosh_big.mp3',
};

// Ореол GlowLayer узла Glow перчатки (README перчаток; нет записи — без ореола) и слабое
// свечение всей перчатки («светящийся» призрак).
const FX_GLOVE_GLOW = { default: 0x1fb8c8, slime: 0x8ad028, love: 0xb83a7c, ice: 0x2ab8e0, fire: 0xff6a1a, bomb: 0xffb030, meteor: 0xe0560c, tile: 0x1aa8c0, brainrot: 0xc8307e, ghost: 0x4a8098, gravity: 0x8a5cff, speed: 0x8ad028, blackhole: 0xb83ec8, giant: 0x7ab020, golden: 0xd8b040, diamond: 0xa8d8f0, rainbow: 0x8070c0, neon: 0x8a4ae0, pixel: 0xd8a820, dragon: 0xe86010 };
const FX_GLOVE_SELF = { ghost: 0.3 };

Object.assign(LANG_STRINGS.ru, { fxAutoLow: 'Графика понижена для плавности — вернуть можно в настройках' });
Object.assign(LANG_STRINGS.en, { fxAutoLow: 'Graphics lowered for smoother play — change it in settings' });

// Менеджер частиц игры: игровое время (slow-mo), свой бюджет систем, плотность по качеству.
class GameFXParticles extends ParticleFX {
    constructor(scene) {
        super(scene);
        this.density = 1;   // множитель плотности/бюджета (качество графики)
        this.timeK = 1;     // скорость времени частиц (игровое / реальное)
    }
    // Плотность — только по качеству графики (мобильные по умолчанию и так на low; движковый
    // FX_MOBILE_SCALE поверх него оставлял от шлепка две-три искры).
    cfg() {
        const c = super.cfg();
        return { systems: Math.max(64, c.systems), particles: c.particles, quality: this.density || 1 };
    }
    syncPause() {
        const k = this.timeK == null ? 1 : this.timeK;
        for (const e of this.effects) e.system.updateSpeed = Pause.active ? 0 : e.speed * k;
    }
}

/** @satisfies {Record<string, any>} */
const GameFX = {
    quality: 'high',
    /** @type {GameFXParticles | null} */
    ps: null,
    /** @type {BABYLON.Scene | null} */
    scene: null,
    /** @type {Array<{ stop: Function, dispose: Function }>} */
    _ambient: [],
    _ambientOn: false,
    _ambientQ: '',
    /** @type {Record<string, number[]>} */
    _lim: {},
    /** @type {Record<string, boolean>} */
    _warned: {},
    _portalSndAt: -99,
    _wasTransit: false,
    /** @type {BABYLON.SceneInstrumentation | null} */
    _inst: null,
    _debugUrl: false,
    _weakGpu: false,
    _autoDone: false,
    _autoT: 0,
    _autoN: 0,
    _autoSum: 0,

    init(game) {
        void game;
        this.scene = GameWorld.scene;
        this.ps = new GameFXParticles(this.scene);
        const s = Game.save && Game.save.settings;
        this.quality = s && s.quality === 'low' ? 'low' : 'high';
        this._applyDensity();
        this._debugUrl = new URLSearchParams(window.location.search).has('debug');
        try {
            const info = World3D.engine.getGlInfo();
            this._weakGpu = /swiftshader|llvmpipe|software|basic render/i.test(String(info && info.renderer));
        } catch (e) { /* нет данных о GPU */ }
        // Звуки событий декодируются заранее (до жеста — OfflineAudioContext): первый шлепок без задержки.
        Sound.preload(FX_SND.slap.concat(FX_SND.swing, [FX_SND.slapHeavy, FX_SND.dash, FX_SND.land, FX_SND.ko, FX_SND.aura, FX_SND.portal]));
        Game.on('swing', (e) => this._onSwing(e));
        Game.on('slap', (e) => this._onSlap(e));
        Game.on('aura', (e) => this._onAura(e));
        Game.on('ko', (e) => this._onKO(e));
        Game.on('respawn', (e) => this._onRespawn(e));
        Game.on('dash', (e) => this._onDash(e));
        Game.on('land', (e) => this._onLand(e));
        Game.on('zone', (e) => this._onZoneEvent(e));
        Game.on('glove', (e) => this._onGlove(e));
        Game.on('spawn', (e) => this._onSpawn(e));
        Game.on('despawn', (e) => this._onDespawn(e));
        Game.on('settings', (s2) => { if (s2 && s2.quality && s2.quality !== this.quality) this.setQuality(s2.quality); });
    },

    ready() {
        this._syncAmbient();
        const D = Game.debug;
        if (D) {
            // Счётчики draw calls — с первого кадра (созданные в момент замера врут).
            if (!this._inst && this.scene) this._inst = new BABYLON.SceneInstrumentation(this.scene);
            D.fx = (name, opts) => !!GameFX.play(name || 'slapHit', Game.player, Object.assign({ force: true }, opts || {}));
            D.quality = (q) => {
                Game.save.settings.quality = q === 'low' ? 'low' : 'high';
                Game.applySettings();
                return GameFX.quality;
            };
            D.fxStats = () => JSON.stringify(GameFX.stats());
        }
    },

    onZone() { this._syncAmbient(); },

    update(dt, realDt) {
        if (!this.ps) return;
        const rdt = realDt == null ? dt : realDt;
        this.ps.timeK = rdt > 0 ? Math.max(0, Math.min(2, dt / rdt)) : 1;
        this.ps.update(dt);
        // Вход в портал: звук нарастает ~0.3 с — пик совпадает со вспышкой телепорта.
        if (Game.transitioning && !this._wasTransit) this._portalSound();
        this._wasTransit = Game.transitioning;
        for (const c of Game.chars) {
            if (c.disposed) continue;
            this._lightCharGlove(c);
            this._watchFall(c);
        }
        this._autoQuality(rdt);
    },

    // --- Качество -----------------------------------------------------------------------

    setQuality(q) {
        this.quality = q === 'low' ? 'low' : 'high';
        this._applyDensity();
        if (this._ambientOn) this._syncAmbient();
        if (typeof GameWorld !== 'undefined' && GameWorld.quality !== this.quality) GameWorld.setQuality(this.quality);
    },

    _applyDensity() { if (this.ps) this.ps.density = this.quality === 'low' ? FX_LOW_SCALE : 1; },

    _autoKey() { return (typeof GAME_ID !== 'undefined' ? GAME_ID : 'game') + '.fxAutoLow'; },

    // Слабое устройство: средний fps первых секунд игры ниже FX_AUTO_LOW_FPS (или программный
    // рендер) — один раз переключить на low (флаг в Store: выбор игрока потом не трогаем).
    // В ?debug не работает (скриншоты агентов в headless).
    _autoQuality(rdt) {
        if (this._autoDone) return;
        if (this._debugUrl || this.quality === 'low' || (Platform.name !== 'playables' && Store.get(this._autoKey()) === '1')) { this._autoDone = true; return; }
        if (!Game.started || Game.transitioning || Pause.active || !rdt) return;
        this._autoT += rdt;
        if (this._autoT < 2) return;
        this._autoN++;
        this._autoSum += rdt;
        if (!this._weakGpu && this._autoT < 2 + FX_AUTO_LOW_TIME) return;
        this._autoDone = true;
        const fps = this._autoSum > 0 ? this._autoN / this._autoSum : 60;
        if (!this._weakGpu && fps >= FX_AUTO_LOW_FPS) return;
        if (Platform.name !== 'playables') Store.set(this._autoKey(), '1');   // Playables: прогресс только в облаке (качество — в Game.save)
        Game.save.settings.quality = 'low';
        Game.applySettings();
        Game.saveSoon();
        if (typeof GameUI !== 'undefined' && typeof GameUI.toast === 'function') GameUI.toast(Lang.t('fxAutoLow'), 3.5);
    },

    // Отладка: кадр, draw calls, меши, частицы.
    stats() {
        const s = this.scene;
        if (!s) return null;
        if (!this._inst) this._inst = new BABYLON.SceneInstrumentation(s);
        const eng = s.getEngine();
        let parts = 0;
        for (const p of s.particleSystems) parts += p.getActiveCount ? p.getActiveCount() : 0;
        return {
            quality: this.quality, fps: Math.round(Game.fps), engineFps: Math.round(eng.getFps()),
            drawCalls: this._inst.drawCallsCounter.current, activeMeshes: s.getActiveMeshes().length, meshes: s.meshes.length,
            materials: s.materials.length, textures: s.textures.length, particleSystems: s.particleSystems.length, particles: parts,
            glow: !!(GameWorld.glow && GameWorld.glow.isEnabled), render: eng.getRenderWidth() + 'x' + eng.getRenderHeight(),
            chars: Game.chars.length,
        };
    },

    // --- Звук -----------------------------------------------------------------------------

    // Звук с ограничением: не больше opts.max одинаковых (opts.key) за opts.window с.
    sfx(url, volume, opts) {
        const o = opts || {};
        if (!url || !(volume > 0.01)) return null;
        const key = o.key || url, now = Game.realTime, win = o.window || 0.12;
        const l = this._lim[key] || (this._lim[key] = []);
        while (l.length && now - l[0] > win) l.shift();
        if (l.length >= (o.max || 3)) return null;
        l.push(now);
        return Sound.play(url, { volume: Math.min(1, volume), detune: o.detune || 0, rate: o.rate });
    },

    // Громкость события в точке pos (позиция play) от персонажа ch: игрок — 1; другие —
    // FX_SND_VOL_NEAR…FX_SND_VOL_FAR по расстоянию до камеры, другая зона / далеко — 0.
    volumeAt(pos, ch) {
        if (ch && ch.isPlayer) return 1;
        if (ch && Game.player && ch.zone !== Game.player.zone) return 0;
        const at = pos ? this._at(pos, {}) : null;
        if (!at) return 0;
        const d = this._camDist(at);
        if (d > FX_SND_FAR) return 0;
        const k = Math.max(0, Math.min(1, (d - FX_SND_NEAR) / (FX_SND_FAR - FX_SND_NEAR)));
        return FX_SND_VOL_NEAR + (FX_SND_VOL_FAR - FX_SND_VOL_NEAR) * k;
    },

    _pick(list) { return list[Math.floor(Math.random() * list.length)]; },

    _portalSound() {
        if (Game.realTime - this._portalSndAt < 1.2) return;
        this._portalSndAt = Game.realTime;
        this.sfx(FX_SND.portal, 1, { key: 'portal', max: 1, window: 1 });
    },

    // --- События -------------------------------------------------------------------------

    _onSwing(e) {
        const c = e.char;
        if (!c || c.hidden) return;
        const v = this.volumeAt(c, c) * (c.isPlayer ? 0.85 : 0.75);
        this.sfx(this._pick(FX_SND.swing), v, { key: 'swing', max: 3, detune: 0.12 });
    },

    _onSlap(e) {
        const a = e.attacker, v = e.victim;
        if (!v) return;
        const dir = e.dir || { x: 0, y: 0 };
        const power = e.power || 600;
        const heavy = power >= FX_HEAVY_POWER;
        const mine = a === Game.player || v === Game.player;
        // Точка контакта: перед жертвой со стороны удара, на уровне груди.
        const at = new BABYLON.Vector3(v.x - dir.x * 35, v.h + 128, v.y - dir.y * 35);
        this.play('slapHit', at, { dir, power, glove: e.glove, force: mine });
        const vol = mine ? 1 : this.volumeAt(at, a || v);
        // Обычный — slap_1..3 (изредка тяжёлый slap_4 для разнообразия), сильная перчатка — slap_4.
        const snd = heavy || Math.random() < FX_SLAP_HEAVY_CHANCE ? FX_SND.slapHeavy : this._pick(FX_SND.slap);
        this.sfx(snd, vol, { key: 'slap', max: 4, window: 0.1, detune: 0.07 });
        if (mine && power >= 1000) this.sfx(FX_SND.whoosh, 0.45, { key: 'whoosh', max: 1, window: 0.4 });
        const cam = typeof GameCamera !== 'undefined' ? GameCamera : null;
        const p = Game.player;
        if (v === p) {
            if (cam) cam.shake(FX_SHAKE_HIT, 0.3);
            Game.hitStop(FX_HITSTOP_HEAVY);
        } else if (a === p) {
            if (cam) cam.shake(heavy ? FX_SHAKE_SLAP * 1.5 : FX_SHAKE_SLAP, heavy ? 0.22 : 0.16);
            Game.hitStop(heavy ? FX_HITSTOP_HEAVY : FX_HITSTOP);
        } else if (p && cam && v.zone === p.zone) {
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            if (d < FX_SHAKE_RADIUS) cam.shake(FX_SHAKE_NEAR * (1 - d / FX_SHAKE_RADIUS), 0.14);
        }
    },

    _onAura(e) {
        const c = e.char;
        if (!c || c !== Game.player || !(e.delta > 0)) return;
        // Крупные начисления (магазин, награды) озвучивает их модуль — здесь только «+1…+8» за удары.
        if (e.delta <= 8) this.sfx(FX_SND.aura, 1, { key: 'aura', max: 2, window: 0.1 });
        this.play('auraGain', c, { force: true, height: 110 });
    },

    _onKO(e) {
        const v = e.victim;
        if (!v) return;
        const f = this._fx(v);
        if (!f.fell) { f.fell = true; this.sfx(FX_SND.ko, this.volumeAt(v, v) * (v.isPlayer ? 1 : 0.85), { key: 'ko', max: 2, window: 0.3 }); }
        this.play('koPoof', { x: v.x, y: v.y, h: v.h + 100 });
    },

    // Начало падения в бездну (ниже края острова, вниз) — свист падения сразу, а не в момент KO.
    _watchFall(c) {
        const f = this._fx(c);
        if (f.fell) {
            if (c.onGround && c.h > -50) f.fell = false;
            return;
        }
        if (c.state === 'dead' || c.onGround || c.h > -260 || c.vh > -150) return;
        f.fell = true;
        this.sfx(FX_SND.ko, this.volumeAt(c, c) * (c.isPlayer ? 1 : 0.85), { key: 'ko', max: 2, window: 0.3 });
    },

    _onRespawn(e) {
        const c = e.char;
        if (!c) return;
        this._fx(c).fell = false;
        if (c.hidden || !this._limit('spawnfx', 4, 0.5)) return;
        this.play('spawnPoof', { x: c.x, y: c.y, h: c.h + 6 }, { force: c.isPlayer });
    },

    _onDash(e) {
        const c = e.char;
        if (!c || c.hidden) return;
        this.sfx(FX_SND.dash, this.volumeAt(c, c) * (c.isPlayer ? 0.9 : 0.8), { key: 'dash', max: 2, detune: 0.08 });
        this.play('dashTrail', c, { follow: c, dir: { x: c.dashX, y: c.dashY }, force: c.isPlayer });
        if (c.onGround) this.play('landDust', { x: c.x, y: c.y, h: c.h + 4 }, { power: 380, force: c.isPlayer });
    },

    _onLand(e) {
        const c = e.char, sp = e.speed || 0;
        if (!c || c.hidden) return;
        if (sp > FX_LAND_DUST) this.play('landDust', { x: c.x, y: c.y, h: c.h + 4 }, { power: sp });
        if (sp > FX_LAND_THUD) {
            const k = Math.max(0.5, Math.min(1, sp / 1300));
            this.sfx(FX_SND.land, this.volumeAt(c, c) * (c.isPlayer ? Math.max(0.7, k) : k), { key: 'land', max: 3, window: 0.15, detune: 0.06 });
            if (c.isPlayer && sp > 900 && typeof GameCamera !== 'undefined') GameCamera.shake(0.22, 0.18);
        }
    },

    _onZoneEvent(e) {
        if (!e.char || e.char !== Game.player) return;
        this._portalSound();
        this.play('portalArrive', { x: e.char.x, y: e.char.y, h: e.char.h + 6 }, { force: true });
        this._syncAmbient();
    },

    _onGlove(e) {
        const c = e.char;
        if (!c || c !== Game.player) return;
        this.play('gloveEquip', c, { follow: c, height: 120, force: true });
    },

    _onSpawn(e) {
        const c = e.char;
        if (!c || !c.isBot || !Game.started || c.hidden || !this._limit('spawnfx', 4, 0.5)) return;
        this.play('spawnPoof', { x: c.x, y: c.y, h: c.h + 6 });
    },

    // Бот «вышел из игры» стоя на острове — облачко.
    _onDespawn(e) {
        const c = e.char;
        if (!c || !c.isBot || c.state === 'dead' || c.hidden || c.h < -200 || !this._limit('spawnfx', 4, 0.5)) return;
        this.play('koPoof', { x: c.x, y: c.y, h: c.h + 100 }, { small: true });
    },

    // Не больше max срабатываний ключа за window с (без звука — для частиц).
    _limit(key, max, win) {
        const now = Game.realTime, l = this._lim[key] || (this._lim[key] = []);
        while (l.length && now - l[0] > win) l.shift();
        if (l.length >= max) return false;
        l.push(now);
        return true;
    },

    // Своё место в char.data (модули делят data — ключ fx).
    _fx(c) { return c.data.fx || (c.data.fx = { fell: false, glove: null }); },

    // --- Перчатки: свечение -----------------------------------------------------------------

    // Перчатку в руке светит сам Character (Character.lightGlove при setGlove) — здесь только
    // запасной путь для сборки без него.
    _lightCharGlove(c) {
        const r = c._gloveRoot;
        if (!r || typeof /** @type {any} */ (Character).lightGlove === 'function') return;
        const f = this._fx(c);
        if (f.glove === r) return;
        f.glove = r;
        this.lightGlove(r, c.glove);
    },

    // Узел Glow — emissive белый всегда (цвет детали — в вершинах/текстуре), ореол GlowLayer
    // цветом из FX_GLOVE_GLOW; прозрачные материалы — с depth pre-pass (README перчаток).
    lightGlove(root, id) {
        if (!root || root.isDisposed()) return;
        for (const m of root.getChildMeshes(false)) {
            const part = m.metadata && m.metadata.part;
            const mat = m.material;
            const mats = mat ? (/** @type {any} */ (mat).subMaterials || [mat]) : [];
            if (part === 'Glow') {
                for (const sm of mats) if (sm && 'emissiveColor' in sm) sm.emissiveColor = new BABYLON.Color3(1, 1, 1);
                if (FX_GLOVE_GLOW[id] != null && !GameWorld._glowColors.has(m)) GameWorld.addGlow(m, FX_GLOVE_GLOW[id]);
            } else if (part === 'Glove' && FX_GLOVE_SELF[id]) {
                const k = FX_GLOVE_SELF[id];
                for (const sm of mats) if (sm && 'emissiveColor' in sm) sm.emissiveColor = new BABYLON.Color3(k, k, k);
            }
            for (const sm of mats) if (sm && sm.alpha < 1) sm.needDepthPrePass = true;
        }
    },

    // --- Фоновые эффекты лобби: завихрения порталов, искры колец ------------------------------

    _syncAmbient() {
        const want = !!this.ps && Game.zone === 'lobby';
        if (want === this._ambientOn && (!want || this._ambientQ === this.quality)) return;
        this._stopAmbient();
        if (!want) return;
        this._ambientOn = true;
        this._ambientQ = this.quality;
        for (const P of GameWorld.portalPlanes()) {
            const g = this.play('portalSwirl', P.center, { plane: P, force: true });
            if (g) this._ambient.push(g);
        }
        const rings = GameWorld.findParts('pedestal', 'Ring').map(({ mesh }) => {
            mesh.computeWorldMatrix(true);
            const bb = mesh.getBoundingInfo().boundingBox;
            return { c: bb.centerWorld.clone(), r: Math.max(20, Math.max(bb.extendSizeWorld.x, bb.extendSizeWorld.z) * 0.9) };
        });
        if (rings.length) {
            const g = this.play('sparkle', rings[0].c, { points: rings, rate: FX_RING_RATE, force: true });
            if (g) this._ambient.push(g);
        }
    },

    _stopAmbient() {
        for (const g of this._ambient) g.dispose();
        this._ambient = [];
        this._ambientOn = false;
    },

    // --- Частицы ---------------------------------------------------------------------------

    // Эффект по рецепту (см. шапку). null — нет рецепта, далеко от камеры или бюджет исчерпан.
    play(name, pos, opts) {
        const o = opts || {};
        const recipe = this.RECIPES[name];
        if (!recipe || !this.ps) {
            if (!this._warned[name]) { this._warned[name] = true; console.warn('GameFX: нет эффекта ' + name); }
            return null;
        }
        const at = this._at(pos, o);
        if (!at) return null;
        const d = this._camDist(at);
        if (!o.force && d > FX_CULL_DIST) return null;
        const layers = recipe(o, at, d > FX_FAR_DIST) || [];
        const follow = this._followOf(o);
        /** @type {any[]} */
        const handles = [];
        for (const L of layers) {
            if (!L) continue;
            const opt = Object.assign({}, L, { position: L.position || at });
            delete opt.follow;
            if (follow && !L.still) opt.follow = follow;
            if (o.count && opt.burst) opt.burst = Math.max(1, Math.round(opt.burst * o.count));
            const h = this.ps.create(opt);
            if (!h) continue;
            this._post(h.system, L);
            handles.push(h);
        }
        if (!handles.length) return null;
        return {
            handles,
            stop: () => handles.forEach(h => h.stop()),
            dispose: () => handles.forEach(h => h.dispose()),
            setPosition: (p) => { const v = this._at(p, o); if (v) handles.forEach(h => h.setPosition(v)); },
        };
    },

    // Настройки системы сверх ParticleFX: слой рендера, вытянутые частицы, поворот, свои функции позиции/направления.
    _post(sys, L) {
        sys.renderingGroupId = 1;
        if (L.stretch) {
            sys.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_STRETCHED;
            sys.minScaleX = sys.maxScaleX = L.stretch;
        }
        if (L.rot) { sys.minInitialRotation = 0; sys.maxInitialRotation = Math.PI * 2; }
        if (L.posFn) sys.startPositionFunction = L.posFn;
        if (L.dirFn) sys.startDirectionFunction = L.dirFn;
    },

    // pos -> BABYLON.Vector3 (см. шапку).
    _at(pos, o) {
        const V = BABYLON.Vector3;
        if (!pos) return null;
        if (pos instanceof V) return pos.clone();
        if (Array.isArray(pos)) return new V(+pos[0] || 0, +pos[1] || 0, +pos[2] || 0);
        if (pos instanceof Character) return new V(pos.x, pos.h + (o && o.height != null ? o.height : 100), pos.y);
        if (pos.h != null) return new V(+pos.x || 0, +pos.h || 0, +pos.y || 0);
        if (pos.z != null) return new V(+pos.x || 0, +pos.y || 0, +pos.z || 0);
        return new V(+pos.x || 0, (o && o.height) || 0, +pos.y || 0);
    },

    _followOf(o) {
        const f = o.follow;
        if (!f) return null;
        if (typeof f === 'function') return f;
        if (f instanceof Character) {
            const hh = o.height != null ? o.height : 100;
            return () => (f.disposed ? null : new BABYLON.Vector3(f.x, f.h + hh, f.y));
        }
        return f;
    },

    _cam() { return GameWorld.view && GameWorld.view.camera ? GameWorld.view.camera.position : null; },

    _camDist(at) {
        const c = this._cam();
        if (!c) return 0;
        return Math.hypot(at.x - c.x, (at.y - c.y) * 0.5, at.z - c.z);
    },

    // Точка ближе к камере на dist px (вспышка удара — перед телом жертвы под любым углом).
    _toCam(at, dist) {
        const c = this._cam();
        if (!c) return at.clone();
        const v = c.subtract(at);
        const l = v.length();
        return l > 1 ? at.add(v.scaleInPlace(Math.min(dist, l * 0.5) / l)) : at.clone();
    },

    // Частицы «по перчатке» в шлепке (характер перчатки).
    _gloveExtra(id, d, k) {
        const spray = [[d.x * 0.6 - 0.6, 0.2, d.y * 0.6 - 0.6], [d.x * 0.6 + 0.6, 1, d.y * 0.6 + 0.6]];
        const fade = (c1, c2) => [[0, c1, 1], [0.6, c2, 0.9], [1, c2, 0]];
        switch (id) {
            case 'love': return { name: 'fxHearts', texture: FX_TEX.heart, blend: 'standard', burst: 4, capacity: 5, life: [0.6, 0.9], size: [26 * k, 40 * k],
                speed: [80, 180], direction: spray, gravity: [0, 90, 0], colorGradient: fade('#ffffff', '#ffffff') };
            case 'ice': return { name: 'fxIce', texture: FX_TEX.ice, blend: 'standard', burst: 7, capacity: 8, life: [0.4, 0.7], size: [18 * k, 30 * k],
                speed: [220, 420], direction: spray, gravity: [0, -1100, 0], spin: [-8, 8], rot: true, colorGradient: fade('#ffffff', '#ffffff') };
            case 'fire': case 'meteor': return { name: 'fxFlame', texture: FX_TEX.flame, blend: 'standard', burst: 6, capacity: 7, life: [0.3, 0.5],
                size: [40 * k, 68 * k], speed: [80, 220], direction: spray, gravity: [0, 160, 0], sizeGradient: [[0, 0.7], [1, 0.25]], colorGradient: fade('#ffffff', '#ffffff') };
            case 'slime': return { name: 'fxSlime', texture: FX_TEX.glow, burst: 10, capacity: 11, life: [0.4, 0.7], size: [12 * k, 24 * k],
                speed: [200, 380], direction: spray, gravity: [0, -1300, 0], colorGradient: fade('#b4ff6a', '#4cff3a') };
            case 'golden': return { name: 'fxGold', texture: FX_TEX.sparkle, burst: 8, capacity: 9, life: [0.4, 0.7], size: [18 * k, 32 * k],
                speed: [160, 320], direction: spray, gravity: [0, -300, 0], rot: true, spin: [-4, 4], colorGradient: fade('#fff6c0', '#ffc23a') };
            case 'diamond': return { name: 'fxDiamond', texture: FX_TEX.sparkle, burst: 11, capacity: 12, life: [0.45, 0.8], size: [18 * k, 34 * k],
                speed: [180, 360], direction: spray, gravity: [0, -250, 0], rot: true, spin: [-5, 5], colorGradient: fade('#ffffff', '#9ee8ff') };
            case 'blackhole': case 'gravity': return { name: 'fxVoid', texture: FX_TEX.glow, burst: 9, capacity: 10, life: [0.35, 0.6], size: [16 * k, 30 * k],
                speed: [160, 320], direction: [[-1, -0.3, -1], [1, 1, 1]], gravity: [0, id === 'gravity' ? 600 : 0, 0], colorGradient: fade('#e3b8ff', '#8a4dff') };
            case 'ghost': return { name: 'fxGhost', texture: FX_TEX.smoke, blend: 'standard', burst: 3, capacity: 3, life: [0.5, 0.8], size: [60 * k, 90 * k],
                speed: [40, 90], direction: spray, gravity: [0, 60, 0], rot: true, colorGradient: [[0, '#ffffff', 0.55], [1, '#e6f2ff', 0]] };
            case 'brainrot': return { name: 'fxMeme', texture: FX_TEX.confetti, blend: 'standard', sheet: FX_CONFETTI_SHEET, burst: 10, capacity: 11,
                life: [0.6, 1], size: [16, 24], speed: [200, 380], direction: spray, gravity: [0, -900, 0], spin: [-8, 8], rot: true, colorGradient: fade('#ffffff', '#ffffff') };
            case 'speed': return { name: 'fxBolt', texture: FX_TEX.line, burst: 6, capacity: 6, life: [0.14, 0.2], size: [80 * k, 120 * k],
                speed: [700, 1000], direction: [[-1, -0.4, -1], [1, 0.6, 1]], stretch: 0.25, colorGradient: [[0, '#fff6a0', 1], [1, '#ffd21a', 0]] };
            case 'bomb': return { name: 'fxSpark', texture: FX_TEX.glow, burst: 8, capacity: 9, life: [0.25, 0.45], size: [12 * k, 22 * k],
                speed: [260, 480], direction: spray, gravity: [0, -900, 0], colorGradient: fade('#fff0a0', '#ff7a14') };
            case 'giant': return { name: 'fxGiant', texture: FX_TEX.dust, blend: 'standard', burst: 6, capacity: 6, life: [0.4, 0.7], size: [50 * k, 80 * k],
                speed: [120, 240], direction: spray, gravity: [0, 40, 0], rot: true, colorGradient: [[0, '#ffffff', 0.8], [1, '#ffffff', 0]] };
            default: return null;
        }
    },

    // Рецепты: (opts, at: Vector3 Babylon, far: дальше FX_FAR_DIST) -> слои ParticleFX.create
    // + свои поля: stretch (ширина вытянутой частицы), rot (случайный поворот), posFn/dirFn
    // (своя стартовая позиция/направление), still (не следовать за opts.follow).
    /** @type {Record<string, (o: any, at: BABYLON.Vector3, far: boolean) => any[]>} */
    RECIPES: {
        // Шлепок: комикс-вспышка (как на t_30), ударное кольцо, звёзды-искры, линии удара; тяжёлый — взрыв-клякса.
        slapHit(o, at, far) {
            const k = Math.max(0.85, Math.min(1.5, (o.power || 650) / 700)) * (o.scale || 1);
            const d = o.dir || { x: 0, y: 0 };
            const heavy = (o.power || 0) >= FX_HEAVY_POWER;
            const front = GameFX._toCam(at, 60);
            const L = [
                { name: 'fxFlash', texture: FX_TEX.flash, blend: 'standard', position: front, still: true, burst: 1, capacity: 1, life: [0.18, 0.2], size: [118 * k, 128 * k],
                    speed: [0, 0], sizeGradient: [[0, 0.35], [0.16, 1.08], [1, 1.22]], colorGradient: [[0, '#ffffff', 1], [0.55, '#ffffff', 1], [1, '#ffffff', 0]], rot: true },
                { name: 'fxRing', texture: FX_TEX.ring, position: front, still: true, burst: 1, capacity: 1, life: [0.28, 0.3], size: [150 * k, 150 * k], speed: [0, 0],
                    sizeGradient: [[0, 0.25], [1, 1.75]], colorGradient: [[0, '#ffffff', 0.85], [0.6, '#fff6d8', 0.45], [1, '#fff1c4', 0]] },
            ];
            if (far) return L;
            L.push({ name: 'fxStars', texture: FX_TEX.star, burst: heavy ? 10 : 7, capacity: 12, life: [0.35, 0.6], size: [15 * k, 28 * k], speed: [300, 560],
                direction: [[d.x * 0.7 - 0.7, 0.15, d.y * 0.7 - 0.7], [d.x * 0.7 + 0.7, 1, d.y * 0.7 + 0.7]], gravity: [0, -1000, 0], spin: [-9, 9], rot: true,
                colorGradient: [[0, '#ffffff', 1], [0.45, '#fff2a8', 0.95], [1, '#ffcf5a', 0]] });
            L.push({ name: 'fxLines', texture: FX_TEX.line, position: front, burst: 7, capacity: 8, life: [0.13, 0.19], size: [70 * k, 110 * k], speed: [700, 1000],
                direction: [[-1, -0.6, -1], [1, 0.8, 1]], stretch: 0.25, colorGradient: [[0, '#ffffff', 0.9], [1, '#ffffff', 0]] });
            if (heavy) {
                L.push({ name: 'fxBurst', texture: FX_TEX.burst, blend: 'standard', position: front, burst: 1, capacity: 1, delay: 0.02, life: [0.22, 0.24],
                    size: [175 * k, 185 * k], speed: [0, 0], sizeGradient: [[0, 0.4], [0.2, 1], [1, 1.15]],
                    colorGradient: [[0, '#ffffff', 1], [0.5, '#ffffff', 0.95], [1, '#ffffff', 0]], rot: true });
            }
            L.push(GameFX._gloveExtra(o.glove, d, k));
            return L;
        },

        // Рывок: вытянутые линии скорости назад вдоль рывка + лёгкий голубой след (следует за персонажем).
        dashTrail(o) {
            const c = o.follow instanceof Character ? o.follow : null;
            const d = o.dir || (c ? { x: c.dashX, y: c.dashY } : { x: 1, y: 0 });
            const dur = o.duration || (typeof GameCfg !== 'undefined' ? GameCfg.dashTime : 0.25) + 0.04;
            return [
                { name: 'fxDashLines', texture: FX_TEX.line, rate: 110, capacity: 40, duration: dur, life: [0.16, 0.26], size: [60, 100], speed: [240, 420],
                    box: [[-30, -80, -30], [30, 80, 30]], direction: [[-d.x, -0.04, -d.y], [-d.x * 1.15, 0.04, -d.y * 1.15]], stretch: 0.25,
                    colorGradient: [[0, '#ffffff', 0], [0.15, '#ffffff', 0.8], [1, '#dff3ff', 0]] },
                { name: 'fxDashGlow', texture: FX_TEX.glow, rate: 60, capacity: 24, duration: dur, life: [0.2, 0.35], size: [26, 44], speed: [20, 60],
                    box: [[-26, -70, -26], [26, 70, 26]], direction: [[-d.x, 0, -d.y], [-d.x, 0.2, -d.y]], colorGradient: [[0, '#bfe8ff', 0.55], [1, '#ffffff', 0]] },
            ];
        },

        // Пыль у ног: приземление, старт рывка. power — скорость удара о землю.
        landDust(o) {
            const k = Math.max(0.5, Math.min(1.6, (o.power || 500) / 700)) * (o.scale || 1);
            return [{ name: 'fxDust', texture: FX_TEX.dust, blend: 'standard', burst: Math.round(10 * k), capacity: 18, life: [0.45, 0.85], size: [28 * k, 54 * k],
                speed: [90 * k, 220 * k], box: [[-24, 2, -24], [24, 10, 24]], direction: [[-1, 0.05, -1], [1, 0.35, 1]], gravity: [0, 30, 0], rot: true, spin: [-1.5, 1.5],
                sizeGradient: [[0, 0.5], [1, 1.5]], colorGradient: [[0, '#ffffff', 0.85], [0.6, '#ffffff', 0.5], [1, '#ffffff', 0]] }];
        },

        // +Аура: золотисто-розовые искры вокруг персонажа, вверх.
        auraGain() {
            const box = [[-55, -70, -55], [55, 70, 55]];
            return [
                { name: 'fxAura', texture: FX_TEX.sparkle, burst: 7, capacity: 8, life: [0.5, 0.9], size: [16, 30], speed: [50, 120], box,
                    direction: [[-0.5, 0.6, -0.5], [0.5, 1, 0.5]], gravity: [0, 60, 0], rot: true, spin: [-3, 3],
                    colorGradient: [[0, '#fff6c8', 0], [0.15, '#ffe27a', 1], [0.6, '#ff9ccf', 0.8], [1, '#ff5f9e', 0]] },
                { name: 'fxAuraDots', texture: FX_TEX.glow, burst: 6, capacity: 6, life: [0.4, 0.7], size: [14, 24], speed: [30, 80], box,
                    direction: [[-0.3, 0.7, -0.3], [0.3, 1, 0.3]], colorGradient: [[0, '#ff7ab0', 0.9], [1, '#ffd36b', 0]] },
            ];
        },

        // Облачко с искрами (KO, бот вышел). small — меньше.
        koPoof(o) {
            const k = (o.small ? 0.7 : 1) * (o.scale || 1);
            return [
                { name: 'fxPoof', texture: FX_TEX.smoke, blend: 'standard', burst: 9, capacity: 10, life: [0.55, 0.95], size: [70 * k, 120 * k], speed: [60 * k, 170 * k],
                    box: [[-30, -40, -30], [30, 40, 30]], direction: [[-1, -0.2, -1], [1, 0.8, 1]], gravity: [0, 40, 0], rot: true, spin: [-1, 1],
                    sizeGradient: [[0, 0.4], [0.3, 1], [1, 1.3]], colorGradient: [[0, '#ffffff', 0.95], [0.6, '#ffffff', 0.7], [1, '#ffffff', 0]] },
                { name: 'fxPoofStars', texture: FX_TEX.star, burst: 6, capacity: 6, life: [0.4, 0.65], size: [18 * k, 30 * k], speed: [220, 380],
                    direction: [[-1, 0, -1], [1, 1, 1]], gravity: [0, -500, 0], rot: true, spin: [-6, 6], colorGradient: [[0, '#ffffff', 1], [1, '#ffe27a', 0]] },
            ];
        },

        // Конфетти: дождь сверху + хлопушка вверх (победа).
        confetti(o) {
            const sheet = FX_CONFETTI_SHEET, grad = [[0, '#ffffff', 1], [0.85, '#ffffff', 1], [1, '#ffffff', 0]];
            return [
                { name: 'fxConfetti', texture: FX_TEX.confetti, blend: 'standard', sheet, burst: 70, capacity: 80, life: [2.2, 3.2], size: [18, 28], speed: [40, 200],
                    box: [[-260, 300, -260], [260, 460, 260]], direction: [[-0.6, -0.3, -0.6], [0.6, 0.5, 0.6]], gravity: [0, -320, 0], spin: [-7, 7], rot: true, colorGradient: grad },
                { name: 'fxConfettiPop', texture: FX_TEX.confetti, blend: 'standard', sheet, burst: 40, capacity: 45, life: [1.6, 2.4], size: [16, 26], speed: [520, 820],
                    box: [[-20, 0, -20], [20, 20, 20]], direction: [[-0.5, 1, -0.5], [0.5, 1, 0.5]], gravity: [0, -900, 0], spin: [-8, 8], rot: true, colorGradient: grad },
            ].map(L => (o.scale ? Object.assign(L, { size: [L.size[0] * o.scale, L.size[1] * o.scale] }) : L));
        },

        // Завихрение портала (непрерывно): две спиральные ветви огоньков по обе стороны плоскости
        // + редкие искры. opts.plane — из GameWorld.portalPlanes(); без него — вихрь вокруг точки.
        portalSwirl(o, at) {
            const P = o.plane || { center: at, u: new BABYLON.Vector3(1, 0, 0), n: new BABYLON.Vector3(0, 0, 1), w: 120, h: 160, color: 0xffffff };
            const base = World3D.hexColor3(o.color != null ? o.color : P.color);
            const col = BABYLON.Color3.Lerp(base, new BABYLON.Color3(1, 1, 1), 0.35).toHexString();
            const C = P.center, U = P.u, N = P.n, rx = P.w * 0.72, ry = P.h * 0.72;
            let lastA = 0;
            const posFn = (wm, pos) => {
                const a = Game.realTime * 2.2 + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.5;
                const rr = 0.5 + Math.random() * 0.5, side = Math.random() < 0.5 ? -14 : 14;
                const cu = Math.cos(a) * rx * rr;
                pos.set(C.x + U.x * cu + N.x * side, C.y + Math.sin(a) * ry * rr, C.z + U.z * cu + N.z * side);
                lastA = a;
            };
            const dirFn = (wm, dir) => {
                const tx = -Math.sin(lastA) * rx, ty = Math.cos(lastA) * ry;
                const l = Math.hypot(tx, ty) || 1;
                dir.set(U.x * tx / l, ty / l, U.z * tx / l);
            };
            const sparkPos = (wm, pos) => {
                const cu = (Math.random() * 2 - 1) * P.w * 0.8, side = Math.random() < 0.5 ? -18 : 18;
                pos.set(C.x + U.x * cu + N.x * side, C.y + (Math.random() * 2 - 1) * P.h * 0.8, C.z + U.z * cu + N.z * side);
            };
            return [
                { name: 'fxSwirl', texture: FX_TEX.glow, rate: FX_PORTAL_RATE, capacity: 70, life: [0.8, 1.2], size: [16, 30], speed: [30, 60], gravity: [0, 10, 0],
                    colorGradient: [[0, col, 0], [0.2, col, 0.95], [1, '#ffffff', 0]], sizeGradient: [[0, 0.6], [0.3, 1], [1, 0.3]], posFn, dirFn },
                { name: 'fxSwirlSpark', texture: FX_TEX.sparkle, rate: 5, capacity: 10, life: [0.6, 1], size: [18, 34], speed: [10, 30], direction: [[0, 1, 0], [0, 1, 0]],
                    rot: true, spin: [-2, 2], colorGradient: [[0, '#ffffff', 0], [0.3, '#ffffff', 0.9], [1, col, 0]], posFn: sparkPos },
            ];
        },

        // Искры: opts.points [{ c: Vector3, r }] + opts.rate — редкие искры по кольцам (непрерывно);
        // без них — разовый всплеск искр в точке.
        sparkle(o, at) {
            const grad = [[0, '#fffbe0', 0], [0.25, '#ffe680', 0.95], [1, '#ffd23a', 0]];
            if (o.points && o.points.length) {
                const pts = o.points;
                const posFn = (wm, pos) => {
                    const p = pts[Math.floor(Math.random() * pts.length)], a = Math.random() * Math.PI * 2;
                    pos.set(p.c.x + Math.cos(a) * p.r, p.c.y + 2 + Math.random() * 18, p.c.z + Math.sin(a) * p.r);
                };
                return [{ name: 'fxRingSpark', texture: FX_TEX.sparkle, rate: o.rate || FX_RING_RATE, capacity: 20, life: [0.6, 1.1], size: [12, 24], speed: [15, 45],
                    direction: [[-0.2, 1, -0.2], [0.2, 1, 0.2]], rot: true, spin: [-2, 2], colorGradient: grad, posFn }];
            }
            const k = o.scale || 1;
            return [{ name: 'fxSparkle', texture: FX_TEX.sparkle, burst: 10, capacity: 10, life: [0.45, 0.8], size: [16 * k, 30 * k], speed: [60 * k, 180 * k],
                box: [[-30, -30, -30], [30, 30, 30]], direction: [[-1, -0.3, -1], [1, 1, 1]], rot: true, spin: [-3, 3],
                colorGradient: o.color ? [[0, '#ffffff', 1], [1, o.color, 0]] : grad }];
        },

        // Появление: кольцо у ног + искры вверх.
        spawnPoof(o) {
            const k = o.scale || 1, col = o.color || '#9fe6ff';
            return [
                { name: 'fxSpawnRing', texture: FX_TEX.ring, burst: 1, capacity: 1, life: [0.35, 0.35], size: [130 * k, 130 * k], speed: [0, 0],
                    sizeGradient: [[0, 0.2], [1, 1.6]], colorGradient: [[0, col, 0.9], [1, '#ffffff', 0]] },
                { name: 'fxSpawnSpark', texture: FX_TEX.sparkle, burst: 8, capacity: 8, life: [0.5, 0.9], size: [14 * k, 26 * k], speed: [40, 120],
                    box: [[-40, 0, -40], [40, 180, 40]], direction: [[-0.3, 0.5, -0.3], [0.3, 1, 0.3]], rot: true, colorGradient: [[0, '#ffffff', 1], [1, col, 0]] },
            ];
        },

        // Прибытие через портал: крупное кольцо, огоньки вверх, искры.
        portalArrive(o, at) {
            const L = GameFX.RECIPES.spawnPoof(Object.assign({ scale: 1.5 }, o), at, false);
            L.push({ name: 'fxArriveUp', texture: FX_TEX.glow, burst: 16, capacity: 16, life: [0.5, 0.9], size: [18, 34], speed: [160, 320],
                box: [[-60, 0, -60], [60, 30, 60]], direction: [[-0.15, 1, -0.15], [0.15, 1, 0.15]], colorGradient: [[0, '#ffffff', 0.9], [1, '#bff4ff', 0]] });
            return L;
        },

        // Новая перчатка в руке: искры и маленькое кольцо.
        gloveEquip() {
            return [
                { name: 'fxGloveSpark', texture: FX_TEX.sparkle, burst: 12, capacity: 12, life: [0.45, 0.8], size: [16, 30], speed: [80, 200],
                    box: [[-50, -40, -50], [50, 60, 50]], direction: [[-1, -0.2, -1], [1, 1, 1]], rot: true, spin: [-4, 4],
                    colorGradient: [[0, '#ffffff', 1], [0.5, '#fff1a0', 0.9], [1, '#ffcf4a', 0]] },
                { name: 'fxGloveRing', texture: FX_TEX.ring, burst: 1, capacity: 1, life: [0.3, 0.3], size: [160, 160], speed: [0, 0], still: true,
                    sizeGradient: [[0, 0.2], [1, 1.5]], colorGradient: [[0, '#fff3b0', 0.85], [1, '#ffffff', 0]] },
            ];
        },

        // Взрыв (бомба, метеор, чёрная дыра): клякса-вспышка, огонь, дым, кольцо, искры.
        explosion(o, at) {
            const k = o.scale || 1;
            return [
                { name: 'fxBoom', texture: FX_TEX.burst, blend: 'standard', position: GameFX._toCam(at, 80), burst: 1, capacity: 1, life: [0.3, 0.32], size: [260 * k, 280 * k],
                    speed: [0, 0], rot: true, sizeGradient: [[0, 0.3], [0.2, 1], [1, 1.2]], colorGradient: [[0, '#ffffff', 1], [0.6, '#ffffff', 0.9], [1, '#ffffff', 0]] },
                { name: 'fxBoomFire', texture: FX_TEX.flame, blend: 'standard', burst: 14, capacity: 14, life: [0.35, 0.6], size: [60 * k, 100 * k], speed: [300 * k, 600 * k],
                    direction: [[-1, 0, -1], [1, 1, 1]], gravity: [0, 120, 0], rot: true, sizeGradient: [[0, 0.8], [1, 0.3]], colorGradient: [[0, '#ffffff', 1], [1, '#ffffff', 0]] },
                { name: 'fxBoomSmoke', texture: FX_TEX.smoke, blend: 'standard', delay: 0.08, burst: 12, capacity: 12, life: [1, 1.6], size: [120 * k, 200 * k], speed: [60, 160],
                    box: [[-60, -20, -60], [60, 60, 60]], direction: [[-1, 0.2, -1], [1, 1, 1]], gravity: [0, 50, 0], rot: true, spin: [-0.6, 0.6],
                    sizeGradient: [[0, 0.5], [1, 1.4]], colorGradient: [[0, '#c9c3bd', 0.85], [1, '#ffffff', 0]] },
                { name: 'fxBoomRing', texture: FX_TEX.ring, burst: 1, capacity: 1, life: [0.4, 0.4], size: [300 * k, 300 * k], speed: [0, 0],
                    sizeGradient: [[0, 0.2], [1, 2.2]], colorGradient: [[0, '#fff1c4', 0.9], [1, '#ffffff', 0]] },
                { name: 'fxBoomStars', texture: FX_TEX.star, burst: 10, capacity: 10, life: [0.4, 0.7], size: [20 * k, 34 * k], speed: [400, 700],
                    direction: [[-1, 0, -1], [1, 1, 1]], gravity: [0, -900, 0], rot: true, spin: [-8, 8], colorGradient: [[0, '#ffffff', 1], [1, '#ffb347', 0]] },
            ];
        },

        // Сердечки вверх (перчатка «Любовь»).
        hearts(o) {
            const k = o.scale || 1;
            return [{ name: 'fxHeartsUp', texture: FX_TEX.heart, blend: 'standard', burst: 6, capacity: 6, life: [0.8, 1.2], size: [26 * k, 44 * k], speed: [60, 140],
                box: [[-40, -20, -40], [40, 40, 40]], direction: [[-0.4, 1, -0.4], [0.4, 1, 0.4]], gravity: [0, 40, 0],
                colorGradient: [[0, '#ffffff', 0], [0.15, '#ffffff', 1], [0.75, '#ffffff', 1], [1, '#ffffff', 0]] }];
        },

        // Ледяные осколки во все стороны (заморозка / лёд разбился).
        iceBurst(o) {
            const k = o.scale || 1;
            return [
                { name: 'fxIceShards', texture: FX_TEX.ice, blend: 'standard', burst: 12, capacity: 12, life: [0.5, 0.8], size: [22 * k, 38 * k], speed: [250, 450],
                    direction: [[-1, 0, -1], [1, 1, 1]], gravity: [0, -1100, 0], rot: true, spin: [-8, 8], colorGradient: [[0, '#ffffff', 1], [0.7, '#ffffff', 1], [1, '#ffffff', 0]] },
                { name: 'fxIceGlow', texture: FX_TEX.glow, burst: 8, capacity: 8, life: [0.3, 0.5], size: [40 * k, 70 * k], speed: [40, 120],
                    direction: [[-1, -0.5, -1], [1, 1, 1]], colorGradient: [[0, '#d8f6ff', 0.8], [1, '#8fe3ff', 0]] },
            ];
        },

        // Огонь (непрерывно, opts.duration или stop()): языки пламени вверх («Ярость»).
        flame(o) {
            const k = o.scale || 1;
            return [{ name: 'fxFire', texture: FX_TEX.flame, blend: 'standard', rate: 40, capacity: 40, duration: o.duration, life: [0.35, 0.6], size: [40 * k, 70 * k],
                speed: [60, 140], box: [[-40, -60, -40], [40, 60, 40]], direction: [[-0.2, 1, -0.2], [0.2, 1, 0.2]], gravity: [0, 80, 0],
                sizeGradient: [[0, 0.6], [0.3, 1], [1, 0.2]], colorGradient: [[0, '#ffffff', 0], [0.15, '#ffffff', 1], [1, '#ffffff', 0]] }];
        },

        // Клуб дыма.
        smoke(o) {
            const k = o.scale || 1;
            return [{ name: 'fxSmoke', texture: FX_TEX.smoke, blend: 'standard', burst: 8, capacity: 8, life: [0.8, 1.4], size: [90 * k, 150 * k], speed: [40, 110],
                box: [[-30, -20, -30], [30, 30, 30]], direction: [[-1, 0.2, -1], [1, 1, 1]], gravity: [0, 40, 0], rot: true, spin: [-0.6, 0.6],
                sizeGradient: [[0, 0.5], [1, 1.4]], colorGradient: [[0, o.color || '#ffffff', 0.85], [1, '#ffffff', 0]] }];
        },

        // Звёздочки над головой (оглушение): небольшой всплеск по кругу.
        stars(o) {
            const k = o.scale || 1;
            return [{ name: 'fxDizzy', texture: FX_TEX.star, burst: 6, capacity: 6, life: [0.6, 0.9], size: [18 * k, 28 * k], speed: [60, 110],
                box: [[-30, 0, -30], [30, 10, 30]], direction: [[-1, 0.3, -1], [1, 0.6, 1]], gravity: [0, -60, 0], rot: true, spin: [-5, 5],
                colorGradient: [[0, '#fff6a0', 1], [1, '#ffd21a', 0]] }];
        },

        // Всплеск светящихся огоньков (цвет opts.color).
        glowBurst(o) {
            const k = o.scale || 1, col = o.color || '#ffffff';
            return [{ name: 'fxGlowBurst', texture: FX_TEX.glow, burst: 12, capacity: 12, life: [0.35, 0.6], size: [20 * k, 40 * k], speed: [120, 300],
                direction: [[-1, -0.5, -1], [1, 1, 1]], colorGradient: [[0, '#ffffff', 1], [0.3, col, 0.9], [1, col, 0]] }];
        },
    },
};
