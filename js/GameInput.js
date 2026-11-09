// GameInput.js — управление (DESIGN.md §0.4, §4): экранный джойстик — один и тот же на
// телефоне и на ПК (на ПК его тянут мышью), перетаскивание по свободной части экрана —
// поворот камеры, кнопка «Рывок» (круглая синяя, справа внизу — в зоне большого пальца, с кольцом
// перезарядки). На ПК ещё WASD / стрелки — движение, пробел — рывок (подсказка «Пробел» на кнопке).
//
// Джойстик — картинки assets/ui/joystick_base.png (база) и joystick_knob.png (ручка),
// центрирование translate(-50%,-50%); появляется и гаснет плавно, при касании база
// «впрыгивает» под палец, после отпускания ручка и база мягко возвращаются на место.
// База внизу слева. Стик «плавающий» и для пальца, и для мыши: нажатие в левых GAME_JOY_ZONE
// экрана (ниже верхних GAME_JOY_TOP) ставит базу под палец/курсор; нейтраль — сама точка
// нажатия (у края экрана база рисуется сдвинутой внутрь, но стик не «едет» без движения).
// Кнопки HUD лежат выше слоя ввода и нажимаются как обычно. Мультитач: стик, камера и кнопка —
// разные пальцы.
// Вектор GameInput.vector = { x вправо, y вперёд (вверх по экрану) }, длина 0..1 —
// направление движения ОТНОСИТЕЛЬНО КАМЕРЫ (переводит GamePlayer).
//
// Камера: consumeLook() -> { dx, dy } экранных px с прошлого кадра; lastLookTime —
// когда игрок последний раз крутил камеру (realTime Game). Колесо — consumeZoom().
// setEnabled(false) (телепорт) обнуляет выход, но палец на стике продолжает отслеживаться:
// после включения стик работает без повторного касания. reset() — забыть всё зажатое:
// событие window 'lory-release-input' (автопауза), потеря фокуса, окно настроек.
//
// API: move, vector, joyActive, enabled, visible, R (ход стика, px), consumeLook/Zoom/Dash,
// setDashCooldown(left, total), setEnabled, setVisible, forced (отладка), flush(), reset(),
// joyRect() -> { x, y, r } — база по умолчанию на экране (для раскладки HUD).

/** @satisfies {Record<string, any>} */
const GameInput = {
    vector: { x: 0, y: 0 },
    enabled: false,
    visible: false,
    lastLookTime: -99,
    /** @type {{ x: number, y: number } | null} */
    forced: null,                 // отладка: вектор вместо джойстика (Game.debug.joy)
    _lookX: 0,
    _lookY: 0,
    _zoom: 0,
    _dash: false,
    /** @type {Set<string>} */
    _keys: new Set(),             // зажатые клавиши движения (WASD, стрелки)
    _keyVec: { x: 0, y: 0 },
    _ringC: 2 * Math.PI * 58,     // длина кольца перезарядки рывка
    // cx, cy — центр базы на экране; ox, oy — сдвиг нейтрали от центра (тач у края экрана);
    // x, y — ручка; px, py — последняя точка пальца.
    /** @type {{ id: number, cx: number, cy: number, ox: number, oy: number, x: number, y: number, px: number, py: number, floating: boolean } | null} */
    _joy: null,
    /** @type {Map<number, { x: number, y: number }>} */
    _looks: new Map(),
    /** @type {HTMLElement | null} */
    layer: null,
    /** @type {HTMLElement | null} */
    joyEl: null,
    /** @type {HTMLElement | null} */
    baseEl: null,
    /** @type {HTMLElement | null} */
    knobEl: null,
    /** @type {HTMLElement | null} */
    dashEl: null,
    /** @type {SVGCircleElement | null} */
    _ring: null,
    _dashFrac: 0,
    // Коды клавиш движения на ПК (e.code не зависит от раскладки: WASD работают и на русской).
    MOVE_KEYS: { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 },
    R: 64,                        // ход стика, экранных px (на маленьком экране — меньше)

    init(game) {
        const short = Math.min(VIEW.w, VIEW.h);
        this.R = Math.round(GameCfg.joyRadius * (IS_MOBILE ? Math.max(0.68, Math.min(1, short / 520)) : 1));
        this._css();
        const layer = this.layer = document.createElement('div');
        layer.id = 'gi-layer';
        document.body.appendChild(layer);
        // Джойстик: позиция — у .gi-joy (translate центра), «впрыгивание» — у .gi-base.
        const joy = this.joyEl = document.createElement('div');
        joy.className = 'gi-joy gi-hidden gi-idle';
        joy.innerHTML = '<div class="gi-base"><div class="gi-knob"></div></div>';
        this.baseEl = /** @type {HTMLElement} */ (joy.querySelector('.gi-base'));
        this.knobEl = /** @type {HTMLElement} */ (joy.querySelector('.gi-knob'));
        document.body.appendChild(joy);
        const dash = this.dashEl = document.createElement('button');
        dash.type = 'button';
        dash.id = 'gi-dash';
        dash.className = 'gi-hidden' + (IS_MOBILE ? ' gi-mobile' : '');
        const C = this._ringC;
        dash.innerHTML = '<svg viewBox="0 0 124 124" aria-hidden="true"><circle class="gi-ring-bg" cx="62" cy="62" r="58"/>' +
            '<circle class="gi-ring" cx="62" cy="62" r="58" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="0"/></svg>' +
            '<img src="assets/ui/icon_dash.png" alt=""><span class="gi-label" data-t="dash"></span>' +
            (IS_MOBILE ? '' : '<span class="gi-kbd" data-t="dashKey"></span>');
        document.body.appendChild(dash);
        this._ring = /** @type {SVGCircleElement} */ (dash.querySelector('.gi-ring'));
        Lang.apply(dash);
        dash.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.enabled) this._dash = true; });
        layer.addEventListener('pointerdown', (e) => this._down(e));
        layer.addEventListener('pointermove', (e) => this._move(e));
        layer.addEventListener('pointerup', (e) => this._up(e));
        layer.addEventListener('pointercancel', (e) => this._up(e));
        layer.addEventListener('lostpointercapture', (e) => this._up(e));
        layer.addEventListener('wheel', (e) => { e.preventDefault(); if (this.enabled) this._zoom += Math.sign(e.deltaY); }, { passive: false });
        window.addEventListener('keydown', (e) => {
            const t = /** @type {HTMLElement} */ (e.target);
            if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
            if (GameInput.MOVE_KEYS[e.code]) { e.preventDefault(); this._keys.add(e.code); this._updKeys(); return; }
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.enabled && !e.repeat) this._dash = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (GameInput.MOVE_KEYS[e.code]) { this._keys.delete(e.code); this._updKeys(); }
        });
        window.addEventListener('lory-release-input', () => this.reset());
        window.addEventListener('blur', () => this.reset());
        window.addEventListener('resize', () => this._placeBase());
        this._placeBase();
        void game;
    },

    _css() {
        const R = this.R, B = Math.round(R * 1.3), K = Math.round(R * 0.52);
        const st = document.createElement('style');
        st.textContent = `
#gi-layer{position:fixed;inset:0;z-index:5;touch-action:none;-webkit-tap-highlight-color:transparent}
.gi-joy{position:fixed;left:0;top:0;width:${2 * B}px;height:${2 * B}px;z-index:7;pointer-events:none;opacity:1;visibility:visible;
 transition:opacity .25s ease,visibility 0s linear 0s;will-change:transform}
.gi-joy.gi-idle{opacity:.62}
.gi-joy.gi-ret{transition:opacity .25s ease,visibility 0s linear 0s,transform .24s cubic-bezier(.2,.8,.3,1)}
.gi-joy.gi-hidden{opacity:0;visibility:hidden;transition:opacity .25s ease,visibility 0s linear .25s}
.gi-base{position:absolute;inset:0;background:url('assets/ui/joystick_base.png') center/100% 100% no-repeat;
 filter:drop-shadow(0 4px 8px rgba(0,30,60,.28))}
.gi-joy.gi-pop .gi-base{animation:gi-pop .16s ease-out}
@keyframes gi-pop{from{transform:scale(.8);opacity:.5}to{transform:scale(1);opacity:1}}
.gi-knob{position:absolute;left:50%;top:50%;width:${2 * K}px;height:${2 * K}px;transform:translate(-50%,-50%);
 background:url('assets/ui/joystick_knob.png') center/100% 100% no-repeat;filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))}
.gi-knob.gi-ret{transition:transform .14s ease-out}
#gi-dash{position:fixed;right:calc(30px + env(safe-area-inset-right));bottom:calc(40px + env(safe-area-inset-bottom));z-index:8;width:108px;height:108px;padding:0;
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;border-radius:50%;border:4px solid #0c2b57;cursor:pointer;
 background:radial-gradient(circle at 34% 28%,#9cecff 0%,#38b6ff 38%,#1a6ee0 78%,#1453b8 100%);
 box-shadow:0 6px 0 #0a2449,0 12px 20px rgba(0,20,60,.35),inset 0 4px 0 rgba(255,255,255,.4),inset 0 -6px 0 rgba(0,20,80,.25);color:#fff;
 font:900 17px/1 GameFont,system-ui,sans-serif;letter-spacing:.5px;text-transform:uppercase;
 text-shadow:-1.5px -1.5px 0 #0c2b57,1.5px -1.5px 0 #0c2b57,-1.5px 1.5px 0 #0c2b57,1.5px 1.5px 0 #0c2b57,0 3px 0 rgba(0,0,0,.3);
 touch-action:none;-webkit-tap-highlight-color:transparent;user-select:none;opacity:1;visibility:visible;
 transition:filter .15s,transform .08s,opacity .25s ease,visibility 0s linear 0s}
#gi-dash.gi-hidden{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .25s ease,visibility 0s linear .25s}
#gi-dash:active{transform:translateY(3px) scale(.96)}
#gi-dash.gi-cool{filter:saturate(.3) brightness(.82)}
#gi-dash img{width:50px;height:50px;margin-top:-4px;filter:drop-shadow(0 2px 0 rgba(0,20,60,.45));pointer-events:none}
#gi-dash .gi-label{margin-top:-1px;pointer-events:none}
#gi-dash .gi-kbd{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%);padding:4px 10px 5px;border-radius:9px;border:3px solid #0c2b57;
 background:linear-gradient(#ffffff,#dfe9f5);color:#13325c;font:900 14px/1 GameFont,system-ui,sans-serif;letter-spacing:0;text-transform:none;text-shadow:none;
 box-shadow:0 3px 0 #0c2b57;white-space:nowrap;pointer-events:none}
#gi-dash svg{position:absolute;left:-12px;top:-12px;width:calc(100% + 24px);height:calc(100% + 24px);transform:rotate(-90deg);pointer-events:none}
#gi-dash .gi-ring-bg{fill:none;stroke:rgba(255,255,255,0);stroke-width:7}
#gi-dash.gi-cool .gi-ring-bg{stroke:rgba(10,36,73,.35)}
#gi-dash .gi-ring{fill:none;stroke:#ffe14d;stroke-width:7;stroke-linecap:round}
#gi-dash.gi-mobile{right:calc(20px + env(safe-area-inset-right));bottom:calc(max(26px, 6vh) + env(safe-area-inset-bottom));width:94px;height:94px;font-size:15px}
#gi-dash.gi-mobile img{width:44px;height:44px}
@media (max-height:430px){#gi-dash.gi-mobile{bottom:calc(14px + env(safe-area-inset-bottom));transform-origin:100% 100%;scale:.86}}
`;
        document.head.appendChild(st);
    },

    // База джойстика по умолчанию: внизу слева.
    _base() {
        const B = this.R * 1.3, W = VIEW.w, H = VIEW.h;
        const x = IS_MOBILE ? Math.max(B + 18, Math.min(W * 0.2, B + 60)) : B + 28;
        const y = H - B - (IS_MOBILE ? Math.max(36, H * 0.06) : 30);
        return { x, y };
    },

    // База по умолчанию на экране: центр (x, y) и радиус r картинки — для раскладки HUD.
    joyRect() {
        const b = this._base();
        return { x: b.x, y: b.y, r: this.R * 1.3 };
    },

    _placeBase() {
        if (this._joy) return;
        const b = this._base();
        this._setJoy(b.x, b.y, b.x, b.y);
    },

    _setJoy(cx, cy, x, y) {
        if (!this.joyEl) return;
        this.joyEl.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px) translate(-50%,-50%)';
        this.knobEl.style.transform = 'translate(-50%,-50%) translate(' + (x - cx).toFixed(1) + 'px,' + (y - cy).toFixed(1) + 'px)';
    },

    // Стик схвачен: база — сразу под палец (без «езды»), лёгкое «впрыгивание».
    _grabFx(moved) {
        const j = this.joyEl;
        j.classList.remove('gi-idle', 'gi-ret');
        this.knobEl.classList.remove('gi-ret');
        if (moved) {
            j.classList.remove('gi-pop');
            void j.offsetWidth;
            j.classList.add('gi-pop');
        }
    },

    // Стик отпущен: ручка и база плавно возвращаются, стик полупрозрачный.
    _releaseFx() {
        if (!this.joyEl) return;
        this.joyEl.classList.add('gi-idle', 'gi-ret');
        this.knobEl.classList.add('gi-ret');
    },

    _down(e) {
        if (!this.enabled) return;
        e.preventDefault();
        const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        const W = VIEW.w, H = VIEW.h, ex = e.clientX - VIEW.x, ey = e.clientY - VIEW.y;
        let joy = false;
        if (!this._joy) {
            const b = this._base();
            // Вся левая часть экрана — и для пальца, и для мыши (левая кнопка).
            joy = (touch || e.button === 0) && ex < W * GameCfg.joyZone && ey >= H * GameCfg.joyTop;
            if (joy) {
                const B = this.R * 1.3;
                const cx = Math.max(B + 8, Math.min(W - B - 8, ex));
                const cy = Math.max(B + 8, Math.min(H - B - 8, ey));
                // Нейтраль — точка нажатия (база у края сдвинута внутрь только на экране).
                const ox = ex - cx, oy = ey - cy;
                this._joy = { id: e.pointerId, cx, cy, ox, oy, x: ex, y: ey, px: ex, py: ey, floating: true };
                this._grabFx(Math.hypot(cx - b.x, cy - b.y) > 4);
                this._joyMove(ex, ey);
            }
        }
        if (!joy) this._looks.set(e.pointerId, { x: ex, y: ey });
        try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* синтетическое событие */ }
    },

    _move(e) {
        const ex = e.clientX - VIEW.x, ey = e.clientY - VIEW.y;
        const j = this._joy;
        if (j && e.pointerId === j.id) {
            j.px = ex; j.py = ey;
            if (this.enabled) this._joyMove(ex, ey);
            return;
        }
        const l = this._looks.get(e.pointerId);
        if (!l) return;
        const dx = ex - l.x, dy = ey - l.y;
        if ((dx || dy) && this.enabled) {
            this._lookX += dx; this._lookY += dy;
            this.lastLookTime = Game.realTime;
        }
        l.x = ex; l.y = ey;
    },

    _joyMove(x, y) {
        const j = this._joy, R = this.R;
        j.px = x; j.py = y;
        let dx = x - j.ox - j.cx, dy = y - j.oy - j.cy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        j.x = j.cx + dx; j.y = j.cy + dy;
        let vx = dx / R, vy = -dy / R;
        const len = Math.hypot(vx, vy);
        const dead = GameCfg.joyDead;
        if (len < dead) { vx = 0; vy = 0; } else { const k = (len - dead) / (1 - dead) / len; vx *= k; vy *= k; }
        this.vector.x = vx; this.vector.y = vy;
        this._setJoy(j.cx, j.cy, j.x, j.y);
    },

    _up(e) {
        const j = this._joy;
        if (j && e.pointerId === j.id) {
            this._joy = null;
            this.vector.x = 0; this.vector.y = 0;
            this._releaseFx();
            this._placeBase();
        }
        this._looks.delete(e.pointerId);
    },

    // Забыть всё зажатое (автопауза, потеря фокуса, настройки): пальцы надо поставить заново.
    reset() {
        const had = !!this._joy;
        this._joy = null;
        this._looks.clear();
        this.vector.x = 0; this.vector.y = 0;
        this._lookX = this._lookY = 0;
        this._dash = false;
        this._keys.clear();
        this._updKeys();
        if (had) this._releaseFx(); else if (this.joyEl) this.joyEl.classList.add('gi-idle');
        this._placeBase();
    },

    // Сбросить накопленное (поворот камеры, рывок), не отпуская пальцы (смена зоны).
    flush() {
        this._lookX = this._lookY = 0;
        this._dash = false;
    },

    // Выключено: выход нулевой, но пальцы отслеживаются; включено — стик снова от пальца.
    setEnabled(on) {
        this.enabled = !!on;
        const j = this._joy;
        if (!on) {
            this.vector.x = 0; this.vector.y = 0;
            this.flush();
            if (j) this._setJoy(j.cx, j.cy, j.cx, j.cy);
        } else if (j) {
            this._joyMove(j.px, j.py);
        }
    },

    // Показать/спрятать джойстик и «Рывок» (плавно).
    setVisible(on) {
        this.visible = !!on;
        for (const el of [this.joyEl, this.dashEl]) if (el) el.classList.toggle('gi-hidden', !on);
        if (this.joyEl && !this._joy) this.joyEl.classList.add('gi-idle');
    },

    // Клавиши движения ПК -> вектор (как у стика: x вправо, y вперёд, длина 0..1).
    _updKeys() {
        const K = this._keys, has = (a, b) => K.has(a) || K.has(b);
        let x = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
        let y = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
        const l = Math.hypot(x, y);
        if (l > 1) { x /= l; y /= l; }
        this._keyVec.x = x; this._keyVec.y = y;
    },

    get _keysActive() { return this.enabled && (this._keyVec.x !== 0 || this._keyVec.y !== 0); },

    // Вектор движения: отладочная подмена > стик > клавиатура.
    get move() {
        if (this.forced) return this.forced;
        if (!this._joy && this._keysActive) return this._keyVec;
        return this.vector;
    },

    get joyActive() { return !!this._joy || !!this.forced || this._keysActive; },

    consumeLook() {
        const r = { dx: this._lookX, dy: this._lookY };
        this._lookX = 0; this._lookY = 0;
        return r;
    },

    consumeZoom() { const z = this._zoom; this._zoom = 0; return z; },

    consumeDash() { const d = this._dash; this._dash = false; return d; },

    // Перезарядка рывка: left — секунд до готовности, total — полная перезарядка.
    setDashCooldown(left, total) {
        const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
        if (Math.abs(frac - this._dashFrac) < 0.004 && frac !== 0) return;
        this._dashFrac = frac;
        if (this._ring) this._ring.setAttribute('stroke-dashoffset', (this._ringC * frac).toFixed(2));
        if (this.dashEl) this.dashEl.classList.toggle('gi-cool', frac > 0);
    },
};
