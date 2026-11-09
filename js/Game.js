// Game.js — ядро Aura Farming Master (DESIGN.md §2–§8, docs/RESKIN.md): запуск (мир, игрок, стартовый экран),
// зоны lobby / arena / royale / duel и переход-телепорт со вспышкой, шина событий
// Game.on/off/emit, Game.timeScale (slow-mo), жизненный цикл модулей, аура, сохранение,
// порталы лобби, debug-API (?debug) и ?autostart=<зона>.
//
// Модули — глобальные объекты с необязательными хуками init(game) (может быть async),
// ready(), update(dt, realDt) (dt — игровое время с учётом timeScale), onZone(zone, mode).
// Порядок кадра: PRE-модули (ввод, игрок, боты, перчатки, способности, бой, фонк, режимы)
// -> физика персонажей (step) -> расталкивание -> анимация -> порталы -> POST-модули
// (мир, камера, FX, UI). Зовёт их только Game — через typeof (модуля может не быть).
//
// Порталы лобби: вход — один раз, когда игрок вошёл в радиус маркера portal-* (стоять в
// портале не повторяет вход). Game.enterPortal(mode) сначала спрашивает
// GameModes.enterPortal(mode): true — режимы сами решают (окно, очередь), иначе goto(mode).
// Снова портал сработает после выхода из радиуса и нового входа (goto / respawnPlayer тоже
// сбрасывают Game._portalIn).
//
// События (data): swing {char}, slap {attacker, victim, glove, power, dir}, miss {char},
// aura {char, delta, total}, ko {victim, killer}, respawn {char, zone}, dash {char},
// land {char, speed}, zone {char, from, to, mode}, glove {char, glove}, phonk/phonkEnd
// {attacker, victim}, ability {char, ability, x, y}, round {mode, result, reward},
// spawn {char} / despawn {char} — персонаж добавлен/убран, start {} — нажали «ИГРАТЬ»,
// settings {…} — изменены настройки.

// Числа ядра из Constants.js (в игре это лексические const — только typeof + дефолт).
const GameCfg = (() => {
    const U = 'undefined';
    return {
        runSpeed: typeof GAME_RUN_SPEED !== U ? GAME_RUN_SPEED : 520,
        accel: typeof GAME_RUN_ACCEL !== U ? GAME_RUN_ACCEL : 3600,
        decel: typeof GAME_RUN_DECEL !== U ? GAME_RUN_DECEL : 4600,
        airControl: typeof GAME_AIR_CONTROL !== U ? GAME_AIR_CONTROL : 0.35,
        turnRate: typeof GAME_TURN_RATE !== U ? GAME_TURN_RATE : 13,
        gravity: typeof GAME_GRAVITY !== U ? GAME_GRAVITY : 1900,
        charRadius: typeof GAME_CHAR_RADIUS !== U ? GAME_CHAR_RADIUS : 42,
        pushRate: typeof GAME_PUSH_RATE !== U ? GAME_PUSH_RATE : 14,
        koHeight: typeof GAME_KO_HEIGHT !== U ? GAME_KO_HEIGHT : -1400,
        koCredit: typeof GAME_KO_CREDIT !== U ? GAME_KO_CREDIT : 6,
        slapRange: typeof GAME_SLAP_RANGE !== U ? GAME_SLAP_RANGE : 190,
        slapLock: typeof GAME_SLAP_LOCK !== U ? GAME_SLAP_LOCK : 1.6,
        slapAura: typeof GAME_SLAP_AURA !== U ? GAME_SLAP_AURA : 0,
        slapMagnet: typeof GAME_SLAP_MAGNET !== U ? GAME_SLAP_MAGNET : 90,
        slapContact: typeof GAME_SLAP_CONTACT !== U ? GAME_SLAP_CONTACT : 0.5,
        slapHeight: typeof GAME_SLAP_HEIGHT !== U ? GAME_SLAP_HEIGHT : 160,
        botMissRange: typeof GAME_BOT_MISS_RANGE !== U ? GAME_BOT_MISS_RANGE : 1.15,
        botMissAngle: (typeof GAME_BOT_MISS_ANGLE_DEG !== U ? GAME_BOT_MISS_ANGLE_DEG : 75) * Math.PI / 180,
        knockH: typeof GAME_KNOCK_H !== U ? GAME_KNOCK_H : 1.7,
        knockV: typeof GAME_KNOCK_V !== U ? GAME_KNOCK_V : 380,
        knockVK: typeof GAME_KNOCK_V_K !== U ? GAME_KNOCK_V_K : 0.4,
        stun: typeof GAME_STUN !== U ? GAME_STUN : 0.9,
        friction: typeof GAME_FRICTION !== U ? GAME_FRICTION : 1500,
        bounce: typeof GAME_BOUNCE !== U ? GAME_BOUNCE : 0.32,
        bounceMin: typeof GAME_BOUNCE_MIN !== U ? GAME_BOUNCE_MIN : 420,
        downTime: typeof GAME_DOWN_TIME !== U ? GAME_DOWN_TIME : 0.4,
        getupTime: typeof GAME_GETUP_TIME !== U ? GAME_GETUP_TIME : 0.45,
        charLift: typeof GAME_CHAR_LIFT !== U ? GAME_CHAR_LIFT : 0.16,
        dashTime: typeof GAME_DASH_TIME !== U ? GAME_DASH_TIME : 0.25,
        dashSpeed: typeof GAME_DASH_SPEED !== U ? GAME_DASH_SPEED : 1450,
        dashCooldown: typeof GAME_DASH_COOLDOWN !== U ? GAME_DASH_COOLDOWN : 3,
        respawnDelay: typeof GAME_RESPAWN_DELAY !== U ? GAME_RESPAWN_DELAY : 1.6,
        spawnShield: typeof GAME_SPAWN_SHIELD !== U ? GAME_SPAWN_SHIELD : 1.5,
        camDist: typeof GAME_CAM_DIST !== U ? GAME_CAM_DIST : 520,
        camPitch: typeof GAME_CAM_PITCH_DEG !== U ? GAME_CAM_PITCH_DEG : 18,
        camFov: typeof GAME_CAM_FOV_DEG !== U ? GAME_CAM_FOV_DEG : 70,
        camLookH: typeof GAME_CAM_LOOK_H !== U ? GAME_CAM_LOOK_H : 230,
        camFollow: typeof GAME_CAM_FOLLOW !== U ? GAME_CAM_FOLLOW : 9,
        camAutoDelay: typeof GAME_CAM_AUTO_DELAY !== U ? GAME_CAM_AUTO_DELAY : 2,
        camAutoRate: typeof GAME_CAM_AUTO_RATE !== U ? GAME_CAM_AUTO_RATE : 1.3,
        camDrag: typeof GAME_CAM_DRAG_DEG !== U ? GAME_CAM_DRAG_DEG : 0.3,
        camFar: typeof GAME_CAM_FAR !== U ? GAME_CAM_FAR : 40000,
        camFlyFollow: typeof GAME_CAM_FLY_FOLLOW !== U ? GAME_CAM_FLY_FOLLOW : 2.5,
        camFlyDist: typeof GAME_CAM_FLY_DIST !== U ? GAME_CAM_FLY_DIST : 1.25,
        camCollide: typeof GAME_CAM_COLLIDE !== U ? GAME_CAM_COLLIDE : 20,
        joyRadius: typeof GAME_JOY_RADIUS !== U ? GAME_JOY_RADIUS : 64,
        joyZone: typeof GAME_JOY_ZONE !== U ? GAME_JOY_ZONE : 0.45,
        joyTop: typeof GAME_JOY_TOP !== U ? GAME_JOY_TOP : 0.3,
        joyDead: typeof GAME_JOY_DEAD !== U ? GAME_JOY_DEAD : 0.12,
        flashIn: typeof GAME_FLASH_IN !== U ? GAME_FLASH_IN : 0.28,
        flashOut: typeof GAME_FLASH_OUT !== U ? GAME_FLASH_OUT : 0.12,
        saveDelay: typeof GAME_SAVE_DELAY !== U ? GAME_SAVE_DELAY : 1.5,
        saveMaxDelay: typeof GAME_SAVE_MAX_DELAY !== U ? GAME_SAVE_MAX_DELAY : 5,
        badgeDist: typeof GAME_BADGE_DIST !== U ? GAME_BADGE_DIST : 2600,
        badgeScale: typeof GAME_BADGE_SCALE !== U ? GAME_BADGE_SCALE : 1.15,
        badgeMax: typeof GAME_BADGE_MAX !== U ? GAME_BADGE_MAX : 8,
        glow: typeof GAME_GLOW !== U ? GAME_GLOW : 0.75,
        skyTop: typeof GAME_SKY_TOP !== U ? GAME_SKY_TOP : 0x2f7fd0,
        skyBottom: typeof GAME_SKY_BOTTOM !== U ? GAME_SKY_BOTTOM : 0x9ccfe6,
    };
})();

/** @satisfies {Record<string, any>} */
const Game = {
    /** @type {LoryApp | null} */
    app: null,
    /** @type {typeof GameWorld | null} */
    world: null,
    /** @type {Character[]} */
    chars: [],
    /** @type {Character | null} */
    player: null,
    zone: 'lobby',          // зона игрока: 'lobby' | 'arena' | 'royale' | 'duel'
    mode: 'lobby',          // режим: 'lobby' | 'arena' | 'hardcore' | 'royale' | 'duel'
    timeScale: 1,           // множитель игрового времени (Фонк Момент — slow-mo)
    time: 0,                // игровое время, с (с учётом timeScale)
    realTime: 0,            // реальное время игры, с (без пауз)
    fps: 60,
    started: false,         // нажали «ИГРАТЬ»
    transitioning: false,   // идёт телепорт (вспышка)
    /** @type {any} */
    save: null,
    /** @type {any} */
    debug: null,
    // Правила зон: pvp — можно ли шлёпать (лобби — безопасная зона).
    /** @type {Record<string, { pvp: boolean }>} */
    ZONE_RULES: { lobby: { pvp: false }, arena: { pvp: true }, royale: { pvp: true }, duel: { pvp: true } },
    /** @type {Record<string, Function[]>} */
    _ev: {},
    _hitStop: 0,
    _saveTimer: 0,
    _dirtySince: 0,         // performance.now() первого несохранённого изменения (0 — всё сохранено)
    /** @type {Portal | null} */
    _portalIn: null,        // портал, в котором стоит игрок (вход срабатывает один раз — по входу в радиус)
    /** @type {{ url: string, opts: any } | null} */
    _music: null,
    /** @type {HTMLElement | null} */
    _flash: null,

    // --- Модули ----------------------------------------------------------------------------

    _pre() {
        return [typeof GameInput !== 'undefined' ? GameInput : null, typeof GamePlayer !== 'undefined' ? GamePlayer : null,
            typeof GameBots !== 'undefined' ? GameBots : null, typeof GameGloves !== 'undefined' ? GameGloves : null,
            typeof GameAbilities !== 'undefined' ? GameAbilities : null, typeof GameCombat !== 'undefined' ? GameCombat : null, typeof GameFarm !== 'undefined' ? GameFarm : null,
            typeof GamePhonk !== 'undefined' ? GamePhonk : null, typeof GameModes !== 'undefined' ? GameModes : null].filter(Boolean);
    },

    _post() {
        return [typeof GameWorld !== 'undefined' ? GameWorld : null, typeof GameCamera !== 'undefined' ? GameCamera : null,
            typeof GameFX !== 'undefined' ? GameFX : null, typeof GameUI !== 'undefined' ? GameUI : null,
            typeof GameWardrobe !== 'undefined' ? GameWardrobe : null, typeof GameDaily !== 'undefined' ? GameDaily : null,
            typeof GameTutorial !== 'undefined' ? GameTutorial : null, typeof GameTelemetry !== 'undefined' ? GameTelemetry : null].filter(Boolean);
    },

    // Порядок init: мир -> (игрок) -> ввод, камера, UI, бой, игрок, перчатки, способности, боты, фонк, FX, режимы.
    _initOrder() {
        return [typeof GameInput !== 'undefined' ? GameInput : null, typeof GameCamera !== 'undefined' ? GameCamera : null,
            typeof GameUI !== 'undefined' ? GameUI : null, typeof GameCombat !== 'undefined' ? GameCombat : null,
            typeof GamePlayer !== 'undefined' ? GamePlayer : null, typeof GameGloves !== 'undefined' ? GameGloves : null,
            typeof GameAbilities !== 'undefined' ? GameAbilities : null, typeof GameBots !== 'undefined' ? GameBots : null,
            typeof GamePhonk !== 'undefined' ? GamePhonk : null, typeof GameFX !== 'undefined' ? GameFX : null,
            typeof GameModes !== 'undefined' ? GameModes : null, typeof GameFarm !== 'undefined' ? GameFarm : null, typeof GameWardrobe !== 'undefined' ? GameWardrobe : null,
            typeof GameDaily !== 'undefined' ? GameDaily : null, typeof GameTutorial !== 'undefined' ? GameTutorial : null,
            typeof GameTelemetry !== 'undefined' ? GameTelemetry : null, typeof GameSkin !== 'undefined' ? GameSkin : null].filter(Boolean);
    },

    _all() {
        return [typeof GameWorld !== 'undefined' ? GameWorld : null].filter(Boolean).concat(this._initOrder());
    },

    // --- Шина событий -----------------------------------------------------------------------

    on(name, fn) { (this._ev[name] || (this._ev[name] = [])).push(fn); return fn; },

    off(name, fn) {
        const l = this._ev[name];
        if (!l) return;
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
    },

    emit(name, data) {
        const l = this._ev[name];
        if (!l) return;
        for (const fn of l.slice()) {
            try { fn(data || {}); } catch (e) { console.error('Game event ' + name + ':', e); }
        }
    },

    // --- Запуск ------------------------------------------------------------------------------

    async init(app) {
        this.app = app;
        this.world = typeof GameWorld !== 'undefined' ? GameWorld : null;
        const q = new URLSearchParams(window.location.search);
        this._css();
        await this._loadSave();
        await GameWorld.init(this);
        await Character.preload();
        // Игрок — в лобби у маркера spawn; внешность — надетое из гардероба (save.cos).
        const sp = this.spawnFor('lobby') || { x: 4000, y: 8000, heading: 0 };
        let name = Lang.t('playerName');
        try { const pl = /** @type {any} */ (Platform).player; const n = pl && pl.getName && pl.getName(); if (n) name = String(n); } catch (e) { /* аноним */ }
        if (Platform.playerName()) name = Platform.playerName();   // CrazyGames: ник аккаунта
        const p = new Character({ name, isPlayer: true, look: typeof GameWardrobe !== 'undefined' && typeof /** @type {any} */ (GameWardrobe).lookOfPlayer === 'function' ? /** @type {any} */ (GameWardrobe).lookOfPlayer() : Character.BASE_LOOK, glove: this.save.glove || 'default', zone: 'lobby', x: sp.x, y: sp.y, heading: sp.heading });
        p.aura = this.save.aura || 0;
        this.player = p;
        this.addChar(p);
        // CrazyGames: вход в аккаунт — ник игрока; режим — контекст для отзывов; процент
        // прохождения — доля открытых перчаток (только растёт).
        window.addEventListener('platform-user', () => {
            const n = Platform.playerName();
            if (n && this.player) { this.player.name = n; if (typeof GameUI !== 'undefined') GameUI.refreshBadge(this.player); }
        });
        this.on('zone', (e) => { if (e.char === this.player) Platform.context(e.to && e.to !== 'lobby' ? { mode: e.to } : null); });
        // Особые победы (королевская битва, дуэль) — happytime площадки.
        this.on('round', (e) => { if (e && e.result === 'win' && (e.mode === 'royale' || e.mode === 'duel')) Platform.happy(); });
        for (const m of this._initOrder()) {
            if (typeof m.init !== 'function') continue;
            try { await m.init(this); } catch (e) { console.error('Game: init модуля', e); }
        }
        this.applySettings();
        if (typeof GameUI !== 'undefined') GameUI.setAura(p.aura);
        if (Platform.name === 'playables') {
            // Playables: только onPause SDK (Pause 'platform'), Page Visibility API запрещён.
            Pause.onChange(() => { if (Pause.has('platform')) this.saveNow(); });
        } else {
            window.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
            window.addEventListener('pagehide', () => this.saveNow());
        }
        if (q.has('debug')) this._setupDebug();
        const auto = q.get('autostart');
        const lobby = GameWorld.zoneCenter('lobby') || { x: sp.x, y: sp.y };
        GameCamera.orbit(lobby.x, lobby.y, 1500);
        GameCamera.tx = lobby.x; GameCamera.ty = lobby.y; GameCamera.th = 160;
        GameCamera.az = -2.2;
        if (auto) {
            this.start(true);
            if (auto !== 'lobby' && (GameWorld.zones[auto === 'hardcore' ? 'arena' : auto])) this.goto(auto, { instant: true });
        } else if (typeof GameUI !== 'undefined') {
            GameUI.showStart(() => this.start());
        }
    },

    async ready() {
        for (const m of this._all()) {
            if (typeof m.ready !== 'function') continue;
            try { await m.ready(); } catch (e) { console.error('Game: ready модуля', e); }
        }
    },

    // «ИГРАТЬ»: камера за спину, ввод и HUD, игровой процесс для платформы.
    start(instant) {
        if (this.started) return;
        this.started = true;
        if (typeof GameUI !== 'undefined') { GameUI.hideStart(); GameUI.showHud(true); }
        GameInput.setEnabled(true);
        GameInput.setVisible(true);
        GameCamera.follow();
        if (instant) GameCamera.snap(); else GameCamera.swoop(0.9);
        Platform.gameplay(true);
        this.emit('start', {});
    },

    // --- Персонажи ------------------------------------------------------------------------

    addChar(c) {
        if (this.chars.indexOf(c) < 0) this.chars.push(c);
        this.emit('spawn', { char: c });
        return c;
    },

    removeChar(c) {
        const i = this.chars.indexOf(c);
        if (i >= 0) this.chars.splice(i, 1);
        this.emit('despawn', { char: c });
        c.dispose();
    },

    // Можно ли шлёпаться в зоне (лобби — нельзя).
    pvp(zone) { const r = this.ZONE_RULES[zone]; return r ? r.pvp !== false : true; },

    // --- Аура ------------------------------------------------------------------------------

    // Множитель ауры: хардкор ×2, «×2 аура» из магазина (save.boostUntil) — только игроку.
    // Есть модуль режимов — решает он (GameModes.auraMult).
    auraMultiplier(ch) {
        const gm = typeof GameModes !== 'undefined' ? /** @type {any} */ (GameModes) : null;
        if (gm && typeof gm.auraMult === 'function') {
            try { return gm.auraMult(ch); } catch (e) { console.error('GameModes.auraMult:', e); }
        }
        if (!ch || !ch.isPlayer) return 1;
        let k = 1;
        if (this.mode === 'hardcore') k *= 2;
        if (this.save && this.save.boostUntil > Date.now()) k *= 2;
        return k;
    },

    // +n ауры персонажу (opts.raw — без множителей). Игроку — сохранение и рекорд.
    addAura(ch, n, opts) {
        if (!ch || !n) return;
        let d = n;
        if (!(opts && opts.raw) && d > 0) d *= this.auraMultiplier(ch);
        const before = ch.aura;
        ch.aura = Math.max(0, Math.round(ch.aura + d));
        if (ch.isPlayer) {
            this.save.aura = ch.aura;
            const gained = ch.aura - before;
            if (gained > 0 && !(opts && opts.spend)) this.save.auraTotal = Math.round((this.save.auraTotal || 0) + gained);
            this.saveSoon();
            Platform.submitScore(this.save.auraTotal || ch.aura);
        }
        this.emit('aura', { char: ch, delta: d, total: ch.aura });
    },

    // --- Экономика ------------------------------------------------------------------------
    // save.aura — баланс игрока (тратится в гардеробе), save.auraTotal — аура, заработанная за всё
    // время (пороги перчаток, рекорды; трата её не уменьшает). Разблокировка за несколько
    // просмотров рекламы: save.adViews[key] — засчитанные просмотры.

    // Заработано за всё время (не меньше текущего баланса).
    auraTotal() { return Math.max(this.save ? this.save.auraTotal || 0 : 0, this.player ? this.player.aura : 0); },

    // Потратить n ауры игрока: true — списано; false — не хватает (ничего не меняется).
    spendAura(n) {
        const p = this.player, k = Math.max(0, Math.round(n || 0));
        if (!p || p.aura < k) return false;
        if (k > 0) this.addAura(p, -k, { raw: true, spend: true });
        return true;
    },

    // Сколько просмотров рекламы уже засчитано для key.
    adViews(key) { return (this.save && this.save.adViews && this.save.adViews[key]) | 0; },

    // Один просмотр rewarded-рекламы в счёт разблокировки key (нужно need просмотров).
    // -> { ok: просмотр засчитан, views, need, done: набрано need }. Награда — только по ok.
    async adUnlock(key, need) {
        const n = Math.max(1, need | 0);
        let views = this.adViews(key);
        if (views >= n) return { ok: false, views, need: n, done: true };
        let ok = false;
        try { ok = (await Platform.rewarded('unlock_' + key)) === true; } catch (e) { ok = false; }
        if (ok) {
            if (!this.save.adViews) this.save.adViews = {};
            views = this.save.adViews[key] = views + 1;
            this.saveSoon();
        }
        return { ok, views, need: n, done: views >= n };
    },

    // --- Зоны и телепорт -------------------------------------------------------------------

    // Точка появления для режима/зоны: { x, y, h, heading } или null.
    spawnFor(mode, i) {
        const name = { lobby: 'spawn', arena: 'arena-spawn', hardcore: 'arena-spawn', royale: 'royale-spawn', duel: 'duel-a' }[mode];
        let sp = name ? GameWorld.spawnPoint(name, i) : null;
        if (!sp) {
            const z = GameWorld.zoneCenter(mode === 'hardcore' ? 'arena' : mode);
            if (z) sp = { x: z.x, y: z.y, h: 0, heading: 0 };
        }
        return sp;
    },

    // Перейти игроком в режим/зону: 'lobby' | 'arena' | 'hardcore' | 'royale' | 'duel'.
    // opts: { instant — без вспышки, spawn: {x, y, heading} — своя точка }.
    goto(target, opts) {
        const o = opts || {};
        const mode = target, zone = target === 'hardcore' ? 'arena' : target;
        if (!GameWorld.zones[zone] || this.transitioning) return false;
        const go = () => {
            const p = this.player, from = this.zone;
            const sp = o.spawn || this.spawnFor(mode) || { x: p.x, y: p.y, heading: p.heading };
            this.zone = zone;
            this.mode = mode;
            p.zone = zone;
            p.respawn(sp.x, sp.y, sp.heading);
            this._portalIn = null;
            GameInput.flush();      // стик под пальцем держится и после телепорта
            GameCamera.snap();
            this.emit('zone', { char: p, from, to: zone, mode });
            for (const m of this._all()) {
                if (typeof m.onZone !== 'function') continue;
                try { m.onZone(zone, mode); } catch (e) { console.error('Game: onZone модуля', e); }
            }
        };
        if (o.instant) go(); else this.transition(go);
        return true;
    },

    // Игрок снова в игре в своей зоне (после падения).
    respawnPlayer(spawn) {
        const p = this.player;
        if (!p) return;
        const sp = spawn || this.spawnFor(this.mode) || this.spawnFor('lobby');
        p.zone = this.zone;
        p.respawn(sp.x, sp.y, sp.heading);
        this._portalIn = null;
        GameCamera.snap();
    },

    // Вход в портал (один раз на вход в радиус портала — см. update): модуль режимов может
    // перехватить (GameModes.enterPortal(mode) === true — свой экран/очередь, телепорт не
    // делается). Повторный вызов — только после выхода из радиуса и нового входа, goto или
    // respawnPlayer (они сбрасывают Game._portalIn).
    enterPortal(mode) {
        const gm = typeof GameModes !== 'undefined' ? /** @type {any} */ (GameModes) : null;
        if (gm && typeof gm.enterPortal === 'function') {
            try { if (gm.enterPortal(mode) === true) return; } catch (e) { console.error(e); }
        }
        this.goto(mode);
    },

    // Вспышка-затемнение: fn — в самый яркий момент (GAME_FLASH_IN), угасание — через
    // GAME_FLASH_OUT. Ввод на это время выключен (палец на стике продолжает отслеживаться).
    transition(fn) {
        this.transitioning = true;
        GameInput.setEnabled(false);
        const el = this._flash;
        el.classList.add('gf-on');
        setTimeout(() => {
            try { fn(); } catch (e) { console.error('Game.transition:', e); }
            setTimeout(() => {
                el.classList.remove('gf-on');
                this.transitioning = false;
                if (this.started) GameInput.setEnabled(true);
            }, GameCfg.flashOut * 1000);
        }, GameCfg.flashIn * 1000);
    },

    _css() {
        const st = document.createElement('style');
        const fin = GameCfg.flashIn.toFixed(2) + 's';
        st.textContent = '#game-flash{position:fixed;inset:0;z-index:60;pointer-events:none;opacity:0;transition:opacity ' + fin + ' ease-in;' +
            'background:radial-gradient(circle at 50% 55%,#ffffff 0%,#f2fbff 35%,#bfe8ff 75%,#8fd3ff 100%)}' +
            '#game-flash.gf-on{opacity:1;transition:opacity ' + fin + ' ease-out}';
        document.head.appendChild(st);
        const el = this._flash = document.createElement('div');
        el.id = 'game-flash';
        document.body.appendChild(el);
    },

    // Короткая заморозка игрового времени (сочный удар): seconds — реальные.
    hitStop(seconds) { this._hitStop = Math.max(this._hitStop, seconds || 0.05); },

    // --- Сохранение и настройки ---------------------------------------------------------------

    DEFAULT_SAVE: { aura: 0, glove: 'default', unlocked: ['default'], stats: { slaps: 0, kos: 0, falls: 0, royaleWins: 0, duelWins: 0, perfects: 0, zoneSecs: 0 },
        settings: { music: true, sfx: true, quality: 'high' }, boostUntil: 0, auraTotal: 0, adViews: {},
        up: { farm: 0, pose: 0, slap: 0 } },

    async _loadSave() {
        let data = null;
        try { data = await Platform.load(); } catch (e) { console.warn('Game: сохранение не загрузилось', e); }
        const d = JSON.parse(JSON.stringify(this.DEFAULT_SAVE));
        if (IS_MOBILE) d.settings.quality = 'low';
        const s = Object.assign(d, data && typeof data === 'object' ? data : {});
        s.stats = Object.assign({}, this.DEFAULT_SAVE.stats, s.stats || {});
        s.settings = Object.assign({}, d.settings, (data && data.settings) || {});
        if (!Array.isArray(s.unlocked)) s.unlocked = ['default'];
        if (s.unlocked.indexOf('default') < 0) s.unlocked.unshift('default');
        s.aura = Math.max(0, Math.round(Number(s.aura) || 0));
        s.auraTotal = Math.max(s.aura, Math.round(Number(s.auraTotal) || 0));
        if (!s.adViews || typeof s.adViews !== 'object') s.adViews = {};
        // Прокачка за ауру (Aura Farming Master): старые сохранения — нулевые уровни.
        s.up = Object.assign({}, this.DEFAULT_SAVE.up, s.up && typeof s.up === 'object' ? s.up : {});
        for (const k of Object.keys(this.DEFAULT_SAVE.up)) s.up[k] = Math.max(0, Math.min(20, Math.round(Number(s.up[k]) || 0)));
        // Гардероб: save.cos = { owned, equip } (старые сохранения — стандартный набор вещей).
        if (typeof GameWardrobe !== 'undefined' && typeof /** @type {any} */ (GameWardrobe).migrate === 'function') /** @type {any} */ (GameWardrobe).migrate(s);
        this.save = s;
        // Загруженное не перезаписываем тем же самым: первая запись — после реального изменения.
        if (data && typeof data === 'object') { try { this._savedJson = JSON.stringify(data); } catch (e) { this._savedJson = ''; } }
    },

    // Сохранить через GAME_SAVE_DELAY после последнего изменения (изменения подряд — одна
    // запись), но не позже GAME_SAVE_MAX_DELAY после первого несохранённого (шлепки без пауз).
    saveSoon() {
        const now = performance.now();
        if (!this._dirtySince) this._dirtySince = now;
        const left = GameCfg.saveMaxDelay * 1000 - (now - this._dirtySince);
        if (left <= 0) { this.saveNow(); return; }
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveNow(), Math.min(GameCfg.saveDelay * 1000, left));
    },

    // Одно действие — не больше одной записи: одинаковые данные не отправляются повторно
    // (уход с вкладки зовёт и visibilitychange, и pagehide), пока идёт запись — следующая
    // ждёт её конца и уходит одна, с последними данными.
    saveNow() {
        clearTimeout(this._saveTimer);
        this._saveTimer = 0;
        this._dirtySince = 0;
        if (!this.save) return;
        let json = '';
        try { json = JSON.stringify(this.save); } catch (e) { return; }
        if (json === this._savedJson) return;
        if (this._saving) { this._savePending = true; return; }
        this._saving = true;
        this._savedJson = json;
        Promise.resolve(Platform.save(this.save))
            .then((ok) => { if (!ok) this._savedJson = ''; }, () => { this._savedJson = ''; })
            .then(() => {
                this._saving = false;
                if (this._savePending) { this._savePending = false; this.saveNow(); }
            });
    },
    _savedJson: '',
    _progressAt: 0,
    _saving: false,
    _savePending: false,

    // Применить настройки (звук, музыка, качество графики) из save.settings.
    applySettings() {
        const s = this.save.settings;
        if (Sound.muted !== !s.sfx) Sound.setMuted(!s.sfx);
        this._applyMusic();
        GameWorld.setQuality(s.quality);
        this.emit('settings', s);
    },

    // Музыка игры с учётом настройки «Музыка»: url (строковый литерал пути ассета), null — тишина.
    music(url, opts) {
        this._music = url ? { url, opts: opts || {} } : null;
        this._applyMusic();
    },

    _applyMusic() {
        const m = this.save && this.save.settings.music ? this._music : null;
        if (m) Sound.music(m.url, m.opts); else Sound.music(null);
    },

    // --- Кадр ----------------------------------------------------------------------------------

    update(dt) {
        const realDt = Math.min(0.1, dt || 0);
        this.realTime += realDt;
        let scale = this.timeScale;
        if (this._hitStop > 0) { this._hitStop -= realDt; scale *= 0.06; }
        const gdt = realDt * scale;
        this.time += gdt;
        if (realDt > 0) this.fps += (1 / realDt - this.fps) * 0.05;
        if (Platform.name === 'crazygames' && this.realTime >= this._progressAt && typeof GameGloves !== 'undefined') {
            this._progressAt = this.realTime + 3;
            const list = /** @type {any[]} */ (GameGloves.LIST || []);
            if (list.length) Platform.progress(100 * list.filter((g) => GameGloves.isUnlocked(g.id)).length / list.length);
        }
        for (const m of this._pre()) this._tick(m, gdt, realDt);
        const list = this.chars.slice();
        for (const c of list) c.step(gdt);
        Character.separate(list, gdt);
        for (const c of list) c.animate(gdt);
        // Порталы лобби: вход срабатывает один раз — когда игрок вошёл в радиус портала.
        const p = this.player;
        if (p && this.started && !this.transitioning) {
            const inZone = this.zone === 'lobby' && p.state !== 'dead' && p.state !== 'ragdoll' && p.h > -100;
            const portal = inZone ? GameWorld.portalAt(p.x, p.y) : null;
            if (portal !== this._portalIn) {
                this._portalIn = portal;
                if (portal) this.enterPortal(portal.mode);
            }
        }
        for (const m of this._post()) this._tick(m, gdt, realDt);
    },

    // update модуля: ошибка одного модуля не останавливает кадр (и не сыплет в консоль каждый кадр).
    _tick(m, gdt, realDt) {
        if (typeof m.update !== 'function') return;
        try { m.update(gdt, realDt); } catch (e) {
            const t = this.realTime;
            if (!m._errAt || t - m._errAt > 3) { m._errAt = t; console.error('Game: update модуля', e); }
        }
    },

    // --- Отладка (?debug) ------------------------------------------------------------------------

    _setupDebug() {
        const G = this;
        /** @type {Character[]} */
        const dummies = [];
        G.on('ko', (e) => {
            const v = e.victim;
            if (!v.isDummy) return;
            setTimeout(() => {
                if (v.disposed) return;
                const sp = G.spawnFor(v.zone === 'arena' ? 'arena' : v.zone) || { x: v.x, y: v.y, heading: 0 };
                v.respawn(sp.x + (Math.random() - 0.5) * 300, sp.y + (Math.random() - 0.5) * 300, sp.heading);
            }, 2000);
        });
        const randomLook = () => {
            const pal = [0xe8463c, 0x2f6fe0, 0x31b04a, 0xf3c623, 0x8b4fd8, 0xff8a2a, 0x222222, 0xf0f0f0, 0x6b3a20, 0x18a7b5];
            const r = () => pal[Math.floor(Math.random() * pal.length)];
            const skin = [0xe8b48c, 0xffd9b3, 0xc68642, 0x8d5524][Math.floor(Math.random() * 4)];
            const faces = Object.keys(Character.FACES);
            return { colors: { head: skin, torso: r(), leftArm: skin, rightArm: skin, leftLeg: r(), rightLeg: r() }, face: faces[Math.floor(Math.random() * faces.length)] };
        };
        this.debug = {
            // JSON-сводка состояния.
            state() {
                const p = G.player;
                return JSON.stringify({ started: G.started, zone: G.zone, mode: G.mode, time: +G.time.toFixed(2), timeScale: G.timeScale, fps: Math.round(G.fps),
                    player: p && { x: Math.round(p.x), y: Math.round(p.y), h: Math.round(p.h), state: p.state, aura: p.aura, glove: p.glove, heading: +p.heading.toFixed(2) },
                    chars: G.chars.length, alive: G.chars.filter(c => c.state !== 'dead').length,
                    camera: { mode: GameCamera.mode, az: Math.round(GameCamera.az * 180 / Math.PI), pitch: Math.round(GameCamera.pitch * 180 / Math.PI), dist: GameCamera.dist },
                    floors: GameWorld.floors.length, colliders: GameWorld.colliders.length, portals: GameWorld.portals.map(x => x.mode),
                    meshes: GameWorld.scene.meshes.length, save: G.save });
            },
            start() { G.start(true); return true; },
            goto(zone) { if (!G.started) G.start(true); return G.goto(zone, { instant: true }); },
            setAura(n) { const p = G.player; G.addAura(p, (n | 0) - p.aura, { raw: true }); return p.aura; },
            // Манекены вокруг игрока в его зоне (стоят, после падения появляются снова).
            spawnDummies(n, radius) {
                const p = G.player, R = radius || 420, cnt = n || 4;
                for (let i = 0; i < cnt; i++) {
                    let x = p.x, y = p.y;
                    for (let k = 0; k < 20; k++) {
                        const a = Math.random() * Math.PI * 2, r = 200 + Math.random() * R;
                        x = p.x + Math.cos(a) * r; y = p.y + Math.sin(a) * r;
                        if (GameWorld.floorAt(x, y, 120) !== null) break;
                    }
                    const c = new Character({ name: Lang.t('dummy') + ' ' + (dummies.length + 1), look: randomLook(), zone: p.zone, x, y,
                        heading: Math.atan2(p.y - y, p.x - x) });
                    c.isDummy = true;
                    c.aura = Math.floor(Math.random() * 300);
                    dummies.push(c);
                    G.addChar(c);
                }
                return G.chars.length;
            },
            spawnBots(n) {
                const gb = typeof GameBots !== 'undefined' ? /** @type {any} */ (GameBots) : null;
                if (gb && typeof gb.spawn === 'function') return gb.spawn(n);
                return this.spawnDummies(n);
            },
            // Ближайшая цель — к игроку, шлепок (гарантированный).
            slapNearest() {
                const p = G.player;
                let best = null, bd = Infinity;
                for (const c of G.chars) {
                    if (c === p || c.state === 'dead' || c.zone !== p.zone) continue;
                    const d = Math.hypot(c.x - p.x, c.y - p.y);
                    if (d < bd) { bd = d; best = c; }
                }
                if (!best) return false;
                if (bd > GameCombat.range(p) * 0.8) {
                    const a = Math.atan2(p.y - best.y, p.x - best.x);
                    best.teleport(p.x + Math.cos(p.heading) * 150, p.y + Math.sin(p.heading) * 150, null, a);
                }
                p.nextSlapAt = 0;
                best.shieldUntil = 0;
                return GameCombat.trySlap(p, best, { forced: true });
            },
            phonk() {
                const gp = typeof GamePhonk !== 'undefined' ? /** @type {any} */ (GamePhonk) : null;
                if (gp && typeof gp.trigger === 'function') return gp.trigger(G.player, null);
                const victim = GameCombat.nearestTarget(G.player, 3000);
                G.emit('phonk', { attacker: G.player, victim });
                setTimeout(() => G.emit('phonkEnd', { attacker: G.player, victim }), 2500);
                return true;
            },
            glove(id) {
                G.player.setGlove(id);
                G.save.glove = id;
                G.saveSoon();
                G.emit('glove', { char: G.player, glove: id });
                return id;
            },
            camera(az, pitch, dist) { GameCamera.set(az, pitch, dist); return true; },
            time(scale) { G.timeScale = scale == null ? 1 : scale; return G.timeScale; },
            // Подмена стика: joy(x, y) — вектор; joy() — снять.
            joy(x, y) { GameInput.forced = x == null ? null : { x, y }; return true; },
            tp(x, y, heading) { G.player.teleport(x, y, null, heading); GameCamera.snap(); return true; },
            knock(power) {
                const p = G.player;
                GameCombat.push(p, Math.cos(p.heading + Math.PI), Math.sin(p.heading + Math.PI), power || 700, {});
                return true;
            },
            mask(key) { G.player.setMask(key || null); return true; },
            // Ежедневный подарок: «перемотать» дату на days дней вперёд (накопительно); -> статус.
            dailyShift(days) {
                const gd = typeof GameDaily !== 'undefined' ? /** @type {any} */ (GameDaily) : null;
                return gd && typeof gd.debugShift === 'function' ? gd.debugShift(days) : null;
            },
            dummies,
        };
        console.log('Game.debug: state(), start(), goto(z), setAura(n), spawnDummies(n), spawnBots(n), slapNearest(), phonk(), glove(id), camera(az, pitch, dist), time(s), joy(x, y), tp(x, y), knock(p), mask(k)');
    },
};
