// Pause.js — пауза игры по причинам. Игра стоит, пока есть хоть одна причина:
//   'auto'     — вкладка скрыта или окно без фокуса (ставит и снимает сам Pause);
//   'manual'   — кнопка паузы игрока;
//   'ad'       — идёт реклама (Platform.showInterstitial / showRewarded);
//   'platform' — пауза от платформы (Яндекс game_api_pause, Playables onPause);
//   свои причины игры — любая строка.
// Снятие одной причины не снимает другие: вернулись на вкладку — снята только
// 'auto', ручная и рекламная пауза остаются. Звук молчит на любой паузе (Sound.js).
// main.js не зовёт Game.update и location.update на паузе, но кадр рисует (иначе
// в канвасе мусор: preserveDrawingBuffer false).
// При автопаузе — событие window 'lory-release-input': игра сбрасывает зажатые
// клавиши и касания, чтобы движение не залипло.

/** @satisfies {Record<string, any>} */
const Pause = {
    reasons: new Set(),
    _listeners: [],
    _hidden: false,
    _blurred: false,
    _inited: false,

    get active() { return this.reasons.size > 0; },

    has(reason) { return this.reasons.has(reason); },

    // Поставить (on = true) или снять причину паузы.
    set(reason, on) {
        const had = this.reasons.has(reason);
        if (!!on === had) return;
        if (on) this.reasons.add(reason); else this.reasons.delete(reason);
        if (on && (reason === 'auto' || reason === 'platform')) window.dispatchEvent(new Event('lory-release-input'));
        for (const fn of this._listeners) {
            try { fn(this.active, reason, !!on); } catch (e) { console.error('Pause listener:', e); }
        }
    },

    toggle(reason) { this.set(reason, !this.reasons.has(reason)); },

    // fn(active, reason, on) — после каждой смены причины.
    onChange(fn) { this._listeners.push(fn); return () => { const i = this._listeners.indexOf(fn); if (i >= 0) this._listeners.splice(i, 1); }; },

    // Автопауза: скрытая вкладка или потеря фокуса окна. Фокус при старте не
    // проверяется: в iframe платформы его нет до первого касания, игра стояла бы.
    init() {
        if (this._inited) return;
        this._inited = true;
        // Playables owns lifecycle. Browser focus/visibility must not resume or pause it.
        if (typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) {
            const block = e => {
                if (this.has('platform')) {
                    if (e.key !== 'Escape' && e.code !== 'Escape') e.preventDefault();
                    e.stopImmediatePropagation();
                }
            };
            for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
                document.addEventListener(type, block, { capture: true, passive: false });
            }
            return;
        }
        const sync = () => this.set('auto', this._hidden || this._blurred);
        document.addEventListener('visibilitychange', () => {
            this._hidden = document.hidden;
            if (!this._hidden) this._blurred = false;   // мобильные возвращают вкладку без focus
            sync();
        });
        window.addEventListener('blur', () => { this._blurred = true; sync(); });
        window.addEventListener('focus', () => { this._blurred = false; sync(); });
        window.addEventListener('pointerdown', () => { if (this._blurred) { this._blurred = false; sync(); } }, true);
        window.addEventListener('pagehide', () => { this._hidden = true; sync(); });
        window.addEventListener('pageshow', () => { this._hidden = document.hidden; sync(); });
    },
};
