// PlatformPikabu.js — SDK Пикабу Игры (глобал PkbSDK) для Platform.js движка 1.20 (в 1.20 нет реестра адаптеров).
// Подключается ПОСЛЕ Platform.js. Если на странице есть SDK Пикабу (сборка node tools/build.mjs pikabu вписывает его
// первым скриптом), подменяет методы Platform; без SDK ничего не меняет — остальные площадки работают как раньше.
//
//   init       await PkbSDK.init() один раз (таймаут 15 с); отказ SDK — исходный Platform.init (локальная игра)
//   ready      sdk.gameStarted() — один раз, когда игра готова к вводу (Platform.ready)
//   реклама    fullscreen и rewarded: перед КАЖДЫМ показом canShow(), затем show(). На время рекламы игра стоит
//              (Pause 'ad'), награда — только при reward: true. Отказ площадки или блокировщик — false, игра идёт дальше
//   сохранения sdk.storage, один ключ 'save' (JSON-строка): методы синхронные, сервер SDK догоняет сам.
//              REVISION_CONFLICT (игра открыта во второй вкладке или на другом устройстве) — пауза и окно «Перезагрузить»
//   вход       не обязателен: authorized() как у остальных площадок вне Яндекса; login() — окно входа SDK
(() => {
    if (typeof Platform === 'undefined' || typeof PkbSDK === 'undefined' || !PkbSDK || typeof PkbSDK.init !== 'function') return;
    /** @type {any} */
    const P = Platform;
    /** @type {any} */
    const SDK = PkbSDK;
    const base = { init: P.init, ready: P.ready, interstitial: P.interstitial, rewarded: P.rewarded, _load: P._load, save: P.save, login: P.login };
    const INIT_TIMEOUT = 15000, CAN_SHOW_TIMEOUT = 4000, AD_OPEN_TIMEOUT = 180000, SAVE_KEY = 'save';

    // Промис с отказом по таймауту; поздний ответ исходного промиса не станет unhandled.
    /** @param {any} promise @param {number} ms @param {string} what */
    const limit = (promise, ms, what) => {
        let timer = 0;
        const source = Promise.resolve(promise);
        source.catch(() => {});
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + ' timeout')), ms); });
        return Promise.race([source, timeout]).finally(() => clearTimeout(timer));
    };
    const active = () => P.name === 'pikabu' && !!P.sdk;
    /** @param {string} kind */
    const adApi = (kind) => { const ads = P.sdk && P.sdk.ads; return ads ? ads[kind] : null; };

    // Показ: результат show() или null, если реклама сейчас недоступна (интервал площадки, блокировщик).
    /** @param {string} kind */
    const show = async (kind) => {
        const ad = adApi(kind);
        if (!ad || !ad.isSupported) return null;
        let can = false;
        try { can = (await limit(ad.canShow(), CAN_SHOW_TIMEOUT, 'canShow')) === true; } catch (e) { can = false; }
        if (!can) return null;
        const r = await limit(ad.show(), AD_OPEN_TIMEOUT, 'show');
        if (r && r.rendered === false) console.warn('Pikabu: реклама не показана:', r.reason);
        return r || null;
    };
    // Как исходный Platform: один показ за раз, на время рекламы игра и звук стоят.
    /** @param {() => Promise<boolean>} fn */
    const withAdPause = async (fn) => {
        if (P._adBusy) return false;
        P._adBusy = true;
        Pause.set('ad', true);
        try { return await fn(); } catch (e) { return false; } finally { Pause.set('ad', false); P._adBusy = false; }
    };

    let conflictShown = false;
    const conflictNotice = () => {
        if (conflictShown) return;
        conflictShown = true;
        try { Pause.set('platform', true); } catch (e) { /* без паузы окно всё равно покажется */ }
        try {
            const box = document.createElement('div');
            box.id = 'pkb-conflict';
            box.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;'
                + 'background:rgba(0,0,0,.72);font:600 18px/1.35 system-ui,Arial,sans-serif;color:#fff;text-align:center';
            const card = document.createElement('div');
            card.style.cssText = 'max-width:min(420px,86vw);padding:24px 22px;border-radius:16px;background:#20232b;box-shadow:0 10px 40px rgba(0,0,0,.5)';
            const title = document.createElement('div');
            title.style.cssText = 'font-size:22px;margin-bottom:10px';
            title.textContent = 'Игра открыта ещё где-то';
            const text = document.createElement('div');
            text.style.cssText = 'font-weight:400;font-size:16px;opacity:.85;margin-bottom:18px';
            text.textContent = 'Прогресс изменился на другом устройстве или в другой вкладке. Перезагрузите игру, чтобы продолжить сохраняться.';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'padding:12px 28px;border:0;border-radius:10px;background:#4caf50;color:#fff;font:700 18px system-ui,Arial,sans-serif;cursor:pointer';
            btn.textContent = 'Перезагрузить';
            btn.addEventListener('click', () => location.reload());
            card.appendChild(title); card.appendChild(text); card.appendChild(btn); box.appendChild(card);
            document.body.appendChild(box);
        } catch (e) { console.warn('Pikabu: окно конфликта сохранений не показано:', e); }
    };

    P.init = async function () {
        let sdk;
        try {
            sdk = await limit(SDK.init(), INIT_TIMEOUT, 'PkbSDK.init');
        } catch (e) {
            console.warn('Platform: SDK Пикабу не поднялся, играем локально — ' + ((e && e.message) || e));
            return base.init.call(P);
        }
        P.name = 'pikabu';
        P.sdk = sdk;
        P.lang = 'ru';
        try {
            sdk.on('storageSaveError', (/** @type {any} */ reason) => {
                console.warn('Pikabu: сохранение не удалось:', reason);
                if (reason === 'REVISION_CONFLICT') conflictNotice();
            });
        } catch (e) { /* старый SDK без событий */ }
        Pause.onChange(() => { if (typeof P._syncGameplay === 'function') P._syncGameplay(); });
        console.log('Platform: pikabu');
        return P;
    };

    P.ready = function () {
        if (!active()) return base.ready.call(P);
        if (P._readySent) return;
        try { P.sdk.gameStarted(); } catch (e) { console.warn('Platform.ready:', e); }
        P._readySent = true;
    };

    P.interstitial = function () {
        if (!active()) return base.interstitial.call(P);
        return withAdPause(async () => { const r = await show('fullscreen'); return !!(r && r.rendered); });
    };

    P.rewarded = function (/** @type {any} */ id) {
        if (!active()) return base.rewarded.call(P, id);
        return withAdPause(async () => { const r = await show('rewarded'); return !!(r && r.rendered && r.reward === true); });
    };

    P._load = async function () {
        if (!active()) return base._load.call(P);
        const raw = P.sdk.storage.get(SAVE_KEY);
        P._loadOk = true;
        if (raw == null || raw === '') return null;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return data && typeof data === 'object' ? data : null;
    };

    P.save = async function (/** @type {any} */ obj) {
        if (!active()) return base.save.call(P, obj);
        try {
            if (!P._loadOk) await P.load();   // запись только после успешной загрузки
            P.sdk.storage.set(SAVE_KEY, JSON.stringify(obj));
            return true;
        } catch (e) {
            console.warn('Platform.save:', (e && e.message) || e);
            return false;
        }
    };

    // Кнопки рекламы: показывать, если площадка поддерживает такой формат (в копиях 1.20 эти методы есть не везде).
    /** @param {string} kind */
    const supported = (kind) => { const ad = adApi(kind); return !!(ad && ad.isSupported); };
    /** @param {string} name @param {string} kind */
    const wrapSupported = (name, kind) => {
        const orig = P[name];
        if (typeof orig !== 'function') return;
        P[name] = function (/** @type {any[]} */ ...args) { return active() ? supported(kind) : orig.apply(P, args); };
    };
    wrapSupported('rewardedSupported', 'rewarded');
    wrapSupported('interstitialSupported', 'fullscreen');
    wrapSupported('adsAvailable', 'rewarded');

    if (typeof base.login === 'function') {
        P.login = async function () {
            if (!active()) return base.login.call(P);
            if (!P.sdk.auth || (P.sdk.player && P.sdk.player.isAuthorized)) return true;
            Pause.set('platform', true);
            try { await P.sdk.auth.openAuthDialog(); } catch (e) { /* окно закрыто с ошибкой: остаётся гость */ } finally { Pause.set('platform', false); }
            return !!(P.sdk.player && P.sdk.player.isAuthorized);
        };
    }
})();
