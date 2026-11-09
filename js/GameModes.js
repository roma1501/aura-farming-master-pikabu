// GameModes.js — режимы Aura Farming Master (DESIGN.md §7): лобби, «Фарм» (арена с зонами ауры,
// GameFarm), «Раш ×2» (хардкор), королевская битва, дуэль; итоги раунда, награды, реклама, музыка по зонам, население зон ботами.
//
// Вход в портал лобби — enterPortal(mode) (зовёт Game, вернуть true — свой переход):
// арена/хардкор — сразу телепорт; битва/дуэль — короткий «подбор игроков», потом телепорт.
// Сам режим начинается в onZone(zone, mode) (его зовёт Game.goto — так же работают
// Game.debug.goto и ?autostart).
//
// Арена/хардкор — бесконечно; падение игрока = конец «жизни»: Platform.ads.roundEnded(),
// карточка «Ты упал в бездну!» со статистикой жизни, кнопки «В бой!» / «В лобби» (через
// Platform.ads.next) и «Удвоить ауру за жизнь — за рекламу» (Platform.rewarded('double')).
// Королевская битва: игрок + 9 ботов, отсчёт 3-2-1, остров осыпается к центру (фигуры пола
// GameWorld.floors зоны royale и модель острова сжимаются, красное кольцо у края),
// последний на острове — победа (+50 ауры). Дуэль: до 2 побед против сильного бота (+15).
// roundEnded — один раз на падение на арене / на битву / на дуэль. Событие round
// { mode, result: 'win'|'lose', reward, place?, score?, life? }.
//
// API: current, enterPortal(mode) -> true, onPlayerKO(e) -> true (падение обработано
// режимом; зовёт GamePlayer), auraMult(ch) (зовёт Game.auraMultiplier), state().
// Debug (?debug): Game.debug.fall() — игрок за край, win() — соперников за край,
// modes() — JSON-сводка, portal(mode) — как вход в портал.
// Чужие модули — только через typeof: GameBots (populate/spawnBot/remove/clear/freeze),
// GameUI (modal/button/toast/setModeLabel), GameFX (play), без них режимы тоже работают.

const MODES_LOBBY_BOTS = 5;          // ботов в лобби
const MODES_ARENA_BOTS = 12;         // ботов на арене
const MODES_HARDCORE_BOTS = 12;      // ботов в хардкоре
const MODES_HARDCORE_SKILL = 0.82;   // умение ботов хардкора (0..1)
const MODES_SPAWN_SHIELD = 3;        // с защиты после появления на арене
const MODES_KO_CARD_DELAY = 0.9;     // с от падения до карточки итога
const MODES_RESULT_DELAY = 1.8;      // с от победы до карточки (празднование)
const MODES_COUNTDOWN = 3;           // с отсчёта перед раундом
const MODES_COUNT_LEAD = 0.55;       // с до первой цифры (после вспышки телепорта)
const MODES_ROYALE_BOTS = 9;         // соперников в королевской битве
const MODES_ROYALE_REWARD = 50;      // аура за победу в битве
const MODES_ROYALE_GRACE = 6;        // с после старта до начала осыпания
const MODES_ROYALE_SHRINK = 60;      // с осыпания до минимального радиуса
const MODES_ROYALE_MIN = 340;        // px — минимальный радиус острова
const MODES_ROYALE_HOLD = 15;        // с на минимальном радиусе
const MODES_ROYALE_FINAL = 12;       // с — финал: остров исчезает целиком
const MODES_ROYALE_BAND = 170;       // px — красная полоса у края
const MODES_DEBRIS = 18;             // обломков у края (пул)
const MODES_DUEL_REWARD = 15;        // аура за победу в дуэли
const MODES_DUEL_WINS = 2;           // побед до конца дуэли
const MODES_DUEL_SKILL = 0.85;       // умение соперника в дуэли
const MODES_DUEL_BETWEEN = 2.2;      // с между раундами дуэли
const MODES_MM_MIN = 1.1;            // с — подбор игроков, минимум
const MODES_MM_MAX = 2.4;            // с — подбор игроков, максимум

Object.assign(LANG_STRINGS.ru, {
    'gmArena': 'ФАРМ',
    'gmHardcore': 'РАШ ×2 ауры',
    'gmRoyale': 'КОРОЛЕВСКАЯ БИТВА',
    'gmDuel': 'ДУЭЛЬ',
    'gmLobby': 'Лобби',
    'gmLeft': 'Осталось: {n}',
    'gmYou': 'Ты',
    'gmGo': 'СТАРТ!',
    'gmRound': 'Раунд {n}',
    'gmFellTitle': 'Ты упал в бездну!',
    'gmKilledBy': 'Тебя сбросил: {name}',
    'gmTip1': 'Совет: стой в зоне — серия множит ауру!',
    'gmTip2': 'Совет: «Идеально» в зоне даёт двойной всплеск.',
    'gmTip3': 'Совет: трать ауру на прокачку фарма.',
    'gmSlaps': 'Шлепков',
    'gmKos': 'Выбито',
    'gmLifeAura': 'Аура за жизнь',
    'gmRoundAura': 'Аура за раунд',
    'gmTime': 'Время',
    'gmFight': 'В бой!',
    'gmToLobby': 'В лобби',
    'gmAgain': 'Ещё раз',
    'gmRematch': 'Реванш',
    'gmDouble': 'Удвоить ауру за жизнь (+{n}) — за рекламу',
    'gmDoubled': 'Аура удвоена: +{n}!',
    'gmShrink': 'Остров осыпается — держись ближе к центру!',
    'gmFinal': 'Финал! Остров исчезает!',
    'gmWin': 'ПОБЕДА!',
    'gmRoyaleWin': 'Ты — последний на острове!',
    'gmReward': '+{n} ауры',
    'gmOut': 'Ты выбыл!',
    'gmPlaceOf': 'из {n}',
    'gmDuelWin': 'ПОБЕДА В ДУЭЛИ!',
    'gmDuelLose': 'ПОРАЖЕНИЕ',
    'gmRoundWon': 'Раунд за тобой!',
    'gmRoundLost': 'Раунд за соперником',
    'gmFoe': 'Соперник: {name}',
    'gmSearch': 'Поиск игроков… {n}/{total}',
    'gmSearchDuel': 'Поиск соперника…',
    'gmFound': 'Соперник найден!',
    'gmAllFound': 'Все в сборе!',
    'gmCancel': 'Отмена',
});
Object.assign(LANG_STRINGS.en, {
    'gmArena': 'FARM',
    'gmHardcore': 'RUSH ×2 aura',
    'gmRoyale': 'BATTLE ROYALE',
    'gmDuel': 'DUEL',
    'gmLobby': 'Lobby',
    'gmLeft': 'Left: {n}',
    'gmYou': 'You',
    'gmGo': 'GO!',
    'gmRound': 'Round {n}',
    'gmFellTitle': 'You fell into the void!',
    'gmKilledBy': 'Knocked off by: {name}',
    'gmTip1': 'Tip: stay in the zone — the streak multiplies aura!',
    'gmTip2': 'Tip: a Perfect pose inside a zone pays double.',
    'gmTip3': 'Tip: spend aura on farm upgrades.',
    'gmSlaps': 'Slaps',
    'gmKos': 'Knockouts',
    'gmLifeAura': 'Aura this life',
    'gmRoundAura': 'Aura this round',
    'gmTime': 'Time',
    'gmFight': 'Fight!',
    'gmToLobby': 'To lobby',
    'gmAgain': 'Play again',
    'gmRematch': 'Rematch',
    'gmDouble': 'Double this life\'s aura (+{n}) — watch an ad',
    'gmDoubled': 'Aura doubled: +{n}!',
    'gmShrink': 'The island is crumbling — stay near the center!',
    'gmFinal': 'Final! The island is vanishing!',
    'gmWin': 'VICTORY!',
    'gmRoyaleWin': 'You are the last one standing!',
    'gmReward': '+{n} aura',
    'gmOut': 'You are out!',
    'gmPlaceOf': 'of {n}',
    'gmDuelWin': 'DUEL WON!',
    'gmDuelLose': 'DEFEAT',
    'gmRoundWon': 'Round won!',
    'gmRoundLost': 'Round lost',
    'gmFoe': 'Opponent: {name}',
    'gmSearch': 'Finding players… {n}/{total}',
    'gmSearchDuel': 'Finding an opponent…',
    'gmFound': 'Opponent found!',
    'gmAllFound': 'Everyone is here!',
    'gmCancel': 'Cancel',
});

/** @satisfies {Record<string, any>} */
const GameModes = {
    current: 'lobby',       // 'lobby' | 'arena' | 'hardcore' | 'royale' | 'duel'
    _homeBusy: false,       // кнопка «Лобби»: идёт реклама перед выходом
    /** @type {any} */
    round: null,            // раунд битвы/дуэли (см. _startRoyale / _startDuel)
    /** @type {{ slaps: number, kos: number, aura: number, t0: number } | null} */
    life: null,             // статистика текущей жизни (арена) или раунда (битва, дуэль)
    /** @type {any} */
    _card: null,            // открытая карточка итога (GameUI.modal)
    /** @type {any} */
    _mm: null,              // подбор игроков (окно перед битвой/дуэлью)
    /** @type {Array<{ at: number, fn: Function, keep: boolean }>} */
    _timers: [],
    _arenaPop: '',          // чем населена арена: 'arena' | 'hardcore' | ''
    /** @type {any} */
    _rematch: null,         // снимок соперника для «Реванша» в дуэли
    /** @type {any} */
    _koEvent: null,
    _koHandled: false,
    _ownLabel: true,        // метку режима рисует этот модуль (у GameUI нет setModeLabel)
    _dummyN: 0,
    /** @type {Record<string, HTMLElement>} */
    _el: {},
    /** @type {BABYLON.Mesh | null} */
    _ring: null,
    /** @type {Float32Array | null} */
    _ringPos: null,
    /** @type {Array<{ m: BABYLON.Mesh, t: number, life: number, x: number, y: number, h: number, vx: number, vy: number, vh: number, sx: number, sz: number }>} */
    _debris: [],

    // --- Жизненный цикл ----------------------------------------------------------------------

    init(game) {
        this._css();
        this._dom();
        Game.on('slap', (e) => { if (this.life && e.attacker === Game.player) this.life.slaps++; });
        Game.on('aura', (e) => { if (this.life && e.char === Game.player && e.delta > 0) this.life.aura += e.delta; });
        Game.on('ko', (e) => this._onKo(e));
        this.current = Game.mode || 'lobby';
        this._music();
        this._label();
        void game;
    },

    ready() {
        this._populate();
        this._debugApi();
    },

    update(dt, realDt) {
        if (this._timers.length) {
            const now = Game.realTime;
            const due = this._timers.filter(t => now >= t.at);
            if (due.length) {
                this._timers = this._timers.filter(t => now < t.at);
                for (const t of due) {
                    try { t.fn(); } catch (e) { console.error('GameModes: таймер', e); }
                }
            }
        }
        if (this._mm) this._mmStep(realDt);
        const r = this.round;
        if (r) {
            if (r.phase === 'count') this._countStep(r, realDt);
            if (r.mode === 'royale') this._royaleStep(r, dt);
            else if (r.mode === 'duel') this._duelStep(r);
        }
        if (this._debris.length) this._debrisStep(dt);
    },

    // Игрок перешёл в зону/режим (Game.goto): прежний раунд убран, новый — начат.
    onZone(zone, mode) {
        this.current = mode || zone;
        this._timers = this._timers.filter(t => t.keep);   // отложенные действия прежней зоны — отменены
        this._closeCard();
        this._closeMM();
        this._endRound();
        this.life = null;
        this._populate();
        this._music();
        this._label();
        this._resume();
        const p = Game.player;
        if (mode === 'arena' || mode === 'hardcore') {
            this._startLife();
            if (p) p.shieldUntil = Game.time + MODES_SPAWN_SHIELD;
        } else if (mode === 'royale') this._startRoyale();
        else if (mode === 'duel') this._startDuel();
    },

    // --- Порталы -----------------------------------------------------------------------------

    // Вход в портал лобби. true — переход делает модуль режимов.
    enterPortal(mode) {
        if (this._mm || this._card) return true;
        if (mode === 'royale' || mode === 'duel') this._matchmake(mode);
        else this._go(mode);
        return true;
    },

    // «Подбор игроков»: окно со счётчиком, затем телепорт. Отмена — остаться в лобби.
    _matchmake(mode) {
        const ui = this._ui();
        if (!ui || typeof ui.modal !== 'function') { this._go(mode); return; }
        const total = mode === 'duel' ? 2 : 1 + MODES_ROYALE_BOTS;
        const body = document.createElement('div');
        body.className = 'gm-mm';
        body.innerHTML = '<div class="gm-spin"></div><div class="gm-mmt"></div><div class="gm-dots"></div>';
        const dots = body.querySelector('.gm-dots');
        for (let i = 0; i < total; i++) {
            const d = document.createElement('span');
            d.className = 'gm-dot';
            dots.appendChild(d);
        }
        const mm = {
            mode, total, t: 0, doneAt: 0, body,
            found: mode === 'duel' ? 1 : 2 + Math.floor(Math.random() * 3),
            next: mode === 'duel' ? this._rand(MODES_MM_MIN, MODES_MM_MAX) : this._rand(0.2, 0.5),
            /** @type {any} */ m: null,
        };
        this._mm = mm;
        mm.m = ui.modal({
            title: Lang.t(mode === 'duel' ? 'gmDuel' : 'gmRoyale'), theme: mode === 'duel' ? 'blue' : 'gold', body, closeX: false,
            buttons: [{ text: Lang.t('gmCancel'), kind: 'gray' }],
            onClose: () => { if (this._mm === mm) this._mm = null; },
        });
        this._mmText();
    },

    _mmText() {
        const mm = this._mm;
        if (!mm) return;
        const t = /** @type {HTMLElement} */ (mm.body.querySelector('.gm-mmt'));
        if (mm.found >= mm.total) t.textContent = Lang.t(mm.mode === 'duel' ? 'gmFound' : 'gmAllFound');
        else t.textContent = mm.mode === 'duel' ? Lang.t('gmSearchDuel') : Lang.t('gmSearch', { n: mm.found, total: mm.total });
        const dots = mm.body.querySelectorAll('.gm-dot');
        for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('gm-in', i < mm.found);
    },

    _mmStep(realDt) {
        const mm = this._mm;
        mm.t += realDt;
        if (mm.found < mm.total && mm.t >= mm.next) {
            mm.found = Math.min(mm.total, mm.found + (Math.random() < 0.3 ? 2 : 1));
            mm.next = mm.t + this._rand(0.12, 0.42);
            this._mmText();
            if (mm.found >= mm.total) mm.doneAt = mm.t + 0.5;
        }
        if (mm.doneAt && mm.t >= mm.doneAt) {
            const mode = mm.mode;
            this._closeMM();
            this._go(mode);
        }
    },

    _closeMM() {
        const mm = this._mm;
        this._mm = null;
        if (mm && mm.m) mm.m.close();
    },

    // --- Падения, аура ---------------------------------------------------------------------------

    // Падение игрока (зовёт GamePlayer; на одно событие — один раз). true — режим сам
    // покажет итог и вернёт игрока; false — обычное появление (лобби).
    onPlayerKO(e) {
        if (this._koEvent === e) return this._koHandled;
        this._koEvent = e;
        this._koHandled = this._playerKO(e);
        return this._koHandled;
    },

    _playerKO(e) {
        const mode = this.current, r = this.round;
        if (mode === 'arena' || mode === 'hardcore') { this._lifeOver(e); return true; }
        if (mode === 'royale' && r && r.mode === 'royale') { this._royaleOut(e); return true; }
        if (mode === 'duel' && r && r.mode === 'duel') { if (r.phase === 'fight') this._duelPoint(false, e); return true; }
        return false;
    },

    _onKo(e) {
        const v = e.victim, p = Game.player;
        if (v === p) {
            // Запасной путь, если GamePlayer не передал падение (обычное появление — отменить).
            if (this._koEvent !== e && this.onPlayerKO(e) && typeof GamePlayer !== 'undefined') GamePlayer._respawnAt = 0;
            return;
        }
        if (this.life && e.killer === p) this.life.kos++;
        const r = this.round;
        if (!r || r.phase === 'done') return;
        if (r.mode === 'duel' && v === r.bot && r.phase === 'fight') this._duelPoint(true, e);
    },

    // Множитель ауры: хардкор ×2 (всем на арене хардкора), «×2 аура» из магазина — игроку.
    auraMult(ch) {
        if (!ch) return 1;
        let k = 1;
        if (this.current === 'hardcore' && ch.zone === 'arena') k *= 2;
        if (ch.isPlayer && Game.save && Game.save.boostUntil > Date.now()) k *= 2;
        return k;
    },

    _startLife() { this.life = { slaps: 0, kos: 0, aura: 0, t0: Game.realTime }; },

    _endLife() {
        const l = this.life;
        this.life = null;
        return l ? { slaps: l.slaps, kos: l.kos, aura: Math.round(l.aura), time: Game.realTime - l.t0 } : { slaps: 0, kos: 0, aura: 0, time: 0 };
    },

    // --- Арена / хардкор -------------------------------------------------------------------------

    _lifeOver(e) {
        if (this._card) return;
        const st = this._endLife();
        const mode = this.current;
        Platform.ads.roundEnded();
        Game.emit('round', { mode, result: 'lose', reward: 0, life: st });
        const killer = e && e.killer ? e.killer.name : null;
        this._after(MODES_KO_CARD_DELAY, () => this._fellCard(st, killer));
    },

    _fellCard(st, killer) {
        Sound.play('assets/sounds/lose_jingle.mp3', { volume: 0.8 });
        const ui = this._ui();
        const sub = killer ? Lang.t('gmKilledBy', { name: killer }) : Lang.t(['gmTip1', 'gmTip2', 'gmTip3'][Math.floor(Math.random() * 3)]);
        const body = document.createElement('div');
        body.className = 'gm-card';
        body.innerHTML = '<div class="gm-sub">' + this._esc(sub) + '</div>' + this._stats([
            ['assets/ui/icon_hand.png', Lang.t('gmSlaps'), st.slaps],
            ['assets/ui/icon_skull.png', Lang.t('gmKos'), st.kos],
            ['assets/ui/icon_aura.png', Lang.t('gmLifeAura'), '+' + st.aura],
            ['assets/ui/icon_timer.png', Lang.t('gmTime'), this._fmt(st.time)],
        ]);
        if (ui && st.aura > 0 && typeof ui.button === 'function') {
            let done = false;
            const btn = ui.button(Lang.t('gmDouble', { n: st.aura }), 'ad', async () => {
                if (done) return;
                btn.disabled = true;
                let ok = false;
                try { ok = (await Platform.rewarded('double')) === true; } catch (err) { ok = false; }
                if (ok && !done) {
                    done = true;
                    Game.addAura(Game.player, st.aura, { raw: true });
                    btn.textContent = Lang.t('gmDoubled', { n: st.aura });
                    Sound.play('assets/sounds/coin.mp3', { volume: 1 });
                } else if (!done) btn.disabled = false;
            });
            btn.classList.add('gm-adb');
            body.appendChild(btn);
        }
        this._openCard({
            title: Lang.t('gmFellTitle'), theme: 'red', body,
            buttons: [
                { text: Lang.t('gmFight'), kind: 'green', onClick: () => this._next(() => this._respawnArena()) },
                { text: Lang.t('gmToLobby'), kind: 'blue', onClick: () => this._next(() => this._go('lobby')) },
            ],
        }, () => this._respawnArena());
    },

    // Снова на арену (вспышка, точка подальше от ботов, защита).
    _respawnArena() {
        if (Game.transitioning) { this._after(0.15, () => this._respawnArena()); return; }
        Game.transition(() => {
            Game.respawnPlayer(this._safeSpawn('arena-spawn'));
            if (Game.player) Game.player.shieldUntil = Game.time + MODES_SPAWN_SHIELD;
            this._startLife();
            this._resume();
        });
    },

    // Маркер появления, самый далёкий от других живых персонажей зоны игрока.
    _safeSpawn(name) {
        const n = GameWorld.markers(name).length;
        let best = null, bd = -1;
        for (let i = 0; i < n; i++) {
            const sp = GameWorld.spawnPoint(name, i);
            let d = Infinity;
            for (const c of Game.chars) {
                if (c === Game.player || c.state === 'dead' || c.zone !== Game.zone) continue;
                d = Math.min(d, Math.hypot(c.x - sp.x, c.y - sp.y));
            }
            d *= 0.75 + Math.random() * 0.5;   // не всегда одна и та же точка
            if (d > bd) { bd = d; best = sp; }
        }
        return best || Game.spawnFor(this.current);
    },

    // --- Королевская битва ------------------------------------------------------------------------

    _startRoyale() {
        const z = GameWorld.zones.royale;
        if (!z) return;
        const p = Game.player;
        const r = this.round = {
            mode: 'royale', phase: 'count', delay: MODES_COUNT_LEAD, cd: MODES_COUNTDOWN, cdShown: 0,
            t: 0, k: 1, left: -1, warned: 0, debT: 0, cx: z.x, cy: z.y, R0: z.r, zr0: z.r,
            /** @type {Character[]} */ bots: [],
            shapes: GameWorld.floors.filter(f => f.zone === 'royale').map(f => ({ f, x: f.x, y: f.y, r: f.r, hx: f.hx, hy: f.hy, round: f.round })),
            islands: this._islandRecs('royale', z),
        };
        // Точки соперников — маркеры royale-spawn, кроме ближайшего к игроку.
        const n = GameWorld.markers('royale-spawn').length;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(GameWorld.spawnPoint('royale-spawn', i));
        pts.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        pts.shift();
        const skills = this._shuffle([0.2, 0.3, 0.4, 0.5, 0.55, 0.62, 0.7, 0.8, 0.9]);
        for (let i = 0; i < MODES_ROYALE_BOTS; i++) {
            let sp = pts[i];
            if (!sp) {
                const a = Math.atan2(p.y - r.cy, p.x - r.cx) + (i + 1) / (MODES_ROYALE_BOTS + 1) * Math.PI * 2;
                sp = { x: r.cx + Math.cos(a) * r.R0 * 0.6, y: r.cy + Math.sin(a) * r.R0 * 0.6, h: 0, heading: 0 };
            }
            const heading = Math.atan2(r.cy - sp.y, r.cx - sp.x);
            const b = this._spawnOpp('royale', { x: sp.x, y: sp.y, heading, skill: skills[i % skills.length], respawn: false });
            if (b) r.bots.push(b);
        }
        this._startLife();
        this._freeze('royale', true);
        this._ringShow(r.cx, r.cy, r.R0);
        this._royaleInfo(r);
    },

    // Модели острова зоны (для сжатия по x/z): объекты 'island*' у центра зоны.
    _islandRecs(zone, z) {
        const out = [];
        for (const rec of GameWorld.objectsOf('island')) {
            if (!rec.mesh || Math.hypot((+rec.def.x || 0) - z.x, (+rec.def.y || 0) - z.y) > z.r * 0.5) continue;
            const m = rec.mesh;
            const nodes = m.getChildMeshes(false);
            nodes.push(m);
            for (const node of nodes) if (node.isWorldMatrixFrozen) node.unfreezeWorldMatrix();
            out.push({ m, sx: m.scaling.x, sz: m.scaling.z, px: m.position.x, pz: m.position.z });
        }
        void zone;
        return out;
    },

    // Доля исходного радиуса острова к моменту t боя.
    _royaleK(r) {
        const G = MODES_ROYALE_GRACE, S = MODES_ROYALE_SHRINK, H = MODES_ROYALE_HOLD, F = MODES_ROYALE_FINAL, t = r.t;
        const kmin = Math.min(1, MODES_ROYALE_MIN / Math.max(1, r.R0));
        if (t < G) return 1;
        if (t < G + S) { const u = (t - G) / S; return 1 + (kmin - 1) * (u * (2 - u) * 0.35 + u * 0.65); }
        if (t < G + S + H) return kmin;
        return Math.max(0, kmin * (1 - (t - G - S - H) / F));
    },

    // Сжать остров: фигуры пола (к центру зоны), запись зоны, модель острова, кольцо.
    _shrinkTo(r, k) {
        r.k = k;
        const cx = r.cx, cy = r.cy;
        const gone = k < 0.004;   // остров исчез: пола нет совсем (r < 0 — ни одна точка не внутри)
        for (const s of r.shapes) {
            const f = s.f;
            f.x = cx + (s.x - cx) * k; f.y = cy + (s.y - cy) * k;
            f.r = gone ? -1 : Math.max(1, s.r * k);
            if (f.kind === 'box') {
                f.hx = gone ? 0 : Math.max(1, s.hx * k); f.hy = gone ? 0 : Math.max(1, s.hy * k);
                f.round = gone ? -1 : Math.min(GameWorld.FLOOR_ROUND, f.hx, f.hy);
            }
        }
        const z = GameWorld.zones.royale;
        if (z) z.r = Math.max(1, r.zr0 * k);
        for (const it of r.islands) {
            it.m.scaling.x = it.sx * Math.max(0.001, k);
            it.m.scaling.z = it.sz * Math.max(0.001, k);
            it.m.position.x = cx + (it.px - cx) * k;
            it.m.position.z = cy + (it.pz - cy) * k;
            it.m.setEnabled(k > 0.01);
        }
        this._ringShow(cx, cy, r.R0 * k);
    },

    _restoreRoyale(r) {
        r.t = 0;
        this._shrinkTo(r, 1);
        for (const s of r.shapes) { s.f.x = s.x; s.f.y = s.y; s.f.r = s.r; s.f.hx = s.hx; s.f.hy = s.hy; s.f.round = s.round; }
        const z = GameWorld.zones.royale;
        if (z) z.r = r.zr0;
        for (const it of r.islands) { it.m.scaling.x = it.sx; it.m.scaling.z = it.sz; it.m.position.x = it.px; it.m.position.z = it.pz; it.m.setEnabled(true); }
        if (this._ring) this._ring.setEnabled(false);
        for (const d of this._debris) { d.life = 0; d.m.setEnabled(false); }
    },

    _royaleStep(r, dt) {
        if (this._ring && this._ring.isEnabled()) this._ring.visibility = 0.72 + 0.28 * Math.sin(Game.realTime * 6.5);
        if (r.phase === 'fight') {
            r.t += dt;
            const k = this._royaleK(r);
            if (k < r.k - 1e-5) {
                this._shrinkTo(r, k);
                r.debT -= dt;
                if (r.debT <= 0 && k > 0.01) {
                    r.debT = GameWorld.quality === 'low' ? 0.22 : 0.09;
                    this._debrisSpawn(r.cx, r.cy, r.R0 * k);
                }
            }
            if (!r.warned && r.t >= MODES_ROYALE_GRACE) {
                r.warned = 1;
                this._toast(Lang.t('gmShrink'), 2.8);
                GameCamera.shake(0.18, 0.7);
            } else if (r.warned === 1 && r.t >= MODES_ROYALE_GRACE + MODES_ROYALE_SHRINK + MODES_ROYALE_HOLD) {
                r.warned = 2;
                this._toast(Lang.t('gmFinal'), 2.8);
                GameCamera.shake(0.25, 0.9);
            }
        }
        this._royaleInfo(r);
        // Победа — соперников не осталось, а игрок стоит на острове (летит в бездну — решит его падение).
        const p = Game.player;
        if (r.phase === 'fight' && p.state !== 'dead' && p.state !== 'falling' && !this._aliveBots(r).length) this._royaleWin(r);
    },

    _royaleInfo(r) {
        const left = this._aliveBots(r).length + (Game.player.state !== 'dead' ? 1 : 0);
        if (left === r.left) return;
        r.left = left;
        this._info('assets/ui/icon_crown.png', Lang.t('gmLeft', { n: left }), left <= 3);
    },

    _aliveBots(r) {
        return r.bots.filter(b => !b.disposed && b.state !== 'dead');
    },

    _royaleWin(r) {
        r.phase = 'done';
        const st = this._endLife();
        this._roundOver('royale', 'win', MODES_ROYALE_REWARD, { place: 1 });
        this._celebrate();
        this._after(MODES_RESULT_DELAY, () => this._royaleCard(true, 1, r.bots.length + 1, st, null));
    },

    _royaleOut(e) {
        const r = this.round;
        if (r.phase === 'done') return;
        // Все соперники упали раньше — игрок продержался дольше всех: победа.
        if (r.phase === 'fight' && !this._aliveBots(r).length) { this._royaleWin(r); return; }
        r.phase = 'done';
        const place = 1 + this._aliveBots(r).length;
        const st = this._endLife();
        this._roundOver('royale', 'lose', 0, { place });
        const killer = e && e.killer ? e.killer.name : null;
        this._after(MODES_KO_CARD_DELAY, () => {
            Sound.play('assets/sounds/lose_jingle.mp3', { volume: 0.8 });
            this._royaleCard(false, place, r.bots.length + 1, st, killer);
        });
    },

    _royaleCard(win, place, total, st, killer) {
        const body = document.createElement('div');
        body.className = 'gm-card';
        let html = '';
        if (win) {
            html += '<img class="gm-crown" src="assets/ui/icon_crown.png" alt="">' +
                '<div class="gm-sub">' + this._esc(Lang.t('gmRoyaleWin')) + '</div>' +
                '<div class="gm-rew"><img src="assets/ui/icon_aura.png" alt="">' + this._esc(Lang.t('gmReward', { n: MODES_ROYALE_REWARD })) + '</div>';
        } else {
            html += '<div class="gm-place">#' + place + '<small>' + this._esc(Lang.t('gmPlaceOf', { n: total })) + '</small></div>';
            if (killer) html += '<div class="gm-sub">' + this._esc(Lang.t('gmKilledBy', { name: killer })) + '</div>';
        }
        html += this._stats([
            ['assets/ui/icon_hand.png', Lang.t('gmSlaps'), st.slaps],
            ['assets/ui/icon_skull.png', Lang.t('gmKos'), st.kos],
            ['assets/ui/icon_aura.png', Lang.t('gmRoundAura'), '+' + (st.aura + (win ? MODES_ROYALE_REWARD : 0))],
            ['assets/ui/icon_timer.png', Lang.t('gmTime'), this._fmt(st.time)],
        ]);
        body.innerHTML = html;
        this._openCard({
            title: Lang.t(win ? 'gmWin' : 'gmOut'), theme: win ? 'gold' : 'red', body,
            buttons: [
                { text: Lang.t('gmAgain'), kind: 'green', onClick: () => this._next(() => this._go('royale')) },
                { text: Lang.t('gmToLobby'), kind: 'blue', onClick: () => this._next(() => this._go('lobby')) },
            ],
        }, () => this._go('lobby'));
    },

    // --- Дуэль ----------------------------------------------------------------------------------

    _startDuel() {
        const a = Game.spawnFor('duel', 0);
        const z = GameWorld.zones.duel;
        if (!a || !z) return;
        let b = GameWorld.spawnPoint('duel-b', 0);
        if (!b) b = { x: 2 * z.x - a.x, y: 2 * z.y - a.y, h: 0, heading: a.heading + Math.PI };
        const r = this.round = { mode: 'duel', phase: 'count', delay: MODES_COUNT_LEAD, cd: MODES_COUNTDOWN, cdShown: 0,
            n: 1, me: 0, foe: 0, a, b, /** @type {Character | null} */ bot: null, snap: this._rematch };
        this._rematch = null;
        this._duelBot(r);
        this._startLife();
        this._duelRound(true);
    },

    // Соперник дуэли: тот же (снимок имени/вида), если прежнего убрали.
    _duelBot(r) {
        const s = r.snap;
        const bot = this._spawnOpp('duel', { x: r.b.x, y: r.b.y, heading: r.b.heading, skill: MODES_DUEL_SKILL, respawn: false, name: s ? s.name : undefined });
        if (bot && s) {
            bot.name = s.name;
            if (s.look) bot.setAppearance(s.look);
            bot.avatar = s.avatar;
            bot.aura = s.aura;
            if (s.glove) bot.setGlove(s.glove);
            const ui = this._ui();
            if (ui && typeof ui.refreshBadge === 'function') ui.refreshBadge(bot);
        }
        r.bot = bot;
        if (bot) r.snap = { name: bot.name, look: bot.look, avatar: bot.avatar, aura: bot.aura, glove: bot.glove };
    },

    // Начало раунда дуэли: оба на свои точки, отсчёт.
    _duelRound(first) {
        const r = this.round, p = Game.player;
        if (!first || p.state === 'dead') Game.respawnPlayer(r.a);
        const bot = r.bot;
        if (!bot || bot.disposed) this._duelBot(r);
        else bot.respawn(r.b.x, r.b.y, r.b.heading);
        r.phase = 'count';
        r.delay = first ? MODES_COUNT_LEAD : 0.9;
        r.cd = MODES_COUNTDOWN;
        r.cdShown = 0;
        this._freeze('duel', true);
        this._duelInfo();
        if (!first) this._big(Lang.t('gmRound', { n: r.n }), 'gm-small', 1.1);
    },

    // Соперника убрали не падением (модуль ботов) — тот же соперник снова на точке, отсчёт заново.
    _duelStep(r) {
        if (r.phase !== 'fight' && r.phase !== 'count') return;
        const b = r.bot;
        if (!b || b.disposed) {
            this._duelBot(r);
            if (r.phase === 'fight') {
                Game.respawnPlayer(r.a);
                r.phase = 'count';
                r.delay = 0.4;
                r.cd = MODES_COUNTDOWN;
                r.cdShown = 0;
                this._freeze('duel', true);
            } else if (r.bot) this._freeze('duel', true);
            return;
        }
        if (b.state === 'dead') { if (r.phase === 'fight') this._duelPoint(true, null); return; }
        if (r.snap) r.snap.aura = b.aura;
    },

    _duelInfo() {
        const r = this.round;
        if (!r || r.mode !== 'duel') return;
        const name = r.snap ? r.snap.name : '?';
        this._info('assets/ui/icon_trophy.png', Lang.t('gmYou') + '  ' + r.me + ' : ' + r.foe + '  ' + name, false);
    },

    // Очко в дуэли (playerWon — соперник упал). Конец дуэли — карточка итога.
    _duelPoint(playerWon, e) {
        const r = this.round;
        if (!r || r.mode !== 'duel' || r.phase !== 'fight') return;
        if (playerWon) r.me++; else r.foe++;
        this._duelInfo();
        if (r.me >= MODES_DUEL_WINS || r.foe >= MODES_DUEL_WINS) {
            r.phase = 'done';
            const win = r.me >= MODES_DUEL_WINS;
            const st = this._endLife();
            this._roundOver('duel', win ? 'win' : 'lose', win ? MODES_DUEL_REWARD : 0, { score: [r.me, r.foe] });
            if (win) this._celebrate();
            this._after(win ? MODES_RESULT_DELAY : MODES_KO_CARD_DELAY, () => {
                if (!win) Sound.play('assets/sounds/lose_jingle.mp3', { volume: 0.8 });
                this._duelCard(win, r, st);
            });
            return;
        }
        r.phase = 'between';
        this._big(Lang.t(playerWon ? 'gmRoundWon' : 'gmRoundLost'), playerWon ? 'gm-small gm-go' : 'gm-small gm-red', 1.6);
        Sound.play(playerWon ? 'assets/sounds/coin.mp3' : 'assets/sounds/record_scratch.mp3', { volume: 0.9 });
        void e;
        const nextRound = () => {
            if (this.round !== r) return;
            if (Game.transitioning) { this._after(0.15, nextRound); return; }
            r.n++;
            Game.transition(() => { if (this.round === r) this._duelRound(false); });
        };
        this._after(MODES_DUEL_BETWEEN, nextRound);
    },

    _duelCard(win, r, st) {
        const body = document.createElement('div');
        body.className = 'gm-card';
        const name = r.snap ? r.snap.name : '?';
        let html = '<div class="gm-score">' + r.me + ' : ' + r.foe + '</div>' +
            '<div class="gm-sub">' + this._esc(Lang.t('gmFoe', { name })) + '</div>';
        if (win) html += '<div class="gm-rew"><img src="assets/ui/icon_aura.png" alt="">' + this._esc(Lang.t('gmReward', { n: MODES_DUEL_REWARD })) + '</div>';
        html += this._stats([
            ['assets/ui/icon_hand.png', Lang.t('gmSlaps'), st.slaps],
            ['assets/ui/icon_timer.png', Lang.t('gmTime'), this._fmt(st.time)],
        ]);
        body.innerHTML = html;
        const snap = r.snap;
        this._openCard({
            title: Lang.t(win ? 'gmDuelWin' : 'gmDuelLose'), theme: win ? 'gold' : 'red', body,
            buttons: [
                { text: Lang.t(win ? 'gmAgain' : 'gmRematch'), kind: 'green', onClick: () => this._next(() => {
                    this._rematch = win ? null : snap;   // реванш — тот же соперник (_startDuel)
                    this._go('duel');
                }) },
                { text: Lang.t('gmToLobby'), kind: 'blue', onClick: () => this._next(() => this._go('lobby')) },
            ],
        }, () => this._go('lobby'));
    },

    // --- Общее для раундов ------------------------------------------------------------------------

    // Отсчёт 3-2-1 (реальное время): по окончании — «СТАРТ!», все размораживаются.
    _countStep(r, realDt) {
        if (r.delay > 0) { r.delay -= realDt; return; }
        r.cd -= realDt;
        if (r.cd <= 0) {
            r.phase = 'fight';
            this._freeze(r.mode, false);
            this._big(Lang.t('gmGo'), 'gm-go', 0.9);
            Sound.play('assets/sounds/countdown_beep.mp3', { volume: 1, rate: 1.5 });
            return;
        }
        const n = Math.ceil(r.cd);
        if (n !== r.cdShown) {
            r.cdShown = n;
            this._big(String(n), '', 0.95);
            Sound.play('assets/sounds/countdown_beep.mp3', { volume: 1 });
        }
    },

    // Заморозка зоны на отсчёт: игрок и боты стоят, шлепки и способности в зоне выключены.
    _freeze(zone, on) {
        if (typeof GamePlayer !== 'undefined') GamePlayer.frozen = !!on;
        const gb = this._bots();
        if (gb && typeof gb.freeze === 'function') {
            try { gb.freeze(zone, !!on); } catch (e) { console.error('GameBots.freeze:', e); }
        }
        const rule = Game.ZONE_RULES[zone];
        if (rule) rule.pvp = !on;
        if (on) for (const c of Game.chars) if (c.zone === zone && !c.isPlayer) c.setMove(0, 0);
    },

    // Итог раунда: реклама (счётчик), награда, статистика, событие round.
    _roundOver(mode, result, reward, extra) {
        Platform.ads.roundEnded();
        if (reward) Game.addAura(Game.player, reward, { raw: true });
        const s = Game.save.stats;
        if (result === 'win' && mode === 'royale') s.royaleWins = (s.royaleWins || 0) + 1;
        if (result === 'win' && mode === 'duel') s.duelWins = (s.duelWins || 0) + 1;
        Game.saveSoon();
        Game.emit('round', Object.assign({ mode, result, reward }, extra || {}));
    },

    // Победа: джингл, конфетти, радость, наезд камеры.
    _celebrate() {
        const p = Game.player;
        Sound.play('assets/sounds/win_jingle.mp3', { volume: 1 });
        this._big(Lang.t('gmWin'), 'gm-gold', MODES_RESULT_DELAY);
        const zc = GameWorld.zoneCenter(Game.zone);
        const onIsland = p.state !== 'dead' && p.state !== 'falling';
        this._fx('confetti', onIsland || !zc ? { x: p.x, y: p.y, h: Math.max(0, p.h) + 180 } : { x: zc.x, y: zc.y, h: 180 }, { force: true });
        if (onIsland) {
            p.emote('cheer', 3);
            GameCamera.focus([p], MODES_RESULT_DELAY + 0.4);
        }
    },

    // Убрать раунд битвы/дуэли: соперники, остров, заморозка, HUD.
    _endRound() {
        const r = this.round;
        if (!r) return;
        this.round = null;
        this._freeze(r.mode, false);
        const gb = this._bots();
        const list = (r.mode === 'royale' ? r.bots : [r.bot]).filter(Boolean);
        let cleared = false;
        if (gb && typeof gb.clear === 'function') {
            try { gb.clear(r.mode); cleared = true; } catch (e) { console.error('GameBots.clear:', e); }
        }
        for (const b of list) if (!cleared || this._own.has(b)) this._removeChar(b);
        // Кого модуль ботов не убрал (или убирает с задержкой) — убрать позже.
        if (cleared) {
            this._after(1.2, () => {
                const cur = this.round;
                for (const b of list) {
                    if (b.disposed || Game.chars.indexOf(b) < 0) continue;
                    if (cur && (cur.bot === b || (cur.bots && cur.bots.indexOf(b) >= 0))) continue;
                    this._removeChar(b);
                }
            }, true);
        }
        if (r.mode === 'royale') this._restoreRoyale(r);
        this._info(null);
    },

    // --- Население зон (GameBots) -----------------------------------------------------------------

    // Лобби — всегда MODES_LOBBY_BOTS; арена — ботами своего режима, пока игрок там (ушёл — очищена).
    _populate() {
        const gb = this._bots();
        if (!gb) return;
        const want = this.current === 'arena' || this.current === 'hardcore' ? this.current : '';
        try {
            if (this._arenaPop && this._arenaPop !== want) {
                if (typeof gb.populate === 'function') gb.populate('arena', 0);
                if (typeof gb.clear === 'function') gb.clear('arena');
                this._arenaPop = '';
            }
            if (typeof gb.populate === 'function') {
                if (want && this._arenaPop !== want) {
                    if (want === 'hardcore') gb.populate('arena', MODES_HARDCORE_BOTS, { hardcore: true, skill: MODES_HARDCORE_SKILL });
                    else gb.populate('arena', MODES_ARENA_BOTS);
                    this._arenaPop = want;
                }
                gb.populate('lobby', MODES_LOBBY_BOTS);
            }
        } catch (e) { console.error('GameModes: население', e); }
    },

    // Соперник раунда: бот GameBots, без модуля — простой персонаж (стоит, его можно сбить).
    _spawnOpp(zone, o) {
        const gb = this._bots();
        let b = null;
        if (gb && typeof gb.spawnBot === 'function') {
            try { b = gb.spawnBot(zone, o); } catch (e) { console.error('GameBots.spawnBot:', e); }
        }
        if (b) return b;
        const pal = [0xe8463c, 0x2f6fe0, 0x31b04a, 0xf3c623, 0x8b4fd8, 0xff8a2a, 0x222222, 0xf0f0f0, 0x18a7b5];
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        const skin = pick([0xe8b48c, 0xffd9b3, 0xc68642, 0x8d5524]);
        const look = { colors: { head: skin, torso: pick(pal), leftArm: skin, rightArm: skin, leftLeg: pick(pal), rightLeg: pick(pal) },
            face: pick(Object.keys(Character.FACES)) };
        const c = new Character({ name: o.name || (Lang.t('dummy') + ' ' + (++this._dummyN)), isBot: true, zone, x: o.x, y: o.y, heading: o.heading, look });
        c.aura = Math.floor(Math.random() * 250);
        this._own.add(c);
        Game.addChar(c);
        return c;
    },

    // Убрать соперника: бота — через GameBots.remove, своего запасного — Game.removeChar.
    _removeChar(c) {
        if (!c || c.disposed) return;
        const gb = this._bots();
        if (!this._own.has(c) && gb && typeof gb.remove === 'function') {
            try { gb.remove(c); return; } catch (e) { console.error('GameBots.remove:', e); }
        }
        if (Game.chars.indexOf(c) >= 0) Game.removeChar(c); else c.dispose();
    },
    /** @type {WeakSet<Character>} */
    _own: new WeakSet(),

    // --- Музыка, метки, переходы -----------------------------------------------------------------

    // Лобби — music-lobby-neon, остальные режимы — music-farm. Прежний трек выгружается (память).
    _music() {
        const url = this.current === 'lobby' ? 'assets/sounds/music-lobby-neon.ogg' : 'assets/sounds/music-farm.ogg';
        const prev = Game._music ? Game._music.url : null;
        if (prev === url) return;
        Game.music(url, { fade: 1 });
        if (prev) Sound.buffers.delete(prev);
    },

    _label() {
        const key = { arena: 'gmArena', hardcore: 'gmHardcore', royale: 'gmRoyale', duel: 'gmDuel' }[this.current];
        const text = key ? Lang.t(key) : null;
        const ui = this._ui();
        const el = this._el;
        this._ownLabel = !(ui && typeof ui.setModeLabel === 'function');
        if (!this._ownLabel) {
            const color = {
                arena: 'linear-gradient(#4fd15a,#26a332)', hardcore: 'linear-gradient(#ff5a5a,#c92f2f)',
                royale: 'linear-gradient(#ffc93d,#e0901a)', duel: 'linear-gradient(#4dc8f0,#2f8fb8)',
            }[this.current];
            try { ui.setModeLabel(text, color); } catch (e) { console.error('GameUI.setModeLabel:', e); }
        }
        if (el.mode) {
            el.mode.textContent = text || '';
            el.mode.className = 'gm-pill' + (this._ownLabel && text ? ' gm-on gm-m-' + this.current : '');
        }
        if (el.top) el.top.classList.toggle('gm-low', !this._ownLabel);
        if (el.home) el.home.classList.toggle('gm-on', this.current === 'arena' || this.current === 'hardcore');
    },

    // Строка раунда под меткой режима: icon — путь-литерал картинки, null — скрыть.
    _info(icon, text, warn) {
        const el = this._el.info;
        if (!el) return;
        if (icon === null && text === undefined) { el.className = 'gm-pill'; el.textContent = ''; return; }
        el.textContent = '';
        if (icon) {
            const img = document.createElement('img');
            img.src = icon;
            img.alt = '';
            el.appendChild(img);
        }
        const s = document.createElement('span');
        s.textContent = text || '';
        el.appendChild(s);
        el.className = 'gm-pill gm-on' + (warn ? ' gm-warn' : '');
    },

    // Крупная надпись по центру (отсчёт, «СТАРТ!», «ПОБЕДА!»): cls — 'gm-go' | 'gm-gold' | 'gm-red' | 'gm-small'.
    _big(text, cls, seconds) {
        const el = this._el.big;
        if (!el) return;
        el.textContent = text;
        el.className = '';
        void el.offsetWidth;
        el.style.setProperty('--d', (seconds || 1).toFixed(2) + 's');
        el.className = 'gm-play' + (cls ? ' ' + cls : '');
    },

    // Переход по кнопке итога — через счётчик рекламы.
    _next(go) {
        Platform.ads.next(() => {
            try { go(); } catch (e) { console.error('GameModes: переход', e); }
        });
    },

    // Телепорт в режим (повтор, если идёт другой телепорт).
    _go(target) {
        if (!Game.goto(target)) this._after(0.15, () => this._go(target));
    },

    // Снова в игре: платформе — игровой процесс, джойстик виден.
    _resume() {
        if (!Game.started) return;
        Platform.gameplay(true);
        GameInput.setVisible(true);
    },

    // Карточка итога: игра для платформы стоит, джойстик спрятан. fallback — без GameUI.modal.
    _openCard(opts, fallback) {
        this._closeCard();
        Platform.gameplay(false);
        GameInput.setVisible(false);
        if (this._el.home) this._el.home.classList.remove('gm-on');
        const ui = this._ui();
        if (!ui || typeof ui.modal !== 'function') { this._after(2, fallback); return; }
        // banner: экран итога — единственное место баннера площадки (CrazyGames), не во время игры.
        const m = ui.modal(Object.assign({ closeX: false, banner: true }, opts, { onClose: () => { if (this._card === m) this._card = null; } }));
        this._card = m;
    },

    _closeCard() {
        const c = this._card;
        this._card = null;
        if (c) c.close();
    },

    // fn через seconds (время игры без пауз); keep — не отменять при смене зоны.
    _after(seconds, fn, keep) { this._timers.push({ at: Game.realTime + seconds, fn, keep: !!keep }); },

    // --- Красное кольцо и обломки (королевская битва) ----------------------------------------------

    _ringShow(cx, cy, R) {
        const scene = GameWorld.scene;
        if (!scene) return;
        const N = 96;
        if (!this._ring) {
            const pos = this._ringPos = new Float32Array(3 * (N + 1) * 3);
            const col = [], idx = [];
            const alpha = [0, 0.4, 0.95];
            for (let k = 0; k < 3; k++) {
                for (let i = 0; i <= N; i++) col.push(1, k === 2 ? 0.32 : 0.12, k === 2 ? 0.22 : 0.08, alpha[k]);
            }
            for (let k = 0; k < 2; k++) {
                for (let i = 0; i < N; i++) {
                    const a = k * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
                    idx.push(a, c, b, b, c, d);
                }
            }
            const mesh = new BABYLON.Mesh('gmRing', scene);
            const vd = new BABYLON.VertexData();
            vd.positions = Array.from(pos);
            vd.indices = idx;
            vd.colors = col;
            vd.applyToMesh(mesh, true);
            mesh.hasVertexAlpha = true;
            const mat = new BABYLON.StandardMaterial('gmRingMat', scene);
            mat.disableLighting = true;
            mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
            mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.backFaceCulling = false;
            mat.metadata = { toon: false };
            mesh.material = mat;
            mesh.isPickable = false;
            mesh.receiveShadows = false;
            mesh.alwaysSelectAsActiveMesh = true;
            this._ring = mesh;
        }
        const pos = this._ringPos;
        const band = Math.min(MODES_ROYALE_BAND, R * 0.45);
        const radii = [Math.max(0, R - band), Math.max(0, R - Math.min(28, band * 0.3)), R + 6];
        for (let k = 0; k < 3; k++) {
            for (let i = 0; i <= N; i++) {
                const a = i / N * Math.PI * 2, j = (k * (N + 1) + i) * 3;
                pos[j] = cx + Math.cos(a) * radii[k];
                pos[j + 1] = 4;
                pos[j + 2] = cy + Math.sin(a) * radii[k];
            }
        }
        this._ring.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
        this._ring.setEnabled(R > 8);
    },

    // Обломок у края: камень/дёрн отрывается и падает в бездну.
    _debrisSpawn(cx, cy, R) {
        const scene = GameWorld.scene;
        if (!scene) return;
        if (!this._debris.length) {
            const mk = (name, color) => {
                const mat = new BABYLON.StandardMaterial(name, scene);
                mat.diffuseColor = World3D.hexColor3(color);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.emissiveColor = World3D.hexColor3(color).scale(0.25);
                return mat;
            };
            const rock = mk('gmDebrisRock', 0x7d6248), grass = mk('gmDebrisGrass', 0x5fb83f);
            for (let i = 0; i < MODES_DEBRIS; i++) {
                const m = BABYLON.MeshBuilder.CreateBox('gmDebris' + i, { size: 1 }, scene);
                m.material = i % 3 === 0 ? grass : rock;
                m.isPickable = false;
                m.receiveShadows = false;
                m.setEnabled(false);
                this._debris.push({ m, t: 0, life: 0, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, sx: 0, sz: 0 });
            }
        }
        const d = this._debris.find(it => it.t >= it.life);
        if (!d) return;
        const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const size = 36 + Math.random() * 70;
        d.x = cx + c * (R + 12); d.y = cy + s * (R + 12); d.h = -size * 0.4;
        const out = 40 + Math.random() * 120;
        d.vx = c * out; d.vy = s * out; d.vh = 60 + Math.random() * 160;
        d.sx = (Math.random() - 0.5) * 6; d.sz = (Math.random() - 0.5) * 6;
        d.t = 0; d.life = 2.4;
        d.m.scaling.set(size, size * (0.5 + Math.random() * 0.4), size * (0.7 + Math.random() * 0.5));
        d.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        d.m.position.set(d.x, d.h, d.y);
        d.m.setEnabled(true);
    },

    _debrisStep(dt) {
        for (const d of this._debris) {
            if (d.t >= d.life) continue;
            d.t += dt;
            d.vh -= 1900 * dt;
            d.x += d.vx * dt; d.y += d.vy * dt; d.h += d.vh * dt;
            d.m.position.set(d.x, d.h, d.y);
            d.m.rotation.x += d.sx * dt;
            d.m.rotation.z += d.sz * dt;
            if (d.t >= d.life) d.m.setEnabled(false);
        }
    },

    // --- Мелочи ------------------------------------------------------------------------------

    _bots() { return typeof GameBots !== 'undefined' ? /** @type {any} */ (GameBots) : null; },
    _ui() { return typeof GameUI !== 'undefined' ? /** @type {any} */ (GameUI) : null; },

    _fx(name, pos, opts) {
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (!fx || typeof fx.play !== 'function') return;
        try { fx.play(name, pos, opts); } catch (e) { console.error('GameFX.play:', e); }
    },

    _toast(text, seconds) {
        const ui = this._ui();
        if (ui && typeof ui.toast === 'function') ui.toast(text, seconds);
    },

    _stats(items) {
        return '<div class="gm-stats">' + items.map(([icon, label, value]) =>
            '<div class="gm-st"><img src="' + icon + '" alt=""><span><small>' + this._esc(label) + '</small><b>' + this._esc(value) + '</b></span></div>').join('') + '</div>';
    },

    _esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
    },

    _fmt(sec) {
        const s = Math.max(0, Math.round(sec || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    },

    _rand(a, b) { return a + Math.random() * (b - a); },

    _shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    },

    // JSON-сводка для отладки.
    state() {
        const r = this.round;
        return {
            current: this.current, arenaPop: this._arenaPop, card: !!this._card, matchmaking: !!this._mm, ads: Platform.ads.results,
            life: this.life && { slaps: this.life.slaps, kos: this.life.kos, aura: Math.round(this.life.aura) },
            round: r && (r.mode === 'royale'
                ? { mode: r.mode, phase: r.phase, t: +r.t.toFixed(1), k: +r.k.toFixed(3), alive: this._aliveBots(r).length, bots: r.bots.length }
                : { mode: r.mode, phase: r.phase, n: r.n, me: r.me, foe: r.foe, bot: r.bot ? r.bot.name : null }),
            pvp: Game.ZONE_RULES[Game.zone] ? Game.ZONE_RULES[Game.zone].pvp : null,
            frozen: typeof GamePlayer !== 'undefined' ? GamePlayer.frozen : null,
            stats: Game.save && Game.save.stats,
        };
    },

    _debugApi() {
        const d = Game.debug;
        if (!d) return;
        const G = this;
        const offEdge = (c, zone, a) => {
            const z = GameWorld.zones[zone];
            if (!z || !c || c.disposed || c.state === 'dead') return;
            const ang = a == null ? Math.random() * Math.PI * 2 : a;
            c.teleport(z.x + Math.cos(ang) * (z.r + 500), z.y + Math.sin(ang) * (z.r + 500), 0, c.heading);
        };
        // Игрок — за край своей зоны (падение через ~1.2 с).
        d.fall = () => { offEdge(Game.player, Game.zone, 0); return true; };
        // Соперники раунда — за край (победа игрока).
        d.win = () => {
            const r = G.round;
            if (!r) return false;
            const list = r.mode === 'royale' ? r.bots : [r.bot];
            list.forEach((b, i) => offEdge(b, r.mode, i * 0.7));
            return true;
        };
        d.modes = () => JSON.stringify(G.state());
        d.portal = (mode) => { G.enterPortal(mode); return true; };
    },

    // --- Разметка и стиль ------------------------------------------------------------------------

    _dom() {
        const top = document.createElement('div');
        top.id = 'gm-top';
        top.innerHTML = '<div id="gm-mode" class="gm-pill"></div><div id="gm-info" class="gm-pill"></div>';
        document.body.appendChild(top);
        const big = document.createElement('div');
        big.id = 'gm-big';
        document.body.appendChild(big);
        const home = document.createElement('button');
        home.type = 'button';
        home.id = 'gm-home';
        home.innerHTML = '<img src="assets/ui/icon_swirl.png" alt=""><span></span>';
        home.querySelector('span').textContent = Lang.t('gmLobby');
        home.addEventListener('pointerdown', (e) => e.stopPropagation());
        home.addEventListener('click', (e) => {
            e.stopPropagation();
            const p = Game.player;
            if (this._card || Game.transitioning || !p || p.state === 'dead') return;
            if (this._homeBusy) return;
            const ui = this._ui();
            if (ui && typeof ui.click === 'function') ui.click();
            // Выход в лобби посреди игры — естественная пауза: на Playables сначала interstitial.
            this._homeBusy = true;
            Platform.ads.breakpoint(() => { this._homeBusy = false; this._go('lobby'); });
        });
        document.body.appendChild(home);
        this._el = { top, mode: /** @type {HTMLElement} */ (top.querySelector('#gm-mode')), info: /** @type {HTMLElement} */ (top.querySelector('#gm-info')), big, home };
    },

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gm-top{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:7;display:flex;flex-direction:column;align-items:center;gap:6px;
 pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff}
#gm-top.gm-low{top:calc(66px + env(safe-area-inset-top))}
.gm-pill{display:none;align-items:center;gap:8px;padding:5px 18px;border-radius:22px;background:rgba(10,30,60,.5);border:2px solid rgba(255,255,255,.4);
 font-size:22px;line-height:1.15;white-space:nowrap;text-shadow:0 2px 0 rgba(0,0,0,.35);box-shadow:0 3px 0 rgba(0,0,0,.18)}
.gm-pill.gm-on{display:flex}
.gm-pill img{width:28px;height:28px}
.gm-pill.gm-m-arena{background:linear-gradient(#4fd15a,#26a332);border-color:#17501c}
.gm-pill.gm-m-hardcore{background:linear-gradient(#ff5a5a,#c92f2f);border-color:#5a1414}
.gm-pill.gm-m-royale{background:linear-gradient(#ffd34d,#e8a21a);border-color:#5a3a08}
.gm-pill.gm-m-duel{background:linear-gradient(#4dc8f0,#2f8fb8);border-color:#0b4a65}
.gm-pill.gm-warn{background:linear-gradient(#ff5a5a,#c92f2f);border-color:#5a1414;animation:gm-pulse 1s ease-in-out infinite}
@keyframes gm-pulse{0%,100%{scale:1}50%{scale:1.07}}
#gm-big{position:fixed;left:50%;top:36%;z-index:8;pointer-events:none;opacity:0;transform:translate(-50%,-50%);white-space:nowrap;
 font:900 clamp(72px,15vw,140px)/1 GameFont,system-ui,sans-serif;color:#fff;
 text-shadow:-5px -5px 0 #1b2b45,5px -5px 0 #1b2b45,-5px 5px 0 #1b2b45,5px 5px 0 #1b2b45,0 -5px 0 #1b2b45,0 5px 0 #1b2b45,-5px 0 0 #1b2b45,5px 0 0 #1b2b45,0 10px 0 rgba(0,0,0,.3)}
#gm-big.gm-small{font-size:clamp(34px,7.5vw,68px);text-shadow:-3px -3px 0 #1b2b45,3px -3px 0 #1b2b45,-3px 3px 0 #1b2b45,3px 3px 0 #1b2b45,0 6px 0 rgba(0,0,0,.3)}
#gm-big.gm-go{color:#7dff5f}
#gm-big.gm-gold{color:#ffd84d}
#gm-big.gm-red{color:#ff7272}
#gm-big.gm-play{animation:gm-big var(--d,1s) ease-out forwards}
@keyframes gm-big{0%{opacity:0;transform:translate(-50%,-50%) scale(2.2)}14%{opacity:1;transform:translate(-50%,-50%) scale(.93)}24%{transform:translate(-50%,-50%) scale(1)}
 78%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.88)}}
#gm-home{position:fixed;right:calc(14px + env(safe-area-inset-right));top:calc(80px + env(safe-area-inset-top));z-index:7;display:none;align-items:center;gap:6px;height:46px;
 padding:0 14px 0 8px;border-radius:14px;border:3px solid #1d3d55;background:linear-gradient(#3a6f93,#25506f);color:#fff;cursor:pointer;pointer-events:auto;
 font:900 18px GameFont,system-ui,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.3);box-shadow:0 3px 0 rgba(0,0,0,.25)}
#gm-home.gm-on{display:flex}
#gm-home:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.25)}
#gm-home img{width:30px;height:30px}
.gm-card{display:flex;flex-direction:column;align-items:center}
.gm-sub{margin:0 0 10px;font-size:18px;color:#ffe9a8}
.gm-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%}
.gm-st{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 10px;border-radius:14px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.12);text-align:left}
.gm-st img{width:32px;height:32px;flex:none}
.gm-st span{display:flex;flex-direction:column;min-width:0;line-height:1.08}
.gm-st small{font-size:13px;color:#b9c9dc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gm-st b{font-size:24px;color:#fff}
.gm-adb{width:100%;margin-top:12px;font-size:17px;line-height:1.2}
.gm-crown{width:76px;height:76px;margin:-4px 0 4px;animation:gm-bob 1.6s ease-in-out infinite}
@keyframes gm-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}
.gm-rew{display:inline-flex;align-items:center;gap:6px;margin:0 0 12px;padding:5px 18px 5px 8px;border-radius:22px;border:3px solid #7a1029;
 background:linear-gradient(#ff6d8a,#e8325a);font-size:26px;box-shadow:0 3px 0 rgba(0,0,0,.25)}
.gm-rew img{width:34px;height:34px}
.gm-place{display:flex;align-items:baseline;gap:8px;margin:0 0 6px;font-size:64px;line-height:1;color:#ffd84d;
 text-shadow:-3px -3px 0 #3a1408,3px -3px 0 #3a1408,-3px 3px 0 #3a1408,3px 3px 0 #3a1408,0 5px 0 rgba(0,0,0,.35)}
.gm-place small{font-size:24px;color:#fff}
.gm-score{margin:0 0 6px;font-size:60px;line-height:1;color:#fff;letter-spacing:2px;
 text-shadow:-3px -3px 0 #14202c,3px -3px 0 #14202c,-3px 3px 0 #14202c,3px 3px 0 #14202c,0 5px 0 rgba(0,0,0,.35)}
.gm-mm{display:flex;flex-direction:column;align-items:center;gap:12px;padding:6px 0 2px}
.gm-spin{width:54px;height:54px;border-radius:50%;border:7px solid rgba(255,255,255,.18);border-top-color:#ffd84d;animation:gm-spin .8s linear infinite}
@keyframes gm-spin{to{transform:rotate(360deg)}}
.gm-mmt{font-size:21px}
.gm-dots{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:300px}
.gm-dot{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.25);transition:background .2s}
.gm-dot.gm-in{background:#6dff5a;border-color:#17501c;animation:gm-dot .25s ease-out}
@keyframes gm-dot{from{transform:scale(.3)}to{transform:scale(1)}}
@media (max-width:560px){
 #gm-top.gm-low{left:auto;right:calc(12px + env(safe-area-inset-right));top:calc(110px + env(safe-area-inset-top));transform:none;align-items:flex-end}
 #gm-home{top:calc(110px + env(safe-area-inset-top));height:40px}
}
@media (max-height:430px){
 #gm-top{top:calc(8px + env(safe-area-inset-top));scale:.85;transform-origin:50% 0}
 #gm-top.gm-low{left:50%;right:auto;transform:translateX(-50%);align-items:center}
 #gm-top.gm-low{top:calc(54px + env(safe-area-inset-top))}
 #gm-home{top:calc(64px + env(safe-area-inset-top));height:40px}
 .gm-sub{margin-bottom:6px;font-size:16px}
 .gm-st{padding:4px 8px}.gm-st img{width:24px;height:24px}.gm-st b{font-size:19px}
 .gm-crown{width:48px;height:48px}.gm-place,.gm-score{font-size:44px}.gm-rew{font-size:21px;margin-bottom:8px}
}
@media (max-width:400px){.gm-pill{font-size:19px;padding:4px 14px}.gm-st b{font-size:21px}}
`;
        document.head.appendChild(st);
    },
};
