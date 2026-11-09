// Sound.js — звук игры на Web Audio: эффекты и музыка по путям assets/sounds/….
// Звуки берутся из библиотеки Sound Pack (в корне набора, в архив не едет):
// node tools/sounds.mjs find <слова> -> add "<путь в Sound Pack>" <имя> копирует
// файл в assets/sounds/ латинским именем. В коде путь — ЛИТЕРАЛОМ, иначе сборщик
// его не увидит (Sound.play с путём в кавычках — см. скилл game).
//
// Молчит, когда: игрок выключил звук (setMuted — хранится в Store), платформа
// выключила звук (Playables isAudioEnabled), игра на любой паузе (Pause.js —
// вкладка скрыта, реклама, пауза платформы или игрока). На паузе контекст
// приостанавливается: музыка встаёт и продолжается с того же места.
// Обычный браузер пускает звук после жеста игрока: AudioContext создаётся на первом
// pointerdown / keydown, до него файлы декодирует OfflineAudioContext (буфер
// годится любому контексту), а музыка ждёт жеста и стартует сама.
// Громкость — SOUND_VOLUME и MUSIC_VOLUME (Constants.js, редактор), читается при
// каждом звуке.
// Приглушение музыки (Фонк Момент): duck(level, fadeIn, hold, fadeOut) / unduck(fadeOut) —
// отдельный гейн между музыкой и master (громкость музыки из настроек его не трогает).
// Эффект можно плавно убрать: handle.fade(seconds).

/** @satisfies {Record<string, any>} */
const Sound = {
    /** @type {AudioContext | null} */
    ctx: null,
    /** @type {GainNode | null} */
    master: null,
    /** @type {GainNode | null} */
    musicGain: null,
    /** @type {GainNode | null} */
    duckGain: null,         // музыка -> duckGain -> master (duck / unduck)
    /** @type {{ level: number, end: number } | null} */
    _duck: null,            // текущее приглушение: уровень и конец удержания (ctx.currentTime)
    /** @type {BaseAudioContext | null} */
    _decoder: null,
    buffers: new Map(),     // url -> Promise<AudioBuffer | null>
    muted: false,           // игрок
    platformMuted: false,   // платформа (Playables)
    _music: null,           // { url, opts, source, gain }
    _inited: false,

    init() {
        if (this._inited) return;
        this._inited = true;
        this.muted = Store.get(this._key('muted')) === '1';
        const unlock = () => {
            if (!this._ensure()) return;
            this._sync();
            if (this._music && !this._music.gain) this._startTrack(this._music, 0.6);
        };
        for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, true);
        Pause.onChange(() => this._sync());
    },

    _key(name) {
        return (typeof GAME_ID !== 'undefined' ? GAME_ID : 'lory-game') + '.' + name;
    },

    // Живой контекст — только после жеста (зовёт unlock).
    _ensure() {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.duckGain = this.ctx.createGain();
        this.duckGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.duckGain);
        return this.ctx;
    },

    get unlocked() { return !!this.ctx; },
    get silent() { return this.muted || this.platformMuted || this._paused(); },

    // Пауза глушит звук — кроме причины 'adwait' (CrazyGames: игра стоит, пока реклама
    // запрашивается, а звук выключается только когда ролик реально начался — причина 'ad').
    _paused() {
        if (!Pause.active) return false;
        if (!Pause.reasons) return true;
        for (const r of Pause.reasons) if (r !== 'adwait') return true;
        return false;
    },

    // Громкость и приостановка контекста по состоянию.
    _sync() {
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(this.muted || this.platformMuted ? 0 : 1, t, 0.03);
        this.musicGain.gain.setTargetAtTime(this._volume('music'), t, 0.05);
        if (this._paused()) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
        else if (ctx.state !== 'running') ctx.resume().catch(() => {});
    },

    _volume(kind) {
        const v = kind === 'music'
            ? (typeof MUSIC_VOLUME !== 'undefined' ? MUSIC_VOLUME : 0.5)
            : (typeof SOUND_VOLUME !== 'undefined' ? SOUND_VOLUME : 0.8);
        return Math.max(0, Math.min(1, Number(v) || 0));
    },

    // Декодер до жеста: OfflineAudioContext не требует разрешения на звук.
    _decodeWith() {
        if (this.ctx) return this.ctx;
        if (!this._decoder) {
            const OAC = window.OfflineAudioContext || /** @type {any} */ (window).webkitOfflineAudioContext;
            try { this._decoder = OAC ? new OAC(1, 1, 44100) : null; } catch (e) { this._decoder = null; }
        }
        return this._decoder;
    },

    // url -> Promise<AudioBuffer | null>: грузится и декодируется раз на страницу.
    // Файла нет или формат не читается — null и предупреждение, игра не падает.
    load(url) {
        let p = this.buffers.get(url);
        if (!p) {
            const dec = this._decodeWith();
            p = !dec ? Promise.resolve(null) : fetch(url)
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                .then(buf => new Promise((resolve, reject) => dec.decodeAudioData(buf, resolve, reject)))
                .catch(e => { console.warn('Sound: не загрузился ' + url + ' — ' + ((e && e.message) || e)); return null; });
            this.buffers.set(url, p);
        }
        return p;
    },

    preload(urls) {
        return Promise.all((urls || []).map(u => this.load(u)));
    },

    // Эффект. opts: { volume: 0..1 (× SOUND_VOLUME), rate: скорость (1 — как есть),
    // detune: разброс скорости ±доля (0.05 — живее повторы) }. На паузе, без звука и
    // до первого жеста не играет. Возвращает { stop(), fade(seconds) } или null.
    play(url, opts) {
        const o = opts || {};
        const ctx = this.ctx;
        if (!ctx || this.silent) return null;
        const handle = {
            source: null, gain: null, stopped: false,
            stop() { this.stopped = true; if (this.source) try { this.source.stop(); } catch (e) { /* уже стоит */ } },
            // Плавно убрать за seconds и остановить (ещё не зазвучал — не зазвучит).
            fade(seconds) {
                const s = Math.max(0.01, seconds == null ? 0.3 : seconds);
                if (!this.gain || !ctx) { this.stop(); return; }
                this.stopped = true;
                const g = this.gain.gain, t = ctx.currentTime, src = this.source;
                g.cancelScheduledValues(t);
                g.setValueAtTime(g.value, t);
                g.linearRampToValueAtTime(0, t + s);
                setTimeout(() => { try { src.stop(); } catch (e) { /* уже стоит */ } }, s * 1000 + 80);
            },
        };
        this.load(url).then(buf => {
            if (!buf || handle.stopped || this.silent) return;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const rate = (o.rate || 1) * (o.detune ? 1 + (Math.random() * 2 - 1) * o.detune : 1);
            src.playbackRate.value = Math.max(0.1, rate);
            const g = ctx.createGain();
            g.gain.value = this._volume('sfx') * (o.volume == null ? 1 : o.volume);
            src.connect(g);
            g.connect(this.master);
            src.start();
            handle.source = src;
            handle.gain = g;
        });
        return handle;
    },

    // Приглушить музыку (эффекты не трогает): до level (0..1) за fadeIn с, держать hold с,
    // вернуть за fadeOut с. Наложение вызовов: глубже из уровней, держится до более позднего
    // конца. На паузе контекст стоит — приглушение тоже. До первого жеста — ничего.
    duck(level, fadeIn, hold, fadeOut) {
        const ctx = this.ctx;
        if (!ctx || !this.duckGain) return;
        const t = ctx.currentTime;
        const fi = Math.max(0.01, fadeIn == null ? 0.1 : fadeIn), fo = Math.max(0.01, fadeOut == null ? 0.6 : fadeOut);
        let lv = Math.max(0, Math.min(1, level == null ? 0.3 : level));
        let end = t + fi + Math.max(0, hold || 0);
        const d = this._duck;
        if (d && t < d.end) { lv = Math.min(lv, d.level); end = Math.max(end, d.end); }
        this._duck = { level: lv, end };
        const g = this.duckGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(lv, t + fi);
        g.setValueAtTime(lv, end);
        g.linearRampToValueAtTime(1, end + fo);
    },

    // Снять приглушение раньше срока: музыка вернётся за fadeOut с.
    unduck(fadeOut) {
        const ctx = this.ctx;
        const was = this._duck;
        this._duck = null;
        if (!ctx || !this.duckGain || !was) return;
        const t = ctx.currentTime, g = this.duckGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(1, t + Math.max(0.01, fadeOut == null ? 0.5 : fadeOut));
    },

    // Музыка по кругу; другая дорожка сменяет прежнюю плавно, null — выключить.
    // До первого жеста игрока дорожка ждёт и стартует сама.
    // opts: { volume: 0..1 (× MUSIC_VOLUME), fade: секунды смены }.
    music(url, opts) {
        const o = opts || {};
        const old = this._music;
        if (old ? old.url === url : !url) return;
        this._music = url ? { url, opts: o, source: null, gain: null } : null;
        const fade = o.fade == null ? 0.6 : o.fade;
        if (old) this._stopTrack(old, fade);
        if (url) this.load(url);   // декодируется заранее, пока ждёт жеста
        if (this._music && this.ctx) this._startTrack(this._music, fade);
    },

    stopMusic() { this.music(null); },

    _startTrack(rec, fade) {
        const ctx = this.ctx;
        rec.gain = ctx.createGain();
        rec.gain.gain.value = 0;
        rec.gain.connect(this.musicGain);
        this.load(rec.url).then(buf => {
            if (!buf || this._music !== rec) return;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(rec.gain);
            src.start();
            rec.source = src;
            rec.gain.gain.setTargetAtTime(rec.opts.volume == null ? 1 : rec.opts.volume, ctx.currentTime, Math.max(0.01, fade / 3));
        });
    },

    _stopTrack(rec, fade) {
        if (!rec.gain || !this.ctx) return;
        rec.gain.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, fade / 3));
        setTimeout(() => { if (rec.source) try { rec.source.stop(); } catch (e) { /* уже стоит */ } }, fade * 1000 + 100);
    },

    // Звук игрока (кнопка в меню) — запоминается.
    setMuted(on) {
        this.muted = !!on;
        Store.set(this._key('muted'), this.muted ? '1' : '0');
        this._sync();
    },

    toggleMuted() { this.setMuted(!this.muted); return this.muted; },

    // Платформа выключила звук (Playables: кнопка звука YouTube).
    setPlatformMuted(on) {
        this.platformMuted = !!on;
        // Playables may grant audio focus without an in-game gesture. Try now;
        // browsers with gesture restrictions still use init()'s unlock fallback.
        if (!this.platformMuted && !this.muted) this._ensure();
        this._sync();
        if (!this.platformMuted && this.ctx && this._music && !this._music.gain) this._startTrack(this._music, 0.6);
    },
};
