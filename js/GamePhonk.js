// GamePhonk.js — «Фонк Момент» (DESIGN.md §1, §4–§6), главная фишка игры. Удачный шлепок ->
// hit-stop -> белая вспышка -> slow-mo (Game.timeScale до PHONK_SLOW) ~1.6 с -> плавный возврат.
// Кадр темнеет и уходит в холодный приглушённый тон, сильная виньетка, RGB-сдвиг и зерно
// пульсируют в такт фонку (BPM отрывка), камера — наезд спереди-сбоку атакующего
// (GameCamera.focus) с лёгким облётом и тряской на долях. На головах мем-маски: атакующему —
// «доминирующая» ухмылка, жертве — «испуганная» (держатся PHONK_MASK_TIME, снимаются с «попом»),
// бейджи над головами глитчат. Звук: бас + скретч, через 0.3 с — случайный funk-1..3 поверх
// приглушённой музыки (Sound.duck); отрывок звучит свои ~12 с и уходит сам, даже когда
// картинка уже вернулась. Крупная надпись «+1 АУРА» с глитчем — когда атакует игрок.
//
// Запуск: GamePhonk.trigger(attacker, victim) (victim не задан — ближайший к атакующему).
// Авто: событие slap, где атакующий — игрок: шанс PHONK_CHANCE (×PHONK_BRAINROT_MULT с
// перчаткой «Брейнрот») не чаще PHONK_COOLDOWN; гарантированно (не чаще PHONK_COOLDOWN_SURE) —
// первый шлепок игрока за сессию и шлепок, после которого жертва улетит за край (willFall:
// баллистика по её скорости, полёт/отскоки/скольжение — по физике Character и полу GameWorld).
// Решение — в update следующего кадра: обработчики slap (способности перчаток) уже поменяли
// скорость жертвы.
//
// Постобработка (качество high): свой PostProcess Babylon в один проход — экспозиция,
// насыщенность, холодный тон, контраст, виньетка, хроматическая аберрация, зерно. Создаётся
// один раз (шейдер компилируется заранее) и цепляется к камере только на время момента.
// Не DefaultRenderingPipeline: его imageProcessing переключает
// scene.imageProcessingConfiguration.applyByPostProcess, и все материалы сцены
// перекомпилируются при каждом включении (рывок кадра, меши пропадают до готовности).
// Качество low (GameFX.quality или save.settings.quality) или шейдер ещё не готов — лёгкий
// CSS-оверлей (затемнение + холодный тон + виньетка). Вспышка и надпись — DOM на обоих.
//
// Время момента — реальное (update realDt): на паузе всё стоит (звук тоже — Sound
// приостанавливает контекст, CSS-анимации надписи — на паузе). Смена зоны — момент и маски
// снимаются сразу, фонк уходит; падение игрока — быстрое угасание, фонк уходит. После момента
// возвращается всё: timeScale, постобработка, бейджи, камера, громкость музыки.
//
// API: trigger(attacker, victim) -> bool, active, attacker, victim, chance(char),
// willFall(char) -> bool, stop(). События: phonk {attacker, victim} — начало,
// phonkEnd {attacker, victim} — конец визуальной части.

const PHONK_CHANCE = 0.2;            // шанс момента на шлепок игрока
const PHONK_BRAINROT_MULT = 3;       // перчатка «Брейнрот» — втрое чаще
const PHONK_COOLDOWN = 9;            // с (реальные) от начала прошлого момента — для случайного
const PHONK_COOLDOWN_SURE = 4;       // с — для гарантированного (первый шлепок, жертва за край)
const PHONK_HITSTOP = 0.08;          // с — заморозка в момент удара
const PHONK_SLOW = 0.15;             // timeScale в разгаре
const PHONK_SLOW_IN = 0.2;           // с — вход в slow-mo
const PHONK_SLOW_HOLD = 1.6;         // с — slow-mo
const PHONK_SLOW_OUT = 0.5;          // с — возврат
const PHONK_FX_END = 2.5;            // с — конец визуальной части (постобработка, глитч бейджей)
const PHONK_FX_IN = 0.12;            // с — нарастание постобработки
const PHONK_FX_OUT = 0.5;            // с — угасание постобработки
const PHONK_CUT_FADE = 0.35;         // с — быстрое угасание (игрок упал)
const PHONK_FOCUS = 1.8;             // с — наезд камеры
const PHONK_FOCUS_ANGLE_DEG = 50;    // ° — камера спереди-сбоку атакующего (0 — прямо в лицо)
const PHONK_SHAKE = 0.7;             // тряска в момент удара
const PHONK_BEAT_SHAKE = 0.2;        // тряска на долю фонка (сильная доля — ×1.6)
const PHONK_MASK_TIME = 4;           // с — маски на головах
const PHONK_MASK_IN = 0.24;          // с — «поп» появления маски (реальные)
const PHONK_MASK_POP = 0.26;         // с — «поп» снятия маски
const PHONK_MUSIC_DELAY = 0.3;       // с — фонк после удара баса
const PHONK_TRACK_LEN = 12.5;        // с — сколько звучит отрывок funk-* (потом затухает; SOUNDS.md)
const PHONK_TRACK_FADE = 3;          // с — затухание в конце отрывка (в самом файле)
const PHONK_VOLUME = 0.8;            // громкость отрывка (SOUNDS.md)
const PHONK_DUCK = 0.18;             // громкость музыки зоны под фонком
const PHONK_AURA_TEXT = 2;           // с — надпись «+1 АУРА»
const PHONK_FALL_SIM = 6;            // с — горизонт прогноза «улетит за край»
const PHONK_NEAREST = 1500;          // px — поиск жертвы для trigger без victim

// Цветокоррекция момента (GLSL, один проход). uK — сила 0..1, uAb — RGB-сдвиг (доля экрана у
// края), uPump — вспышка на долю, uVig — виньетка, uGrain — зерно, uSeed — кадр зерна.
const PHONK_SHADER = `
#ifdef GL_ES
precision highp float;
#endif
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uK;
uniform float uAb;
uniform float uPump;
uniform float uVig;
uniform float uGrain;
uniform float uSeed;

float phonkHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main(void) {
    vec2 c = vUV - 0.5;
    vec4 base = texture2D(textureSampler, vUV);
    vec2 off = c * 2.0 * uAb;
    vec3 col = vec3(texture2D(textureSampler, vUV + off).r, base.g, texture2D(textureSampler, vUV - off).b);
    col *= 0.62 + uPump;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, 0.38);
    col *= vec3(0.84, 0.95, 1.12);
    col = (col - 0.36) * 1.28 + 0.36;
    float r = length(c * vec2(1.0, 0.92)) * 1.414;
    col *= 1.0 - uVig * smoothstep(0.28, 1.0, r);
    col += (phonkHash(gl_FragCoord.xy + vec2(uSeed, uSeed * 0.37)) - 0.5) * uGrain;
    gl_FragColor = vec4(mix(base.rgb, clamp(col, 0.0, 1.0), uK), 1.0);
}
`;

Object.assign(LANG_STRINGS.ru, { phonkAura: '+{n} АУРА' });
Object.assign(LANG_STRINGS.en, { phonkAura: '+{n} AURA' });   // (надпись момента от позы — GameFarm: phonkPose)

/** @satisfies {Record<string, any>} */
const GamePhonk = {
    active: false,          // идёт визуальная часть момента
    /** @type {Character | null} */
    attacker: null,
    /** @type {Character | null} */
    victim: null,

    // Отрывки фонка (пути — литералы для сборщика) и их темп (SOUNDS.md).
    TRACKS: [
        { url: 'assets/sounds/funk-1.ogg', bpm: 140 },
        { url: 'assets/sounds/funk-2.ogg', bpm: 150 },
        { url: 'assets/sounds/funk-3.ogg', bpm: 120 },
    ],
    // Маски (ключи Character.MASKS): атакующему — «доминирующие», жертве — «испуганные» (вес).
    DOMINANT: ['grin_purple', 'grin_red', 'grin_shadow', 'devil', 'cool', 'moai'],
    SCARED: [{ key: 'scared_blue', w: 5 }, { key: 'cry_blue', w: 1 }, { key: 'scream', w: 1 }, { key: 'cold', w: 1 },
        { key: 'sob', w: 1 }, { key: 'skull', w: 1 }],

    _t: 0,                  // с (реальные) от начала момента
    _endAt: PHONK_FX_END,   // конец визуальной части (по _t)
    _fadeLen: PHONK_FX_OUT, // длина угасания перед _endAt
    _cutAt: Infinity,       // _t быстрого завершения (slow-mo уходит за _cutFade)
    _cutFade: PHONK_CUT_FADE,
    _baseScale: 1,          // Game.timeScale до момента
    _lastAt: -1e9,          // Game.realTime начала прошлого момента
    _firstDone: false,      // у игрока уже был Фонк Момент за сессию (первый шлепок — гарантированно)
    /** @type {any[]} */
    _pending: [],           // события slap игрока — решение в следующем update
    _k: 0,                  // сила постобработки 0..1
    _flash: 0,              // белая вспышка 0..1
    _pulse: 0,              // пульс доли (аберрация, тряска)
    _seed: 0,
    _bpm: 130,
    _beatAt: 0,             // _t первой доли фонка
    _beat: -1,
    _musicDone: false,      // отрывок уже запущен (или пропущен)
    _lastTrack: -1,
    _trackStop: 0,          // Game.realTime, когда отрывок начинает затухать
    /** @type {any} */
    _track: null,           // handle звучащего отрывка (Sound.play)
    /** @type {{ char: Character, plane: any, age: number, popped: boolean }[]} */
    _masks: [],
    /** @type {BABYLON.PostProcess | null} */
    _pp: null,
    _ppFailed: false,
    /** @type {BABYLON.Camera | null} */
    _ppCam: null,           // камера, к которой сейчас прицеплена постобработка
    _usePP: false,          // этот момент — постобработкой (иначе CSS-оверлей)
    _preloaded: false,
    /** @type {{ grade: HTMLElement | null, flash: HTMLElement | null, aura: HTMLElement | null }} */
    _el: { grade: null, flash: null, aura: null },
    /** @type {Record<string, number>} */
    _op: {},                // последняя выставленная opacity оверлеев (без лишних записей в style)

    init(game) {
        this._css();
        Game.on('slap', (e) => {
            if (e && e.attacker && e.attacker === Game.player && !this.active) this._pending.push(e);
        });
        Game.on('ko', (e) => {
            if (!e || e.victim !== Game.player) return;
            if (this.active) this._cut(PHONK_CUT_FADE);
            this._fadeTrack(1.2);
        });
        Game.on('settings', (s) => {
            if (s && s.music === false) this._fadeTrack(0.4);
            if (s && s.quality !== 'low') this._ensurePP();
        });
        Pause.onChange((paused) => { if (this._el.aura) this._el.aura.classList.toggle('gph-paused', paused); });
        const sc = GameWorld.scene;
        // «Поп» снятия маски — после Character.animate (он держит масштаб маски 1), до кадра.
        if (sc) sc.onBeforeRenderObservable.add(() => this._applyPops());
        if (!this._lowQuality()) this._ensurePP();
        void game;
    },

    onZone(zone) {
        this._pending = [];
        if (this.active) this._cut(0);
        this._clearMasks();
        this._fadeTrack(0.6);
        if (Game.pvp(zone)) this._preload();
    },

    // --- Запуск --------------------------------------------------------------------------

    // Шанс случайного момента на шлепок персонажа.
    chance(ch) {
        if (!ch) return PHONK_CHANCE;
        let k = ch.glove === 'brainrot' ? PHONK_BRAINROT_MULT : 1;
        // Множитель перчатки — из данных перчаток (GameGloves: phonk), если модуль есть.
        if (typeof GameAbilities !== 'undefined' && typeof GameAbilities.phonkMult === 'function') {
            const m = Number(GameAbilities.phonkMult(ch));
            if (m > 0) k = Math.max(k, m);
        }
        return Math.min(0.95, PHONK_CHANCE * k);
    },

    // Фонк Момент: attacker (по умолчанию игрок) и victim (не задан — ближайший к атакующему;
    // null при явной передаче тоже ищется). Идущий момент заканчивается и начинается новый.
    // opts: { text, sub, kind: 'pose' } — надпись момента (поза ауры); без opts — обычный момент от шлепка.
    trigger(attacker, victim, opts) {
        const a = attacker || Game.player;
        if (!a || a.disposed || a.state === 'dead') return false;
        let v = victim && victim !== a && !victim.disposed && victim.state !== 'dead' ? victim : null;
        if (!v) v = this._nearest(a);
        if (this.active) this._finish();
        this.active = true;
        this.attacker = a;
        this.victim = v;
        this._t = 0;
        this._endAt = PHONK_FX_END;
        this._fadeLen = PHONK_FX_OUT;
        this._cutAt = Infinity;
        this._cutFade = PHONK_CUT_FADE;
        this._baseScale = Game.timeScale > 0 ? Game.timeScale : 1;
        this._lastAt = Game.realTime;
        if (a === Game.player) this._firstDone = true;
        this._pulse = 1.3;
        this._beat = -1;
        this._bpm = 130;
        this._beatAt = PHONK_MUSIC_DELAY + 0.015;   // отрывки начинаются с сильной доли дропа
        this._musicDone = false;
        this._usePP = !this._lowQuality() && this._attachPP();
        Game.hitStop(PHONK_HITSTOP);
        this._putMask(a, this.DOMINANT[Math.floor(Math.random() * this.DOMINANT.length)]);
        if (v) this._putMask(v, this._pickScared());
        this._badge(a, 'glitch');
        if (v) this._badge(v, 'glitch');
        this._camera(a, v);
        this._sound();
        this._showAura(a, opts);
        this._applyCss();
        Game.emit('phonk', { attacker: a, victim: v });
        return true;
    },

    // Остановить всё сразу (момент, маски, фонк).
    stop() {
        this._pending = [];
        if (this.active) this._cut(0);
        this._clearMasks();
        this._fadeTrack(0.5);
    },

    // Улетит ли персонаж за край с текущей скоростью: полёт, отскоки и скольжение — как в
    // Character.step (гравитация, GAME_BOUNCE, трение ragdoll), пол — GameWorld.floorAt.
    willFall(c) {
        if (!c || c.disposed || c.state === 'dead') return false;
        if (c.state === 'falling') return true;
        const C = GameCfg, dt = 1 / 60;
        const g = C.gravity * ((c.mods && c.mods.gravity) || 1);
        const fr = C.friction * ((c.mods && c.mods.friction) || 1);
        let x = c.x, y = c.y, h = c.h, vx = c.vx, vy = c.vy, vh = c.vh, ground = c.onGround;
        for (let i = 0, n = Math.round(PHONK_FALL_SIM / dt); i < n; i++) {
            if (ground) {
                const sp = Math.hypot(vx, vy), f = fr * dt;
                if (sp <= f) return false;            // остановился на полу
                vx -= vx / sp * f; vy -= vy / sp * f;
            } else vh -= g * dt;
            const ph = h;
            x += vx * dt; y += vy * dt; h += vh * dt;
            const fh = GameWorld.floorAt(x, y);
            if (fh !== null && h <= fh && (ph >= fh - 80 || ground)) {
                const impact = -vh;
                if (impact > C.bounceMin) { h = fh + 0.5; vh = impact * C.bounce; vx *= 0.72; vy *= 0.72; ground = false; }
                else { h = fh; vh = 0; ground = true; }
            } else if (fh === null || h > fh + 0.5) ground = false;
            if (h < -200 && fh === null) return true;  // ниже верха островов и без пола — бездна
        }
        return false;
    },

    // Решение по шлепкам игрока прошлого кадра.
    _decide() {
        const list = this._pending;
        this._pending = [];
        for (const e of list) {
            const a = e.attacker, v = e.victim;
            if (this.active || !a || a !== Game.player || a.disposed || !v || v.disposed) continue;
            if (!Game.started || Game.transitioning || !Game.pvp(a.zone)) continue;
            const since = Game.realTime - this._lastAt;
            const first = !this._firstDone;     // флаг гасит trigger: не сработал из-за перезарядки — ждёт
            let go = since >= PHONK_COOLDOWN_SURE && (first || this.willFall(v));
            if (!go && since >= PHONK_COOLDOWN) go = Math.random() < this.chance(a);
            if (go) this.trigger(a, v);
        }
    },

    _nearest(a) {
        const t = GameCombat.nearestTarget(a, PHONK_NEAREST);
        if (t) return t;
        let best = null, bd = PHONK_NEAREST * PHONK_NEAREST;
        for (const c of Game.chars) {
            if (c === a || c.disposed || c.state === 'dead' || c.hidden || c.zone !== a.zone) continue;
            const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    },

    _pickScared() {
        let sum = 0;
        for (const s of this.SCARED) sum += s.w;
        let r = Math.random() * sum;
        for (const s of this.SCARED) { r -= s.w; if (r <= 0) return s.key; }
        return this.SCARED[0].key;
    },

    // --- Кадр ----------------------------------------------------------------------------

    update(dt, realDt) {
        const rdt = Math.min(0.1, realDt || 0);
        if (this._pending.length) this._decide();
        this._stepMasks(rdt);
        if (this._track && Game.realTime >= this._trackStop) { this._track.fade(PHONK_TRACK_FADE); this._track = null; }
        if (!this.active) return;
        this._t += rdt;
        // Качество сменили на low посреди момента (настройки, авто-понижение GameFX) — оверлей.
        if (this._usePP && this._lowQuality()) { this._detachPP(); this._usePP = false; }
        const t = this._t, E = Character.ease;
        if (!this._musicDone && t >= PHONK_MUSIC_DELAY) this._startTrack();
        // Доли фонка: пульс аберрации/вспышки и тряска камеры.
        if (t >= this._beatAt && t < this._endAt - this._fadeLen * 0.5) {
            const b = Math.floor((t - this._beatAt) / (60 / this._bpm));
            if (b !== this._beat) { this._beat = b; this._onBeat(b); }
        }
        this._pulse *= Math.exp(-rdt * 8);
        // Slow-mo: вход, удержание, возврат (и быстрый возврат при обрыве).
        const depth = E(t / PHONK_SLOW_IN) * (1 - E((t - PHONK_SLOW_IN - PHONK_SLOW_HOLD) / PHONK_SLOW_OUT)) *
            (1 - E((t - this._cutAt) / this._cutFade));
        Game.timeScale = this._baseScale * (1 + (PHONK_SLOW - 1) * depth);
        // Постобработка и вспышка.
        this._k = E((t - 0.02) / PHONK_FX_IN) * E((this._endAt - t) / this._fadeLen);
        this._flash = t < 0.03 ? t / 0.03 * 0.92 : (t < 0.5 ? 0.92 * Math.exp(-(t - 0.03) * 9) : 0);
        this._seed = Math.random() * 512;
        this._applyCss();
        if (this._el.aura && t > PHONK_AURA_TEXT) this._removeAura();
        if (t >= this._endAt) this._finish();
    },

    _onBeat(b) {
        const strong = b % 4 === 0;
        this._pulse = Math.max(this._pulse, strong ? 1 : 0.65);
        if (typeof GameCamera !== 'undefined') GameCamera.shake(PHONK_BEAT_SHAKE * (strong ? 1.6 : 1), 0.12);
    },

    // Быстро закончить визуальную часть за fade с (0 — сразу).
    _cut(fade) {
        if (!this.active) return;
        const f = Math.max(0, fade || 0);
        // Наезд снимается, только если он ещё наш (не наезд режимов на победу и т. п.).
        if (typeof GameCamera !== 'undefined' && GameCamera.mode === 'focus' && GameCamera._focus.indexOf(this.attacker) >= 0 &&
            this._t < PHONK_FOCUS) GameCamera.unfocus();
        if (f <= 0) { this._finish(); return; }
        if (this._t < this._cutAt) { this._cutAt = this._t; this._cutFade = f; }
        if (this._t + f < this._endAt) { this._endAt = this._t + f; this._fadeLen = f; }
    },

    // Конец визуальной части: всё на место (маски и отрывок живут своё время).
    _finish() {
        if (!this.active) return;
        this.active = false;
        Game.timeScale = this._baseScale;
        this._k = 0;
        this._flash = 0;
        this._pulse = 0;
        this._detachPP();
        this._applyCss();
        this._removeAura();
        const a = this.attacker, v = this.victim;
        this._badge(a, null);
        this._badge(v, null);
        Game.emit('phonkEnd', { attacker: a, victim: v });
    },

    // --- Маски -----------------------------------------------------------------------------

    _putMask(c, key) {
        if (!c || c.disposed || c.state === 'dead' || !Character.MASKS[key]) return;
        c.setMask(key);
        const plane = c.mask;
        this._masks = this._masks.filter(m => m.char !== c);
        if (plane) this._masks.push({ char: c, plane, age: 0, popped: false });
    },

    _stepMasks(rdt) {
        if (!this._masks.length) return;
        const keep = [];
        for (const m of this._masks) {
            const c = m.char;
            if (c.disposed || c.mask !== m.plane) continue;   // маску сняли/сменили другие (KO, способность)
            m.age += rdt;
            // «Поп» появления (Character.animate, 0.28 с игрового времени) — по реальному: в
            // slow-mo игровое почти стоит, и маска выросла бы только к концу замедления.
            if (m.age < PHONK_MASK_IN * 2) c._maskT = Math.max(c._maskT || 0, m.age / PHONK_MASK_IN * 0.28);
            if (m.age >= PHONK_MASK_TIME + PHONK_MASK_POP) { c.setMask(null); continue; }
            if (m.age >= PHONK_MASK_TIME && !m.popped) {
                m.popped = true;
                if (c === Game.player) Sound.play('assets/sounds/bubble_pop.mp3', { volume: 0.7, detune: 0.08 });
            }
            keep.push(m);
        }
        this._masks = keep;
    },

    // Масштаб снимаемых масок: 1 -> 1.3 -> 0.
    _applyPops() {
        const E = Character.ease;
        for (const m of this._masks) {
            if (m.age < PHONK_MASK_TIME) continue;
            const c = m.char;
            if (c.disposed || c.mask !== m.plane || !c.maskNode) continue;
            const u = Math.min(1, (m.age - PHONK_MASK_TIME) / PHONK_MASK_POP);
            const s = u < 0.35 ? 1 + 0.3 * E(u / 0.35) : 1.3 * (1 - E((u - 0.35) / 0.65));
            c.maskNode.scaling.setAll(Math.max(0.01, s));
        }
    },

    _clearMasks() {
        for (const m of this._masks) if (!m.char.disposed && m.char.mask === m.plane) m.char.setMask(null);
        this._masks = [];
    },

    _badge(c, fx) {
        if (!c || c.disposed || typeof GameUI === 'undefined' || typeof GameUI.setBadgeFx !== 'function') return;
        GameUI.setBadgeFx(c, fx);
    },

    // --- Камера ------------------------------------------------------------------------------

    // Наезд: камера спереди-сбоку атакующего (видно его маску), облёт (az растёт) — к лицу.
    _camera(a, v) {
        if (typeof GameCamera === 'undefined' || !GameCamera.cam || !Game.started) return;
        let H = a.heading;
        if (v) {
            const dx = v.x - a.x, dy = v.y - a.y;
            if (dx * dx + dy * dy > 100) H = Math.atan2(dy, dx);
        }
        const az = H + Math.PI - PHONK_FOCUS_ANGLE_DEG * Math.PI / 180;
        GameCamera.focus(v ? [a, v] : [a], PHONK_FOCUS, { az });
        GameCamera.shake(PHONK_SHAKE, 0.4);
    },

    // --- Звук ----------------------------------------------------------------------------------

    _musicOn() { return !(Game.save && Game.save.settings && Game.save.settings.music === false); },

    _sound() {
        Sound.play('assets/sounds/boom_bass.mp3', { volume: 1 });
        Sound.play('assets/sounds/record_scratch.mp3', { volume: 0.7 });
        if (this._track) { this._track.fade(0.25); this._track = null; }
        // Музыка зоны приглушена, пока звучит отрывок (до его затухания), потом возвращается.
        if (this._musicOn()) Sound.duck(PHONK_DUCK, 0.12, PHONK_MUSIC_DELAY + PHONK_TRACK_LEN - PHONK_TRACK_FADE - 0.12, PHONK_TRACK_FADE);
        else Sound.duck(0.4, 0.08, PHONK_FX_END - 0.6, 0.8);
    },

    // Отрывок фонка (музыка выключена в настройках — не играет, доли — по умолчанию 130 BPM).
    _startTrack() {
        this._musicDone = true;
        if (!this._musicOn()) return;
        const n = this.TRACKS.length;
        let i = Math.floor(Math.random() * n);
        if (i === this._lastTrack && n > 1) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
        this._lastTrack = i;
        const tr = this.TRACKS[i];
        this._bpm = tr.bpm;
        if (this._track) this._track.fade(0.2);
        this._track = Sound.play(tr.url, { volume: PHONK_VOLUME });
        this._trackStop = Game.realTime + PHONK_TRACK_LEN - PHONK_TRACK_FADE;   // длинные лупы обрезаются сами
    },

    _fadeTrack(seconds) {
        if (this._track) { this._track.fade(seconds); this._track = null; }
        Sound.unduck(seconds);
    },

    _preload() {
        if (this._preloaded) return;
        this._preloaded = true;
        Sound.preload(this.TRACKS.map(t => t.url).concat(['assets/sounds/boom_bass.mp3', 'assets/sounds/record_scratch.mp3', 'assets/sounds/bubble_pop.mp3']));
        const sc = GameWorld.scene;
        if (!sc) return;
        for (const k of this.DOMINANT.concat(this.SCARED.map(s => s.key))) {
            const url = Character.MASKS[k];
            if (url) Character.textureRec(sc, url);
        }
    },

    // --- Постобработка -------------------------------------------------------------------------

    _lowQuality() {
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (fx && (fx.quality === 'low' || fx.quality === 'high')) return fx.quality === 'low';
        return !!(Game.save && Game.save.settings && Game.save.settings.quality === 'low');
    },

    // PostProcess создаётся один раз без камеры (шейдер компилируется сразу), камере — на момент.
    _ensurePP() {
        if (this._pp || this._ppFailed) return this._pp;
        const sc = GameWorld.scene;
        if (!sc || typeof BABYLON === 'undefined' || typeof BABYLON.PostProcess !== 'function') return null;
        try {
            BABYLON.Effect.ShadersStore['phonkGradeFragmentShader'] = PHONK_SHADER;
            const eng = sc.getEngine();
            const pp = new BABYLON.PostProcess('phonkGrade', 'phonkGrade', ['uK', 'uAb', 'uPump', 'uVig', 'uGrain', 'uSeed'], null,
                1.0, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, eng, false);
            if ((/** @type {any} */ (eng).webGLVersion || 0) >= 2) pp.samples = 4;   // сглаживание сцены в текстуре постобработки
            pp.onApply = (fx) => {
                const p = Math.min(1.4, this._pulse);
                fx.setFloat('uK', this._k);
                fx.setFloat('uAb', 0.0025 + 0.0095 * p);
                fx.setFloat('uPump', 0.1 * Math.min(1, p));
                fx.setFloat('uVig', 0.8 + 0.12 * Math.min(1, p));
                fx.setFloat('uGrain', 0.075);
                fx.setFloat('uSeed', this._seed);
            };
            this._pp = pp;
        } catch (e) {
            this._ppFailed = true;
            console.warn('GamePhonk: постобработка недоступна — CSS-оверлей', e);
        }
        return this._pp;
    },

    _attachPP() {
        const pp = this._ensurePP();
        const cam = typeof GameCamera !== 'undefined' ? GameCamera.cam : null;
        if (!pp || !cam) return false;
        let ready = false;
        try { ready = pp.isReady(); } catch (e) { ready = false; }
        if (!ready) return false;
        if (this._ppCam !== cam) {
            this._detachPP();
            try { cam.attachPostProcess(pp); } catch (e) { console.warn('GamePhonk: attachPostProcess', e); return false; }
            this._ppCam = cam;
        }
        return true;
    },

    _detachPP() {
        if (this._pp && this._ppCam) { try { this._ppCam.detachPostProcess(this._pp); } catch (e) { /* уже снят */ } }
        this._ppCam = null;
    },

    // --- DOM: оверлей (low), вспышка, надпись -----------------------------------------------------

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gph-grade{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0;display:none;
 background:radial-gradient(ellipse 74% 70% at 50% 50%,rgba(18,32,58,.32) 0%,rgba(14,26,48,.5) 46%,rgba(5,10,22,.84) 78%,rgba(0,2,8,.96) 100%)}
#gph-flash{position:fixed;inset:0;z-index:6;pointer-events:none;opacity:0;display:none;
 background:radial-gradient(circle at 50% 50%,#fff 0%,#fff 50%,#e6f5ff 100%)}
#gph-aura{position:fixed;left:50%;top:24%;z-index:6;pointer-events:none;white-space:nowrap;
 font-family:GameFont,system-ui,sans-serif;font-weight:900;font-size:clamp(38px,8.5vmin,88px);letter-spacing:.02em;color:#fff;
 transform:translate(-50%,-50%) rotate(-4deg);text-shadow:-4px 0 #ff2a6d,4px 0 #00e5ff,0 5px 0 rgba(0,0,0,.45);
 animation:gph-in .24s cubic-bezier(.2,1.6,.4,1) both,gph-jit .14s steps(2) .24s 9,gph-out .36s ease-in 1.5s forwards}
#gph-aura.gph-paused{animation-play-state:paused}
#gph-aura .gph-sub{display:block;margin-top:2px;font-size:.3em;letter-spacing:.35em;color:#0a0518;background:#3fe8ff;padding:.2em .7em;border-radius:3px;text-shadow:none;transform:skewX(-10deg)}
#gph-aura.gph-pose{font-size:clamp(46px,10.5vmin,108px);color:#fff8d8;text-align:center;top:30%;
 text-shadow:0 0 14px #ff3fa8,0 0 34px #ff3fa8,-4px 0 #3fe8ff,4px 0 #ff3fa8,0 5px 0 rgba(0,0,0,.5)}
@keyframes gph-in{0%{opacity:0;transform:translate(-50%,-50%) rotate(-10deg) scale(2.4)}100%{opacity:1;transform:translate(-50%,-50%) rotate(-4deg) scale(1)}}
@keyframes gph-jit{0%{transform:translate(-50%,-50%) rotate(-4deg) translate(3px,0);text-shadow:-7px 0 #ff2a6d,6px 0 #00e5ff,0 5px 0 rgba(0,0,0,.45)}
 100%{transform:translate(-50%,-50%) rotate(-4deg) translate(-3px,1px);text-shadow:6px 1px #ff2a6d,-6px -1px #00e5ff,0 5px 0 rgba(0,0,0,.45)}}
@keyframes gph-out{0%{opacity:1;transform:translate(-50%,-50%) rotate(-4deg) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) rotate(-4deg) scale(.82)}}`;
        document.head.appendChild(st);
        for (const id of ['grade', 'flash']) {
            const el = document.createElement('div');
            el.id = 'gph-' + id;
            document.body.appendChild(el);
            this._el[id] = el;
        }
    },

    _applyCss() {
        const grade = this.active && !this._usePP ? this._k * (1 - 0.12 * Math.min(1, this._pulse)) : 0;
        this._setOpacity('grade', grade);
        this._setOpacity('flash', this.active ? this._flash : 0);
    },

    _setOpacity(id, o) {
        const el = this._el[id];
        if (!el) return;
        const v = o > 0.005 ? Math.round(o * 1000) / 1000 : 0;
        if (this._op[id] === v) return;
        this._op[id] = v;
        el.style.display = v > 0 ? 'block' : 'none';
        el.style.opacity = String(v);
    },

    // «+N АУРА» с глитчем — только когда атакует игрок (N — множитель ауры за шлепок).
    _showAura(a, opts) {
        this._removeAura();
        if (!a || a !== Game.player) return;
        const el = document.createElement('div');
        el.id = 'gph-aura';
        const o = opts || {};
        if (o.kind === 'pose') el.classList.add('gph-pose');
        const main = document.createElement('span');
        main.className = 'gph-main';
        main.textContent = o.text || Lang.t('phonkSlap');
        el.appendChild(main);
        if (o.sub) { const sub = document.createElement('small'); sub.className = 'gph-sub'; sub.textContent = o.sub; el.appendChild(sub); }
        if (Pause.active) el.classList.add('gph-paused');
        document.body.appendChild(el);
        this._el.aura = el;
    },

    _removeAura() {
        if (this._el.aura) { this._el.aura.remove(); this._el.aura = null; }
    },
};
