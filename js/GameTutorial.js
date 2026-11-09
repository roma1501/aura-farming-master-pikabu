// GameTutorial.js — мини-обучение при первом запуске: что делать и как управлять. Карточка
// сверху по центру, шаги по порядку: ходьба, камера, рывок, поза (засчитываются сами, когда игрок
// сделал действие), зоны ауры и прокачка (кнопка «Дальше»). Тексты свои для ПК
// (WASD, мышь, пробел) и телефона (джойстик пальцем, кнопка). «Пропустить» — закончить сразу.
// Флаг Game.save.tutorialDone; повтор — GameTutorial.start() (кнопка «Обучение» в настройках).
// Карточка не перехватывает касания (кроме своих кнопок) — джойстик и камера работают под ней.

// --- Числа модуля ---
const TUT_MOVE_DIST = 380;     // px мира: пройти на шаге «ходьба»
const TUT_LOOK_TIME = 0.3;     // с: крутить камеру на шаге «камера» (от первого поворота)
const TUT_DONE_DELAY = 0.7;    // с: пауза «галочки» перед следующим шагом
const TUT_START_DELAY = 1.1;   // с после «ИГРАТЬ» до первой карточки

Object.assign(LANG_STRINGS.ru, {
    'tutorial': 'Обучение',
    'tutSkip': 'Пропустить',
    'tutNext': 'Дальше',
    'tutGo': 'Играть!',
    'tutDone': 'Отлично!',
    'tutMoveT': 'Ходьба',
    'tutMovePc': 'Ходи клавишами WASD или стрелками. Или зажми мышью левую половину экрана и тяни — появится джойстик.',
    'tutMoveMob': 'Зажми пальцем левую половину экрана и веди — это джойстик. Пройдись немного!',
    'tutLookT': 'Камера',
    'tutLookPc': 'Зажми кнопку мыши в правой половине экрана и веди — камера повернётся. Колесо мыши — приближение.',
    'tutLookMob': 'Веди пальцем по правой половине экрана — камера повернётся.',
    'tutDashT': 'Рывок',
    'tutDashPc': 'Нажми ПРОБЕЛ — быстрый рывок вперёд. Им добегают до зоны и уходят от шлепка.',
    'tutDashMob': 'Нажми малую кнопку РЫВОК справа внизу — быстрый рывок вперёд.',
    'tutZoneT': 'Зоны ауры',
    'tutZone': 'На арене светятся зоны ауры. Стой в зоне — аура капает каждую секунду, а серия множит её до x5. Зоны переезжают каждые 25–35 секунд. Шлепок соперника выбивает его из зоны!',
    'tutPoseT': 'Поза',
    'tutPosePc': 'Нажми E (или кнопку «Поза»): вокруг побежит стрелка. Нажми ещё раз, когда она в зелёном окне, — «Идеально» даст всплеск ауры и фонк-момент.',
    'tutPoseMob': 'Нажми кнопку «Поза» справа внизу: вокруг побежит стрелка. Нажми ещё раз, когда она в зелёном окне, — «Идеально» даст всплеск ауры.',
    'tutUpT': 'Прокачка',
    'tutUp': 'Аура тратится на прокачку: «Скорость фарма», «Окно позы», «Сила шлепка» и новые вещи. Зайди в портал ФАРМ — и займи зону!',
});
Object.assign(LANG_STRINGS.en, {
    'tutorial': 'Tutorial',
    'tutSkip': 'Skip',
    'tutNext': 'Next',
    'tutGo': 'Play!',
    'tutDone': 'Great!',
    'tutMoveT': 'Move',
    'tutMovePc': 'Walk with WASD or the arrow keys. Or hold the mouse on the left half of the screen and drag — a joystick appears.',
    'tutMoveMob': 'Hold the left half of the screen and drag — that is the joystick. Take a walk!',
    'tutLookT': 'Camera',
    'tutLookPc': 'Hold the mouse button on the right half of the screen and drag to turn the camera. Mouse wheel zooms.',
    'tutLookMob': 'Drag on the right half of the screen to turn the camera.',
    'tutDashT': 'Dash',
    'tutDashPc': 'Press SPACE for a quick dash forward. Use it to reach a zone or dodge a slap.',
    'tutDashMob': 'Tap the small DASH button at the bottom right for a quick dash forward.',
    'tutZoneT': 'Aura zones',
    'tutZone': 'Glowing aura zones light up the arena. Stand in one — aura drips every second and your streak multiplies it up to x5. Zones move every 25–35 seconds. Slap a rival to knock them out of the zone!',
    'tutPoseT': 'Pose',
    'tutPosePc': 'Press E (or the Pose button): an arrow runs around it. Press again when it is in the green window — a Perfect pose bursts aura and starts a funk moment.',
    'tutPoseMob': 'Tap the Pose button at the bottom right: an arrow runs around it. Tap again when it is in the green window — a Perfect pose bursts aura.',
    'tutUpT': 'Upgrades',
    'tutUp': 'Aura is spent on upgrades — Farm speed, Pose window, Slap power — and on new items. Walk into the FARM portal and take a zone!',
});

/** @satisfies {Record<string, any>} */
const GameTutorial = {
    /** @type {HTMLElement | null} */
    el: null,
    active: false,
    step: -1,
    /** @type {Array<{ id: string, title: string, text: string, icon: string, auto: boolean }>} */
    steps: [],
    _moved: 0,
    _px: 0,
    _py: 0,
    _look: 0,
    _lastLook: -99,
    _dashed: false,
    _posed: false,
    _doneAt: -1,
    _startAt: -1,

    init(game) {
        this._css();
        Game.on('start', () => {
            if (Game.save && !Game.save.tutorialDone && !/[?&]notut\b/.test(location.search)) this._startAt = Game.realTime + TUT_START_DELAY;
        });
        Game.on('dash', (e) => { if (e.char === Game.player) this._dashed = true; });
        Game.on('poseTry', () => { this._posed = true; });
        Game.on('zone', (e) => { if (this.active && e.char === Game.player && e.to && e.to !== 'lobby') this.finish(); });
        void game;
    },

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gt-card{position:fixed;left:50%;top:calc(66px + env(safe-area-inset-top));z-index:9;width:min(540px,calc(100vw - 24px));box-sizing:border-box;
 transform:translateX(-50%);display:flex;gap:14px;align-items:flex-start;padding:14px 16px 12px;border-radius:20px;border:4px solid #0c2b57;
 background:linear-gradient(#3f86e0,#2a5fb8);box-shadow:0 6px 0 rgba(0,0,0,.28),0 12px 24px rgba(0,20,60,.3);color:#fff;pointer-events:none;
 font-family:GameFont,system-ui,sans-serif;font-weight:900;text-shadow:0 2px 0 rgba(0,0,0,.3);animation:gt-in .3s cubic-bezier(.2,.9,.3,1.3)}
#gt-card.gt-out{transition:opacity .25s,transform .25s;opacity:0;transform:translateX(-50%) translateY(-14px)}
@keyframes gt-in{from{opacity:0;transform:translateX(-50%) translateY(-18px) scale(.92)}to{opacity:1;transform:translateX(-50%)}}
#gt-card .gt-ic{flex:none;width:64px;height:64px;border-radius:16px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center}
#gt-card .gt-ic img{width:50px;height:50px}
#gt-card .gt-bd{flex:1;min-width:0}
#gt-card .gt-hd{display:flex;align-items:center;justify-content:space-between;gap:8px}
#gt-card .gt-t{font-size:25px;line-height:1.1;text-shadow:-2px -2px 0 #0c2b57,2px -2px 0 #0c2b57,-2px 2px 0 #0c2b57,2px 2px 0 #0c2b57,0 3px 0 rgba(0,0,0,.3)}
#gt-card .gt-n{font-size:15px;opacity:.85;white-space:nowrap}
#gt-card .gt-x{margin-top:5px;font-size:18px;line-height:1.3}
#gt-card .gt-ft{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 10px;margin-top:9px}
#gt-card .gt-dots{display:flex;gap:6px}
#gt-card .gt-dots i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.3);border:2px solid #0c2b57}
#gt-card .gt-dots i.on{background:#ffe14d}
#gt-card .gt-btns{display:flex;align-items:center;gap:8px;margin-left:auto;pointer-events:auto}
#gt-card .gu-b{min-width:0;padding:7px 14px;font-size:17px}
#gt-card .gt-skip{background:none;border:0;box-shadow:none;color:#d8e8ff;font:900 15px GameFont,system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:6px 4px;
 text-shadow:0 1px 0 rgba(0,0,0,.3)}
#gt-card .gt-ok{display:none;font-size:20px;color:#b6ff8a}
#gt-card.gt-done .gt-ok{display:inline}
#gt-card.gt-done{background:linear-gradient(#45c95a,#2a9a3c)}
#gi-dash.gt-hl{animation:gt-pulse 1s ease-in-out infinite}
@keyframes gt-pulse{0%,100%{box-shadow:0 6px 0 #0a2449,0 0 0 0 rgba(255,225,77,.9)}50%{box-shadow:0 6px 0 #0a2449,0 0 0 16px rgba(255,225,77,0)}}
@media (max-width:520px){#gt-card{top:calc(118px + env(safe-area-inset-top));padding:10px 12px;gap:10px}#gt-card .gt-ic{width:48px;height:48px}
 #gt-card .gt-ic img{width:38px;height:38px}#gt-card .gt-t{font-size:21px}#gt-card .gt-x{font-size:15.5px}}
@media (max-height:430px){#gt-card{top:calc(10px + env(safe-area-inset-top));width:min(480px,calc(100vw - 340px));min-width:300px;padding:8px 12px}
 #gt-card .gt-ic{display:none}#gt-card .gt-t{font-size:19px}#gt-card .gt-x{font-size:14.5px;margin-top:3px}#gt-card .gt-ft{margin-top:5px}}
`;
        document.head.appendChild(st);
    },

    // Шаги под устройство (тексты ПК и телефона разные).
    _build() {
        const mob = IS_MOBILE, T = (k) => Lang.t(k);
        this.steps = [
            { id: 'move', title: T('tutMoveT'), text: T(mob ? 'tutMoveMob' : 'tutMovePc'), icon: 'assets/ui/joystick_knob.png', auto: true },
            { id: 'look', title: T('tutLookT'), text: T(mob ? 'tutLookMob' : 'tutLookPc'), icon: 'assets/ui/icon_swirl.png', auto: true },
            { id: 'dash', title: T('tutDashT'), text: T(mob ? 'tutDashMob' : 'tutDashPc'), icon: 'assets/ui/icon_dash.png', auto: true },
            { id: 'zone', title: T('tutZoneT'), text: T('tutZone'), icon: 'assets/ui/icon_star.png', auto: false },
            { id: 'pose', title: T('tutPoseT'), text: T(mob ? 'tutPoseMob' : 'tutPosePc'), icon: 'assets/ui/icon_crown.png', auto: true },
            { id: 'up', title: T('tutUpT'), text: T('tutUp'), icon: 'assets/ui/icon_bolt.png', auto: false },
        ];
    },

    // Подсветка кнопки «Поза» на шаге позы.
    _hlPose(on) {
        const el = typeof GameFarm !== 'undefined' ? GameFarm.el.pose : null;
        if (el) el.classList.toggle('gt-hl', on);
    },

    // Начать (или начать заново) с первого шага.
    start() {
        this._startAt = -1;
        this._build();
        this.active = true;
        this._go(0);
    },

    _go(i) {
        this.step = i;
        this._doneAt = -1;
        const s = this.steps[i];
        if (!s) { this.finish(); return; }
        const p = Game.player;
        this._moved = 0;
        if (p) { this._px = p.x; this._py = p.y; }
        this._look = 0;
        this._lastLook = GameInput.lastLookTime;
        this._dashed = false;
        this._posed = false;
        if (GameInput.dashEl) GameInput.dashEl.classList.toggle('gt-hl', s.id === 'dash');
        this._hlPose(s.id === 'pose');
        this._render(s);
    },

    _render(s) {
        if (this.el) this.el.remove();
        const el = this.el = document.createElement('div');
        el.id = 'gt-card';
        el.innerHTML = '<div class="gt-ic"><img alt=""></div><div class="gt-bd"><div class="gt-hd"><span class="gt-t"></span>' +
            '<span class="gt-n"></span></div><div class="gt-x"></div><div class="gt-ft"><div class="gt-dots"></div>' +
            '<span class="gt-ok"></span><div class="gt-btns"></div></div></div>';
        /** @type {HTMLImageElement} */ (el.querySelector('.gt-ic img')).src = s.icon;
        el.querySelector('.gt-t').textContent = s.title;
        el.querySelector('.gt-n').textContent = (this.step + 1) + '/' + this.steps.length;
        el.querySelector('.gt-x').textContent = s.text;
        el.querySelector('.gt-ok').textContent = '✔ ' + Lang.t('tutDone');
        const dots = el.querySelector('.gt-dots');
        for (let k = 0; k < this.steps.length; k++) {
            const d = document.createElement('i');
            if (k <= this.step) d.className = 'on';
            dots.appendChild(d);
        }
        const btns = el.querySelector('.gt-btns');
        const last = this.step === this.steps.length - 1;
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'gt-skip';
        skip.textContent = Lang.t('tutSkip');
        skip.addEventListener('click', (e) => { e.stopPropagation(); if (typeof GameUI !== 'undefined') GameUI.click(); this.finish(); });
        if (!last) btns.appendChild(skip);
        if (!s.auto && typeof GameUI !== 'undefined') {
            btns.appendChild(GameUI.button(Lang.t(last ? 'tutGo' : 'tutNext'), last ? 'green' : 'orange', () => this._go(this.step + 1)));
        }
        document.body.appendChild(el);
    },

    // Шаг выполнен: зелёная карточка с «галочкой», через TUT_DONE_DELAY — следующий.
    _complete() {
        if (this._doneAt >= 0) return;
        this._doneAt = Game.realTime + TUT_DONE_DELAY;
        if (this.el) this.el.classList.add('gt-done');
        if (typeof Sound !== 'undefined') Sound.play('assets/sounds/aura_gain.mp3', { volume: 0.8 });
    },

    // Закончить: флаг в сохранение, карточка гаснет.
    finish() {
        this.active = false;
        this.step = -1;
        this._startAt = -1;
        if (GameInput.dashEl) GameInput.dashEl.classList.remove('gt-hl');
        this._hlPose(false);
        if (Game.save && !Game.save.tutorialDone) { Game.save.tutorialDone = true; Game.saveSoon(); }
        const el = this.el;
        this.el = null;
        if (el) { el.classList.add('gt-out'); setTimeout(() => el.remove(), 300); }
    },

    update(dt, realDt) {
        if (this._startAt >= 0 && Game.realTime >= this._startAt) {
            if (Game.zone === 'lobby') this.start(); else this._startAt = -1;
        }
        if (!this.active) return;
        if (this._doneAt >= 0) {
            if (Game.realTime >= this._doneAt) this._go(this.step + 1);
            return;
        }
        const s = this.steps[this.step], p = Game.player;
        if (!s || !p) return;
        if (s.id === 'move') {
            this._moved += Math.min(200, Math.hypot(p.x - this._px, p.y - this._py));
            this._px = p.x; this._py = p.y;
            if (this._moved >= TUT_MOVE_DIST) this._complete();
        } else if (s.id === 'look') {
            // Крутит камеру: время от первого поворота на этом шаге до последнего.
            const t = GameInput.lastLookTime;
            if (t !== this._lastLook) {
                this._lastLook = t;
                if (this._look <= 0) this._look = t;
                else if (t - this._look >= TUT_LOOK_TIME) this._complete();
            }
        } else if (s.id === 'dash') {
            if (this._dashed) this._complete();
        } else if (s.id === 'pose') {
            if (this._posed) this._complete();
        }
    },
};
