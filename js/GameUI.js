// GameUI.js — интерфейс (DESIGN.md §5, §7, §9): неон/стрит (стиль — GameSkin.js). Стартовый экран (название поверх живого лобби,
// «ИГРАТЬ», «Рекорды», «Настройки»), HUD (аура слева сверху, «Магазин Ауры», таймер буста ×2,
// шестерёнка справа сверху, метка режима сверху по центру, лента KO и тихие строки, тосты),
// бейджи над головами («Аура: N» красно-розовым градиентом с белой обводкой, кружок-аватар
// и имя), пузыри чата (как в Roblox: белые облачка стопкой), всплывающие «+1», настройки
// (звук, музыка, графика, «Рекорды»), «Магазин Ауры» (награды за рекламу),
// рекорды (доска в лобби — DynamicTexture на части Screen модели leaderboard.glb; окно —
// Platform.leaderboard() или локальный топ), UI-кит для модулей (modal, button).
// DOM поверх канваса; позиции бейджей — через View3D.projectToScreen (Character.headScreenPos).
//
// Раскладка HUD Aura Farming Master: слева сверху — плашка ауры и серия зоны (GameFarm); справа сверху —
// рейка: шестерёнка и звук в ряд, под ними кнопки (магазин, прокачка, гардероб, подарок, «Лобби»);
// по центру — метка режима и таймер зоны; справа снизу — «Поза» и «Рывок», слева снизу — джойстик.
// (старое описание раскладки ниже устарело; проверять 390×844, 360×800, 800×360, 1366×768)
// Раскладка HUD (без перекрытий; проверять 360×800, 800×360, 768×1024, 1024×768, 1366×768):
// слева сверху — колонка: аура (+ таймер буста), «Магазин Ауры», на телефоне — лента KO;
// справа сверху — шестерёнка; метка режима — сверху по центру (узкий портрет — под
// шестерёнкой); ПК — лента KO слева внизу над джойстиком; «Рывок» и джойстик — GameInput
// (снизу справа / снизу слева); тосты — над центром боя (портрет — ниже ленты).
// Бейджи: игрок + GAME_BADGE_MAX ближайших, масштаб GAME_BADGE_SCALE по расстоянию;
// пересёкшийся с более близким бейдж встаёт над ним, если и там тесно — почти прозрачный;
// персонаж под островом (упал за край) — бейдж и пузыри гаснут (sinkFade).
//
// API: toast(text, seconds?), notice(text), killfeed(attacker, victim), bubble(char, text, seconds?),
// popup(char, text), showStart(onPlay), hideStart(), setAura(n), auraSpent(n) («−N» у счётчика), showHud(on), setModeLabel(text|null, color?),
// openSettings(on), openShop(), openRecords(), openCredits(), refreshBadge(char), sinkFade(char) -> 0..1,
// modal(opts) -> { el, body, close(), closed }, button(text, kind, onClick), click(), setBadgeFx(char, 'glitch'|'dark'|null),
// adBreak() — игрок сам закрыл окно (крестик, тап мимо, Esc): Platform.ads.breakpoint, когда окон больше нет.
// Playables (Platform.ads.frequent): клик по любой кнопке интерфейса — тоже реклама (_initClickAds).
// Шрифт — 'GameFont' (Rubik, index.html). Тексты — Lang (строки модуля — ниже).

const UI_BOARD_EVERY = 3;            // с: обновление доски рекордов в лобби
const UI_BOARD_ROWS = 10;            // строк на доске и в окне рекордов
const UI_LB_CACHE = 60;              // с: кэш Platform.leaderboard (лимит Яндекса — 20 запросов за 5 минут)
const UI_BOOST_MS = 180000;          // «×2 ауры на 3 минуты»
const UI_BOOST_MAX_MS = 1800000;     // потолок накопленного буста (продление подряд)
const UI_AURA75_EVERY_MS = 600000;   // «+75 ауры» — раз в 10 минут
const UI_CHAT_MAX = 3;               // пузырей чата над головой одновременно (стопка)
const UI_FEED_MAX = 5;               // строк в ленте KO (телефон — на одну меньше)
const UI_FEED_TIME = 6;              // с: строка ленты KO на экране
const UI_NOTICE_TIME = 4.5;          // с: тихая строка (вход/выход) на экране
const UI_POPUP_MAX = 10;             // «+N» над головой — только небольшие прибавки (крупные — тостом)

Object.assign(LANG_STRINGS.ru, {
    'shop': 'Магазин Ауры',
    'shopAura25': '+25 ауры',
    'shopBoost': '×2 ауры на 3 минуты',
    'shopAura75': '+75 ауры',
    'shopAura75Note': 'раз в 10 минут',
    'shopBoostNote': 'вся аура ×2',
    'shopAura25Note': 'сразу на счёт',
    'shopAd': 'За рекламу',
    'shopWait': 'Через {t}',
    'shopBoostOn': 'Активно: {t}',
    'shopGot': '+{n} ауры!',
    'shopBoostGot': '×2 ауры на 3 минуты!',
    'adFail': 'Реклама сейчас недоступна',
    'boostHud': '×2',
    'records': 'Рекорды',
    'recordsTitle': 'Рекорды ауры',
    'boardTitle': 'РЕКОРДЫ АУРЫ',
    'recordsEmpty': 'Пока пусто',
    'credits': 'Авторы',
    'cgLogin': 'Войти через CrazyGames',
    'adLabel': 'Реклама',
    'creditsMusicH': 'Музыка — CC0',
    'creditsMusic': '5 Action Chiptunes — Juhani Junkala / SubspaceAudio (OpenGameArt)',
    'creditsArenaH': 'Фонк-моменты — CC0',
    'creditsArena': 'Level 1–3, Ending, Title Screen — Juhani Junkala',
    'creditsSfxH': 'Звуки — CC0',
    'creditsSfx': 'Freesound: AdminMP, pfranzen, steveuk87, njjjjjjjjjjjjjjjjjjjjjjjj, qubodup, Jofae, freakinbehemoth, ' +
        'Paul368, alegemaate, plasterbrain, FunWithSound, kirbydx, GammaGool, modusmogulus, JustInvoke, Relenzo2, wjl, LilMati, ' +
        'AlexLane, AlaskaRobotics, ludvique; собственные звуки игры.',
    'creditsEmojiH': 'Иконки — Apache License 2.0',
    'creditsEmoji': 'Noto Emoji — Google Inc.',
    'creditsKenneyH': 'Kenney — CC0',
    'creditsKenney': 'Звуки интерфейса, монетки, ударов и взрывов — Kenney',
    'creditsFontH': 'Шрифт — SIL Open Font License 1.1',
    'creditsFont': 'Rubik — The Rubik Project Authors',
    'creditsEngineH': 'Движок',
    'creditsEngine': 'Lory Engine; Babylon.js (Apache License 2.0)',
});
Object.assign(LANG_STRINGS.en, {
    'shop': 'Aura Shop',
    'shopAura25': '+25 aura',
    'shopBoost': '×2 aura for 3 minutes',
    'shopAura75': '+75 aura',
    'shopAura75Note': 'every 10 minutes',
    'shopBoostNote': 'all aura ×2',
    'shopAura25Note': 'added instantly',
    'shopAd': 'Watch ad',
    'shopWait': 'In {t}',
    'shopBoostOn': 'Active: {t}',
    'shopGot': '+{n} aura!',
    'shopBoostGot': '×2 aura for 3 minutes!',
    'adFail': 'Ad is not available right now',
    'boostHud': '×2',
    'records': 'Records',
    'recordsTitle': 'Aura records',
    'boardTitle': 'AURA RECORDS',
    'recordsEmpty': 'Nothing here yet',
    'credits': 'Credits',
    'cgLogin': 'Log in with CrazyGames',
    'adLabel': 'Advertisement',
    'creditsMusicH': 'Music — CC0',
    'creditsMusic': '5 Action Chiptunes by Juhani Junkala / SubspaceAudio (OpenGameArt)',
    'creditsArenaH': 'Funk moments — CC0',
    'creditsArena': 'Level 1-3, Ending, Title Screen by Juhani Junkala',
    'creditsSfxH': 'Sound effects — CC0',
    'creditsSfx': 'Freesound: AdminMP, pfranzen, steveuk87, njjjjjjjjjjjjjjjjjjjjjjjj, qubodup, Jofae, freakinbehemoth, ' +
        'Paul368, alegemaate, plasterbrain, FunWithSound, kirbydx, GammaGool, modusmogulus, JustInvoke, Relenzo2, wjl, LilMati, ' +
        'AlexLane, AlaskaRobotics, ludvique; original sounds.',
    'creditsEmojiH': 'Icons — Apache License 2.0',
    'creditsEmoji': 'Noto Emoji — Google Inc.',
    'creditsKenneyH': 'Kenney — CC0',
    'creditsKenney': 'Interface, coin, impact and explosion sounds by Kenney',
    'creditsFontH': 'Font — SIL Open Font License 1.1',
    'creditsFont': 'Rubik — The Rubik Project Authors',
    'creditsEngineH': 'Engine',
    'creditsEngine': 'Lory Engine; Babylon.js (Apache License 2.0)',
});

/** @typedef {{ name: string, aura: number, me: boolean, avatar: string, gone: boolean }} UiRecord */
/** @typedef {{ rank: number, name: string, score: number, me: boolean, avatar: string }} UiRecordRow */

/** @satisfies {Record<string, any>} */
const GameUI = {
    /** @type {HTMLElement | null} */
    hud: null,
    /** @type {HTMLElement | null} */
    badges: null,
    /** @type {HTMLElement | null} */
    auraEl: null,
    /** @type {HTMLElement | null} */
    boostEl: null,
    /** @type {HTMLElement | null} */
    modeEl: null,
    /** @type {HTMLElement | null} */
    feedEl: null,
    /** @type {HTMLElement | null} */
    toastEl: null,
    /** @type {HTMLElement | null} */
    startEl: null,
    /** @type {HTMLElement | null} */
    settingsEl: null,
    /** @type {Array<{ el: HTMLElement, char: Character, items: Array<{ el: HTMLElement, until: number }> }>} */
    _chats: [],
    _shownAura: -1,
    _boostShown: -2,
    /** @type {{ char: Character, t: number } | null} */
    _lastVictim: null,
    /** @type {Array<{ close: () => void, closable: boolean }>} */
    _modals: [],
    _menuPauses: 0,
    _bannerSeq: 0,
    /** @type {{ close: () => void, closed: boolean } | null} */
    _shop: null,
    _adBusy: false,
    /** @type {Map<number, UiRecord>} */
    _roster: new Map(),
    /** @type {{ tex: BABYLON.DynamicTexture, ctx: CanvasRenderingContext2D, W: number, H: number, key: string } | null} */
    _board: null,
    _boardAt: 0,
    _boardTries: 0,
    /** @type {{ at: number, rows: UiRecordRow[] | null } | null} */
    _lbCache: null,
    /** @type {Map<string, HTMLImageElement>} */
    _imgs: new Map(),

    init(game) {
        this._css();
        const hud = this.hud = document.createElement('div');
        hud.id = 'gu-hud';
        hud.className = 'gu-off ' + (IS_MOBILE ? 'gu-mobile' : 'gu-pc');
        hud.innerHTML =
            '<div id="gu-badges"></div>' +
            '<div id="gu-tl"><div class="gu-tl-row">' +
            '<div id="gu-aura"><img src="assets/ui/icon_aura.png" alt=""><span class="gu-aura-l" data-t="auraLabel"></span><span class="gu-aura-n">0</span></div>' +
            '<div id="gu-boost" class="gu-hide"><img src="assets/ui/icon_timer.png" alt=""><b data-t="boostHud"></b><span>0:00</span></div></div></div>' +
            '<div id="gu-mode" class="gu-hide"></div>' +
            '<div id="gu-rail"><div class="gu-rail-ic">' +
            '<button id="gu-snd" type="button" aria-label="sound"><img src="assets/ui/icon_sound_on.png" alt=""></button>' +
            '<button id="gu-gear" type="button" aria-label="settings"><img src="assets/ui/icon_gear.png" alt=""></button></div>' +
            '<button id="gu-shop" class="gu-hbtn gu-th-gold" data-order="0" type="button"><img src="assets/ui/icon_aura.png" alt=""><span data-t="shop"></span></button></div>' +
            '<div id="gu-feed"></div><div id="gu-toast"></div>';
        document.body.appendChild(hud);
        this.badges = hud.querySelector('#gu-badges');
        this.auraEl = hud.querySelector('#gu-aura');
        this.boostEl = hud.querySelector('#gu-boost');
        this.modeEl = hud.querySelector('#gu-mode');
        this.feedEl = hud.querySelector('#gu-feed');
        this.toastEl = hud.querySelector('#gu-toast');
        // Лента KO: телефон — в колонке под аурой; ПК — слева внизу над джойстиком.
        if (IS_MOBILE) hud.querySelector('#gu-tl').appendChild(this.feedEl);
        else this._placeFeed();
        Lang.apply(hud);
        hud.querySelector('#gu-gear').addEventListener('click', () => { this.click(); this.openSettings(true); });
        hud.querySelector('#gu-shop').addEventListener('click', () => { this.click(); this.openShop(); });
        hud.querySelector('#gu-snd').addEventListener('click', () => { this.toggleSound(); });
        Game.on('settings', () => this._syncSound());
        this._buildSettings();
        Platform.backHandler = () => this._back();
        for (const c of Game.chars) this._badge(c);
        Game.on('spawn', (e) => this._badge(e.char));
        Game.on('despawn', (e) => { this._remember(e.char, true); this._dropBadge(e.char); });
        Game.on('aura', (e) => {
            if (e.char === Game.player) {
                this.setAura(e.total, e.delta > 0);
                if (e.delta < 0) this.auraSpent(Math.round(-e.delta));
                if (e.delta > 0 && e.delta <= UI_POPUP_MAX) {
                    const v = this._lastVictim;
                    const at = v && Game.realTime - v.t < 0.05 && !v.char.disposed ? v.char : e.char;
                    this.popup(at, '+' + Math.round(e.delta));
                }
            }
            if (e.char.badge) e.char.badge.aura = -1;
        });
        Game.on('slap', (e) => { if (e.attacker === Game.player) this._lastVictim = { char: e.victim, t: Game.realTime }; });
        Game.on('ko', (e) => { if (e.killer) this.killfeed(e.killer, e.victim); });
        Game.on('zone', () => { this._boardAt = 0; });
        this._initClickAds();
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Escape') return;
            const top = this._modals[this._modals.length - 1];
            if (top) { if (top.closable) top.close(); return; }
            if (this.settingsEl && this.settingsEl.classList.contains('gu-open')) { this.openSettings(false); this.adBreak(); }
        });
        window.addEventListener('resize', () => { if (!IS_MOBILE) this._placeFeed(); });
        try {
            const fonts = /** @type {any} */ (document).fonts;
            if (fonts && fonts.load) fonts.load('900 32px GameFont').then(() => { if (this._board) this._board.key = ''; }).catch(() => {});
        } catch (e) { /* без FontFace API */ }
        void game;
    },

    // ПК: лента KO — над базой джойстика (по его фактическому месту).
    _placeFeed() {
        if (!this.feedEl) return;
        const gi = typeof GameInput !== 'undefined' && typeof GameInput.joyRect === 'function' ? GameInput.joyRect() : null;
        const H = VIEW.h;
        const bottom = gi ? Math.max(120, Math.round(H - (gi.y - gi.r) + 14)) : 220;
        this.feedEl.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom))';
    },

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gu-hud{position:fixed;inset:0;z-index:6;pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff}
#gu-hud.gu-off>:not(#gu-badges){display:none!important}
#gu-hud .gu-hide{display:none!important}
#gu-badges{position:absolute;inset:0;overflow:hidden}
.gu-badge{position:absolute;left:0;top:0;transform-origin:50% 100%;display:flex;flex-direction:column;align-items:center;white-space:nowrap;will-change:transform}
.gu-badge.gu-hide{display:none}
.gu-ar{position:relative;font-size:32px;line-height:1.02;letter-spacing:.5px}
.gu-ar .o{position:absolute;left:0;top:0;color:#fff;-webkit-text-stroke:8px #fff;text-shadow:0 3px 4px rgba(0,0,0,.28)}
.gu-ar .f{position:relative;background:linear-gradient(180deg,#ff2f52 0%,#ff4a6a 42%,#ff9dbb 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.gu-nm{display:flex;align-items:center;gap:6px;margin-top:3px;font-size:18px;line-height:1.1;color:#fff;
 text-shadow:-2px 0 0 #262626,2px 0 0 #262626,0 -2px 0 #262626,0 2px 0 #262626,-1.5px -1.5px 0 #262626,1.5px -1.5px 0 #262626,-1.5px 1.5px 0 #262626,1.5px 1.5px 0 #262626,0 3px 3px rgba(0,0,0,.35)}
.gu-nm img{width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px #262626,0 2px 3px rgba(0,0,0,.35);background:#9fd8ff;object-fit:cover}
.gu-chat{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:5px;transform-origin:50% 100%;pointer-events:none;will-change:transform}
.gu-bub{position:relative;max-width:230px;padding:8px 13px;border-radius:13px;background:rgba(255,255,255,.96);color:#393b3d;
 font:800 17px/1.22 GameFont,system-ui,sans-serif;text-align:center;white-space:normal;overflow-wrap:anywhere;box-shadow:0 2px 6px rgba(0,0,0,.2);
 animation:gu-bub .2s cubic-bezier(.2,1.4,.4,1);transition:opacity .3s,transform .3s}
.gu-bub:last-child:after{content:'';position:absolute;left:50%;bottom:-8px;margin-left:-8px;border:8px solid transparent;border-bottom:0;border-top-color:rgba(255,255,255,.96)}
.gu-bub:not(:last-child){opacity:.7;font-size:15px;padding:6px 11px}
.gu-bub.gu-out{opacity:0;transform:translateY(-8px) scale(.9)}
@keyframes gu-bub{from{transform:translateY(8px) scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes gu-pop{from{transform:scale(.3);opacity:0}to{opacity:1}}
#gu-tl{position:absolute;left:calc(12px + env(safe-area-inset-left));top:calc(10px + env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-start;gap:8px;transform-origin:0 0}
.gu-tl-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:calc(100vw - 96px - env(safe-area-inset-left) - env(safe-area-inset-right))}
#gu-aura{position:relative;display:flex;align-items:center;gap:6px;height:50px;box-sizing:border-box;padding:0 16px 0 5px;border-radius:30px;background:rgba(10,30,60,.42);border:2px solid rgba(255,255,255,.4)}
#gu-aura.gu-spend .gu-aura-n{animation:gu-spend .45s ease-out}
@keyframes gu-spend{0%{transform:none;color:#fff}25%{transform:translateX(-4px) scale(.88);color:#ffb3c2}50%{transform:translateX(4px) scale(.92)}75%{transform:translateX(-2px)}100%{transform:none;color:#fff}}
.gu-minus{position:absolute;right:6px;top:70%;font-size:26px;line-height:1;color:#fff;white-space:nowrap;pointer-events:none;
 text-shadow:-2px -2px 0 #7a1236,2px -2px 0 #7a1236,-2px 2px 0 #7a1236,2px 2px 0 #7a1236,0 3px 0 rgba(0,0,0,.35);animation:gu-minus 1.1s ease-out forwards}
@keyframes gu-minus{0%{opacity:0;transform:translateY(-8px) scale(.5)}15%{opacity:1;transform:translateY(0) scale(1.2)}30%{transform:translateY(2px) scale(1)}100%{opacity:0;transform:translateY(44px)}}
#gu-aura img{width:40px;height:40px}
#gu-aura .gu-aura-l{font-size:19px;color:#ffe0ea;text-shadow:0 2px 0 rgba(0,0,0,.3)}
#gu-aura .gu-aura-n{display:inline-block;font-size:29px;color:#fff;text-shadow:-2px -2px 0 #e8325a,2px -2px 0 #e8325a,-2px 2px 0 #e8325a,2px 2px 0 #e8325a,0 3px 0 #9c1a37}
#gu-aura.gu-bump .gu-aura-n{animation:gu-bump .3s ease-out}
@keyframes gu-bump{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
#gu-boost{display:flex;align-items:center;gap:5px;height:40px;box-sizing:border-box;padding:0 12px 0 5px;border-radius:22px;border:3px solid #6b3d00;
 background:linear-gradient(#ffd75a,#f3a312);color:#fff;font-size:20px;text-shadow:-1.5px -1.5px 0 #7a4300,1.5px -1.5px 0 #7a4300,-1.5px 1.5px 0 #7a4300,1.5px 1.5px 0 #7a4300;
 box-shadow:0 3px 0 rgba(0,0,0,.25);animation:gu-pop .25s ease-out}
#gu-boost img{width:28px;height:28px}
#gu-boost b{font-size:22px}
#gu-shop{display:flex;align-items:center;gap:6px;height:44px;padding:0 14px 0 6px;border-radius:14px;border:3px solid #5c1a0b;pointer-events:auto;cursor:pointer;
 background:linear-gradient(#ff8a52,#e5482a);color:#fff;font:900 18px/1 GameFont,system-ui,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);
 box-shadow:0 3px 0 rgba(0,0,0,.28),inset 0 2px 0 rgba(255,255,255,.25);-webkit-tap-highlight-color:transparent}
#gu-shop img{width:32px;height:32px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}
#gu-shop:active{transform:translateY(2px)}
.gu-hbtn{position:relative;display:flex;align-items:center;gap:6px;height:44px;padding:0 14px 0 6px;border-radius:14px;border:3px solid #1d2b6b;pointer-events:auto;cursor:pointer;
 background:linear-gradient(#6c8dff,#3d5fe0);color:#fff;font:900 18px/1 GameFont,system-ui,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);
 box-shadow:0 3px 0 rgba(0,0,0,.28),inset 0 2px 0 rgba(255,255,255,.25);-webkit-tap-highlight-color:transparent}
.gu-hbtn img{width:32px;height:32px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}
.gu-hbtn:active{transform:translateY(2px)}
.gu-hbtn.gu-hide{display:none}
.gu-hbtn.gu-th-purple{border-color:#3d1670;background:linear-gradient(#b67aff,#8040e0)}
.gu-hbtn.gu-th-green{border-color:#17501c;background:linear-gradient(#4fe356,#25a92e)}
.gu-hbtn.gu-th-pink{border-color:#6b1640;background:linear-gradient(#ff7ab8,#e0407e)}
.gu-hbtn.gu-th-gold{border-color:#6b3d00;background:linear-gradient(#ffd75a,#f3a312)}
.gu-hbtn .gu-dot{position:absolute;right:-7px;top:-7px;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;border:2px solid #fff;
 background:#ff2d3a;color:#fff;font:900 13px/18px GameFont,system-ui,sans-serif;text-align:center;text-shadow:none;animation:gu-pulse 1.2s ease-in-out infinite}
.gu-hbtn .gu-dot:empty{min-width:18px;height:18px;padding:0}
#gu-gear{position:absolute;right:calc(12px + env(safe-area-inset-right));top:calc(10px + env(safe-area-inset-top));width:52px;height:52px;padding:9px;box-sizing:border-box;
 border-radius:14px;border:0;background:rgba(18,28,40,.62);pointer-events:auto;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent}
#gu-gear img{width:100%;height:100%;filter:brightness(0) invert(1)}
#gu-gear:active{transform:scale(.94)}
#gu-mode{position:absolute;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);max-width:44vw;padding:7px 18px;border-radius:20px;
 background:rgba(10,30,60,.5);border:2px solid rgba(255,255,255,.4);font-size:20px;line-height:1.1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
 text-shadow:0 2px 0 rgba(0,0,0,.35);animation:gu-pop .25s ease-out}
#gu-feed{position:absolute;left:calc(14px + env(safe-area-inset-left));display:flex;flex-direction:column;align-items:flex-start;gap:3px;max-width:min(380px,32vw);
 font-size:16px;text-shadow:-1.5px -1.5px 0 #222,1.5px -1.5px 0 #222,-1.5px 1.5px 0 #222,1.5px 1.5px 0 #222,0 2px 2px rgba(0,0,0,.3)}
#gu-tl #gu-feed{position:static;max-width:min(300px,34vw);font-size:14px;margin-top:2px}
.gu-kill{display:flex;align-items:center;gap:5px;max-width:100%;white-space:nowrap;animation:gu-in .25s ease-out;transition:opacity .6s}
.gu-kill span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.gu-kill img{width:1.3em;height:1.3em;flex:none}
.gu-kill .gu-me{color:#ffe14d}
.gu-kill.gu-note{color:#e6edf3;font-weight:800;opacity:.78;font-size:.88em}
.gu-kill.gu-fade{opacity:0}
@keyframes gu-in{from{transform:translateX(-20px);opacity:0}to{transform:none}}
#gu-toast{position:absolute;left:50%;top:16vh;transform:translateX(-50%);width:max-content;max-width:min(560px,60vw);display:flex;flex-direction:column;align-items:center;gap:8px}
.gu-t{padding:9px 22px;border-radius:16px;background:rgba(15,35,65,.72);border:2px solid rgba(255,255,255,.4);font-size:22px;line-height:1.2;
 text-shadow:0 2px 0 rgba(0,0,0,.35);animation:gu-pop .2s ease-out;transition:opacity .5s,transform .5s;text-align:center}
.gu-t.gu-fade{opacity:0;transform:translateY(-12px)}
.gu-plus{position:absolute;left:0;top:0;font-size:38px;color:#fff;pointer-events:none;
 text-shadow:-2px -2px 0 #e8325a,2px -2px 0 #e8325a,-2px 2px 0 #e8325a,2px 2px 0 #e8325a,0 4px 0 #9c1a37;animation:gu-plus .95s ease-out forwards}
@keyframes gu-plus{0%{opacity:0;margin-top:10px;scale:.4}15%{opacity:1;scale:1.25}30%{scale:1}100%{opacity:0;margin-top:-90px}}
#gu-hud.gu-mobile .gu-t{font-size:18px;padding:7px 16px}
@media (orientation:portrait){#gu-toast{top:30vh;max-width:86vw}#gu-tl #gu-feed{max-width:72vw}}
@media (orientation:landscape){#gu-hud.gu-mobile #gu-toast{max-width:38vw}}
@media (max-width:560px){#gu-mode{left:auto;right:calc(12px + env(safe-area-inset-right));top:calc(70px + env(safe-area-inset-top));transform:none;max-width:44vw;font-size:16px;padding:5px 12px}}
@media (max-width:400px){#gu-aura{height:44px;padding-right:12px}#gu-aura img{width:34px;height:34px}#gu-aura .gu-aura-l{font-size:16px}#gu-aura .gu-aura-n{font-size:25px}
 #gu-shop{height:40px;font-size:16px}#gu-shop img{width:28px;height:28px}#gu-boost{height:36px;font-size:17px}#gu-boost b{font-size:18px}#gu-boost img{width:24px;height:24px}}
@media (max-height:430px){#gu-tl{transform:scale(.8)}#gu-gear{transform:scale(.82);transform-origin:100% 0}#gu-mode{font-size:16px;padding:5px 12px;top:calc(8px + env(safe-area-inset-top))}
 #gu-tl #gu-feed{max-width:36vw;font-size:14px}#gu-hud #gu-toast{top:calc(52px + env(safe-area-inset-top));max-width:36vw}#gu-hud .gu-t{font-size:16px;padding:6px 14px}}
.gu-mwrap{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(5,20,40,.45);pointer-events:auto;
 font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff;animation:gu-fadein .15s ease-out;
 padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}
@keyframes gu-fadein{from{opacity:0}to{opacity:1}}
.gu-modal{position:relative;width:min(460px,92vw);max-height:88vh;display:flex;flex-direction:column;border-radius:22px;border:4px solid #14202c;
 background:#1f2c3b;box-shadow:0 7px 0 rgba(0,0,0,.3),0 16px 30px rgba(0,0,0,.3);animation:gu-pop .2s ease-out;overflow:hidden}
.gu-mh{position:relative;flex:none;display:flex;align-items:center;justify-content:center;min-height:52px;padding:6px 56px;font-size:28px;line-height:1.1;text-align:center;
 text-shadow:-2px -2px 0 #3a1408,2px -2px 0 #3a1408,-2px 2px 0 #3a1408,2px 2px 0 #3a1408,0 3px 0 rgba(0,0,0,.35);border-bottom:4px solid #14202c}
.gu-th-orange .gu-mh{background:linear-gradient(#ff7a4d,#e5522c)}
.gu-th-blue .gu-mh{background:linear-gradient(#4d8fe0,#2f63b8);text-shadow:-2px -2px 0 #0e2a55,2px -2px 0 #0e2a55,-2px 2px 0 #0e2a55,2px 2px 0 #0e2a55,0 3px 0 rgba(0,0,0,.35)}
.gu-th-red .gu-mh{background:linear-gradient(#ff5a5a,#c92f2f)}
.gu-th-green .gu-mh{background:linear-gradient(#4fd15a,#26a332);text-shadow:-2px -2px 0 #0d4012,2px -2px 0 #0d4012,-2px 2px 0 #0d4012,2px 2px 0 #0d4012,0 3px 0 rgba(0,0,0,.35)}
.gu-th-gold .gu-mh{background:linear-gradient(#ffd34d,#e8a21a);text-shadow:-2px -2px 0 #5a3500,2px -2px 0 #5a3500,-2px 2px 0 #5a3500,2px 2px 0 #5a3500,0 3px 0 rgba(0,0,0,.35)}
.gu-x{position:absolute;right:9px;top:50%;transform:translateY(-50%);width:40px;height:40px;padding:0;border-radius:50%;border:3px solid #14202c;background:linear-gradient(#ff5050,#d01f1f);
 color:#fff;font:900 22px/1 GameFont,system-ui,sans-serif;cursor:pointer;text-shadow:0 2px 0 rgba(0,0,0,.35);box-shadow:0 2px 0 rgba(0,0,0,.3)}
.gu-x:active{transform:translateY(-50%) scale(.92)}
.gu-mb{padding:14px 16px;overflow:auto;font-size:19px;text-align:center;text-shadow:0 2px 0 rgba(0,0,0,.3);-webkit-overflow-scrolling:touch}
.gu-mf{flex:none;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:0 16px 16px}
.gu-banner{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;padding:0 0 12px}
.gu-banner-l{font-size:11px;font-weight:700;letter-spacing:.5px;opacity:.6;text-transform:uppercase}
.gu-banner-c{width:320px;height:50px;max-width:100%}
.gu-b{min-width:120px;padding:10px 18px;border-radius:14px;border:3px solid #14202c;color:#fff;cursor:pointer;font:900 20px/1.1 GameFont,system-ui,sans-serif;
 text-shadow:0 2px 0 rgba(0,0,0,.35);box-shadow:0 4px 0 rgba(0,0,0,.3),inset 0 2px 0 rgba(255,255,255,.22);background:linear-gradient(#4fe356,#25a92e);-webkit-tap-highlight-color:transparent}
.gu-b:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.3)}
.gu-b[disabled]{filter:grayscale(.85) brightness(.8);cursor:default;transform:none}
.gu-b.gu-k-orange{background:linear-gradient(#ffb43a,#e8891a)}
.gu-b.gu-k-blue{background:linear-gradient(#4d8fe0,#2f63b8)}
.gu-b.gu-k-red{background:linear-gradient(#ff5a5a,#c92f2f)}
.gu-b.gu-k-gray{background:linear-gradient(#8d99a6,#64707c)}
.gu-b.gu-k-gold{background:linear-gradient(#ffd34d,#e8a21a)}
.gu-b.gu-k-ad{background:linear-gradient(#b46cff,#7d3ad8)}
html.no-rewarded .gu-k-ad,html.no-rewarded .gg-ad{display:none!important}
.gu-b.gu-k-ad:before{content:'';display:inline-block;width:26px;height:26px;margin:-6px 7px -6px 0;vertical-align:middle;background:url('assets/ui/icon_video.png') center/contain no-repeat}
.gu-badge.gu-fx-glitch .gu-ar,.gu-badge.gu-fx-glitch .gu-nm{animation:gu-glitch .18s steps(2) infinite}
@keyframes gu-glitch{0%{text-shadow:-4px 0 #ff2a6d,4px 0 #00e5ff;transform:translate(1px,0)}50%{text-shadow:4px 0 #ff2a6d,-4px 0 #00e5ff;transform:translate(-2px,1px)}100%{text-shadow:-3px 1px #ff2a6d,3px -1px #00e5ff;transform:translate(1px,-1px)}}
.gu-badge.gu-fx-dark{filter:brightness(.55)}
#gu-settings{display:none}
#gu-settings.gu-open{display:flex}
.gu-srow{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:4px 0 10px;font-size:22px;text-align:left}
.gu-srow>span{display:flex;align-items:center;gap:10px}
.gu-srow img{width:34px;height:34px}
.gu-tg{min-width:118px}
.gu-tg.gu-offb{background:linear-gradient(#ff5a5a,#c92f2f)}
.gu-srow2{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:16px}
.gu-srow2 .gu-b{display:flex;align-items:center;gap:7px;min-width:0;font-size:18px}
.gu-srow2 .gu-b img{width:26px;height:26px;margin:-4px 0}
.gu-m-shop{width:min(600px,94vw);background:#202833}
.gu-shopg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:2px}
.gu-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 10px;border-radius:16px;border:3px solid #10161d;
 background:linear-gradient(#3b4553,#2a313b);box-shadow:inset 0 2px 0 rgba(255,255,255,.08),0 3px 0 rgba(0,0,0,.3)}
.gu-ct{font-size:20px;line-height:1.1;min-height:2.2em;display:flex;align-items:center;justify-content:center}
.gu-ci{position:relative;display:flex;align-items:flex-end;justify-content:center;height:64px}
.gu-ci img{width:54px;height:54px;filter:drop-shadow(0 3px 3px rgba(0,0,0,.4))}
.gu-ci img.gu-sm{width:44px;height:44px;margin:0 -10px}
.gu-ci img.gu-sm:nth-child(2){width:58px;height:58px;position:relative;z-index:1}
.gu-ci .gu-x2{position:absolute;right:-16px;top:-2px;padding:2px 7px;border-radius:10px;border:2px solid #6b3d00;background:linear-gradient(#ffd75a,#f3a312);font-size:18px;
 text-shadow:-1.5px -1.5px 0 #7a4300,1.5px -1.5px 0 #7a4300,-1.5px 1.5px 0 #7a4300,1.5px 1.5px 0 #7a4300;transform:rotate(8deg)}
.gu-cn{font-size:14px;font-weight:800;color:#c9d6e3;min-height:1.2em}
.gu-cn.gu-on{color:#ffd75a}
.gu-card .gu-b{width:100%;min-width:0;padding:9px 6px;font-size:17px}
.gu-card .gu-b.gu-k-ad:before{width:22px;height:22px;margin-right:5px}
.gu-m-rec .gu-mb{padding:12px}
.gu-rec{display:flex;flex-direction:column;gap:6px}
.gu-rrow{display:flex;align-items:center;gap:9px;padding:5px 12px 5px 6px;border-radius:12px;background:rgba(255,255,255,.08);font-size:19px;text-align:left}
.gu-rrow:nth-child(odd){background:rgba(255,255,255,.13)}
.gu-rrow.gu-me{background:linear-gradient(#ffe066,#f5b82a);color:#3a2400;text-shadow:none}
.gu-rk{flex:none;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px}
.gu-rk.gu-r1{background:linear-gradient(#ffe066,#e8a21a);color:#5a3500;text-shadow:none}
.gu-rk.gu-r2{background:linear-gradient(#f2f6fa,#b6c2cf);color:#3b4653;text-shadow:none}
.gu-rk.gu-r3{background:linear-gradient(#f0a868,#c06a2c);color:#4a2306;text-shadow:none}
.gu-rrow>img{flex:none;width:32px;height:32px;border-radius:50%;border:2px solid #fff;background:#9fd8ff}
.gu-rn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gu-rs{flex:none;display:flex;align-items:center;gap:3px;color:#ff8aa4}
.gu-rrow.gu-me .gu-rs{color:#c2183f}
.gu-rs img{width:24px;height:24px}
.gu-rsep{text-align:center;opacity:.6;line-height:.6}
.gu-cred{text-align:left;font-size:16px;font-weight:800;line-height:1.35}
.gu-cred h3{margin:12px 0 4px;font-size:18px;font-weight:900;color:#ffd75a}
.gu-cred h3:first-child{margin-top:0}
.gu-cred p{margin:0;white-space:pre-line;color:#e8eef5;text-shadow:0 1px 0 rgba(0,0,0,.3)}
#gu-start{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:min(4vh,30px);pointer-events:auto;box-sizing:border-box;
 padding:calc(12px + env(safe-area-inset-top)) 16px calc(78px + env(safe-area-inset-bottom));
 background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,0) 35%,rgba(10,40,80,.42) 100%);font-family:GameFont,system-ui,sans-serif;font-weight:900;transition:opacity .35s}
#gu-start.gu-gone{opacity:0;pointer-events:none}
.gu-logo{display:block;width:min(86vw,640px);max-height:42vh;object-fit:contain;filter:drop-shadow(0 8px 10px rgba(0,30,60,.35));animation:gu-float 3s ease-in-out infinite}
.gu-title{position:relative;font-size:clamp(46px,9vw,112px);line-height:.95;text-align:center;letter-spacing:1px;animation:gu-float 3s ease-in-out infinite}
.gu-title .o{position:absolute;inset:0;color:#fff;-webkit-text-stroke:clamp(10px,1.6vw,18px) #fff;text-shadow:0 8px 0 rgba(0,0,0,.18)}
.gu-title .f{position:relative;background:linear-gradient(180deg,#ff2d55 0%,#ff4f6d 45%,#ffa3c0 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
@keyframes gu-float{0%,100%{transform:rotate(-2deg) translateY(0)}50%{transform:rotate(-1deg) translateY(-8px)}}
.gu-play{padding:16px 70px;border-radius:22px;border:5px solid #17501c;background:linear-gradient(#5be862,#25a92e);color:#fff;cursor:pointer;
 font:900 clamp(32px,5.5vw,50px)/1 GameFont,system-ui,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.35);box-shadow:0 7px 0 #17501c,0 12px 20px rgba(0,0,0,.25),inset 0 3px 0 rgba(255,255,255,.3);
 animation:gu-pulse 1.4s ease-in-out infinite;-webkit-tap-highlight-color:transparent}
.gu-play:active{transform:translateY(4px);box-shadow:0 3px 0 #17501c}
@keyframes gu-pulse{0%,100%{scale:1}50%{scale:1.06}}
.gu-stb{position:absolute;left:0;right:0;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;justify-content:center;gap:12px}
.gu-sb{display:flex;align-items:center;gap:7px;height:46px;padding:0 16px 0 8px;border-radius:14px;border:3px solid #14202c;cursor:pointer;color:#fff;
 font:900 18px/1 GameFont,system-ui,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);background:linear-gradient(#4d8fe0,#2f63b8);
 box-shadow:0 4px 0 rgba(0,0,0,.3),inset 0 2px 0 rgba(255,255,255,.22);-webkit-tap-highlight-color:transparent}
.gu-sb img{width:30px;height:30px}
.gu-sb:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.3)}
@media (max-height:430px){#gu-start{gap:12px;padding-bottom:calc(64px + env(safe-area-inset-bottom))}.gu-logo{max-height:44vh}.gu-play{padding:12px 54px;font-size:32px}
 .gu-stb{bottom:calc(10px + env(safe-area-inset-bottom))}.gu-sb{height:40px;font-size:16px}.gu-sb img{width:26px;height:26px}
 .gu-mh{min-height:44px;font-size:23px}.gu-mb{padding:10px 14px;font-size:17px}.gu-srow{margin:2px 0 6px;font-size:19px}.gu-srow img{width:28px;height:28px}
 .gu-srow2{margin-top:8px}.gu-modal{max-height:94vh}.gu-ci{height:50px}.gu-ci img{width:44px;height:44px}.gu-ct{font-size:17px}}
@media (max-width:400px){.gu-play{padding:14px 52px}.gu-mh{font-size:24px}.gu-shopg{grid-template-columns:1fr 1fr}.gu-ct{font-size:17px}.gu-card .gu-b{font-size:15px}}
`;
        document.head.appendChild(st);
    },

    // --- Бейджи ---------------------------------------------------------------------------

    _badge(ch) {
        if (!this.badges || !ch || ch.badge) return;
        const el = document.createElement('div');
        el.className = 'gu-badge gu-hide';
        el.innerHTML = '<div class="gu-ar"><span class="o"></span><span class="f"></span></div><div class="gu-nm"><img alt=""><span></span></div>';
        /** @type {HTMLImageElement} */ (el.querySelector('img')).src = ch.avatar || Character.avatarFor(ch.look);
        el.querySelector('.gu-nm span').textContent = ch.name;
        this.badges.appendChild(el);
        ch.badge = { el, aura: -1, o: el.querySelector('.o'), f: el.querySelector('.f'), shown: false, name: ch.name, avatar: ch.avatar, look: ch.look,
            w: 0, h: 0, d: 0, p: null, sink: 1, alpha: 1, top: 0 };
    },

    _dropBadge(ch) {
        if (ch.badge && ch.badge.el) ch.badge.el.remove();
        ch.badge = null;
        this._chats = this._chats.filter(c => { if (c.char === ch) { c.el.remove(); return false; } return true; });
    },

    // Обновить имя/аватар бейджа (боты меняют имя/внешность после появления).
    refreshBadge(ch) {
        if (!ch || !ch.badge) return;
        ch.badge.el.querySelector('.gu-nm span').textContent = ch.name;
        /** @type {HTMLImageElement} */ (ch.badge.el.querySelector('img')).src = ch.avatar || Character.avatarFor(ch.look);
    },

    // Бейдж/пузырь персонажа под островом (упал за край, KO) гаснет: 1 — не ниже 60 px под
    // полом, 0 — с 260 px (иначе DOM-бейдж «просвечивает» сквозь остров).
    sinkFade(c) {
        const fh = GameWorld.floorAt(c.x, c.y);
        const below = (fh !== null ? fh : 0) - c.h;
        return Math.max(0, Math.min(1, 1 - (below - 60) / 200));
    },

    update(dt, realDt) {
        this._updateBoost();
        this._updateBoard();
        if (!this.badges || !GameWorld.view) return;
        GameWorld.view.refreshMatrices();   // камеру уже сдвинули в этом кадре — проекция без отставания
        const cam = GameWorld.view.camera;
        const cx = cam.position.x, cy = cam.position.z, ch = cam.position.y;
        const maxD = GameCfg.badgeDist, W = VIEW.w, H = VIEW.h;
        const showAll = Game.started || GameCamera.mode !== 'orbit';
        const list = this._list;
        list.length = 0;
        for (const c of Game.chars) {
            const b = c.badge;
            if (!b) continue;
            let show = showAll && c.state !== 'dead' && !c.hidden;
            let d = 0, p = null, sink = 1;
            if (show) { sink = this.sinkFade(c); show = sink > 0.02; }
            if (show) {
                d = Math.hypot(c.x - cx, c.y - cy, c.h + 200 - ch);
                show = d < maxD;
            }
            if (show) {
                p = c.headScreenPos(14);
                show = !p.behind && p.x > -200 && p.y > -100 && p.x < W + 200 && p.y < H + 200;
            }
            if (!show) { this._hideBadge(b); continue; }
            b.d = d; b.p = p; b.sink = sink;
            list.push(c);
        }
        // Игрок — первым, остальные — от ближних к дальним; дальше GAME_BADGE_MAX — без бейджа.
        const me = Game.player;
        list.sort((a, b) => (a === me ? -1 : b === me ? 1 : a.badge.d - b.badge.d));
        const placed = this._rects;
        placed.length = 0;
        const base = GameCfg.badgeScale * (IS_MOBILE ? 0.82 : 1) * (W < 500 ? 0.9 : 1);
        for (let i = 0; i < list.length; i++) {
            const c = list[i], b = c.badge;
            if (i > GameCfg.badgeMax - (list[0] === me ? 0 : 1)) { this._hideBadge(b); continue; }
            if (!b.shown) { b.el.classList.remove('gu-hide'); b.shown = true; }
            if (b.aura !== c.aura) {
                b.aura = c.aura;
                const t = Lang.t('auraBadge', { n: c.aura });
                b.o.textContent = t; b.f.textContent = t;
                b.w = 0;
            }
            if (b.name !== c.name || b.avatar !== c.avatar || b.look !== c.look) {
                b.name = c.name; b.avatar = c.avatar; b.look = c.look; this.refreshBadge(c); b.w = 0;
            }
            if (!b.w) { b.w = b.el.offsetWidth || 120; b.h = b.el.offsetHeight || 56; }
            const d = b.d, p = b.p;
            const s = Math.max(0.36, Math.min(1, 760 / Math.max(1, d))) * base;
            // Разведение: бейдж пересёкся с более близким — встаёт над ним (один раз), если и там
            // тесно — почти прозрачный (и не мешает следующим).
            const w = (b.w + 12) * s, h = b.h * s;   // + обводка букв
            const x0 = p.x - w / 2, x1 = p.x + w / 2;
            let y1 = p.y, y0 = y1 - h, alpha = 1;
            for (let pass = 0; pass < 2; pass++) {
                let hit = null;
                for (const r of placed) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { hit = r; break; }
                if (!hit) break;
                if (pass === 0) { const sh = hit[1] - 2 - y1; y1 += sh; y0 += sh; } else alpha = 0.12;
            }
            if (alpha === 1) placed.push([x0, y0, x1, y1]);
            b.top = y0;
            // Прозрачность «тесноты» — плавно (бейджи в толпе не мигают при каждом шаге).
            b.alpha += (alpha - b.alpha) * Math.min(1, (realDt || 0.016) * 8);
            const fade = (d > maxD * 0.75 ? Math.max(0, (maxD - d) / (maxD * 0.25)) : 1) * b.sink * b.alpha;
            b.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + y1.toFixed(1) + 'px,0) translate(-50%,-100%) scale(' + s.toFixed(3) + ')';
            b.el.style.opacity = fade.toFixed(2);
            b.el.style.zIndex = String(10000 - Math.round(d));
        }
        this._updateChats(showAll, cx, cy, ch, maxD);
        void dt;
    },

    _hideBadge(b) {
        if (b.shown) { b.el.classList.add('gu-hide'); b.shown = false; }
    },
    /** @type {Character[]} */
    _list: [],
    /** @type {number[][]} */
    _rects: [],

    // --- Пузыри чата (как в Roblox: белые облачка, новые снизу, старые выше и бледнее) -----

    // Белое облачко чата над головой персонажа (Character.say). seconds — сколько висит.
    bubble(ch, text, seconds) {
        if (!this.badges || !ch || ch.disposed) return;
        if (Platform.chatDisabled) return;   // CrazyGames disableChat: фразы «игроков» в чате выключены
        const s = String(text == null ? '' : text).trim();
        if (!s) return;
        let chat = this._chats.find(c => c.char === ch);
        if (!chat) {
            const el = document.createElement('div');
            el.className = 'gu-chat';
            el.style.zIndex = '20000';
            this.badges.appendChild(el);
            chat = { el, char: ch, items: [] };
            this._chats.push(chat);
        }
        const b = document.createElement('div');
        b.className = 'gu-bub';
        b.textContent = s;
        chat.el.appendChild(b);
        chat.items.push({ el: b, until: Game.realTime + (seconds || Math.min(7, 3 + s.length * 0.07)) });
        while (chat.items.length > UI_CHAT_MAX) chat.items.shift().el.remove();
        // Тихий «пук» пузыря — только рядом с игроком.
        const p = Game.player;
        if (Game.started && p && ch.zone === p.zone) {
            const d = Math.hypot(ch.x - p.x, ch.y - p.y);
            if (d < 1300) this.sfx('assets/sounds/bubble_pop.mp3', 0.25 + 0.55 * (1 - d / 1300));
        }
    },

    _updateChats(showAll, cx, cy, ch, maxD) {
        const now = Game.realTime;
        this._chats = this._chats.filter(chat => {
            const c = chat.char;
            if (c.disposed || c.state === 'dead') { chat.el.remove(); return false; }
            for (const it of chat.items) {
                if (now > it.until && !it.el.classList.contains('gu-out')) {
                    it.el.classList.add('gu-out');
                    const el = it.el;
                    setTimeout(() => el.remove(), 320);
                }
            }
            chat.items = chat.items.filter(it => now <= it.until + 0.35);
            if (!chat.items.length) { setTimeout(() => chat.el.remove(), 330); return false; }
            const sink = this.sinkFade(c);
            const p = c.headScreenPos(30);
            const d = Math.hypot(c.x - cx, c.y - cy, c.h - ch);
            const hide = !showAll || p.behind || d > maxD || sink < 0.5 || c.hidden;
            chat.el.style.display = hide ? 'none' : '';
            if (hide) return true;
            const s = Math.max(0.5, Math.min(1, 700 / Math.max(1, d))) * (IS_MOBILE ? 0.9 : 1);
            const b = c.badge;
            const y = b && b.shown ? Math.min(p.y, b.top - 4) : p.y;
            chat.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + (y - 8).toFixed(1) + 'px,0) translate(-50%,-100%) scale(' + s.toFixed(3) + ')';
            chat.el.style.opacity = sink.toFixed(2);
            return true;
        });
    },

    // --- HUD -----------------------------------------------------------------------------

    // Трата ауры (баланс уменьшился): «−N» уплывает вниз от счётчика, число вздрагивает.
    auraSpent(n) {
        const el = this.auraEl;
        if (!el || !(n > 0)) return;
        const m = document.createElement('span');
        m.className = 'gu-minus';
        m.textContent = '−' + n;
        el.appendChild(m);
        setTimeout(() => m.remove(), 1150);
        el.classList.remove('gu-spend', 'gu-bump');
        void el.offsetWidth;
        el.classList.add('gu-spend');
    },

    setAura(n, bump) {
        if (!this.auraEl) return;
        if (n !== this._shownAura) {
            this._shownAura = n;
            this.auraEl.querySelector('.gu-aura-n').textContent = String(n);
        }
        if (bump) {
            this.auraEl.classList.remove('gu-bump');
            void this.auraEl.offsetWidth;
            this.auraEl.classList.add('gu-bump');
        }
    },

    // Показать HUD игры (после «ИГРАТЬ»).
    showHud(on) { if (this.hud) this.hud.classList.toggle('gu-off', !on); },

    // Метка режима сверху по центру («АРЕНА», «ХАРДКОР ×2»…); null — убрать. color — фон (CSS).
    setModeLabel(text, color) {
        const el = this.modeEl;
        if (!el) return;
        if (!text) { el.classList.add('gu-hide'); el.textContent = ''; return; }
        if (el.textContent !== String(text) || el.classList.contains('gu-hide')) {
            el.textContent = String(text);
            el.classList.remove('gu-hide');
        }
        el.style.background = color || '';
    },

    // Таймер буста «×2 ауры» в HUD (Game.save.boostUntil), раз в секунду.
    _updateBoost() {
        if (!this.boostEl || !Game.save) return;
        const left = Math.ceil(((Game.save.boostUntil || 0) - Date.now()) / 1000);
        const v = left > 0 ? left : -1;
        if (v === this._boostShown) return;
        this._boostShown = v;
        this.boostEl.classList.toggle('gu-hide', v < 0);
        if (v >= 0) this.boostEl.querySelector('span').textContent = this._mmss(v);
    },

    _mmss(sec) {
        const s = Math.max(0, Math.ceil(sec));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    },

    toast(text, seconds) {
        if (!this.toastEl) return;
        const el = document.createElement('div');
        el.className = 'gu-t';
        el.textContent = String(text);
        this.toastEl.appendChild(el);
        while (this.toastEl.children.length > 3) this.toastEl.firstElementChild.remove();
        setTimeout(() => { el.classList.add('gu-fade'); setTimeout(() => el.remove(), 550); }, (seconds || 2.2) * 1000);
    },

    _feedLine(el, seconds) {
        if (!this.feedEl) return;
        this.feedEl.appendChild(el);
        while (this.feedEl.children.length > UI_FEED_MAX - (IS_MOBILE ? 1 : 0)) this.feedEl.firstElementChild.remove();
        setTimeout(() => { el.classList.add('gu-fade'); setTimeout(() => el.remove(), 650); }, seconds * 1000);
    },

    // Лента KO: «Имя [череп] Имя» (ПК — слева внизу над джойстиком, телефон — слева вверху под аурой).
    killfeed(attacker, victim) {
        if (!this.feedEl || !attacker || !victim) return;
        const el = document.createElement('div');
        el.className = 'gu-kill';
        const a = document.createElement('span');
        a.textContent = attacker.name;
        if (attacker === Game.player) a.className = 'gu-me';
        const img = document.createElement('img');
        img.src = 'assets/ui/icon_skull.png';
        img.alt = '';
        const v = document.createElement('span');
        v.textContent = victim.name;
        if (victim === Game.player) v.className = 'gu-me';
        el.append(a, img, v);
        this._feedLine(el, UI_FEED_TIME);
    },

    // Тихая серая строка в ленте (бот вошёл/вышел и т.п.).
    notice(text) {
        if (!this.feedEl || !text) return;
        const el = document.createElement('div');
        el.className = 'gu-kill gu-note';
        const s = document.createElement('span');
        s.textContent = String(text);
        el.appendChild(s);
        this._feedLine(el, UI_NOTICE_TIME);
    },

    // Всплывающий текст над персонажем («+1» за шлепок).
    popup(ch, text) {
        if (!this.badges || !ch) return;
        const p = ch.headScreenPos(-20);
        if (p.behind) return;
        const el = document.createElement('div');
        el.className = 'gu-plus';
        el.textContent = text;
        el.style.transform = 'translate(' + (p.x - 20 + (Math.random() - 0.5) * 30).toFixed(0) + 'px,' + p.y.toFixed(0) + 'px)';
        this.badges.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    },

    // --- Настройки -------------------------------------------------------------------------

    _buildSettings() {
        const el = this.settingsEl = document.createElement('div');
        el.id = 'gu-settings';
        el.className = 'gu-mwrap';
        el.innerHTML = '<div class="gu-modal gu-th-blue"><div class="gu-mh"><span data-t="settings"></span>' +
            '<button class="gu-x" type="button" aria-label="close">✕</button></div><div class="gu-mb">' +
            '<div class="gu-srow"><span><img class="gu-snd" src="assets/ui/icon_sound_on.png" alt=""><span data-t="sound"></span></span><button class="gu-b gu-tg" type="button" data-k="sfx"></button></div>' +
            '<div class="gu-srow"><span><img src="assets/ui/icon_music.png" alt=""><span data-t="music"></span></span><button class="gu-b gu-tg" type="button" data-k="music"></button></div>' +
            '<div class="gu-srow"><span><img src="assets/ui/icon_star.png" alt=""><span data-t="quality"></span></span><button class="gu-b gu-tg" type="button" data-k="quality"></button></div>' +
            '<div class="gu-srow2"></div></div></div>';
        document.body.appendChild(el);
        Lang.apply(el);
        const row2 = el.querySelector('.gu-srow2');
        const rec = this.button(Lang.t('records'), 'gold', () => this.openRecords());
        rec.insertAdjacentHTML('afterbegin', '<img src="assets/ui/icon_trophy.png" alt="">');
        row2.append(rec);
        if (typeof GameTutorial !== 'undefined') {
            const tut = this.button(Lang.t('tutorial'), 'blue', () => { this.openSettings(false); GameTutorial.start(); });
            tut.insertAdjacentHTML('afterbegin', '<img src="assets/ui/icon_star.png" alt="">');
            row2.append(tut);
        }
        // CrazyGames: гость может войти в аккаунт (прогресс в облаке) — кнопка, не автоматически.
        if (Platform.name === 'crazygames' && Platform.userAvailable && !Platform.user) {
            const login = this.button(Lang.t('cgLogin'), 'blue', async () => {
                if (await Platform.login()) { login.remove(); window.dispatchEvent(new Event('platform-user')); }
            });
            row2.append(login);
        }
        el.addEventListener('pointerdown', (e) => { if (e.target === el) { this.openSettings(false); this.adBreak(); } });
        el.querySelector('.gu-x').addEventListener('click', () => { this.click(); this.openSettings(false); this.adBreak(); });
        for (const b of /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-k]'))) {
            b.addEventListener('click', () => {
                const s = Game.save.settings, k = b.dataset.k;
                if (k === 'quality') s.quality = s.quality === 'low' ? 'high' : 'low';
                else s[k] = !s[k];
                Game.applySettings();
                if (k === 'quality') {
                    const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
                    if (fx && typeof fx.setQuality === 'function' && fx.quality !== s.quality) { try { fx.setQuality(s.quality); } catch (e) { console.error(e); } }
                }
                Game.saveSoon();
                this._syncSettings();
                this.click();
            });
        }
    },

    _syncSettings() {
        if (!this.settingsEl || !Game.save) return;
        const s = Game.save.settings;
        for (const b of /** @type {NodeListOf<HTMLElement>} */ (this.settingsEl.querySelectorAll('[data-k]'))) {
            const k = b.dataset.k;
            const on = k === 'quality' ? s.quality !== 'low' : !!s[k];
            b.textContent = k === 'quality' ? Lang.t(on ? 'qualityHigh' : 'qualityLow') : Lang.t(on ? 'on' : 'off');
            b.classList.toggle('gu-offb', !on);
        }
        /** @type {HTMLImageElement} */ (this.settingsEl.querySelector('.gu-snd')).src = s.sfx ? 'assets/ui/icon_sound_on.png' : 'assets/ui/icon_sound_off.png';
    },

    openSettings(on) {
        if (!this.settingsEl) return;
        const was = this.settingsEl.classList.contains('gu-open');
        this._syncSettings();
        this.settingsEl.classList.toggle('gu-open', !!on);
        Pause.set('settings', !!on);
        if (on) {
            GameInput.reset();
            if (!was) this.sfx('assets/sounds/ui_open.mp3', 1);
        }
    },

    // Авторы: титры музыки (CC0), эмодзи, звуков, шрифта — простым текстом, без ссылок.
    openCredits() {
        this.sfx('assets/sounds/ui_open.mp3', 1);
        const body = document.createElement('div');
        body.className = 'gu-cred';
        for (const k of ['Music', 'Arena', 'Sfx', 'Kenney', 'Emoji', 'Font', 'Engine']) {
            const h = document.createElement('h3');
            h.textContent = Lang.t('credits' + k + 'H');
            const p = document.createElement('p');
            p.textContent = Lang.t('credits' + k);
            body.append(h, p);
        }
        return this.modal({ title: Lang.t('credits'), theme: 'blue', body, backdrop: true });
    },

    // --- Магазин Ауры (награды за рекламу) ------------------------------------------------

    openShop() {
        if (this._shop && !this._shop.closed) return this._shop;
        this.sfx('assets/sounds/ui_open.mp3', 1);
        const grid = document.createElement('div');
        grid.className = 'gu-shopg';
        const flame = '<img src="assets/ui/icon_aura.png" alt="">';
        const flameS = '<img class="gu-sm" src="assets/ui/icon_aura.png" alt="">';
        const defs = [
            { id: 'aura25', title: Lang.t('shopAura25'), icon: flame, note: Lang.t('shopAura25Note') },
            { id: 'boost', title: Lang.t('shopBoost'), icon: flame + '<span class="gu-x2">×2</span>', note: Lang.t('shopBoostNote') },
            { id: 'aura75', title: Lang.t('shopAura75'), icon: flameS + flameS + flameS, note: Lang.t('shopAura75Note') },
        ];
        /** @type {Array<{ id: string, btn: HTMLButtonElement, note: HTMLElement, def: { note: string } }>} */
        const cards = [];
        for (const d of defs) {
            const card = document.createElement('div');
            card.className = 'gu-card';
            card.innerHTML = '<div class="gu-ct"></div><div class="gu-ci">' + d.icon + '</div><div class="gu-cn"></div>';
            card.querySelector('.gu-ct').textContent = d.title;
            const btn = this.button(Lang.t('shopAd'), 'ad', () => this._buy(d.id, refresh));
            card.appendChild(btn);
            grid.appendChild(card);
            cards.push({ id: d.id, btn, note: /** @type {HTMLElement} */ (card.querySelector('.gu-cn')), def: d });
        }
        const refresh = () => {
            const now = Date.now(), s = Game.save || {};
            for (const c of cards) {
                let text = Lang.t('shopAd'), dis = this._adBusy, note = c.def.note, on = false;
                if (c.id === 'boost' && (s.boostUntil || 0) > now) { note = Lang.t('shopBoostOn', { t: this._mmss(((s.boostUntil || 0) - now) / 1000) }); on = true; }
                if (c.id === 'aura75') {
                    const wait = (s.shopAura75At || 0) + UI_AURA75_EVERY_MS - now;
                    if (wait > 0) { text = Lang.t('shopWait', { t: this._mmss(wait / 1000) }); dis = true; }
                }
                if (c.btn.textContent !== text) c.btn.textContent = text;
                c.btn.disabled = dis;
                c.btn.classList.toggle('gu-k-gray', c.id === 'aura75' && text !== Lang.t('shopAd'));
                if (c.note.textContent !== note) c.note.textContent = note;
                c.note.classList.toggle('gu-on', on);
            }
        };
        refresh();
        const timer = setInterval(refresh, 500);
        const pause = Game.started && Game.pvp(Game.zone);
        const m = this.modal({ title: Lang.t('shop'), theme: 'orange', body: grid, cls: 'gu-m-shop', pause, backdrop: true,
            onClose: () => { clearInterval(timer); this._shop = null; } });
        this._shop = m;
        return m;
    },

    // Награда за рекламу: только по подтверждению SDK (Platform.rewarded === true), один раз.
    async _buy(id, refresh) {
        if (this._adBusy) return;
        if (id === 'aura75' && Game.save && (Game.save.shopAura75At || 0) + UI_AURA75_EVERY_MS > Date.now()) return;
        this._adBusy = true;
        if (refresh) refresh();
        let ok = false;
        try { ok = (await Platform.rewarded(id)) === true; } catch (e) { ok = false; }
        this._adBusy = false;
        if (ok) this._grant(id); else this.toast(Lang.t('adFail'));
        if (refresh) refresh();
    },

    _grant(id) {
        const p = Game.player, s = Game.save;
        if (!p || !s) return;
        if (id === 'aura25' || id === 'aura75') {
            const n = id === 'aura25' ? 25 : 75;
            if (id === 'aura75') s.shopAura75At = Date.now();
            Game.addAura(p, n, { raw: true });
            this.toast(Lang.t('shopGot', { n }));
        } else if (id === 'boost') {
            const now = Date.now();
            s.boostUntil = Math.min(now + UI_BOOST_MAX_MS, Math.max(now, s.boostUntil || 0) + UI_BOOST_MS);
            this._boostShown = -2;
            this.toast(Lang.t('shopBoostGot'));
        }
        Game.saveNow();
        this.sfx('assets/sounds/coin.mp3', 1);
        this.sfx('assets/sounds/aura_gain.mp3', 1);
    },

    // --- Рекорды ---------------------------------------------------------------------------

    // Запомнить персонажа в таблице сессии (ушедшие боты остаются с последней аурой).
    _remember(c, gone) {
        if (!c || c.isDummy || !(c.isPlayer || c.isBot)) return;
        let r = this._roster.get(c.id);
        if (!r) { r = { name: c.name, aura: 0, me: !!c.isPlayer, avatar: '', gone: false }; this._roster.set(c.id, r); }
        // Игрок в рекордах — аура, заработанная за всё время (трата в гардеробе рекорд не снижает).
        r.name = c.name; r.aura = c.isPlayer && typeof Game.auraTotal === 'function' ? Game.auraTotal() : c.aura || 0; r.me = !!c.isPlayer;
        r.avatar = c.avatar || Character.avatarFor(c.look);
        if (gone) r.gone = true;
    },

    // Все известные (боты + игрок) по убыванию ауры, без повторов имён.
    _ranking() {
        for (const c of Game.chars) this._remember(c, false);
        if (this._roster.size > 120) {
            const old = [...this._roster.entries()].filter(e => e[1].gone).sort((a, b) => a[1].aura - b[1].aura);
            for (let i = 0; i < old.length && this._roster.size > 100; i++) this._roster.delete(old[i][0]);
        }
        /** @type {Map<string, UiRecord>} */
        const best = new Map();
        for (const r of this._roster.values()) {
            const key = r.me ? '\u0000me' : r.name;
            const o = best.get(key);
            if (!o || r.aura > o.aura || (r.aura === o.aura && !r.gone)) best.set(key, r);
        }
        return [...best.values()].sort((a, b) => b.aura - a.aura || (a.me ? -1 : b.me ? 1 : 0));
    },

    // Топ-n строк; игрок вне топа — последней строкой со своим местом.
    _topRows(n) {
        const all = this._ranking();
        /** @type {UiRecordRow[]} */
        const rows = all.slice(0, n).map((r, i) => ({ rank: i + 1, name: r.name, score: r.aura, me: r.me, avatar: r.avatar }));
        if (rows.length === n && !rows.some(r => r.me)) {
            const i = all.findIndex(r => r.me);
            if (i >= n) { const r = all[i]; rows[n - 1] = { rank: i + 1, name: r.name, score: r.aura, me: true, avatar: r.avatar }; }
        }
        return rows;
    },

    // Окно рекордов: таблица платформы (Platform.leaderboard), иначе — локальный топ.
    openRecords() {
        this.sfx('assets/sounds/ui_open.mp3', 1);
        const body = document.createElement('div');
        body.className = 'gu-rec';
        this._renderRecords(body, this._topRows(UI_BOARD_ROWS));
        const m = this.modal({ title: Lang.t('recordsTitle'), theme: 'gold', body, cls: 'gu-m-rec', backdrop: true });
        const c = this._lbCache;
        const fresh = c && performance.now() - c.at < UI_LB_CACHE * 1000;
        const apply = (rows) => { if (!m.closed && rows && rows.length) this._renderRecords(body, rows); };
        if (fresh) apply(c.rows);
        else if (typeof Platform.leaderboard === 'function') {
            Promise.resolve(Platform.leaderboard()).then((list) => {
                /** @type {UiRecordRow[] | null} */
                let rows = null;
                if (Array.isArray(list) && list.length) {
                    const mine = Game.player ? (Game.player.avatar || Character.avatarFor(Game.player.look)) : '';
                    rows = list.map((e) => ({ rank: e.rank, name: e.name || '—', score: e.score, me: !!e.me, avatar: e.me ? mine : Character.avatarFor(null) }));
                }
                this._lbCache = { at: performance.now(), rows };
                apply(rows);
            }).catch(() => { this._lbCache = { at: performance.now(), rows: null }; });
        }
        return m;
    },

    _renderRecords(body, rows) {
        body.textContent = '';
        if (!rows.length) {
            const e = document.createElement('div');
            e.textContent = Lang.t('recordsEmpty');
            body.appendChild(e);
            return;
        }
        let prev = 0;
        for (const r of rows) {
            if (prev && r.rank > prev + 1) {
                const sep = document.createElement('div');
                sep.className = 'gu-rsep';
                sep.textContent = '• • •';
                body.appendChild(sep);
            }
            prev = r.rank;
            const row = document.createElement('div');
            row.className = 'gu-rrow' + (r.me ? ' gu-me' : '');
            const rk = document.createElement('b');
            rk.className = 'gu-rk' + (r.rank <= 3 ? ' gu-r' + r.rank : '');
            rk.textContent = String(r.rank);
            const av = document.createElement('img');
            av.alt = '';
            av.src = r.avatar || Character.avatarFor(null);
            const nm = document.createElement('span');
            nm.className = 'gu-rn';
            nm.textContent = r.name;
            const sc = document.createElement('span');
            sc.className = 'gu-rs';
            sc.innerHTML = '<img src="assets/ui/icon_aura.png" alt="">';
            sc.appendChild(document.createTextNode(String(r.score)));
            row.append(rk, av, nm, sc);
            body.appendChild(row);
        }
    },

    // Доска рекордов в лобби: часть Screen модели leaderboard.glb — DynamicTexture 512×640
    // (экран 4×5 м, UV 0..1), перерисовка раз в UI_BOARD_EVERY с, только если топ изменился.
    _updateBoard() {
        if (Game.realTime < this._boardAt) return;
        this._boardAt = Game.realTime + UI_BOARD_EVERY;
        if (!this._board) {
            if (this._boardTries > 20 || !GameWorld.scene) return;
            this._boardTries++;
            if (!this._setupBoard()) return;
        }
        // Вне лобби доска не видна — данные копятся, рисуем реже.
        if (Game.zone !== 'lobby' && this._board.key) { this._boardAt = Game.realTime + UI_BOARD_EVERY * 4; }
        this._drawBoard();
    },

    _setupBoard() {
        const parts = GameWorld.findParts('leaderboard', 'Screen');
        if (!parts.length) return false;
        const scene = GameWorld.scene, W = 512, H = 640;
        const tex = new BABYLON.DynamicTexture('records-board', { width: W, height: H }, scene, true);
        tex.hasAlpha = false;
        const mat = new BABYLON.StandardMaterial('records-board/mat', scene);
        mat.disableLighting = true;
        mat.emissiveTexture = tex;
        mat.emissiveColor = new BABYLON.Color3(0, 0, 0);   // с emissiveTexture — чёрный, иначе выбелит
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.metadata = { toon: false };
        for (const p of parts) {
            p.mesh.material = mat;
            p.mesh.receiveShadows = false;
            if (GameWorld.view && typeof GameWorld.view.removeShadowCaster === 'function') GameWorld.view.removeShadowCaster(p.mesh);
        }
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        this._board = { tex, ctx, W, H, key: '' };
        return true;
    },

    _img(url) {
        let im = this._imgs.get(url);
        if (!im) {
            im = new Image();
            im.onload = () => { if (this._board) this._board.key = ''; };
            im.src = url;
            this._imgs.set(url, im);
        }
        return im.complete && im.naturalWidth ? im : null;
    },

    _rr(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    _fit(ctx, s, max) {
        if (ctx.measureText(s).width <= max) return s;
        let t = s;
        while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
        return t + '…';
    },

    _drawBoard() {
        const b = this._board;
        if (!b) return;
        const rows = this._topRows(UI_BOARD_ROWS);
        const flame = this._img('assets/ui/icon_aura.png');
        const key = rows.map(r => r.rank + r.name + ':' + r.score + (r.me ? '*' : '') + (this._img(r.avatar) ? '' : '?')).join('|') + (flame ? '' : '?');
        if (key === b.key) return;
        b.key = key;
        const ctx = b.ctx, W = b.W, H = b.H;
        const font = (px) => '900 ' + px + 'px GameFont, Rubik, system-ui, sans-serif';
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        let g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#2c66cc');
        g.addColorStop(1, '#173a86');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // Шапка: оранжево-красная полоса, «РЕКОРДЫ АУРЫ», огоньки по бокам.
        g = ctx.createLinearGradient(0, 0, 0, 92);
        g.addColorStop(0, '#ff8452');
        g.addColorStop(1, '#e24a2a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, 92);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, 88, W, 6);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.font = font(44);
        const title = this._fit(ctx, Lang.t('boardTitle'), W - 130);
        ctx.lineWidth = 9;
        ctx.strokeStyle = '#4a1406';
        ctx.strokeText(title, W / 2, 48);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(title, W / 2, 48);
        if (flame) { ctx.drawImage(flame, 10, 20, 52, 52); ctx.drawImage(flame, W - 62, 20, 52, 52); }
        // Строки.
        const top = 104, rh = Math.floor((H - top - 10) / UI_BOARD_ROWS);
        for (let i = 0; i < UI_BOARD_ROWS; i++) {
            const y = top + i * rh, r = rows[i];
            this._rr(ctx, 12, y, W - 24, rh - 6, 12);
            ctx.fillStyle = r && r.me ? '#ffd84a' : (i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.16)');
            ctx.fill();
            const cy = y + (rh - 6) / 2;
            if (!r) {
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.font = font(24);
                ctx.textAlign = 'center';
                ctx.fillText('—', W / 2, cy + 1);
                continue;
            }
            // Место: 1–3 — медальки.
            const medal = ['#ffcf3a', '#d4dde7', '#e08a48'][r.rank - 1];
            if (medal) { ctx.beginPath(); ctx.arc(44, cy, 18, 0, Math.PI * 2); ctx.fillStyle = medal; ctx.fill(); }
            ctx.textAlign = 'center';
            ctx.font = font(r.rank > 99 ? 18 : 24);
            ctx.fillStyle = medal || r.me ? '#3a2400' : '#ffffff';
            ctx.fillText(String(r.rank), 44, cy + 1);
            // Аватар-кружок.
            const av = this._img(r.avatar || Character.avatarFor(null));
            ctx.save();
            ctx.beginPath(); ctx.arc(90, cy, 19, 0, Math.PI * 2); ctx.closePath();
            ctx.fillStyle = '#9fd8ff'; ctx.fill();
            if (av) { ctx.clip(); ctx.drawImage(av, 71, cy - 19, 38, 38); }
            ctx.restore();
            ctx.beginPath(); ctx.arc(90, cy, 19, 0, Math.PI * 2);
            ctx.lineWidth = 3; ctx.strokeStyle = r.me ? '#7a4a00' : '#ffffff'; ctx.stroke();
            // Аура справа (огонёк + число), имя — в оставшееся место.
            ctx.font = font(26);
            ctx.textAlign = 'right';
            const sc = String(r.score), sw = ctx.measureText(sc).width;
            ctx.lineWidth = 6;
            ctx.strokeStyle = r.me ? '#ffffff' : '#3a0b17';
            ctx.strokeText(sc, W - 26, cy + 1);
            ctx.fillStyle = r.me ? '#d81b47' : '#ff7896';
            ctx.fillText(sc, W - 26, cy + 1);
            if (flame) ctx.drawImage(flame, W - 26 - sw - 30, cy - 14, 28, 28);
            ctx.textAlign = 'left';
            ctx.font = font(24);
            const name = this._fit(ctx, r.name, W - 26 - sw - 36 - 118);
            if (r.me) { ctx.fillStyle = '#3a2400'; }
            else {
                ctx.lineWidth = 5;
                ctx.strokeStyle = 'rgba(10,25,60,0.85)';
                ctx.strokeText(name, 118, cy + 1);
                ctx.fillStyle = '#ffffff';
            }
            ctx.fillText(name, 118, cy + 1);
        }
        ctx.restore();
        b.tex.update(true);
    },

    // --- UI-кит для модулей (GameModes, GameGloves, магазин, итоги) -------------------------
    // modal({ title, theme: 'orange'|'blue'|'red'|'green'|'gold', html?: string, body?: HTMLElement,
    //   buttons?: [{ text, kind?: 'green'|'orange'|'blue'|'red'|'gray'|'gold'|'ad', onClick?: (m) => void, keep?: bool, disabled?: bool }],
    //   closeX?: bool (крестик, по умолчанию true), onClose?: () => void, pause?: bool (игра на паузе, пока открыто),
    //   backdrop?: bool (тап мимо окна закрывает; только с крестиком), cls?: string (свой класс окна) })
    //   -> { el, body, close(), closed }. Кнопка закрывает окно после onClick, если keep не true. Esc — крестик.
    modal(opts) {
        const o = opts || {};
        const wrap = document.createElement('div');
        wrap.className = 'gu-mwrap';
        const panel = document.createElement('div');
        panel.className = 'gu-modal gu-th-' + (o.theme || 'blue') + (o.cls ? ' ' + o.cls : '');
        const head = document.createElement('div');
        head.className = 'gu-mh';
        head.textContent = o.title || '';
        const body = document.createElement('div');
        body.className = 'gu-mb';
        if (o.html) body.innerHTML = o.html;
        if (o.body) body.appendChild(o.body);
        const foot = document.createElement('div');
        foot.className = 'gu-mf';
        panel.append(head, body, foot);
        wrap.appendChild(panel);
        const closable = o.closeX !== false;
        const m = {
            el: wrap, body, closed: false,
            close: () => {
                if (m.closed) return;
                m.closed = true;
                wrap.remove();
                const i = this._modals.indexOf(rec);
                if (i >= 0) this._modals.splice(i, 1);
                if (o.pause) { this._menuPauses = Math.max(0, this._menuPauses - 1); if (!this._menuPauses) Pause.set('menu', false); }
                if (o.onClose) { try { o.onClose(); } catch (e) { console.error(e); } }
            },
        };
        // Игрок сам закрыл окно — естественная пауза для рекламы (Playables), opts.adBreak: false — нет.
        const userClose = () => { this.click(); m.close(); if (o.adBreak !== false) this.adBreak(); };
        const rec = { close: userClose, closable };
        if (closable) {
            const x = document.createElement('button');
            x.type = 'button'; x.className = 'gu-x'; x.textContent = '✕';
            x.setAttribute('aria-label', 'close');
            x.addEventListener('click', userClose);
            head.appendChild(x);
            if (o.backdrop) wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) userClose(); });
        }
        for (const b of o.buttons || []) {
            const el = this.button(b.text, b.kind, () => { if (b.onClick) b.onClick(m); if (!b.keep) m.close(); });
            if (b.disabled) el.disabled = true;
            foot.appendChild(el);
        }
        if (!foot.childNodes.length) foot.remove();
        // Баннер площадки (CrazyGames) — только на экранах итогов (opts.banner), под кнопками;
        // не пришёл — место схлопывается. Снимается вместе с окном.
        let bannerId = '';
        if (o.banner && Platform.bannerSupported) {
            bannerId = 'gu-banner-' + (++this._bannerSeq);
            const box = document.createElement('div');
            box.className = 'gu-banner';
            box.innerHTML = '<div class="gu-banner-l"></div><div class="gu-banner-c"></div>';
            box.querySelector('.gu-banner-l').textContent = Lang.t('adLabel');
            box.querySelector('.gu-banner-c').id = bannerId;
            panel.appendChild(box);
            const id = bannerId;
            requestAnimationFrame(() => { if (!m.closed) Platform.bannerShow(id, 320, 50).then((ok) => { if (!ok) box.remove(); }); });
        }
        if (bannerId) {
            const close0 = m.close;
            m.close = () => { if (!m.closed) Platform.bannerClear(bannerId); close0(); };
        }
        document.body.appendChild(wrap);
        this._modals.push(rec);
        if (o.pause) { this._menuPauses++; Pause.set('menu', true); }
        GameInput.reset();
        return m;
    },

    // Кнопка в стиле игры: kind — 'green' (по умолчанию) | 'orange' | 'blue' | 'red' | 'gray' | 'gold' | 'ad' (иконка видео).
    button(text, kind, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gu-b' + (kind && kind !== 'green' ? ' gu-k-' + kind : '');
        b.textContent = text;
        let last = 0;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const now = performance.now();
            if (b.disabled || now - last < 350) return;   // двойной клик не дублирует действие
            last = now;
            this.click();
            if (onClick) onClick();
        });
        return b;
    },

    // Системная «Назад» (Android): закрыть верхнее окно игры — модалку, настройки, гардероб.
    // true — закрыли сами; false — окон нет (нативный слой спросит про выход).
    _back() {
        const modals = document.querySelectorAll('.gu-mwrap');
        const top = /** @type {HTMLElement | null} */ (modals.length ? modals[modals.length - 1] : null);
        if (top) {
            const x = /** @type {HTMLElement | null} */ (top.querySelector('.gu-x'));
            if (x) x.click();
            return true;   // окно без крестика (итог раунда) — выбирают кнопкой
        }
        if (this.settingsEl && this.settingsEl.classList.contains('gu-open')) { this.openSettings(false); this.adBreak(); return true; }
        const w = typeof GameWardrobe !== 'undefined' ? /** @type {any} */ (GameWardrobe) : null;
        if (w && w.isOpen && typeof w.close === 'function') { w.close(); this.adBreak(); return true; }
        return false;
    },

    // Playables: клик по любой кнопке интерфейса — межстраничная реклама (Platform.ads.breakpoint: не
    // чаще GAME_ADS_BREAK_GAP). Можно ли — решается до обработчиков кнопки (они могут начать бой или
    // закрыть окно), запрос — после них: кнопка награды или итога уже заняла рекламу, тогда своей нет.
    _initClickAds() {
        if (!Platform.ads.frequent) return;
        window.addEventListener('click', (e) => {
            const el = /** @type {Element | null} */ (e.target);
            const b = el && el.closest ? el.closest('button') : null;
            if (!b || !this._clickAdAllowed(b)) return;
            setTimeout(() => { if (!Platform._adBusy && !this._tutorialActive()) Platform.ads.breakpoint(); }, 0);
        }, true);
    },

    // Не реклама: кнопки управления и наград, туториал и вход в него, идущая реклама и пауза платформы,
    // игровой процесс — бой без открытого окна (в окне бой на паузе или игрок уже не в бою).
    _clickAdAllowed(b) {
        if (b.id === 'gi-dash' || b.matches('.gu-k-ad, .gg-ad')) return false;
        if (this._tutorialActive() || Platform._adBusy || Pause.has('ad') || Pause.has('platform')) return false;
        if (!Game.started && Game.save && !Game.save.tutorialDone) return false;   // новичок: «Играть» ведёт в туториал
        const settings = this.settingsEl && this.settingsEl.classList.contains('gu-open');
        return !(Game.started && Game.pvp(Game.zone) && !this._modals.length && !settings);
    },

    _tutorialActive() {
        const t = typeof GameTutorial !== 'undefined' ? /** @type {any} */ (GameTutorial) : null;
        return !!(t && t.active);
    },

    // Игрок закрыл окно сам: реклама в естественной паузе (Platform.ads.breakpoint — частая только
    // на Playables), когда он вернулся в игру — других окон, настроек и гардероба нет, туториал не идёт.
    adBreak() {
        if (this._modals.length) return;
        if (this.settingsEl && this.settingsEl.classList.contains('gu-open')) return;
        const w = typeof GameWardrobe !== 'undefined' ? /** @type {any} */ (GameWardrobe) : null;
        if (w && w.isOpen) return;
        if (this._tutorialActive()) return;
        Platform.ads.breakpoint();
    },

    // Кнопка HUD в правой рейке под шестерёнкой и звуком (модули: гардероб, подарок …).
    // opts: { id, icon, text, theme: 'blue'|'purple'|'green'|'pink'|'gold', onClick, order } -> HTMLButtonElement.
    // Меньше order — выше (магазин — 0). setHudBadge(id, text|true|null) — красная метка; showHudButton(id, on).
    addHudButton(opts) {
        const col = this.hud && this.hud.querySelector('#gu-rail');
        if (!col) return null;
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'gu-hb-' + opts.id;
        b.className = 'gu-hbtn gu-th-' + (opts.theme || 'blue');
        b.dataset.order = String(opts.order || 10);
        b.innerHTML = '<img alt=""><span></span>';
        /** @type {HTMLImageElement} */ (b.querySelector('img')).src = opts.icon;
        b.querySelector('span').textContent = opts.text;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.click(); if (opts.onClick) opts.onClick(); });
        let before = null;
        for (const el of /** @type {NodeListOf<HTMLElement>} */ (col.querySelectorAll('.gu-hbtn'))) {
            if (Number(el.dataset.order) > Number(b.dataset.order)) { before = el; break; }
        }
        col.insertBefore(b, before);
        return b;
    },

    setHudBadge(id, text) {
        const b = this.hud && this.hud.querySelector('#gu-hb-' + id);
        if (!b) return;
        let d = b.querySelector('.gu-dot');
        if (text == null || text === false) { if (d) d.remove(); return; }
        if (!d) { d = document.createElement('span'); d.className = 'gu-dot'; b.appendChild(d); }
        d.textContent = text === true ? '' : String(text);
    },

    showHudButton(id, on) {
        const b = this.hud && this.hud.querySelector('#gu-hb-' + id);
        if (b) b.classList.toggle('gu-hide', !on);
    },

    // Кнопка звука/музыки в рейке: всё выключено <-> всё включено (по отдельности — в настройках).
    toggleSound() {
        const st = Game.save && Game.save.settings;
        if (!st) return;
        const on = !(st.sfx && st.music);
        st.sfx = on; st.music = on;
        Game.saveSoon();
        Game.applySettings();
        this._syncSound();
        if (on) this.click();
    },

    _syncSound() {
        const b = this.hud && this.hud.querySelector('#gu-snd');
        const st = Game.save && Game.save.settings;
        if (!b || !st) return;
        const on = !!(st.sfx && st.music);
        /** @type {HTMLImageElement} */ (b.querySelector('img')).src = on ? 'assets/ui/icon_sound_on.png' : 'assets/ui/icon_sound_off.png';
        b.classList.toggle('gu-offb', !on);
        b.setAttribute('title', Lang.t(on ? 'soundOn' : 'soundOff'));
    },

    // Звук нажатия интерфейса.
    click() { Sound.play('assets/sounds/ui_click.mp3', { volume: 1 }); },

    // Звук интерфейса (url — строковый литерал пути ассета у вызова).
    sfx(url, volume) { Sound.play(url, { volume: volume == null ? 1 : volume }); },

    // Эффект бейджа персонажа: 'glitch' (RGB-сдвиг, Фонк Момент) | 'dark' | null — снять.
    setBadgeFx(ch, fx) {
        if (!ch || !ch.badge) return;
        const el = ch.badge.el;
        for (const c of Array.from(el.classList)) if (c.startsWith('gu-fx-')) el.classList.remove(c);
        if (fx) el.classList.add('gu-fx-' + fx);
    },

    // --- Стартовый экран ------------------------------------------------------------------
    // Логотип поверх живого лобби (камера облетает лобби — GameCamera.orbit), «ИГРАТЬ»,
    // внизу — «Рекорды» и «Настройки».

    showStart(onPlay) {
        if (this.startEl) this.startEl.remove();
        const el = this.startEl = document.createElement('div');
        el.id = 'gu-start';
        // Название латиницей — одно для всех языков (текстовая вывеска; арт-логотип — docs/CODEX-IMAGEGEN-PROMPT.md).
        const logo = String(GAME_PLATFORM) === 'pikabu'   // Пикабу: название только по-русски
            ? '<div class="gu-logo2"><span>Мастер</span><span>ауры</span><small>НЕОНОВЫЕ КРЫШИ</small></div>'
            : '<div class="gu-logo2"><span>Aura</span><span>Farming</span><small>MASTER</small></div>';
        el.innerHTML = logo + '<button class="gu-play" type="button" data-t="play"></button>' +
            '<div class="gu-stb"><button class="gu-sb" type="button" data-a="records"><img src="assets/ui/icon_trophy.png" alt=""><span data-t="records"></span></button>' +
            '<button class="gu-sb" type="button" data-a="settings"><img src="assets/ui/icon_gear.png" alt=""><span data-t="settings"></span></button></div>';
        const title = Lang.t('title');
        el.setAttribute('aria-label', title);
        for (const s of /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.gu-title span'))) s.textContent = title;
        document.body.appendChild(el);
        Lang.apply(el);
        let done = false;
        el.querySelector('.gu-play').addEventListener('click', () => { if (done) return; done = true; this.click(); onPlay(); });
        el.querySelector('[data-a="records"]').addEventListener('click', () => { this.click(); this.openRecords(); });
        el.querySelector('[data-a="settings"]').addEventListener('click', () => { this.click(); this.openSettings(true); });
    },

    hideStart() {
        const el = this.startEl;
        if (!el) return;
        this.startEl = null;
        el.classList.add('gu-gone');
        setTimeout(() => el.remove(), 400);
    },
};
