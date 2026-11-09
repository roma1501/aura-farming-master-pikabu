// GameTelemetry.js — аналитика для Playgama (Bridge analytics.send), только в сборке playgama
// (Platform.name === 'bridge' и есть bridge.analytics.send). В остальных сборках модуль молчит.
// По гайду Playgama: сессию даёт Bridge (своих session_id нет), имена событий стабильные,
// изменяемое — в данных, без личных данных.
//   performance_sample — раз в ~TEL_WINDOW_S с активной видимой игры (не загрузка, не пауза,
//     не скрытая вкладка): FPS, перцентили времени кадра, счётчики подвисаний за окно.
//   progression_started / progression_completed / progression_failed { step_id: режим } —
//     вход в режим и итог раунда (арена/хардкор: падение = failed).
//   tutorial_completed, glove_equipped { glove_id }, cosmetic_unlocked { tab }, daily_claimed { day }.

// --- Числа модуля ---
const TEL_WINDOW_S = 30;          // с: окно образца производительности
const TEL_TARGET_FPS = 60;        // целевой FPS игры
const TEL_GAP_MS = 5000;          // разрыв больше — пауза/фон (не «замёрзший кадр»); паузу и смену видимости ловим и так
const TEL_MAX_FRAMES = 4000;      // кадров в окне (с запасом на 120 Гц)

/** @satisfies {Record<string, any>} */
const GameTelemetry = {
    on: false,
    /** @type {number[]} */
    _ft: [],
    _last: 0,
    _winStart: 0,
    _active: 0,
    _errors: 0,
    _rejections: 0,
    _ctxLost: 0,
    _tutorial: false,
    /** @type {Set<string>} */
    _owned: new Set(),

    init(game) {
        this.on = Platform.name === 'bridge' && typeof bridge !== 'undefined' && !!bridge.analytics && typeof bridge.analytics.send === 'function';
        if (!this.on) return;
        window.addEventListener('error', () => { this._errors++; });
        window.addEventListener('unhandledrejection', () => { this._rejections++; });
        const canvas = document.getElementById('world3d');
        if (canvas) canvas.addEventListener('webglcontextlost', () => { this._ctxLost++; });
        Pause.onChange(() => { this._last = 0; });
        document.addEventListener('visibilitychange', () => { this._last = 0; });
        this._tutorial = !!(Game.save && Game.save.tutorialDone);
        const cos = Game.save && Game.save.cos;
        if (cos && Array.isArray(cos.owned)) for (const id of cos.owned) this._owned.add(id);

        Game.on('zone', (e) => {
            if (e.char !== Game.player || !e.to || e.to === 'lobby') return;
            this._send('progression_started', { step_id: this._mode(e.to) });
        });
        Game.on('round', (e) => {
            const r = e && e.result === 'win' ? 'progression_completed' : 'progression_failed';
            this._send(r, { step_id: String((e && e.mode) || 'arena') });
        });
        Game.on('glove', (e) => { if (e.char === Game.player) this._send('glove_equipped', { glove_id: String(e.glove) }); });
        Game.on('cosmetic', (e) => {
            if (!e || this._owned.has(e.id)) return;
            this._owned.add(e.id);
            const it = typeof COSMETICS !== 'undefined' ? COSMETICS.items.find((x) => x.id === e.id) : null;
            this._send('cosmetic_unlocked', { tab: it ? it.tab : 'other' });
        });
        Game.on('daily', (e) => { this._send('daily_claimed', { day: Number(e && e.day) || 0 }); });
        void game;
    },

    // Режим по зоне игрока (хардкор — та же арена).
    _mode(zone) {
        const m = typeof GameModes !== 'undefined' && GameModes.current ? String(GameModes.current) : '';
        return m && m !== 'lobby' ? m : String(zone);
    },

    _send(name, data) {
        if (!this.on) return;
        try { bridge.analytics.send(name, data || {}); } catch (e) { /* аналитика не должна ломать игру */ }
    },

    // Каждый кадр вне паузы: кадры только активной видимой игры.
    update(dt, realDt) {
        if (!this.on) return;
        if (!this._tutorial && Game.save && Game.save.tutorialDone) {
            this._tutorial = true;
            this._send('tutorial_completed');
        }
        const now = performance.now();
        const playing = Game.started && !Pause.active && document.visibilityState === 'visible';
        if (!playing) { this._last = 0; return; }
        if (!this._winStart) this._winStart = now;
        if (this._last) {
            const ft = now - this._last;
            if (ft <= TEL_GAP_MS) {
                if (this._ft.length < TEL_MAX_FRAMES) this._ft.push(ft);
                this._active += ft;
            }
        }
        this._last = now;
        if (this._active >= TEL_WINDOW_S * 1000) this._flush(now);
    },

    _flush(now) {
        const ft = this._ft.slice().sort((a, b) => a - b);
        const n = ft.length;
        if (n >= 10) {
            const q = (p) => ft[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
            const over = (ms) => this._ft.reduce((c, v) => c + (v > ms ? 1 : 0), 0);
            const r1 = (v) => Math.round(v * 10) / 10;
            this._send('performance_sample', {
                target_fps: TEL_TARGET_FPS,
                window_ms: Math.round(now - this._winStart),
                active_ms: Math.round(this._active),
                frame_count: n,
                fps_avg: r1(n / (this._active / 1000)),
                fps_p10: r1(1000 / q(0.9)),
                frame_time_p50_ms: r1(q(0.5)),
                frame_time_p95_ms: r1(q(0.95)),
                frame_time_p99_ms: r1(q(0.99)),
                frame_time_max_ms: r1(ft[n - 1]),
                frames_over_50ms: over(50),
                frames_over_100ms: over(100),
                frames_over_250ms: over(250),
                frames_over_500ms: over(500),
                frames_over_1000ms: over(1000),
                js_error_count: this._errors,
                unhandled_rejection_count: this._rejections,
                webgl_context_loss_count: this._ctxLost,
                game_version: typeof GAME_VERSION !== 'undefined' ? GAME_VERSION : '',
            });
        }
        this._ft.length = 0;
        this._active = 0;
        this._winStart = now;
        this._errors = this._rejections = this._ctxLost = 0;
    },
};
