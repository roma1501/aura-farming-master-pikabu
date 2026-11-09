// Platform.js — платформа игры: Яндекс Игры (YaGames), YouTube Playables (ytgame),
// Playgama Bridge (bridge — Playgama и её площадки), Android-обёртка RuStore (нативный мост
// AndroidAds: реклама РСЯ — android/ в проекте) или локальный запуск. Игра зовёт
// только Platform — SDK знает этот файл.
// SDK подключает сборка: build.bat yandex вписывает в index.html скрипт /sdk.js,
// build.bat playables — SDK Playables первым скриптом, build.bat playgama — Bridge SDK с CDN
// Playgama и playgama-bridge-config.json рядом с index.html. Без SDK (run.bat, web-сборка)
// работает локальный адаптер: сохранения — в Store, реклама — ничего (с ?mockads в
// адресе — заглушка-оверлей на секунду: проверить паузу, звук и выдачу награды).
//
//   await Platform.init()        SDK, язык платформы, события паузы (main.js)
//   Platform.firstFrame()        экран загрузки на экране (Playables firstFrameReady; main.js)
//   Platform.ready()             игра готова к вводу: Яндекс LoadingAPI.ready, Playables gameReady (main.js)
//   Platform.gameplay(on)        идёт ли игровой процесс (Яндекс GameplayAPI start/stop);
//                                на паузе (Pause.js) движок сам шлёт stop, после — start
//   Platform.ads.roundEnded()    раунд завершён (победа или поражение) — ОДИН раз на раунд
//   Platform.ads.next(go)        переход по кнопке «Далее/Заново/Меню»: после двух
//                                результатов сначала interstitial, потом go(); защита от двойного клика
//   Platform.ads.breakpoint(go)  естественная пауза (выход в лобби, закрытие окна, клик по кнопке интерфейса):
//                                Playables — interstitial, потом go()
//   await Platform.rewarded(id)  true — ТОЛЬКО если SDK подтвердил просмотр
//   Platform.submitScore(n)      рекорд: Яндекс — лидерборд 'Score' (не чаще раза в секунду), Playables — sendScore
//   await Platform.leaderboard() [{ rank, name, score, me }] или null (Яндекс)
//   await Platform.load()        сохранение игры (объект) или null
//   await Platform.save(obj)     записать сохранение (Яндекс — облако игрока + Store, Playables — saveData)
// На время рекламы игра и звук стоят (Pause 'ad'), после — прежнее состояние.

/** @satisfies {Record<string, any>} */
const Platform = {
    name: 'local',        // 'yandex' | 'playables' | 'bridge' (Playgama Bridge) | 'android' | 'local'
    /** @type {Map<string, (ok: boolean) => void>} */
    _nativeCbs: new Map(), // Android: ожидающие ответа показы рекламы (id -> resolve)
    _nativeSeq: 0,
    /** @type {(() => boolean) | null} */
    backHandler: null,  // «Назад» (Android): true — игра закрыла окно сама
    bridgeId: null,       // площадка под Bridge (bridge.platform.id: 'playgama', 'yandex', …)
    _noSave: false,       // Bridge: загрузка сохранения не удалась — не перезаписывать облако
    sdk: null,            // объект SDK Яндекса (ysdk)
    lang: null,           // язык платформы (BCP-47) или null
    player: null,         // игрок Яндекса
    LEADERBOARD: 'Score', // технический id лидерборда Яндекса (в интерфейсе — «Рекорды»)
    _readySent: false,
    _firstFrameSent: false,
    _playing: false,
    _gameplaySent: false, // последнее, что ушло в GameplayAPI: stop без start не шлётся
    _adBusy: false,
    _adEnd: 0,              // Date.now() конца последней рекламы (ads.breakpoint держит паузу между ними)
    _loaded: null,        // Promise первого load() — Playables: saveData только после loadData
    _scoreAt: 0,
    _scoreTimer: 0,
    _scorePending: null,

    async init() {
        try {
            if (typeof AndroidAds !== 'undefined') this._initAndroid();
            else if (window.CrazyGames && window.CrazyGames.SDK) await this._initCrazy();
            else if (typeof bridge !== 'undefined') await this._initBridge();
            else if (typeof YaGames !== 'undefined') await this._initYandex();
            else if (typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) await this._initPlayables();
        } catch (e) {
            // В Playables нельзя незаметно перейти на локальные сохранения или
            // потерять обязательные SDK-события. Загрузка покажет ошибку/повтор.
            if (typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) throw e;
            console.warn('Platform: SDK не поднялся, играем локально — ' + ((e && e.message) || e));
            this.name = 'local';
            this.sdk = null;
        }
        Pause.onChange(() => this._syncGameplay());
        // Нет rewarded-рекламы на площадке — предложения «за рекламу» скрываются (класс на <html>).
        try { document.documentElement.classList.toggle('no-rewarded', !this.canRewarded); } catch (e) { /* без DOM (тесты) */ }
        console.log('Platform: ' + this.name + (this.lang ? ', язык платформы ' + this.lang : ''));
        return this;
    },

    async _initYandex() {
        let timer = 0;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('YaGames.init timeout')), 8000); });
        try { this.sdk = await Promise.race([YaGames.init(), timeout]); } finally { clearTimeout(timer); }
        this.name = 'yandex';
        try { this.lang = this.sdk.environment.i18n.lang || null; } catch (e) { /* язык по умолчанию */ }
        if (typeof this.sdk.on === 'function') {
            this.sdk.on('game_api_pause', () => Pause.set('platform', true));
            this.sdk.on('game_api_resume', () => Pause.set('platform', false));
        }
        try { this.player = await this.sdk.getPlayer({ scopes: false }); } catch (e) { this.player = null; }
    },

    // Android-обёртка (RuStore): реклама РСЯ в нативном слое через мост AndroidAds
    // (showInterstitial/showRewarded(id) -> window.__androidAdResult(id, ok)); сворачивание
    // приложения -> window.__androidPause(on); системная «Назад» -> window.__androidBack():
    // true — игра сама закрыла окно, false — нативный слой спросит про выход.
    _initAndroid() {
        this.name = 'android';
        window.__androidAdResult = (id, ok) => {
            const cb = this._nativeCbs.get(String(id));
            if (cb) { this._nativeCbs.delete(String(id)); cb(ok === true); }
        };
        window.__androidPause = (on) => Pause.set('platform', !!on);
        window.__androidBack = () => this._androidBack();
    },

    // «Назад» на Android: обработчик игры (GameUI ставит Platform.backHandler) закрывает своё окно.
    _androidBack() {
        try { return this.backHandler ? this.backHandler() === true : false; } catch (e) { return false; }
    },

    // Реклама через нативный мост: true — показ состоялся (rewarded — награда подтверждена SDK).
    _nativeAd(kind) {
        return new Promise((resolve) => {
            const id = kind + '-' + (++this._nativeSeq);
            this._nativeCbs.set(id, resolve);
            try {
                if (kind === 'rewarded') AndroidAds.showRewarded(id); else AndroidAds.showInterstitial(id);
            } catch (e) {
                this._nativeCbs.delete(id);
                resolve(false);
            }
        });
    },

    // Playgama Bridge: initialize до любого bridge.*; язык, звук и пауза — от площадки
    // (события AUDIO_STATE_CHANGED / PAUSE_STATE_CHANGED покрывают и рекламу, и вкладку).
    async _initBridge() {
        let timer = 0;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bridge.initialize timeout')), 10000); });
        try { await Promise.race([bridge.initialize(), timeout]); } finally { clearTimeout(timer); }
        this.name = 'bridge';
        this.sdk = bridge;
        const P = bridge.platform, E = bridge.EVENT_NAME;
        try { this.bridgeId = P.id || null; } catch (e) { this.bridgeId = null; }
        try { this.lang = P.language || null; } catch (e) { this.lang = null; }
        try { Sound.setPlatformMuted(P.isAudioEnabled === false); } catch (e) { /* звук по умолчанию */ }
        try {
            P.on(E.AUDIO_STATE_CHANGED, (on) => { this._bridgeMuted = !on; Sound.setPlatformMuted(!on); });
            P.on(E.PAUSE_STATE_CHANGED, (paused) => this._bridgePause(!!paused));
        } catch (e) { console.warn('Platform: события Bridge недоступны', e); }
        // Пауза Bridge (вкладка, фокус) — своя причина 'bridge'. Если площадка не прислала
        // «продолжить» после возврата в iframe, игра продолжается сама: страница видна и игрок
        // коснулся/кликнул/нажал клавишу (кроме времени нашей рекламы).
        const resume = () => {
            if (document.hidden || this._adBusy) return;
            try { if (!document.hasFocus()) window.focus(); } catch (e) { /* iframe */ }
            if (Pause.has('bridge')) Pause.set('bridge', false);
            if (this._bridgeMuted) { this._bridgeMuted = false; Sound.setPlatformMuted(false); }
        };
        for (const type of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(type, resume, true);
        window.addEventListener('focus', resume);
    },
    _bridgeMuted: false,

    _bridgePause(on) {
        Pause.set('bridge', on);
        if (on) window.dispatchEvent(new Event('lory-release-input'));   // зажатые клавиши/касания не залипнут
    },

    // Реклама Bridge: kind 'interstitial' | 'rewarded'. Итог — по событиям состояния: rewarded —
    // true ТОЛЬКО при состоянии 'rewarded' (закрытие без него — false); interstitial — true при
    // 'closed'. Нет реакции 4 с (интервал Bridge между показами, нет рекламы) — false, игра идёт дальше.
    _bridgeAd(kind) {
        const ad = bridge.advertisement, E = bridge.EVENT_NAME, rewarded = kind === 'rewarded';
        if (rewarded ? !ad.isRewardedSupported : !ad.isInterstitialSupported) return Promise.resolve(false);
        return new Promise((resolve) => {
            const ev = rewarded ? E.REWARDED_STATE_CHANGED : E.INTERSTITIAL_STATE_CHANGED;
            let got = false, done = false, timer = 0;
            const finish = (v) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { if (typeof ad.off === 'function') ad.off(ev, onState); } catch (e) { /* старый Bridge */ }
                resolve(v);
            };
            const onState = (state) => {
                if (state === 'loading' || state === 'opened') { clearTimeout(timer); timer = setTimeout(() => finish(rewarded ? got : true), 180000); }
                else if (state === 'rewarded') got = true;
                else if (state === 'closed') finish(rewarded ? got : true);
                else if (state === 'failed') finish(rewarded ? got : false);
            };
            timer = setTimeout(() => finish(false), 4000);
            ad.on(ev, onState);
            try {
                if (rewarded) ad.showRewarded('reward'); else ad.showInterstitial('round_end');
            } catch (e) { finish(false); }
        });
    },

    async _initPlayables() {
        this.name = 'playables';
        const sys = ytgame.system;
        sys.onPause(() => Pause.set('platform', true));
        sys.onResume(() => Pause.set('platform', false));
        sys.onAudioEnabledChange((on) => Sound.setPlatformMuted(!on));
        Sound.setPlatformMuted(!sys.isAudioEnabled());
        try { this.lang = await sys.getLanguage(); } catch (e) { this.lang = null; }
    },

    // --- CrazyGames (SDK v3: build.bat crazygames вписывает crazygames-sdk-v3.js) ---------
    // Прогресс — модуль data; язык — systemInfo.locale; muteAudio/disableChat — настройки сайта;
    // ник — аккаунт CrazyGames; gameplayStart/Stop — раунд и меню (не фокус: его ведёт сайт);
    // реклама — requestAd midgame/rewarded; баннеры — только на карточках итога (bannerShow).
    chatDisabled: false,  // CrazyGames disableChat: фразы ботов-«игроков» в чате не показываются
    user: null,           // игрок CrazyGames { username, profilePictureUrl } или null (гость)
    userAvailable: false, // аккаунты доступны (на чужих доменах — нет)
    _cgNoAds: false,      // блокировщик рекламы / Basic Launch: предложения «за рекламу» скрыты
    _cgProgress: -1,

    async _initCrazy() {
        const SDK = window.CrazyGames.SDK;
        let timer = 0;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CrazyGames.SDK.init timeout')), 10000); });
        try { await Promise.race([SDK.init(), timeout]); } finally { clearTimeout(timer); }
        if (SDK.environment === 'disabled') throw new Error('CrazyGames SDK отключён на этом домене');
        this.name = 'crazygames';
        this.sdk = SDK;
        try { SDK.game.loadingStart(); } catch (e) { /* старый SDK */ }
        try { const info = SDK.user.systemInfo; this.lang = (info && info.locale) || null; } catch (e) { this.lang = null; }
        const settings = (s) => {
            Sound.setPlatformMuted(!!(s && s.muteAudio));
            this.chatDisabled = !!(s && s.disableChat);
        };
        try { settings(SDK.game.settings); SDK.game.addSettingsChangeListener(settings); } catch (e) { /* настройки по умолчанию */ }
        try {
            const adblock = await Promise.race([SDK.ad.hasAdblock(), new Promise((r) => setTimeout(() => r(false), 3000))]);
            this._cgNoAds = adblock === true;
        } catch (e) { /* неизвестно — считаем, что реклама есть */ }
        try {
            this.userAvailable = !!SDK.user.isUserAccountAvailable;
            if (this.userAvailable) {
                this.user = await SDK.user.getUser();
                // Вход перезагружает игру (модуль data подтягивает облако) — здесь только обновить ник.
                SDK.user.addAuthListener((u) => { this.user = u || null; window.dispatchEvent(new Event('platform-user')); });
            }
        } catch (e) { this.user = null; }
    },

    // Ник игрока площадки (CrazyGames) или null.
    playerName() {
        return this.name === 'crazygames' && this.user && this.user.username ? String(this.user.username) : null;
    },

    // «Войти через CrazyGames» (кнопка в настройках для гостя; не автоматически).
    async login() {
        if (this.name !== 'crazygames' || !this.userAvailable || this.user) return false;
        try { this.user = await this.sdk.user.showAuthPrompt(); return !!this.user; } catch (e) { return false; }
    },

    // Особое достижение (победа в битве/дуэли): CrazyGames happytime.
    happy() {
        if (this.name === 'crazygames') try { this.sdk.game.happytime(); } catch (e) { /* нет SDK */ }
    },

    // Процент прохождения 0..100 (только растёт): CrazyGames reportGameCompletedPercentage.
    progress(pct) {
        const v = Math.max(0, Math.min(100, Math.floor(pct)));
        if (this.name !== 'crazygames' || v <= this._cgProgress) return;
        this._cgProgress = v;
        try { this.sdk.game.reportGameCompletedPercentage(v); } catch (e) { /* нет SDK */ }
    },

    // Контекст для отзывов игроков ({ mode }) или null — снять (CrazyGames).
    context(ctx) {
        if (this.name !== 'crazygames') return;
        try { if (ctx) this.sdk.game.setGameContext(ctx); else this.sdk.game.clearGameContext(); } catch (e) { /* нет SDK */ }
    },

    // Баннер в контейнере id (w×h px) — только на экранах итогов, не в игре. true — показан.
    get bannerSupported() { return this.name === 'crazygames' && !this._cgNoAds; },
    async bannerShow(id, w, h) {
        if (!this.bannerSupported) return false;
        try { await this.sdk.banner.requestBanner({ id, width: w, height: h }); return true; } catch (e) { return false; }
    },
    bannerClear(id) {
        if (this.name === 'crazygames') try { this.sdk.banner.clearBanner(id); } catch (e) { /* уже нет */ }
    },

    // Реклама CrazyGames: пока запрос — игра стоит (причина 'adwait', звук играет) и интерфейс
    // закрыт прозрачным слоем; звук молчит только с adStarted (причина 'ad'). true — adFinished
    // (rewarded — награду выдаёт игра); adError — false, игра продолжается.
    async _crazyAd(kind) {
        if (this._adBusy) return false;
        this._adBusy = true;
        Pause.set('adwait', true);
        const block = document.createElement('div');
        block.style.cssText = 'position:fixed;inset:0;z-index:99998;background:transparent';
        document.body.appendChild(block);
        try {
            return await new Promise((resolve) => {
                this.sdk.ad.requestAd(kind === 'rewarded' ? 'rewarded' : 'midgame', {
                    adStarted: () => Pause.set('ad', true),
                    adFinished: () => resolve(true),
                    adError: (err) => {
                        const code = err && err.code;
                        if (code === 'adblock' || code === 'adsDisabledBasicLaunch') {
                            this._cgNoAds = true;
                            try { document.documentElement.classList.add('no-rewarded'); } catch (e) { /* без DOM */ }
                        }
                        resolve(false);
                    },
                });
            });
        } catch (e) {
            return false;
        } finally {
            block.remove();
            Pause.set('ad', false);
            Pause.set('adwait', false);
            this._adBusy = false;
        }
    },

    // Доступна ли rewarded-реклама на площадке (иначе игра скрывает предложения «за рекламу»).
    get canRewarded() {
        try {
            if (this.name === 'crazygames') return !this._cgNoAds;
            if (this.name === 'playables') return !!(typeof ytgame !== 'undefined' && ytgame.ads && ytgame.ads.requestRewardedAd);
            if (this.name === 'bridge') return !!(typeof bridge !== 'undefined' && bridge.advertisement && bridge.advertisement.isRewardedSupported);
        } catch (e) { return false; }
        return true;
    },

    // --- Жизненный цикл -------------------------------------------------------

    firstFrame() {
        if (!this._firstFrameSent && typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) {
            ytgame.game.firstFrameReady();
            this._firstFrameSent = true;
        }
    },

    ready() {
        if (this._readySent) return;
        try {
            if (this.name === 'yandex') this.sdk.features.LoadingAPI && this.sdk.features.LoadingAPI.ready();
            else if (this.name === 'bridge') bridge.platform.sendMessage('game_ready');
            else if (this.name === 'crazygames') this.sdk.game.loadingStop();
            else if (this.name === 'playables') {
                this.firstFrame();
                ytgame.game.gameReady();
            }
            this._readySent = true;
        } catch (e) {
            if (this.name === 'playables') throw e;
            console.warn('Platform.ready:', e);
        }
    },

    // on — игрок в игровом процессе (раунд идёт). Меню, экран результата, пауза — false.
    gameplay(on) {
        this._playing = !!on;
        this._syncGameplay();
    },

    _syncGameplay() {
        // CrazyGames: фокус и уход со страницы ведёт сам сайт — 'auto' не считается остановкой.
        const crazy = this.name === 'crazygames';
        let paused = Pause.active;
        if (crazy) { paused = false; for (const r of Pause.reasons) if (r !== 'auto') paused = true; }
        const want = this._playing && !paused;
        if (this._gameplaySent === want || (this.name !== 'yandex' && !crazy)) { this._gameplaySent = want; return; }
        this._gameplaySent = want;
        if (crazy) {
            try { if (want) this.sdk.game.gameplayStart(); else this.sdk.game.gameplayStop(); } catch (e) { /* нет SDK */ }
            return;
        }
        try {
            const api = this.sdk.features.GameplayAPI;
            if (api) { if (want) api.start(); else api.stop(); }
        } catch (e) { /* SDK без GameplayAPI */ }
    },

    // --- Реклама ----------------------------------------------------------------

    // Interstitial. true — запрос успешен (Playables НЕ подтверждает факт показа).
    // Яндекс возвращает shown. Ошибка/нет API — false, переход всё равно продолжается.
    async interstitial() {
        if (this.name === 'crazygames') return this._crazyAd('midgame');
        if (this._adBusy) return false;
        this._adBusy = true;
        Pause.set('ad', true);
        try {
            if (this.name === 'yandex') {
                return await new Promise((resolve) => this.sdk.adv.showFullscreenAdv({ callbacks: {
                    onClose: (shown) => resolve(!!shown),
                    onError: () => resolve(false),
                    onOffline: () => resolve(false),
                } }));
            }
            if (this.name === 'bridge') return await this._bridgeAd('interstitial');
            if (this.name === 'android') return await this._nativeAd('interstitial');
            if (this.name === 'playables') {
                if (!ytgame.ads || !ytgame.ads.requestInterstitialAd) return false;
                await ytgame.ads.requestInterstitialAd();
                return true;
            }
            return await this._mockAd(false);
        } catch (e) {
            return false;
        } finally {
            Pause.set('ad', false);
            this._adBusy = false;
            this._adEnd = Date.now();
        }
    },

    // Rewarded. id — стабильный id награды без данных игрока ('continue', 'coins-x2').
    // true — ТОЛЬКО по подтверждению SDK; закрытие и ошибка — false. Награду выдаёт
    // игра по true и один раз.
    async rewarded(id) {
        if (this.name === 'crazygames') return this._crazyAd('rewarded');
        if (this._adBusy) return false;
        this._adBusy = true;
        Pause.set('ad', true);
        try {
            if (this.name === 'yandex') {
                return await new Promise((resolve) => {
                    let got = false;
                    this.sdk.adv.showRewardedVideo({ callbacks: {
                        onRewarded: () => { got = true; },
                        onClose: () => resolve(got),
                        onError: () => resolve(false),
                    } });
                });
            }
            if (this.name === 'bridge') return await this._bridgeAd('rewarded');
            if (this.name === 'android') return await this._nativeAd('rewarded');
            if (this.name === 'playables') {
                if (!ytgame.ads || !ytgame.ads.requestRewardedAd) return false;
                return (await ytgame.ads.requestRewardedAd(String(id || 'reward'))) === true;
            }
            return await this._mockAd(true);
        } catch (e) {
            return false;
        } finally {
            Pause.set('ad', false);
            this._adBusy = false;
            this._adEnd = Date.now();
        }
    },

    // Локальная заглушка рекламы: только с ?mockads в адресе — оверлей на секунду,
    // rewarded засчитывается. Без флага — рекламы нет (false).
    _mockAd(reward) {
        if (!/[?&#]mockads\b/.test(location.search + location.hash)) return Promise.resolve(false);
        return new Promise((resolve) => {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(0,0,0,.85);color:#fff;font:bold 22px system-ui,sans-serif;text-align:center';
            el.textContent = (reward ? 'REWARDED' : 'INTERSTITIAL') + ' — local mock';
            document.body.appendChild(el);
            setTimeout(() => { el.remove(); resolve(true); }, 1000);
        });
    },

    // Счётчик interstitial по правилу игры: реклама — после каждых ДВУХ завершённых
    // раундов (любой исход), и только по кнопке перехода, не в момент результата.
    // Playables (просьба модерации YouTube, 2026-10) — ads.frequent: реклама после КАЖДОГО итога
    // и в естественных паузах — breakpoint(go): выход в лобби кнопкой посреди игры, закрытие окна,
    // клик по кнопке интерфейса вне боя (GameUI._initClickAds).
    // Показывать ли ролик сейчас, решает сам YouTube (requestInterstitialAd — «если есть»).
    ads: {
        results: 0,
        busy: false,

        // Раунд завершён (победа или поражение) — звать ОДИН раз на раунд.
        roundEnded() { this.results++; },

        // Частые interstitial: сборка Playables; локально — с ?adsfreq (вместе с ?mockads).
        get frequent() {
            return String(typeof GAME_PLATFORM !== 'undefined' ? GAME_PLATFORM : '') === 'playables'
                || /[?&#]adsfreq\b/.test(location.search + location.hash);
        },

        // Естественная пауза вне итога раунда. frequent — interstitial (не раньше GAME_ADS_BREAK_GAP с
        // после прошлой рекламы), затем go(); иначе — сразу go(). Идёт другой переход — без рекламы.
        async breakpoint(go) {
            const gap = (typeof GAME_ADS_BREAK_GAP !== 'undefined' ? GAME_ADS_BREAK_GAP : 20) * 1000;
            if (!this.busy && !Platform._adBusy && this.frequent && Date.now() - Platform._adEnd >= gap) {
                this.busy = true;
                try {
                    this.results = 0;
                    await Platform.interstitial();
                } finally {
                    this.busy = false;
                }
            }
            if (go) await go();
        },

        // Переход по кнопке: после двух результатов — сначала реклама, затем go().
        // Повторный клик, пока идёт переход, игнорируется. Реклама не пришла или
        // ошибка — переход без задержки, новый цикл из двух результатов.
        async next(go) {
            if (this.busy) return;
            this.busy = true;
            try {
                if (this.results >= (this.frequent ? 1 : 2)) {
                    this.results = 0;
                    await Platform.interstitial();
                }
                if (go) await go();
            } finally {
                this.busy = false;
            }
        },
    },

    // --- Рекорды -------------------------------------------------------------------

    // Рекорд игрока. Яндекс: лидерборд 'Score', не чаще раза в секунду (лишнее — последним
    // значением через секунду). Playables: sendScore.
    submitScore(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        const v = Math.max(0, Math.floor(number));
        if (!Number.isSafeInteger(v)) return;
        if (this.name === 'playables') {
            try { ytgame.engagement.sendScore({ value: v }).catch(() => {}); } catch (e) { /* SDK старый */ }
            return;
        }
        if (this.name !== 'yandex') return;
        this._scorePending = v;
        const wait = this._scoreAt + 1100 - Date.now();
        if (wait > 0) {
            if (!this._scoreTimer) this._scoreTimer = setTimeout(() => { this._scoreTimer = 0; this.submitScore(this._scorePending); }, wait);
            return;
        }
        this._scoreAt = Date.now();
        this._scorePending = null;
        const lb = this.sdk.leaderboards;
        const p = lb && lb.setScore ? lb.setScore(this.LEADERBOARD, v)
            : this.sdk.getLeaderboards().then((old) => old.setLeaderboardScore(this.LEADERBOARD, v));
        Promise.resolve(p).catch((e) => console.warn('Platform.submitScore:', (e && e.message) || e));
    },

    // Таблица рекордов (Яндекс): [{ rank, name, score, me }] или null — нет SDK,
    // нет лидерборда или ошибка. Лимит Яндекса — 20 запросов за 5 минут: кэшировать в игре.
    async leaderboard(opts) {
        if (this.name !== 'yandex') return null;
        const o = Object.assign({ quantityTop: 10, includeUser: true, quantityAround: 3 }, opts || {});
        try {
            const lb = this.sdk.leaderboards;
            const res = lb && lb.getEntries ? await lb.getEntries(this.LEADERBOARD, o)
                : await (await this.sdk.getLeaderboards()).getLeaderboardEntries(this.LEADERBOARD, o);
            let myId = '';
            try { myId = this.player ? this.player.getUniqueID() : ''; } catch (e) { /* аноним */ }
            return (res.entries || []).map((e) => ({
                rank: e.rank, score: e.score,
                name: (e.player && e.player.publicName) || '',
                me: !!(myId && e.player && e.player.uniqueID === myId),
            }));
        } catch (e) {
            return null;
        }
    },

    // --- Сохранения ------------------------------------------------------------------

    _storeKey() { return (typeof GAME_ID !== 'undefined' ? GAME_ID : 'lory-game') + '.save'; },

    // Сохранение игры: объект или null.
    load() {
        if (!this._loaded) this._loaded = this._load().catch((error) => {
            this._loaded = null; // ошибка сети/данных не означает пустое сохранение; возможен повтор
            throw error;
        });
        return this._loaded;
    },

    async _load() {
        if (this.name === 'playables') {
            // Только SDK. Успешный loadData обязателен ДО saveData; ошибку нельзя
            // превращать в null и затем перезаписывать облако новой игрой.
            const raw = await ytgame.game.loadData();
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') throw new Error('Invalid Playables save data');
            return data;
        }
        if (this.name === 'bridge') {
            // Только Storage Bridge (облако площадки), одним вызовом. Ошибка — играем с нуля,
            // но не перезаписываем облако (_noSave), чтобы не потерять прогресс.
            try {
                const d = await bridge.storage.get(['save']);
                const raw = d && d[0];
                if (raw == null || raw === '') return null;
                const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return data && typeof data === 'object' ? data : null;
            } catch (e) {
                this._noSave = true;
                console.warn('Platform.load (Bridge):', (e && e.message) || e);
                return null;
            }
        }
        if (this.name === 'crazygames') {
            // Модуль data CrazyGames (гость — локально у SDK, вход — облако аккаунта). Ошибка —
            // играем с нуля, но не перезаписываем сохранение (_noSave).
            try {
                const raw = this.sdk.data.getItem('save');
                if (raw == null || raw === '') return null;
                const data = JSON.parse(raw);
                return data && typeof data === 'object' ? data : null;
            } catch (e) {
                this._noSave = true;
                console.warn('Platform.load (CrazyGames):', (e && e.message) || e);
                return null;
            }
        }
        const local = Store.getJSON(this._storeKey(), null);
        try {
            if (this.name === 'yandex' && this.player) {
                const data = await this.player.getData(['save']);
                if (data && data.save && typeof data.save === 'object') return data.save;
            }
        } catch (e) {
            console.warn('Platform.load:', (e && e.message) || e);
        }
        return local;
    },

    // Записать JSON. Playables: только SDK, после УСПЕШНОГО load; без localStorage.
    // До начала новой игры нужно await Platform.load() и применить загруженный
    // прогресс; rejected load следует показать как ошибку с повтором.
    async save(obj) {
        try {
            const data = JSON.stringify(obj);
            if (typeof data !== 'string') return false;
            if (this.name === 'bridge') {
                if (this._noSave) return false;
                await bridge.storage.set(['save'], [data]);
                return true;
            }
            if (this.name === 'crazygames') {
                if (this._noSave) return false;
                this.sdk.data.setItem('save', data);   // SDK сам склеивает частые записи (debounce)
                return true;
            }
            if (this.name === 'playables') {
                // Консервативная проверка обоих представлений: < 3 MiB (MUST).
                // JSON.stringify экранирует непарные суррогаты: строка well-formed UTF-16.
                const bytes = Math.max(data.length * 2, new TextEncoder().encode(data).byteLength);
                if (bytes >= 3 * 1024 * 1024) throw new Error('Playables save must be smaller than 3 MiB');
                await this.load();
                await ytgame.game.saveData(data);
            } else {
                const stored = Store.set(this._storeKey(), data);
                if (this.name === 'yandex' && this.player) await this.player.setData({ save: obj }, true);
                else if (!stored) return false;
            }
            return true;
        } catch (e) {
            console.warn('Platform.save:', (e && e.message) || e);
            return false;
        }
    },
};
