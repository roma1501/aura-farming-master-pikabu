// Lang.js — тексты интерфейса игры (I18N). Все видимые строки — ключами в
// LANG_STRINGS, в коде — Lang.t('ключ', { имя: значение }) с подстановкой {имя},
// в разметке — атрибуты data-t="ключ" (текст), data-t-title, data-t-placeholder
// (Lang.apply() проставляет их после init и смены языка).
//
// Язык — GAME_LANG (Constants.js): по умолчанию en (Playgama), ru оставлен.
// Видимого переключателя языка нет. LANG_AUTO = 1 — язык платформы (Platform.lang),
// если он есть в словаре. Нет строки в языке — английская, нет и её — сам ключ.
// Новая строка = ключ в ОБОИХ словарях.

const LANG_STRINGS = {
    ru: {
        'loading': 'Загрузка…',
        'loadingScene': 'Готовим первый кадр…',
        'loadingReady': 'Готово',
        'loadingFailed': 'Не удалось загрузить. Попробуйте ещё раз.',
        'loadingRetry': 'Повторить',
        'no3d': '3D недоступен: браузер без WebGL',
        // Игра — ядро (Game*.js)
        'title': 'AURA FARMING MASTER',
        'play': 'ИГРАТЬ',
        'playerName': 'Игрок',
        'dummy': 'Манекен',
        'auraLabel': 'АУРА',
        'auraBadge': 'Аура: {n}',
        'dash': 'Рывок',
        'dashKey': 'Пробел',
        'soundOn': 'Звук включён',
        'soundOff': 'Звук выключен',
        'settings': 'Настройки',
        'sound': 'Звук',
        'music': 'Музыка',
        'quality': 'Графика',
        'qualityHigh': 'Высокая',
        'qualityLow': 'Низкая',
        'on': 'Вкл',
        'off': 'Выкл',
        'close': 'Закрыть',
        'portalArena': 'ФАРМ\nЗОНЫ АУРЫ',
        'portalRoyale': 'КОРОЛЕВСКАЯ\nБИТВА\n+50 ауры',
        'portalHardcore': 'РАШ\n×2 ауры',
        'portalDuel': 'ДУЭЛЬ',
    },
    en: {
        'loading': 'Loading…',
        'loadingScene': 'Preparing the first frame…',
        'loadingReady': 'Ready',
        'loadingFailed': 'Loading failed. Please try again.',
        'loadingRetry': 'Retry',
        'no3d': '3D is unavailable: no WebGL in this browser',
        // Game core (Game*.js)
        'title': 'AURA FARMING MASTER',
        'play': 'PLAY',
        'playerName': 'Player',
        'dummy': 'Dummy',
        'auraLabel': 'AURA',
        'auraBadge': 'Aura: {n}',
        'dash': 'Dash',
        'dashKey': 'Space',
        'soundOn': 'Sound on',
        'soundOff': 'Sound off',
        'settings': 'Settings',
        'sound': 'Sound',
        'music': 'Music',
        'quality': 'Graphics',
        'qualityHigh': 'High',
        'qualityLow': 'Low',
        'on': 'On',
        'off': 'Off',
        'close': 'Close',
        'portalArena': 'FARM\nAURA ZONES',
        'portalRoyale': 'BATTLE\nROYALE\n+50 aura',
        'portalHardcore': 'RUSH\n×2 aura',
        'portalDuel': 'DUEL',
    },
};

/** @satisfies {Record<string, any>} */
const Lang = {
    code: 'ru',

    // platformLang — язык платформы (Platform.lang) или null.
    init(platformLang) {
        const def = typeof GAME_LANG !== 'undefined' ? GAME_LANG : 'ru';
        const auto = typeof LANG_AUTO !== 'undefined' ? LANG_AUTO : 0;
        const p = String(platformLang || '').toLowerCase().split(/[-_]/)[0];
        this.code = auto > 0 && p && LANG_STRINGS[p] ? p : (LANG_STRINGS[def] ? def : 'en');
        document.documentElement.lang = this.code;
    },

    has(key) {
        return !!((LANG_STRINGS[this.code] || {})[key] || LANG_STRINGS.en[key]);
    },

    t(key, params) {
        const s = (LANG_STRINGS[this.code] || {})[key] || LANG_STRINGS.en[key] || key;
        return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
    },

    // Разметка: data-t, data-t-title, data-t-placeholder внутри root.
    apply(root) {
        const r = root || document;
        for (const el of /** @type {NodeListOf<HTMLElement>} */ (r.querySelectorAll('[data-t]'))) el.textContent = this.t(el.dataset.t);
        for (const el of /** @type {NodeListOf<HTMLElement>} */ (r.querySelectorAll('[data-t-title]'))) el.title = this.t(el.dataset.tTitle);
        for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (r.querySelectorAll('[data-t-placeholder]'))) el.placeholder = this.t(el.dataset.tPlaceholder);
    },
};
