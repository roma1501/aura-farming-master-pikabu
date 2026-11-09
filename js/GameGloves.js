// GameGloves.js — перчатки (DESIGN.md §5, §7, §10): данные 20 перчаток, пьедесталы лобби,
// инфо-карточка у пьедестала, «Взять», открытие за несколько просмотров рекламы, тосты
// открытия по порогу ауры.
//
// Данные: GameGloves.LIST — [{ id, name, aura, ad, ads, botAura, power, speed, cooldown, range, scale,
//   kind ('active'|'passive'|null), cd (перезарядка способности, с), phonk (множитель шанса Фонк
//   Момента), ability (название способности), desc (описание), icon (путь иконки assets/ui/gloves/ID.png) }]
//   в порядке пьедесталов glove-1 … glove-20. name / ability / desc — геттеры по текущему языку.
//   aura — порог открытия по ауре, ЗАРАБОТАННОЙ за всё время (Game.auraTotal(); трата ауры в
//   гардеробе порог не откатывает); у ad-перчаток aura = 0, ad = true, ads — сколько просмотров
//   рекламы нужно (Game.adUnlock('glove_' + id, ads), 2…7), botAura — порог, с которого такую
//   перчатку носят боты.
//   Новые ad-перчатки (rainbow, neon, pixel, dragon) — на механиках существующих способностей
//   (GameAbilities: ABIL_BASE); модели/цвета/ореол дописываются в таблицы Character ниже.
// API: get(id), isUnlocked(id) (для игрока: заработано ≥ порога, или id в Game.save.unlocked, или
//   у ad-перчатки набраны все просмотры), adProgress(id) -> { views, need },
//   pickForBot(aura, rnd?) -> id, take(id, silent?) (надеть игроку: проверки, сохранение, событие glove).
//
// Пьедестал (маркер glove-N + объект pedestal.glb рядом): над ним перчатка на палке парит и
// медленно вращается (glove_<id>.glb, свечение Character.lightGlove), табличка Sign —
// DynamicTexture «Аура: N» тёмным жирным на белом (у ad — иконка видео и «k/N» просмотров),
// кольцо Ring — жёлтое, у надетой перчатки зелёное. Карточка (DOM над пьедесталом через
// projectToScreen) — когда игрок ближе GLOVES_CARD_DIST: название, СИЛА, СКОРОСТЬ ШЛЕПКА,
// ЗАДЕРЖКА ШЛЕПКА, способность, прогресс («Заработано ауры: X/N») и кнопка «Взять» / «Надето» /
// «Нужно N ауры» / «Смотреть рекламу k/N» (каждый досмотр — +1; набрано N — открыта навсегда).

const GLOVES_CARD_DIST = 180;        // px: игрок ближе к центру пьедестала — карточка
const GLOVES_CARD_H = 225;           // px над полом: точка карточки (низ панели) над пьедесталом
const GLOVES_STAND_H = 64;           // px над полом: точка хвата перчатки на пьедестале
const GLOVES_BOB = 7;                // px: покачивание перчатки на пьедестале
const GLOVES_SPIN = 0.55;            // рад/с: вращение перчатки на пьедестале
const GLOVES_GIANT_SCALE = 0.62;     // «Гигант» на пьедестале меньше (в руке — как в файле)
const GLOVES_PED_TOP = 45;           // px: верх пьедестала (pedestal.glb, 0.45 м) — если объекта нет
const GLOVES_LOBBY_VIEW = 7000;      // px: камера дальше от лобби — пьедесталы не анимируются

// Иконки перчаток — строковыми литералами (сборщик видит только литералы).
const GLOVES_ICONS = {
    default: 'assets/ui/gloves/default.png', slime: 'assets/ui/gloves/slime.png', love: 'assets/ui/gloves/love.png',
    ice: 'assets/ui/gloves/ice.png', fire: 'assets/ui/gloves/fire.png', bomb: 'assets/ui/gloves/bomb.png',
    meteor: 'assets/ui/gloves/meteor.png', tile: 'assets/ui/gloves/tile.png', brainrot: 'assets/ui/gloves/brainrot.png',
    ghost: 'assets/ui/gloves/ghost.png', gravity: 'assets/ui/gloves/gravity.png', speed: 'assets/ui/gloves/speed.png',
    blackhole: 'assets/ui/gloves/blackhole.png', giant: 'assets/ui/gloves/giant.png', golden: 'assets/ui/gloves/golden.png',
    diamond: 'assets/ui/gloves/diamond.png', rainbow: 'assets/ui/gloves/rainbow.png', neon: 'assets/ui/gloves/neon.png',
    pixel: 'assets/ui/gloves/pixel.png', dragon: 'assets/ui/gloves/dragon.png',
};

// Модели и ореол новых ad-перчаток — в таблицах Character (GameCharacter.js: GLOVE_URLS,
// GLOVE_GLOW). Здесь — только цвет запасной перчатки из примитивов (если GLB не загрузился).
if (typeof Character !== 'undefined') {
    Object.assign(Character.GLOVE_COLORS, { rainbow: 0xff6fd0, neon: 0x2ef2ff, pixel: 0x5ad65a, dragon: 0xc8281e });
}

Object.assign(LANG_STRINGS.ru, {
    gl_default: 'Свежак', gl_slime: 'Кислота', gl_love: 'Сердцеед', gl_ice: 'Фриз', gl_fire: 'Жара', gl_bomb: 'Бум',
    gl_meteor: 'Метеорит', gl_tile: 'Подземка', gl_brainrot: 'Мозгоплав', gl_ghost: 'Фантом', gl_gravity: 'Ноль-G',
    gl_speed: 'Турбо', gl_blackhole: 'Бездна', gl_giant: 'Тяжеловес', gl_golden: 'Золотой дрип', gl_diamond: 'Бриллиант',
    gla_slime: 'Скольжение', gla_love: 'Сердечки', gla_ice: 'Заморозка', gla_fire: 'Ярость', gla_bomb: 'Бросок бомбы',
    gla_meteor: 'Лавовый шар', gla_tile: 'Плитка на голову', gla_brainrot: 'Брейнрот', gla_ghost: 'Невидимка',
    gla_gravity: 'Невесомость', gla_speed: 'Скорость', gla_blackhole: 'Чёрная дыра', gla_giant: 'Длинная рука',
    gla_golden: 'Золото', gla_diamond: 'Алмазные искры',
    gld_slime: 'Цель скользит дальше', gld_love: 'Каждый 3-й шлепок +2 ауры', gld_ice: 'Замораживает цель на 1 с, потом полёт',
    gld_fire: 'Огненная аура: +50% силы на 5 с (15 с)', gld_bomb: 'Бомба во врага, взрыв отбрасывает всех рядом (8 с)',
    gld_meteor: 'Катящийся лавовый шар сносит всех на пути (12 с)', gld_tile: 'Плитка падает врагу на голову: оглушение 1 с (9 с)',
    gld_brainrot: 'Фонк-моменты втрое чаще, маска страха на цели', gld_ghost: 'Невидимость для ботов на 3 с (14 с)',
    gld_gravity: 'Цель улетает высоко вверх и медленно падает', gld_speed: '+35% скорости бега, рывок вдвое чаще',
    gld_blackhole: 'Затягивает врагов и взрывается (16 с)', gld_giant: 'Дальность шлепка ×1,5',
    gld_golden: 'Каждый 2-й шлепок +1 бонусная аура', gld_diamond: 'Искры и сильнейший шлепок',
    gl_rainbow: 'Голограмма', gl_neon: 'Неон', gl_pixel: '8-бит', gl_dragon: 'Драконий коготь',
    gla_rainbow: 'Радуга', gla_neon: 'Неоновый разгон', gla_pixel: 'Пиксель-блок', gla_dragon: 'Ярость дракона',
    gld_rainbow: 'Каждый 3-й шлепок +2 ауры, конфетти и сердечки', gld_neon: '+35% скорости бега, рывок вдвое чаще',
    gld_pixel: 'Пиксельный блок падает врагу на голову: оглушение 1 с (9 с)',
    gld_dragon: 'Драконье пламя: +50% силы на 5 с (15 с), мощный шлепок',
    glSign: 'Аура: {n}',
    glPower: 'Сила', glSpeed: 'Скорость шлепка', glDelay: 'Задержка шлепка', glAbility: 'Способность', glNone: 'нет',
    glTake: 'Взять', glEquipped: 'Надето', glNeed: 'Нужно {n} ауры', glAd: 'Открыть за рекламу',
    glAdWatch: 'Смотреть рекламу {k}/{n}', glAdCount: 'Просмотр засчитан: {k}/{n}', glEarned: 'Заработано ауры: {k}/{n}',
    glTaken: 'Перчатка «{name}» в руке!', glUnlocked: 'Открыта перчатка: {name}!', glAdFail: 'Реклама не досмотрена',
});
Object.assign(LANG_STRINGS.en, {
    gl_default: 'Fresh', gl_slime: 'Acid Drip', gl_love: 'Heartbreaker', gl_ice: 'Freeze', gl_fire: 'Heatwave', gl_bomb: 'Boom',
    gl_meteor: 'Meteor Fist', gl_tile: 'Subway', gl_brainrot: 'Brainmelt', gl_ghost: 'Phantom', gl_gravity: 'Zero-G',
    gl_speed: 'Turbo', gl_blackhole: 'Void', gl_giant: 'Heavyweight', gl_golden: 'Gold Drip', gl_diamond: 'Iced Out',
    gla_slime: 'Slide', gla_love: 'Hearts', gla_ice: 'Freeze', gla_fire: 'Rage', gla_bomb: 'Bomb Throw',
    gla_meteor: 'Lava Ball', gla_tile: 'Tile Drop', gla_brainrot: 'Brainrot', gla_ghost: 'Vanish',
    gla_gravity: 'Zero-G', gla_speed: 'Speed', gla_blackhole: 'Black Hole', gla_giant: 'Long Arm',
    gla_golden: 'Gold', gla_diamond: 'Diamond Sparks',
    gld_slime: 'Target slides farther', gld_love: 'Every 3rd slap +2 aura', gld_ice: 'Freezes the target for 1 s, then it flies',
    gld_fire: 'Fire aura: +50% power for 5 s (15 s)', gld_bomb: 'Throws a bomb, the blast knocks everyone back (8 s)',
    gld_meteor: 'A rolling lava ball smashes everyone (12 s)', gld_tile: 'A tile drops on the enemy: stun 1 s (9 s)',
    gld_brainrot: 'Phonk Moments 3× more often, fear mask on the target', gld_ghost: 'Invisible to bots for 3 s (14 s)',
    gld_gravity: 'The target flies sky-high and falls slowly', gld_speed: '+35% run speed, dash twice as often',
    gld_blackhole: 'Pulls enemies in and explodes (16 s)', gld_giant: 'Slap range ×1.5',
    gld_golden: 'Every 2nd slap +1 bonus aura', gld_diamond: 'Sparks and the strongest slap',
    gl_rainbow: 'Holo', gl_neon: 'Neon Circuit', gl_pixel: '8-Bit', gl_dragon: 'Dragon Claw',
    gla_rainbow: 'Rainbow', gla_neon: 'Neon Rush', gla_pixel: 'Pixel Drop', gla_dragon: 'Dragon Rage',
    gld_rainbow: 'Every 3rd slap +2 aura, confetti and hearts', gld_neon: '+35% run speed, dash twice as often',
    gld_pixel: 'A pixel block drops on the enemy: stun 1 s (9 s)',
    gld_dragon: 'Dragon fire: +50% power for 5 s (15 s), mighty slap',
    glSign: 'Aura: {n}',
    glPower: 'Power', glSpeed: 'Slap speed', glDelay: 'Slap delay', glAbility: 'Ability', glNone: 'none',
    glTake: 'Take', glEquipped: 'Equipped', glNeed: 'Need {n} aura', glAd: 'Unlock with an ad',
    glAdWatch: 'Watch ad {k}/{n}', glAdCount: 'Ad counted: {k}/{n}', glEarned: 'Aura earned: {k}/{n}',
    glTaken: '{name} glove equipped!', glUnlocked: 'Glove unlocked: {name}!', glAdFail: 'The ad was not finished',
});

/**
 * Запись перчатки (DESIGN §10).
 * @param {string} id @param {number} aura @param {boolean} ad @param {number} power @param {number} speed
 * @param {number} cooldown @param {string | null} kind @param {number} cd @param {Record<string, any>} [extra]
 */
function glovesEntry(id, aura, ad, power, speed, cooldown, kind, cd, extra) {
    const e = {
        id, aura, ad, ads: ad ? 1 : 0, botAura: aura, power, speed, cooldown, range: 1, scale: 1, kind, cd, phonk: 1,
        icon: /** @type {string} */ (GLOVES_ICONS[id]),
        get name() { return Lang.t('gl_' + id); },
        get ability() { return kind ? Lang.t('gla_' + id) : ''; },
        get desc() { return kind ? Lang.t('gld_' + id) : ''; },
    };
    if (extra) Object.assign(e, extra);
    return e;
}

/** @typedef {ReturnType<typeof glovesEntry>} GloveEntry */
/** @typedef {{ glove: GloveEntry, i: number, x: number, y: number, h: number, top: number, holder: BABYLON.TransformNode,
 *   root: BABYLON.Mesh | null, sign: BABYLON.Mesh | null, signTex: BABYLON.DynamicTexture | null, ring: BABYLON.Mesh | null,
 *   ringOn: number, phase: number, signKey: string }} Pedestal */

/** @satisfies {Record<string, any>} */
const GameGloves = {
    LIST: [
        glovesEntry('default', 0, false, 600, 1.0, 0.55, null, 0),
        glovesEntry('slime', 15, false, 650, 1.0, 0.55, 'passive', 0),
        glovesEntry('love', 40, false, 640, 1.1, 0.5, 'passive', 0),
        glovesEntry('ice', 80, false, 680, 1.0, 0.6, 'passive', 0),
        glovesEntry('fire', 130, false, 700, 1.2, 0.5, 'active', 15),
        glovesEntry('bomb', 200, false, 720, 1.4, 0.53, 'active', 8),
        glovesEntry('meteor', 260, false, 760, 1.0, 0.6, 'active', 12),
        glovesEntry('tile', 330, false, 580, 1.65, 0.44, 'active', 9),
        glovesEntry('brainrot', 420, false, 680, 1.4, 0.35, 'passive', 0, { phonk: 3 }),
        glovesEntry('ghost', 520, false, 700, 1.3, 0.5, 'active', 14),
        glovesEntry('gravity', 650, false, 740, 1.1, 0.55, 'passive', 0),
        glovesEntry('speed', 800, false, 620, 1.8, 0.4, 'passive', 0),
        glovesEntry('blackhole', 1000, false, 800, 1.0, 0.6, 'active', 16),
        glovesEntry('giant', 1400, false, 1000, 0.8, 0.8, 'passive', 0, { range: 1.5 }),
        glovesEntry('golden', 0, true, 900, 1.3, 0.45, 'passive', 0, { ads: 5, botAura: 1800 }),
        glovesEntry('diamond', 0, true, 1100, 1.5, 0.45, 'passive', 0, { ads: 7, botAura: 2600 }),
        // Пьедесталы glove-17 … glove-20 (второй ряд у южного края лобби) — за рекламу.
        glovesEntry('rainbow', 0, true, 660, 1.15, 0.5, 'passive', 0, { ads: 2, botAura: 600 }),
        glovesEntry('neon', 0, true, 680, 1.7, 0.4, 'passive', 0, { ads: 3, botAura: 900 }),
        glovesEntry('pixel', 0, true, 640, 1.6, 0.42, 'active', 9, { ads: 4, botAura: 1200 }),
        glovesEntry('dragon', 0, true, 960, 1.25, 0.5, 'active', 15, { ads: 6, botAura: 2200 }),
    ],
    _lastEarned: 0,
    /** @type {Pedestal[]} */
    pedestals: [],
    /** @type {HTMLElement | null} */
    card: null,
    /** @type {Pedestal | null} */
    _cardPed: null,
    _cardKey: '',
    _adBusy: false,
    _t: 0,
    /** @type {Record<string, HTMLImageElement>} */
    _img: {},

    get(id) {
        for (const g of this.LIST) if (g.id === id) return g;
        return null;
    },

    // Открыта ли перчатка у игрока: заработано за всё время ≥ порога (трата ауры не закрывает),
    // открыта навсегда (save.unlocked) или у ad-перчатки набраны все просмотры рекламы.
    isUnlocked(id) {
        const g = this.get(id);
        if (!g) return false;
        const s = Game.save;
        if (s && Array.isArray(s.unlocked) && s.unlocked.indexOf(id) >= 0) return true;
        if (g.ad) return this.adProgress(id).views >= g.ads;
        return this._earned() >= g.aura;
    },

    // Просмотры рекламы ad-перчатки: { views, need }.
    adProgress(id) {
        const g = this.get(id);
        const need = g && g.ad ? Math.max(1, g.ads | 0) : 0;
        const views = need && typeof Game.adViews === 'function' ? Math.min(need, Game.adViews('glove_' + id)) : 0;
        return { views, need };
    },

    // Аура игрока, заработанная за всё время (пороги перчаток).
    _earned() {
        if (typeof Game.auraTotal === 'function') return Game.auraTotal();
        const p = Game.player, s = Game.save;
        return p ? p.aura : (s ? s.aura || 0 : 0);
    },

    // Перчатка бота по его ауре: чаще одна из трёх лучших доступных, иногда — любая доступная.
    pickForBot(aura, rnd) {
        const r = typeof rnd === 'function' ? rnd : Math.random;
        const a = Number(aura) || 0;
        const need = (g) => (g.ad ? g.botAura : g.aura);
        const ok = this.LIST.filter(g => need(g) <= a).sort((x, y) => need(x) - need(y));
        if (!ok.length) return 'default';
        if (ok.length > 1 && r() < 0.65) {
            const top = ok.slice(-3);
            return top[Math.min(top.length - 1, Math.floor(r() * top.length))].id;
        }
        return ok[Math.min(ok.length - 1, Math.floor(r() * ok.length))].id;
    },

    // --- Жизненный цикл ----------------------------------------------------------------

    init(game) {
        this._css();
        this._loadImages();
        this._buildCard();
        // Сохранённая перчатка больше не открыта (битое сохранение, отладка) — обычная.
        const p = Game.player;
        if (p && !this.isUnlocked(p.glove)) {
            p.setGlove('default');
            Game.save.glove = 'default';
            Game.saveSoon();
        }
        this._lastEarned = this._earned();
        this._setupPedestals();
        Game.on('glove', (e) => { if (e.char === Game.player) this._refresh(); });
        Game.on('aura', (e) => this._onAura(e));
        // Шрифт GameFont догрузился — таблички перерисовать (до этого — запасной шрифт).
        try {
            if (document.fonts && document.fonts.load) {
                document.fonts.load('900 64px GameFont').then(() => {
                    for (const ped of this.pedestals) ped.signKey = '';
                    this._refresh();
                }).catch(() => { /* без шрифта — запасной */ });
            }
        } catch (e) { /* нет FontFaceSet */ }
        void game;
    },

    update(dt, realDt) {
        const rdt = realDt || dt || 0;
        this._t += rdt;
        const cam = GameWorld.view && GameWorld.view.camera;
        const lobby = GameWorld.zoneCenter('lobby');
        const near = !cam || !lobby || Math.hypot(cam.position.x - lobby.x, cam.position.z - lobby.y) < GLOVES_LOBBY_VIEW;
        if (near) {
            for (const ped of this.pedestals) {
                const t = this._t + ped.phase;
                ped.holder.rotation.y = ped.phase * 3 + this._t * GLOVES_SPIN;
                ped.holder.position.y = ped.top + (GLOVES_STAND_H - GLOVES_PED_TOP) + Math.sin(t * 1.7) * GLOVES_BOB;
            }
        }
        this._cardUpdate();
    },

    onZone() { this._hideCard(); },

    // --- Пьедесталы ---------------------------------------------------------------------

    _setupPedestals() {
        const scene = GameWorld.scene, view = GameWorld.view;
        if (!scene) return;
        const peds = GameWorld.objectsOf('pedestal').filter(r => r.mesh && r.def);
        const signs = GameWorld.findParts('pedestal', 'Sign');
        const rings = GameWorld.findParts('pedestal', 'Ring');
        /** @param {Array<{ def: LocationObjectDef }>} list @param {number} x @param {number} y */
        const nearest = (list, x, y) => {
            let best = null, bd = 160;
            for (const it of list) {
                const d = Math.hypot((+it.def.x || 0) - x, (+it.def.y || 0) - y);
                if (d < bd) { bd = d; best = it; }
            }
            return best;
        };
        this.LIST.forEach((g, i) => {
            const mk = GameWorld.marker('glove-' + (i + 1));
            if (!mk) return;
            const x = +mk.x || 0, y = +mk.y || 0, h = +mk.h || 0;
            const rec = nearest(peds, x, y);
            const sc = rec ? /** @type {any} */ (rec.def.scale) : 1;
            const sy = Array.isArray(sc) ? +sc[1] || 1 : +sc || 1;
            const top = (rec ? (+rec.def.h || 0) : h) + GLOVES_PED_TOP * sy;
            const holder = new BABYLON.TransformNode('gg-ped-' + g.id, scene);
            holder.position.set(x, top + GLOVES_STAND_H - GLOVES_PED_TOP, y);
            const sign = /** @type {any} */ (nearest(signs, x, y));
            const ring = /** @type {any} */ (nearest(rings, x, y));
            /** @type {Pedestal} */
            const ped = { glove: g, i, x, y, h, top, holder, root: null, sign: sign ? sign.mesh : null, signTex: null,
                ring: ring ? ring.mesh : null, ringOn: -1, phase: i * 0.83, signKey: '' };
            this.pedestals.push(ped);
            this._setupSign(ped);
            const url = Character.GLOVE_URLS[g.id];
            if (!url) return;
            Model3D.load(url).then(model => {
                const root = Model3D.build(model, scene, { name: 'gg-glove-' + g.id });
                root.parent = holder;
                root.rotation.z = Math.PI / 2;          // палка вниз, пальцы вверх, тыл ладони — к +Z
                if (g.id === 'giant') root.scaling.setAll(GLOVES_GIANT_SCALE);
                World3D.addObject(view, root, 'prop');
                Character.lightGlove(root, g.id);
                ped.root = root;
            }).catch(() => { /* нет модели — пьедестал без перчатки */ });
        });
        this._refresh();
    },

    _setupSign(ped) {
        if (!ped.sign) return;
        const scene = GameWorld.scene;
        const tex = new BABYLON.DynamicTexture('gg-sign-' + ped.glove.id, { width: 512, height: 200 }, scene, true);
        tex.hasAlpha = false;
        tex.anisotropicFilteringLevel = 4;
        const mat = new BABYLON.StandardMaterial('gg-sign-mat-' + ped.glove.id, scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        // Emissive умножается на цвет текстуры: белое — ярче, тёмные буквы остаются тёмными.
        mat.emissiveColor = new BABYLON.Color3(0.42, 0.42, 0.42);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.metadata = { toon: false };
        const old = ped.sign.material;
        ped.sign.material = mat;
        if (old && GameWorld.scene.materials.indexOf(old) >= 0 && !GameWorld.scene.meshes.some(m => m !== ped.sign && m.material === old)) old.dispose(false, false);
        ped.signTex = tex;
    },

    _loadImages() {
        const urls = { video: 'assets/ui/icon_video.png', lock: 'assets/ui/icon_lock.png', check: 'assets/ui/icon_check.png' };
        for (const k in urls) {
            const img = new Image();
            img.onload = () => { for (const p of this.pedestals) p.signKey = ''; this._refresh(); };
            img.src = urls[k];
            this._img[k] = img;
        }
    },

    // Табличка: белая пластина, «Аура: N» тёмным жирным, справа значок замка/галочки;
    // ad — иконка видео и «k/N» просмотров (открыта — иконка видео и галочка).
    _drawSign(ped) {
        const tex = ped.signTex;
        if (!tex) return;
        const g = ped.glove, unlocked = this.isUnlocked(g.id);
        const pr = g.ad ? this.adProgress(g.id) : null;
        const key = (unlocked ? 'u' : 'l') + (pr ? pr.views + '/' + pr.need : '') + Lang.code;
        if (key === ped.signKey) return;
        ped.signKey = key;
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        const W = 512, H = 200;
        ctx.fillStyle = '#f7f7f5';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#d3d6db';
        ctx.lineWidth = 12;
        ctx.strokeRect(6, 6, W - 12, H - 12);
        const img = (k) => { const im = this._img[k]; return im && im.complete && im.naturalWidth > 0 ? im : null; };
        if (g.ad) {
            const v = img('video'), c = unlocked ? img('check') : null;
            const vs = H * 0.78, gap = 14;
            ctx.font = '900 104px GameFont, sans-serif';
            const text = unlocked ? '' : pr.views + '/' + pr.need;
            const tw = text ? ctx.measureText(text).width : 0;
            const rw = c ? 112 : tw;
            const x0 = (W - vs - gap - rw) / 2;
            if (v) ctx.drawImage(v, x0, (H - vs) / 2, vs, vs);
            else {
                ctx.fillStyle = '#e8a21a';
                ctx.beginPath(); ctx.moveTo(x0 + vs * 0.22, H / 2 - vs * 0.32); ctx.lineTo(x0 + vs * 0.86, H / 2); ctx.lineTo(x0 + vs * 0.22, H / 2 + vs * 0.32); ctx.closePath(); ctx.fill();
            }
            if (c) ctx.drawImage(c, x0 + vs + gap, (H - 112) / 2, 112, 112);
            else if (text) {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#26292f';
                ctx.fillText(text, x0 + vs + gap, H / 2 + 4);
            }
        } else {
            const text = Lang.t('glSign', { n: g.aura });
            const icon = img(unlocked ? 'check' : 'lock');
            const isz = 78, gap = icon ? isz + 16 : 0;
            let size = 104;
            ctx.font = '900 ' + size + 'px GameFont, sans-serif';
            let tw = ctx.measureText(text).width;
            const maxW = W - 56 - gap;
            if (tw > maxW) { size = Math.floor(size * maxW / tw); ctx.font = '900 ' + size + 'px GameFont, sans-serif'; tw = ctx.measureText(text).width; }
            const x0 = (W - tw - gap) / 2;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#26292f';
            ctx.fillText(text, x0, H / 2 + size * 0.04);
            if (icon) ctx.drawImage(icon, x0 + tw + 16, (H - isz) / 2, isz, isz);
        }
        tex.update(true);
    },

    // Кольца (зелёное — надетая) и таблички (галочка у открытых).
    _refresh() {
        const p = Game.player;
        for (const ped of this.pedestals) {
            this._drawSign(ped);
            const on = p && p.glove === ped.glove.id ? 1 : 0;
            if (ped.ring && ped.ringOn !== on) {
                ped.ringOn = on;
                const mat = /** @type {BABYLON.StandardMaterial} */ (ped.ring.material);
                if (mat && 'emissiveColor' in mat) {
                    mat.diffuseColor = on ? new BABYLON.Color3(0.45, 1, 0.4) : new BABYLON.Color3(1, 0.88, 0.25);
                    mat.emissiveColor = on ? new BABYLON.Color3(0.3, 0.95, 0.28) : new BABYLON.Color3(1, 0.85, 0.2);
                }
                GameWorld.addGlow(ped.ring, on ? new BABYLON.Color3(0.15, 0.8, 0.15) : new BABYLON.Color3(0.85, 0.7, 0.12));
            }
        }
        this._cardKey = '';
    },

    // Переход порога по ауре, заработанной за всё время: вверх — тост «Открыта перчатка» + звук,
    // таблички. Трата ауры (баланс) порогов не меняет.
    _onAura(e) {
        if (!e || e.char !== Game.player) return;
        const prev = this._lastEarned, now = this._earned();
        this._lastEarned = now;
        if (now === prev) return;
        const lo = Math.min(prev, now), hi = Math.max(prev, now);
        const crossed = this.LIST.filter(g => !g.ad && g.aura > 0 && lo < g.aura && hi >= g.aura);
        if (!crossed.length) return;
        if (now > prev && Game.started) {
            if (typeof GameUI !== 'undefined') for (const g of crossed.slice(-2)) GameUI.toast(Lang.t('glUnlocked', { name: g.name }), 3);
            Sound.play('assets/sounds/unlock.mp3', { volume: 1 });
        }
        this._refresh();
    },

    // --- Взять / открыть ---------------------------------------------------------------

    // Надеть перчатку игроку (если открыта). true — надета. silent — без тоста «в руке».
    take(id, silent) {
        const p = Game.player, g = this.get(id);
        if (!p || !g || !this.isUnlocked(id)) return false;
        if (p.glove !== id) {
            p.setGlove(id);
            Game.save.glove = id;
            Game.saveSoon();
            Game.emit('glove', { char: p, glove: id });
        }
        Sound.play('assets/sounds/unlock.mp3', { volume: 1 });
        this._confetti(p);
        if (!silent && typeof GameUI !== 'undefined') GameUI.toast(Lang.t('glTaken', { name: g.name }), 2.2);
        this._refresh();
        return true;
    },

    // Один просмотр rewarded-рекламы в счёт ad-перчатки (Game.adUnlock: засчитан только при
    // true от SDK). Набрано ads просмотров — перчатка открыта навсегда (save.unlocked) и надета.
    async _unlockAd(id) {
        const g = this.get(id);
        if (!g || !g.ad || this._adBusy || this.isUnlocked(id)) return;
        this._adBusy = true;
        this._cardKey = '';
        /** @type {{ ok: boolean, views: number, need: number, done: boolean } | null} */
        let r = null;
        try { r = await Game.adUnlock('glove_' + id, g.ads); } catch (e) { r = null; }
        this._adBusy = false;
        this._cardKey = '';
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (!r || (!r.ok && !r.done)) { if (ui) ui.toast(Lang.t('glAdFail'), 2); return; }
        if (!r.done) {
            if (ui) ui.toast(Lang.t('glAdCount', { k: r.views, n: r.need }), 2.2);
            Sound.play('assets/sounds/coin.mp3', { volume: 0.9 });
            this._refresh();
            return;
        }
        const s = Game.save;
        if (!Array.isArray(s.unlocked)) s.unlocked = ['default'];
        if (s.unlocked.indexOf(id) < 0) s.unlocked.push(id);
        Game.saveNow();
        this._refresh();
        if (ui) ui.toast(Lang.t('glUnlocked', { name: g.name }), 3);
        this.take(id, true);
    },

    _confetti(ch) {
        const pos = new BABYLON.Vector3(ch.x, ch.h + 160, ch.y);
        let done = false;
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (fx && typeof fx.play === 'function') { try { done = !!fx.play('confetti', pos, { char: ch }); } catch (e) { done = false; } }
        if (!done && typeof GameAbilities !== 'undefined') GameAbilities.burst('confetti', ch.x, ch.h + 160, ch.y, true);
    },

    // --- Инфо-карточка ---------------------------------------------------------------------

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gg-card{position:fixed;left:0;top:0;z-index:9;width:276px;pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff;
 transform-origin:50% 100%;will-change:transform}
#gg-card.gg-hide{display:none}
#gg-card .gg-in{animation:gg-pop .22s ease-out}
@keyframes gg-pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
#gg-card .gg-title{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:-4px;font-size:32px;line-height:1.05;
 text-shadow:-2.5px -2.5px 0 #1b2f66,2.5px -2.5px 0 #1b2f66,-2.5px 2.5px 0 #1b2f66,2.5px 2.5px 0 #1b2f66,0 4px 0 rgba(0,0,0,.3)}
#gg-card .gg-title img{width:46px;height:46px;margin:-8px 0;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}
#gg-card .gg-panel{position:relative;margin-top:6px;padding:10px 12px 11px;border-radius:12px;border:4px solid #13285a;
 background:linear-gradient(180deg,#4a82e6 0%,#3266cc 55%,#2853b0 100%);box-shadow:0 5px 0 rgba(0,0,0,.25),inset 0 2px 0 rgba(255,255,255,.25);
 transform:rotate(-1.2deg);text-align:center}
#gg-card .gg-l{font-size:15px;line-height:1.45;letter-spacing:.3px;text-transform:uppercase;text-shadow:0 2px 0 rgba(0,0,0,.35)}
#gg-card .gg-l b{color:#ffe36b}
#gg-card .gg-ab{margin-top:3px;padding-top:4px;border-top:2px solid rgba(255,255,255,.25)}
#gg-card .gg-d{font-size:13px;line-height:1.25;color:#d9e8ff;text-shadow:0 1px 0 rgba(0,0,0,.35);font-weight:800}
#gg-card .gg-need{margin-top:7px;font-size:15px;line-height:1.2;text-align:center;color:#fff;
 text-shadow:-2px -2px 0 #1b2f66,2px -2px 0 #1b2f66,-2px 2px 0 #1b2f66,2px 2px 0 #1b2f66,0 3px 0 rgba(0,0,0,.3)}
#gg-card .gg-need:empty{display:none}
#gg-card .gg-need b{color:#ffe36b}
#gg-card .gg-act{display:flex;justify-content:center;margin-top:9px;pointer-events:auto}
#gg-card .gg-act .gu-b,#gg-card .gg-act .gg-b{min-width:170px;padding:9px 16px;font-size:21px}
#gg-card .gg-act .gu-b.gu-k-ad,#gg-card .gg-act .gg-b.gg-ad{padding:9px 12px;font-size:18px;white-space:nowrap}
#gg-card .gg-act img{width:24px;height:24px;margin:-5px 6px -5px 0;vertical-align:middle}
#gg-card .gg-b{border-radius:14px;border:3px solid #14202c;color:#fff;cursor:pointer;font:900 20px GameFont,system-ui,sans-serif;
 text-shadow:0 2px 0 rgba(0,0,0,.35);box-shadow:0 4px 0 rgba(0,0,0,.3);background:linear-gradient(#4fe356,#25a92e)}
#gg-card .gg-b.gg-gray{background:linear-gradient(#8d99a6,#64707c)}
#gg-card .gg-b.gg-ad{background:linear-gradient(#b46cff,#7d3ad8)}
#gg-card.gg-mob{width:214px}
#gg-card.gg-mob .gg-title{font-size:24px}
#gg-card.gg-mob .gg-title img{width:34px;height:34px}
#gg-card.gg-mob .gg-panel{padding:7px 8px 8px;border-width:3px}
#gg-card.gg-mob .gg-l{font-size:12px;line-height:1.35}
#gg-card.gg-mob .gg-d{font-size:11px}
#gg-card.gg-mob .gg-need{font-size:12px;margin-top:5px}
#gg-card.gg-mob .gg-act .gu-b,#gg-card.gg-mob .gg-act .gg-b{min-width:140px;padding:7px 12px;font-size:17px}
#gg-card.gg-mob .gg-act .gu-b.gu-k-ad,#gg-card.gg-mob .gg-act .gg-b.gg-ad{padding:7px 10px;font-size:15px}
`;
        document.head.appendChild(st);
    },

    _buildCard() {
        const el = this.card = document.createElement('div');
        el.id = 'gg-card';
        el.className = 'gg-hide' + (IS_MOBILE ? ' gg-mob' : '');
        el.innerHTML = '<div class="gg-in"><div class="gg-title"><img alt=""><span></span></div>' +
            '<div class="gg-panel"><div class="gg-l gg-pw"></div><div class="gg-l gg-sp"></div><div class="gg-l gg-cd"></div>' +
            '<div class="gg-l gg-ab"></div><div class="gg-d"></div></div><div class="gg-need"></div><div class="gg-act"></div></div>';
        // Карточка не пускает касания к слою камеры/джойстика только на кнопке (pointer-events).
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        document.body.appendChild(el);
    },

    _hideCard() {
        this._cardPed = null;
        this._cardKey = '';
        if (this.card) this.card.classList.add('gg-hide');
    },

    _num(v) {
        const s = String(Math.round(v * 100) / 100);
        return Lang.code === 'ru' ? s.replace('.', ',') : s;
    },

    _fillCard(ped) {
        const el = this.card, g = ped.glove;
        /** @type {HTMLImageElement} */ (el.querySelector('.gg-title img')).src = g.icon;
        el.querySelector('.gg-title span').textContent = g.name;
        const line = (sel, label, val) => {
            const d = el.querySelector(sel);
            d.textContent = label + ': ';
            const b = document.createElement('b');
            b.textContent = val;
            d.appendChild(b);
        };
        line('.gg-pw', Lang.t('glPower'), String(g.power));
        line('.gg-sp', Lang.t('glSpeed'), this._num(g.speed));
        line('.gg-cd', Lang.t('glDelay'), this._num(g.cooldown));
        line('.gg-ab', Lang.t('glAbility'), g.ability || Lang.t('glNone'));
        const d = /** @type {HTMLElement} */ (el.querySelector('.gg-d'));
        d.textContent = g.desc;
        d.style.display = g.desc ? '' : 'none';
        const inner = /** @type {HTMLElement} */ (el.querySelector('.gg-in'));
        inner.style.animation = 'none';
        void inner.offsetWidth;
        inner.style.animation = '';
    },

    _button(text, kind, icon, onClick, disabled) {
        /** @type {HTMLButtonElement} */
        let b;
        if (typeof GameUI !== 'undefined' && typeof GameUI.button === 'function') b = GameUI.button(text, kind, onClick || null);
        else {
            b = document.createElement('button');
            b.type = 'button';
            b.className = 'gg-b' + (kind === 'gray' ? ' gg-gray' : kind === 'ad' ? ' gg-ad' : '');
            b.textContent = text;
            if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) onClick(); });
        }
        if (icon) {
            const im = document.createElement('img');
            im.src = icon;
            im.alt = '';
            b.insertBefore(im, b.firstChild);
        }
        if (disabled) b.disabled = true;
        return b;
    },

    _cardUpdate() {
        const el = this.card, p = Game.player;
        if (!el || !p) return;
        let near = null;
        if (Game.started && Game.zone === 'lobby' && p.zone === 'lobby' && !Game.transitioning && p.state !== 'dead' && p.h > -100) {
            let bd = GLOVES_CARD_DIST;
            for (const ped of this.pedestals) {
                const d = Math.hypot(ped.x - p.x, ped.y - p.y);
                if (d < bd) { bd = d; near = ped; }
            }
        }
        if (near !== this._cardPed) {
            this._cardPed = near;
            this._cardKey = '';
            if (!near) { el.classList.add('gg-hide'); return; }
            this._fillCard(near);
            el.classList.remove('gg-hide');
            Sound.play('assets/sounds/ui_open.mp3', { volume: 0.6 });
        }
        if (!near) return;
        const g = near.glove;
        const unlocked = this.isUnlocked(g.id), worn = p.glove === g.id;
        const pr = g.ad ? this.adProgress(g.id) : null;
        const earned = !g.ad && !unlocked ? Math.min(g.aura, this._earned()) : 0;
        const key = g.id + (worn ? ':w' : unlocked ? ':u' : g.ad ? (this._adBusy ? ':b' : ':a') + pr.views : ':l' + earned) + Lang.code;
        if (key !== this._cardKey) {
            this._cardKey = key;
            const act = el.querySelector('.gg-act');
            act.textContent = '';
            const need = el.querySelector('.gg-need');
            need.textContent = '';
            let b;
            if (worn) b = this._button(Lang.t('glEquipped'), 'gray', 'assets/ui/icon_check.png', null, true);
            else if (unlocked) b = this._button(Lang.t('glTake'), 'green', null, () => this.take(g.id), false);
            else if (g.ad) b = this._button(Lang.t('glAdWatch', { k: pr.views, n: pr.need }), 'ad', null, () => { this._unlockAd(g.id); }, this._adBusy);
            else {
                b = this._button(Lang.t('glNeed', { n: g.aura }), 'gray', 'assets/ui/icon_lock.png', null, true);
                // Порог — по ауре за всё время: прогресс, чтобы трата в гардеробе не путала.
                const parts = Lang.t('glEarned', { k: '\u0001', n: g.aura }).split('\u0001');
                const v = document.createElement('b');
                v.textContent = String(earned);
                need.append(parts[0] || '', v, parts[1] || '');
            }
            act.appendChild(b);
        }
        // Позиция: над пьедесталом; в пределах экрана, не на джойстике (низ слева).
        const view = GameWorld.view;
        if (!view) return;
        const sp = view.projectToScreen(near.x, near.y, near.h + GLOVES_CARD_H);
        if (sp.behind) { el.style.opacity = '0'; return; }
        const W = VIEW.w, H = VIEW.h;
        const w = el.offsetWidth || 276, h = el.offsetHeight || 200;
        let x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, sp.x));
        let y = Math.max(h + 8, Math.min(H - 12, sp.y));
        const joyR = (GameInput.R || 64) * 1.3 * 2 + 70;     // зона джойстика: внизу слева
        if (x - w / 2 < joyR && y > H - joyR - 20) y = Math.max(h + 8, H - joyR - 20);
        el.style.opacity = '1';
        el.style.transform = 'translate3d(' + (x - w / 2).toFixed(1) + 'px,' + (y - h).toFixed(1) + 'px,0)';
    },
};
