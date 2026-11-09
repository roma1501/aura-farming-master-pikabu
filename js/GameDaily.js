// GameDaily.js — ежедневный подарок: календарь 7 дней. Дни 1–6 — аура (50, 75, 100, 150, 200,
// 300), день 7 — уникальный скин «Королевский»: вещи каталога с exclusive: 'daily' (COSMETICS)
// + корона из магазина — GameWardrobe.give(id, { equip: true }); скин уже есть (или гардероба
// нет) — DAILY_SKIN_AURA ауры.
//
// Правила: забрать — раз в календарный день (локальная дата устройства); пропущен день —
// серия снова с 1-го дня; после 7-го — новый круг. Аура дня — Game.addAura(raw) (идёт и в
// заработанное за всё время); «Забрать ×2 — за рекламу» — только для дней с аурой, награда —
// только при Platform.rewarded('daily_x2') === true, и один раз (день сразу отмечается).
// Сохранение: Game.save.daily = { day — последний полученный день круга (0…7), last — дата
// получения 'YYYY-MM-DD' (местная) }.
//
// Интерфейс: окно GameUI.modal (тема gold) — 7 карточек (иконки daily_day / daily_day7, сумма,
// «Получено» с daily_check; текущий день подсвечен и пульсирует, будущие — затемнены), подсказка
// или таймер до следующего подарка, кнопки «Забрать» и «Забрать ×2 — за рекламу». Кнопка HUD
// «Подарок» (GameUI.addHudButton, order 8) с красной меткой, когда подарок можно забрать.
// Автопоказ — после «ИГРАТЬ», если подарок доступен: в лобби, без других окон, после мини-обучения
// (GameTutorial.active — ждём конца). В отладке (?debug / ?autostart) автопоказа нет — включить
// ?daily; ?nodaily — выключить всегда.
//
// API: open() — окно, status() -> { can, next, done, claimed, broken }, reward(day) -> { aura, skin },
//   claim(double?) -> Promise<boolean>, debugShift(days) — «перемотать» дату (Game.debug.dailyShift).
// Событие daily { day, aura, skin } — подарок получен.

const DAILY_DAYS = 7;                 // дней в круге
const DAILY_REWARDS = [50, 75, 100, 150, 200, 300];   // аура дней 1–6 (день 7 — скин)
const DAILY_SKIN_AURA = 600;          // день 7, если «Королевский» скин уже есть
const DAILY_AUTO_DELAY = 1.4;         // с после «ИГРАТЬ» до автопоказа окна
const DAILY_AFTER_TUT = 0.9;          // с после конца мини-обучения до окна
const DAILY_RETRY = 0.5;              // с: повтор автопоказа, пока мешает (не лобби, другое окно)
const DAILY_CHECK_EVERY = 1;          // с: проверка «можно забрать» (смена даты) — метка HUD
// Вещи магазина, которые дарятся вместе со скином (к exclusive 'daily' из каталога).
const DAILY_SKIN_EXTRA = ['crown'];
// Запас, если каталога нет.
const DAILY_SKIN_IDS = ['shirt_royal', 'pants_royal', 'aura_royal', 'cape_royal'];

// Иконки — строковыми литералами (сборщик видит только литералы); нет файла — запасная иконка.
/** @type {Record<string, string>} */
const DAILY_ICONS = { day: 'assets/ui/daily_day.png', day7: 'assets/ui/daily_day7.png', check: 'assets/ui/daily_check.png' };
/** @type {Record<string, string>} */
const DAILY_FALLBACK = { day: 'assets/ui/icon_gift.png', day7: 'assets/ui/icon_crown.png', check: 'assets/ui/icon_check.png' };

Object.assign(LANG_STRINGS.ru, {
    dailyBtn: 'Подарок',
    dailyTitle: 'Ежедневный подарок',
    dailyDay: 'День {n}',
    dailyGot: 'Получено',
    dailyToday: 'Сегодня',
    dailyTomorrow: 'Завтра',
    dailySkin: 'Королевский скин',
    dailyClaim: 'Забрать',
    dailyClaimX2: 'Забрать ×2 — за рекламу',
    dailyOk: 'Отлично!',
    dailyNext: 'Следующий подарок через {t}',
    dailyHint: 'Заходи каждый день — на 7-й день королевский скин!',
    dailyHintAura: 'Заходи каждый день — подарки всё больше!',
    dailyBroken: 'Серия прервалась — снова с 1-го дня',
    dailyGotAura: 'Подарок: +{n} ауры!',
    dailyGotSkin: 'Королевский скин — твой!',
    dailyAdFail: 'Реклама не досмотрена',
});
Object.assign(LANG_STRINGS.en, {
    dailyBtn: 'Gift',
    dailyTitle: 'Daily Gift',
    dailyDay: 'Day {n}',
    dailyGot: 'Claimed',
    dailyToday: 'Today',
    dailyTomorrow: 'Tomorrow',
    dailySkin: 'Royal Skin',
    dailyClaim: 'Claim',
    dailyClaimX2: 'Claim ×2 — watch an ad',
    dailyOk: 'Great!',
    dailyNext: 'Next gift in {t}',
    dailyHint: 'Come back every day — the Royal Skin awaits on day 7!',
    dailyHintAura: 'Come back every day — gifts keep growing!',
    dailyBroken: 'Streak lost — back to day 1',
    dailyGotAura: 'Gift: +{n} aura!',
    dailyGotSkin: 'The Royal Skin is yours!',
    dailyAdFail: 'The ad was not finished',
});

/** @typedef {{ can: boolean, next: number, done: number, claimed: boolean, broken: boolean }} DailyStatus */

/** @satisfies {Record<string, any>} */
const GameDaily = {
    /** @type {{ el: HTMLElement, body: HTMLElement, close: () => void, closed: boolean } | null} */
    _modal: null,
    _timer: 0,
    _shift: 0,               // отладка: дней вперёд к сегодняшней дате
    _busy: false,            // идёт реклама «×2»
    _autoAt: -1,             // Game.realTime автопоказа (-1 — нет)
    _tutWas: false,
    _checkAt: 0,
    /** @type {boolean | null} */
    _can: null,
    _shownCan: false,
    _justClaimed: 0,         // день, полученный в открытом окне (анимация отметки)
    /** @type {Record<string, boolean>} */
    _missing: {},

    // --- Жизненный цикл ----------------------------------------------------------------

    init(game) {
        this._css();
        this._data();
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (ui && typeof ui.addHudButton === 'function') {
            ui.addHudButton({ id: 'daily', icon: 'assets/ui/icon_gift.png', text: Lang.t('dailyBtn'), theme: 'pink', order: 8, onClick: () => this.open() });
        }
        this._syncBadge(true);
        Game.on('start', () => { if (this._autoAllowed()) this._autoAt = Game.realTime + DAILY_AUTO_DELAY; });
        void game;
    },

    update(dt, realDt) {
        const t = Game.realTime;
        if (t >= this._checkAt) { this._checkAt = t + DAILY_CHECK_EVERY; this._syncBadge(false); }
        if (this._autoAt >= 0 && t >= this._autoAt) this._tryAuto();
        void dt; void realDt;
    },

    // Автопоказ: только если подарок доступен; ждёт конца обучения, лобби и закрытых окон.
    _tryAuto() {
        const t = Game.realTime;
        if (!this.status().can) { this._autoAt = -1; return; }
        const tut = typeof GameTutorial !== 'undefined' ? GameTutorial : null;
        if (tut && (tut.active || tut._startAt >= 0)) { this._tutWas = true; this._autoAt = t + DAILY_RETRY / 2; return; }
        if (this._tutWas) { this._tutWas = false; this._autoAt = t + DAILY_AFTER_TUT; return; }
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        const busy = !Game.started || Game.transitioning || Game.zone !== 'lobby' || this._busy ||
            (ui && ui._modals && ui._modals.length > 0) || (ui && ui.settingsEl && ui.settingsEl.classList.contains('gu-open'));
        if (busy) { this._autoAt = t + DAILY_RETRY; return; }
        this._autoAt = -1;
        this.open();
    },

    _autoAllowed() {
        const q = window.location.search + window.location.hash;
        if (/[?&#]nodaily\b/.test(q)) return false;
        if (/[?&#](debug|autostart)\b/.test(q) && !/[?&#]daily\b/.test(q)) return false;
        return true;
    },

    // --- Дата и состояние ----------------------------------------------------------------

    // Номер сегодняшнего дня по МЕСТНОЙ дате (дней от 1970-01-01) + сдвиг отладки.
    today() {
        const d = new Date();
        return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) + this._shift;
    },

    _key(n) { return new Date(n * 86400000).toISOString().slice(0, 10); },

    _num(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
        return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
    },

    // Game.save.daily — проверенный { day, last }.
    _data() {
        const s = Game.save;
        if (!s) return { day: 0, last: '' };
        let d = s.daily;
        if (!d || typeof d !== 'object') d = s.daily = { day: 0, last: '' };
        d.day = Math.max(0, Math.min(DAILY_DAYS, Math.round(Number(d.day) || 0)));
        if (typeof d.last !== 'string') d.last = '';
        return d;
    },

    // can — можно забрать сегодня; next — день круга к получению (can = false — завтрашний);
    // done — сколько дней круга уже отмечено «Получено»; claimed — сегодня уже забран;
    // broken — серия прервалась (пропущен день).
    /** @returns {DailyStatus} */
    status() {
        const d = this._data(), today = this.today(), last = this._num(d.last);
        if (last === null || d.day <= 0) return { can: true, next: 1, done: 0, claimed: false, broken: false };
        const full = d.day >= DAILY_DAYS;
        if (today <= last) return { can: false, next: full ? 1 : d.day + 1, done: d.day, claimed: today === last, broken: false };
        if (today === last + 1) return { can: true, next: full ? 1 : d.day + 1, done: full ? 0 : d.day, claimed: false, broken: false };
        return { can: true, next: 1, done: 0, claimed: false, broken: true };
    },

    // Награда дня: { aura, skin }. День 7 — скин, если его ещё нет и есть гардероб.
    reward(day) {
        if (day >= DAILY_DAYS) return this._skinGivable() ? { aura: 0, skin: true } : { aura: DAILY_SKIN_AURA, skin: false };
        return { aura: DAILY_REWARDS[day - 1] || 0, skin: false };
    },

    _wardrobe() {
        const w = typeof GameWardrobe !== 'undefined' ? /** @type {any} */ (GameWardrobe) : null;
        return w && typeof w.give === 'function' ? w : null;
    },

    // Вещи «Королевского» скина: exclusive 'daily' из каталога.
    _skinIds() {
        const cat = typeof COSMETICS !== 'undefined' && COSMETICS && Array.isArray(COSMETICS.items) ? COSMETICS.items : [];
        const list = cat.filter(i => i.exclusive === 'daily').map(i => i.id);
        return list.length ? list : DAILY_SKIN_IDS.slice();
    },

    // Скин можно подарить: гардероб есть и хотя бы одной вещи скина у игрока нет.
    _skinGivable() {
        const w = this._wardrobe();
        if (!w) return false;
        if (typeof w.owns !== 'function') return true;
        return this._skinIds().some(id => { try { return !w.owns(id); } catch (e) { return true; } });
    },

    _giveSkin() {
        const w = this._wardrobe();
        if (!w) return false;
        let any = false;
        for (const id of this._skinIds().concat(DAILY_SKIN_EXTRA)) {
            try { w.give(id, { equip: true }); any = true; } catch (e) { console.error('GameDaily: give ' + id, e); }
        }
        return any;
    },

    // --- Получение --------------------------------------------------------------------------

    // Забрать подарок дня. double — «×2 за рекламу» (только дни с аурой; награда — только при
    // true от SDK). -> true — получено.
    async claim(double) {
        if (this._busy || !Game.player || !Game.save) return false;
        let st = this.status();
        if (!st.can) return false;
        let rw = this.reward(st.next);
        if (double && !(rw.aura > 0)) return false;
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (double) {
            this._busy = true;
            this._render();
            let ok = false;
            try { ok = (await Platform.rewarded('daily_x2')) === true; } catch (e) { ok = false; }
            this._busy = false;
            st = this.status();
            if (!ok || !st.can) {
                if (!ok && ui) ui.toast(Lang.t('dailyAdFail'), 2);
                this._render();
                return false;
            }
            rw = this.reward(st.next);
            if (!(rw.aura > 0)) { this._render(); return false; }
        }
        const p = Game.player, day = st.next;
        // Сначала отметка дня (повторный вызов уже не пройдёт), потом награда.
        Game.save.daily = { day, last: this._key(this.today()) };
        let aura = 0, skin = false;
        if (rw.skin) skin = this._giveSkin();
        if (!skin) {
            aura = (rw.aura || DAILY_SKIN_AURA) * (double ? 2 : 1);
            Game.addAura(p, aura, { raw: true });
        }
        Game.saveNow();
        this._justClaimed = day;
        this._celebrate(p, aura, skin);
        Game.emit('daily', { day, aura, skin });
        this._syncBadge(true);
        this._render();
        return true;
    },

    _celebrate(p, aura, skin) {
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (skin) Sound.play('assets/sounds/unlock.mp3', { volume: 1 });
        Sound.play('assets/sounds/coin.mp3', { volume: 1 });
        Sound.play('assets/sounds/aura_gain.mp3', { volume: 0.9 });
        if (ui) ui.toast(skin ? Lang.t('dailyGotSkin') : Lang.t('dailyGotAura', { n: aura }), 2.6);
        // Конфетти над игроком (частицы FX, иначе — рецепт способностей).
        const pos = new BABYLON.Vector3(p.x, p.h + 170, p.y);
        let done = false;
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (fx && typeof fx.play === 'function') { try { done = !!fx.play('confetti', pos, { char: p }); } catch (e) { done = false; } }
        if (!done && typeof GameAbilities !== 'undefined') GameAbilities.burst('confetti', p.x, p.h + 170, p.y, true);
    },

    // Метка «!» на кнопке HUD — когда можно забрать.
    _syncBadge(force) {
        const can = this.status().can;
        if (!force && can === this._can) return;
        this._can = can;
        if (typeof GameUI !== 'undefined' && typeof GameUI.setHudBadge === 'function') GameUI.setHudBadge('daily', can ? true : null);
    },

    // --- Окно -------------------------------------------------------------------------------

    open() {
        if (this._modal && !this._modal.closed) return this._modal;
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (!ui || typeof ui.modal !== 'function') return null;
        ui.sfx('assets/sounds/ui_open.mp3', 1);
        const body = document.createElement('div');
        body.className = 'gd-wrap';
        this._justClaimed = 0;
        this._autoAt = -1;
        const pause = Game.started && Game.pvp(Game.zone);
        this._modal = ui.modal({ title: Lang.t('dailyTitle'), theme: 'gold', body, cls: 'gd-m' + (IS_MOBILE ? ' gd-mob' : ''), backdrop: true, pause,
            onClose: () => { clearInterval(this._timer); this._timer = 0; this._modal = null; } });
        this._render();
        clearInterval(this._timer);
        this._timer = setInterval(() => this._tick(), 1000);
        return this._modal;
    },

    close() { if (this._modal && !this._modal.closed) this._modal.close(); },

    // Раз в секунду, пока окно открыто: таймер; наступил новый день — перерисовать.
    _tick() {
        const m = this._modal;
        if (!m || m.closed) return;
        this._syncBadge(false);
        if (this.status().can !== this._shownCan) { this._render(); return; }
        const t = m.body.querySelector('.gd-time');
        if (t) t.textContent = this._hms(this._msLeft() / 1000);
    },

    // До следующей местной полуночи, мс.
    _msLeft() {
        const d = new Date();
        return Math.max(0, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime());
    },

    _hms(sec) {
        const s = Math.max(0, Math.ceil(sec));
        const p2 = (n) => String(n).padStart(2, '0');
        return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60);
    },

    // Иконка с запасной (нет файла — запасная, без повторных запросов).
    _icon(key, cls) {
        const im = document.createElement('img');
        im.alt = '';
        im.className = cls;
        im.draggable = false;
        if (this._missing[key]) { im.src = DAILY_FALLBACK[key]; return im; }
        im.onerror = () => {
            if (im.dataset.fb) return;
            im.dataset.fb = '1';
            this._missing[key] = true;
            im.src = DAILY_FALLBACK[key];
        };
        im.src = DAILY_ICONS[key];
        return im;
    },

    _render() {
        const m = this._modal;
        if (!m || m.closed) return;
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        const st = this.status();
        this._shownCan = st.can;
        const wrap = m.body.querySelector('.gd-wrap') || m.body;
        wrap.textContent = '';
        // Карточки дней.
        const grid = document.createElement('div');
        grid.className = 'gd-grid';
        for (let n = 1; n <= DAILY_DAYS; n++) {
            const got = n <= st.done, cur = st.can && n === st.next;
            const now = !st.can && st.claimed && n === st.done;            // получен сегодня
            const tom = !st.can && n === st.next && n > st.done;          // завтра
            const card = document.createElement('div');
            card.className = 'gd-card' + (n === DAILY_DAYS ? ' gd-d7' : '') + (got ? ' gd-got' : cur ? ' gd-cur' : ' gd-fut') +
                (now ? ' gd-now' : '') + (now && this._justClaimed === n ? ' gd-new' : '');
            const dn = document.createElement('div');
            dn.className = 'gd-dn';
            dn.textContent = Lang.t('dailyDay', { n });
            card.appendChild(dn);
            const ic = document.createElement('div');
            ic.className = 'gd-ic';
            ic.appendChild(this._icon(n === DAILY_DAYS ? 'day7' : 'day', 'gd-im'));
            if (got) ic.appendChild(this._icon('check', 'gd-ck'));
            card.appendChild(ic);
            const am = document.createElement('div');
            am.className = 'gd-am';
            const rw = this.reward(n);
            // День 7 получен: скин — если он у игрока есть (иначе тогда выдана аура).
            const skinGot = got && !!this._wardrobe() && !this._skinGivable();
            if (n === DAILY_DAYS && (rw.skin || skinGot)) am.textContent = Lang.t('dailySkin');
            else {
                const fl = document.createElement('img');
                fl.alt = '';
                fl.src = 'assets/ui/icon_aura.png';
                am.append(fl, '+' + rw.aura);
            }
            card.appendChild(am);
            const tag = document.createElement('div');
            tag.className = 'gd-tag';
            tag.textContent = got ? Lang.t('dailyGot') : cur ? Lang.t('dailyToday') : tom ? Lang.t('dailyTomorrow') : '';
            card.appendChild(tag);
            grid.appendChild(card);
        }
        wrap.appendChild(grid);
        // Подсказка или таймер.
        const info = document.createElement('div');
        info.className = 'gd-info';
        if (st.can) {
            info.textContent = st.broken ? Lang.t('dailyBroken') : this._skinGivable() ? Lang.t('dailyHint') : Lang.t('dailyHintAura');
            if (st.broken) info.classList.add('gd-warn');
        } else {
            const parts = Lang.t('dailyNext', { t: '\u0001' }).split('\u0001');
            const tm = document.createElement('b');
            tm.className = 'gd-time';
            tm.textContent = this._hms(this._msLeft() / 1000);
            const ti = document.createElement('img');
            ti.alt = '';
            ti.src = 'assets/ui/icon_timer.png';
            info.append(ti, parts[0] || '', tm, parts[1] || '');
        }
        wrap.appendChild(info);
        // Кнопки.
        const btns = document.createElement('div');
        btns.className = 'gd-btns';
        const mk = (text, kind, fn) => {
            if (ui) return ui.button(text, kind, fn);
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.addEventListener('click', () => { if (!b.disabled) fn(); });
            return b;
        };
        if (st.can) {
            const rw = this.reward(st.next);
            const b1 = mk(Lang.t('dailyClaim'), 'green', () => { this.claim(false); });
            b1.classList.add('gd-claim');
            b1.disabled = this._busy;
            btns.appendChild(b1);
            if (rw.aura > 0) {
                const b2 = mk(Lang.t('dailyClaimX2'), 'ad', () => { this.claim(true); });
                b2.disabled = this._busy;
                btns.appendChild(b2);
            }
        } else {
            btns.appendChild(mk(Lang.t('dailyOk'), 'green', () => this.close()));
        }
        wrap.appendChild(btns);
    },

    // --- Отладка ------------------------------------------------------------------------------

    // «Перемотать» дату на days дней вперёд (накопительно; отрицательное — назад) -> сводка.
    debugShift(days) {
        this._shift += Math.round(Number(days) || 0);
        this._syncBadge(true);
        this._render();
        return { shift: this._shift, today: this._key(this.today()), daily: Object.assign({}, this._data()), status: this.status(),
            reward: this.reward(this.status().next) };
    },

    // --- Стили ------------------------------------------------------------------------------

    _css() {
        const st = document.createElement('style');
        st.textContent = `
.gu-modal.gd-m{width:min(700px,95vw)}
.gd-m .gu-mb{padding:12px 14px 14px}
.gd-wrap{display:flex;flex-direction:column;gap:10px}
.gd-grid{display:grid;grid-template-columns:repeat(3,1fr) 1.25fr;gap:10px;padding:6px}
.gd-card{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:3px;min-width:0;padding:8px 6px 7px;
 border-radius:16px;border:3px solid #10161d;background:linear-gradient(#45536a,#2c3646);box-shadow:inset 0 2px 0 rgba(255,255,255,.12),0 3px 0 rgba(0,0,0,.3)}
.gd-dn{font-size:16px;line-height:1.1;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35);white-space:nowrap}
.gd-ic{position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:64px}
.gd-im{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 3px 3px rgba(0,0,0,.4))}
.gd-ck{position:absolute;right:-12px;bottom:-6px;width:36px;height:36px;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(0,0,0,.45))}
.gd-am{display:flex;align-items:center;justify-content:center;gap:2px;font-size:21px;line-height:1.1;color:#fff;white-space:nowrap;
 text-shadow:-2px -2px 0 #b8203f,2px -2px 0 #b8203f,-2px 2px 0 #b8203f,2px 2px 0 #b8203f,0 3px 0 rgba(0,0,0,.3)}
.gd-am img{width:26px;height:26px;margin:-4px 0}
.gd-tag{min-height:1.15em;font-size:13px;line-height:1.15;color:#cfe0f2;text-shadow:0 1px 0 rgba(0,0,0,.35)}
.gd-card.gd-got{background:linear-gradient(#3fae4c,#26803a);border-color:#0f3d17}
.gd-card.gd-got .gd-im{opacity:.75}
.gd-card.gd-got .gd-tag{color:#eaffd8}
.gd-card.gd-cur{background:linear-gradient(#ffe27a,#f2a81c);border-color:#7a4300;z-index:1;animation:gd-pulse 1.1s ease-in-out infinite}
.gd-card.gd-cur .gd-dn,.gd-card.gd-cur .gd-tag{color:#fff;text-shadow:-1.5px -1.5px 0 #7a4300,1.5px -1.5px 0 #7a4300,-1.5px 1.5px 0 #7a4300,1.5px 1.5px 0 #7a4300}
.gd-card.gd-cur .gd-tag{font-size:14px}
.gd-card.gd-now{box-shadow:0 0 0 3px #ffe27a,0 0 14px 3px rgba(255,214,80,.7)}
.gd-card.gd-new .gd-ck{animation:gd-check .5s cubic-bezier(.2,1.6,.4,1) both}
.gd-card.gd-new{animation:gd-flash .6s ease-out}
.gd-card.gd-fut{filter:brightness(.62) saturate(.55)}
.gd-card.gd-d7{grid-column:4;grid-row:1 / span 2;justify-content:center;gap:8px;background:linear-gradient(#a45cff,#5b23b8);border-color:#2a0b5c}
.gd-card.gd-d7 .gd-ic,.gd-card.gd-d7 .gd-im{width:104px;height:104px}
.gd-card.gd-d7 .gd-dn{font-size:19px}
.gd-card.gd-d7 .gd-am{font-size:18px;white-space:normal;text-align:center;text-shadow:-2px -2px 0 #3a0f78,2px -2px 0 #3a0f78,-2px 2px 0 #3a0f78,2px 2px 0 #3a0f78,0 3px 0 rgba(0,0,0,.3)}
.gd-card.gd-d7.gd-cur{background:linear-gradient(#ffe27a,#f2a81c)}
.gd-card.gd-d7.gd-cur .gd-am{text-shadow:-2px -2px 0 #7a4300,2px -2px 0 #7a4300,-2px 2px 0 #7a4300,2px 2px 0 #7a4300}
.gd-card.gd-d7.gd-got{background:linear-gradient(#3fae4c,#26803a)}
.gd-card.gd-d7 .gd-ck{width:48px;height:48px}
@keyframes gd-pulse{0%,100%{transform:scale(1);box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 3px 0 rgba(0,0,0,.3),0 0 6px 2px rgba(255,214,80,.5)}
 50%{transform:scale(1.05);box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 3px 0 rgba(0,0,0,.3),0 0 18px 6px rgba(255,214,80,.9)}}
@keyframes gd-check{from{transform:scale(0) rotate(-30deg);opacity:0}to{transform:none;opacity:1}}
@keyframes gd-flash{0%{filter:brightness(1.8)}100%{filter:none}}
.gd-info{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px 6px;font-size:17px;line-height:1.25;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.gd-info img{width:26px;height:26px}
.gd-info b{color:#ffd75a;font-variant-numeric:tabular-nums}
.gd-info.gd-warn{color:#ffb3a8}
.gd-btns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.gd-btns .gu-b{min-width:150px}
.gd-btns .gu-b.gd-claim{min-width:170px;font-size:22px}
@media (max-width:520px){
 .gd-m .gu-mh{font-size:20px;padding:6px 54px}
 .gd-m .gu-mb{padding:10px 8px 12px}
 .gd-grid{grid-template-columns:repeat(3,1fr);gap:8px;padding:5px}
 .gd-card{padding:6px 4px;border-radius:14px}
 .gd-dn{font-size:14px}
 .gd-ic,.gd-im{width:50px;height:50px}
 .gd-ck{width:30px;height:30px;right:-10px}
 .gd-am{font-size:18px}
 .gd-am img{width:22px;height:22px}
 .gd-tag{font-size:12px}
 .gd-card.gd-d7{grid-column:1 / -1;grid-row:auto;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto auto;column-gap:10px;justify-items:start;align-items:center;padding:6px 12px}
 .gd-card.gd-d7 .gd-ic,.gd-card.gd-d7 .gd-im{width:64px;height:64px}
 .gd-card.gd-d7 .gd-ic{grid-column:1;grid-row:1 / span 3}
 .gd-card.gd-d7 .gd-dn,.gd-card.gd-d7 .gd-am,.gd-card.gd-d7 .gd-tag{grid-column:2;text-align:left;justify-content:flex-start}
 .gd-card.gd-d7 .gd-ck{width:36px;height:36px}
 .gd-info{font-size:15px}
 .gd-btns{flex-direction:column;align-items:stretch;padding:0 6px}
 .gd-btns .gu-b,.gd-btns .gu-b.gd-claim{min-width:0;width:100%}
 .gd-btns .gu-b.gu-k-ad{font-size:18px;padding:10px 8px;white-space:nowrap}
}
@media (max-height:430px){
 .gd-m .gu-mb{padding:6px 10px 10px}
 .gd-wrap{gap:6px}
 .gd-grid{grid-template-columns:repeat(6,1fr) 1.3fr;gap:6px;padding:4px}
 .gd-card{padding:5px 3px;border-radius:12px}
 .gd-dn{font-size:13px}
 .gd-ic,.gd-im{width:42px;height:42px}
 .gd-ck{width:26px;height:26px;right:-8px}
 .gd-am{font-size:16px}
 .gd-am img{width:20px;height:20px}
 .gd-tag{font-size:11px}
 .gd-card.gd-d7{grid-column:auto;grid-row:auto;gap:2px}
 .gd-card.gd-d7 .gd-ic,.gd-card.gd-d7 .gd-im{width:46px;height:46px}
 .gd-card.gd-d7 .gd-dn{font-size:13px}
 .gd-card.gd-d7 .gd-am{font-size:13px}
 .gd-info{font-size:14px}
 .gd-info img{width:20px;height:20px}
 .gd-btns .gu-b{padding:7px 14px;font-size:17px}
 .gd-btns .gu-b.gd-claim{font-size:18px}
}
`;
        document.head.appendChild(st);
    },
};
