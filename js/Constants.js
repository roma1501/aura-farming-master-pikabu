// Constants.js — ВСЕ числа игры на Lory Engine: земля, камера, рендер, звук. Грузится
// ПЕРВЫМ: остальные модули читают эти глобалы. Правит редактор (_utils/editor): сервер
// патчит только строки `const ИМЯ = <число>;` — значения держать числовыми
// литералами (цвета — 0xRRGGBB), формулу редактор не тронет. Карты (размер, рельеф,
// объекты) — в Maps.js.
const ENGINE_NAME = 'Lory Engine';
const ENGINE_VERSION = '1.20';
const GAME_MODE = '3d';              // '3d' | '2d': renderer selected before boot
const WORLD2D_WIDTH = 960;            // logical viewport width (world pixels)
const WORLD2D_HEIGHT = 540;            // logical viewport height
const WORLD2D_PIXEL_RATIO = 2;         // maximum device pixel ratio
const LOADING_TIMEOUT_MS = 45000;    // ожидание готовности шейдеров/текстур; при ошибке — повтор
const FX_MAX_SYSTEMS = 48;           // одновременно живые слои частиц
const FX_MAX_PARTICLES = 6000;       // общий бюджет ёмкости систем на ПК
const FX_MOBILE_SCALE = 0.55;        // плотность и бюджет частиц на мобильных
const GAME_ID = 'aura-farming-master';          // латиница, цифры, -: имя архива dist/<GAME_ID>-<платформа>-<версия>.zip и ключей сохранений
const GAME_TITLE = 'Мастер ауры';     // название игры: заголовок вкладки браузера
const GAME_VERSION = '1.0.0';         // версия билда: ?v= у скриптов (tools/build.mjs) и имя архива
const GAME_PLATFORM = 'pikabu';          // 'web' | 'yandex' | 'playables' — сборка ставит свою (build.bat yandex|playables)
const GAME_LANG = 'ru';               // язык интерфейса: сборка ставит ru (yandex) или en (playables); Lang.js
// Название игры по площадке: { <сборка>: 'Название' } — сборка ставит его в GAME_TITLE, <title> и заставку загрузки
// (tools/platforms.mjs platformTitle). Пикабу Игры: в названии нельзя иностранные слова.
/** @type {Record<string, string>} */
const GAME_TITLES = { pikabu: 'Мастер ауры' };

// Шим localStorage: в sandbox-iframe и при запрете данных сайта прямой доступ бросает SecurityError.
// Все обращения к хранилищу — только через Store.
// Playgama и CrazyGames: прогресс — только через SDK (Bridge Storage / модуль data), localStorage не трогаем.
const STORE_OFF = String(GAME_PLATFORM) === 'playgama' || String(GAME_PLATFORM) === 'crazygames';
/** @satisfies {Record<string, any>} */
const Store = {
    get(key) {
        if (STORE_OFF) return null;
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
        if (STORE_OFF) return false;
        try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },
    remove(key) {
        if (STORE_OFF) return;
        try { localStorage.removeItem(key); } catch (e) { /* нечего удалять */ }
    },
    // Разбор JSON без падения: битое значение = как будто сохранения нет.
    getJSON(key, fallback = null) {
        const raw = Store.get(key);
        if (raw === null) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : fallback;
        } catch (e) {
            console.warn('Store: повреждённое значение "' + key + '", сбрасываю.');
            Store.remove(key);
            return fallback;
        }
    }
};

// Телефон или планшет: user agent, iPad под видом Mac, тач на небольшом экране.
const IS_MOBILE = (() => {
    const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = Math.max(window.innerWidth, window.innerHeight) <= 1366 &&
        Math.min(window.innerWidth, window.innerHeight) <= 1024;
    const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return userAgentMobile || isiPad || (hasTouchScreen && isSmallScreen);
})();

// Игровое поле внутри окна. На ПК окно шире 2:1 — поле ограничено 2:1 по центру, по бокам
// рамка (index.html, требование Playgama). Координаты событий и getBoundingClientRect даны
// в окне: в поле — x - VIEW.x, y - VIEW.y; размер поля — VIEW.w × VIEW.h.
/** @satisfies {Record<string, any>} */
const VIEW = {
    get x() { const b = document.body; return b ? b.getBoundingClientRect().left : 0; },
    get y() { const b = document.body; return b ? b.getBoundingClientRect().top : 0; },
    get w() { const b = document.body; return (b && b.clientWidth) || window.innerWidth || 800; },
    get h() { const b = document.body; return (b && b.clientHeight) || window.innerHeight || 600; },
};

// --- ЗЕМЛЯ (Terrain3D.js). Размер, текстура и рельеф — у каждой карты свои (Maps.js).
// Единицы мира — px: x вправо, y вниз по карте, высота вверх (скилл world3d, §Координаты). ---
const GROUND_TILE_SIZE = 512;           // px мира на один повтор текстуры земли
const TERRAIN_CELL = 400;                 // px: шаг сетки террейна (мобильные — не мельче 12)

// --- ЗВУК (Sound.js): громкость 0..1; выключенный звук игрок сохраняет сам (Store) ---
const SOUND_VOLUME = 0.8;               // эффекты
const MUSIC_VOLUME = 0.5;               // музыка

// --- ЯЗЫК (Lang.js) ---
const LANG_AUTO = 0;                    // 1 — язык платформы, если он есть в словаре; 0 — всегда GAME_LANG

// --- КАМЕРА (CameraControl.js): цель на карте, азимут, наклон и зум. Зум —
// экранных px на мировой px в точке взгляда; расстояние выводится из него. ---
const CAMERA_FOV_DEG = 52;              // вертикальный угол обзора
const CAMERA_AZIMUTH_DEG = -90;         // куда смотрит камера по карте: −90 — север вверх, 0 — восток вверх
const CAMERA_PITCH_DEG = 57;            // наклон к земле: 90 — строго сверху, меньше — больше перспективы
const CAMERA_ZOOM = 1;                  // стартовый зум: ПК и планшеты
const CAMERA_ZOOM_MOBILE = 0.7;         // стартовый зум: телефоны (большая сторона экрана < 1024)
const CAMERA_ZOOM_MIN = 0.5;            // дальше колесо и щипок не отводят (ниже — в кадр попадёт край земли)
const CAMERA_ZOOM_MAX = 3;              // ближе не приближают
const CAMERA_ZOOM_WHEEL_STEP = 0.12;    // доля зума за один щелчок колеса
const CAMERA_ZOOM_LERP = 0.18;          // сглаживание зума: доля остатка за кадр
const CAMERA_FOLLOW_LERP = 0.05;        // слежение за объектом (follow): доля остатка за кадр
const CAMERA_PAN_KEY_SPEED = 900;       // WASD и стрелки: экранных px/с
const CAMERA_ORBIT = 1;                 // вращение камеры игроком (ПКМ): 0 — ориентация фиксирована, 1 — можно
const CAMERA_ORBIT_DEG_PER_PX = 0.3;    // градусов поворота на экранный px драга
const CAMERA_ORBIT_PITCH_MIN_DEG = 35;  // ниже к земле не опускается (предел поднимается и сам — край земли не в кадре)
const CAMERA_ORBIT_PITCH_MAX_DEG = 88;  // выше — почти строго сверху

// --- РЕНДЕР (World3D.js): свет, тени, небо, материалы, toon и контур. Читает
// World3D.cfg(), редактор применяет правки к живой сцене. ---
// Солнце одно на весь мир. Азимут — КУДА падает тень по карте (0 — вправо, 90 — вниз).
const WORLD3D_SUN_AZIMUTH_DEG = 200;
const WORLD3D_SUN_ELEVATION_DEG = 16;   // высота солнца над горизонтом
const WORLD3D_SUN_INTENSITY = 0.78;      // сила солнца (с небом в сумме ~1.0 на ровной земле — краска текстуры без изменений)
const WORLD3D_SUN_COLOR = 0xff9a5c;     // цвет солнца
const WORLD3D_SKYLIGHT_INTENSITY = 0.5; // рассеянный свет неба (полусферический источник)
const WORLD3D_SKYLIGHT_COLOR = 0x9a7cff; // цвет света неба (грани, смотрящие вверх)
const WORLD3D_GROUNDLIGHT_COLOR = 0x7a3d8c; // подсветка снизу (отражение от земли)
const WORLD3D_SKY_COLOR = 0xff7a4a;     // цвет неба у горизонта и тумана
const WORLD3D_FOG_DENSITY = 0.00009;    // экспоненциальный туман к горизонту (0 — выключить)
// Тени: один цвет на все (красит toon-плагин, Babylon даёт только видимость солнца)
const WORLD3D_SHADOW_COLOR = 0x2a0f4a;  // цвет тени
const WORLD3D_SHADOW_STRENGTH = 0.52;    // сила тени 0..1: поверхность в тени умножается на смесь белого и цвета тени
const WORLD3D_SHADOW_SOFT = 2;          // край: 0 — жёсткий (под toon), 1..3 — PCF низкое/среднее/высокое (мобильные — не выше 1)
const WORLD3D_SHADOW_MAP = 1024;        // размер карты теней (мобильные — вдвое меньше); действует с новой сцены
const WORLD3D_SHADOW_RADIUS = 840;      // px: ПРЕДЕЛ полуразмера ортокадра теней; сам кадр ужимается по объектам в кадре
const WORLD3D_SHADOW_BIAS = 0.001;     // смещение глубины против «акне» (полосы тени на освещённых гранях)
const WORLD3D_SHADOW_NORMAL_BIAS = 0.8; // смещение вдоль нормали против «акне» (полосы и «пила» на гранях под острым углом к солнцу), в текселях карты теней сверх радиуса сглаживания края (его прибавляет движок)
// Материалы по группам (блик — доля 0..1, размер — показатель степени: больше — блик мельче)
const WORLD3D_GROUND_SPECULAR = 0;      // блик земли (0 — матовая)
const WORLD3D_GROUND_SPEC_POWER = 1;    // размер блика земли
const WORLD3D_OUTER_TINT = 1;           // яркость земли ЗА краем локации (меньше 1 — граница локации видна)
const WORLD3D_PROP_SPECULAR = 0.05;     // блик окружения (группа 'prop')
const WORLD3D_PROP_SPEC_POWER = 7;     // размер блика окружения
const WORLD3D_ACTOR_SPECULAR = 0;       // блик главных объектов (группа 'actor'); под toon — яркость «зайчика»
const WORLD3D_ACTOR_SPEC_POWER = 23;    // размер блика главных объектов
// Toon-шейдер (LoryToonPlugin): свет всех источников (солнце + небо, с тенью) квантуется в ступени
const WORLD3D_TOON = 0;                 // 1 — toon-затенение и обводка силуэта, 0 — обычное плавное без обводки
const WORLD3D_TOON_BANDS = 4;           // ступеней света (2..6)
const WORLD3D_TOON_SOFT = 0.02;         // мягкость границы ступени (0 — резко, 0.5 — почти плавно)
const WORLD3D_TOON_LOW = 0.48;          // яркость самой тёмной ступени (доля от полной)
const WORLD3D_TOON_GROUND = 1;          // 1 — ступени и на земле, 0 — земля затеняется плавно
const WORLD3D_TOON_SPEC = 0.25;            // сила блика-«зайчика» (0 — без блика)
const WORLD3D_TOON_SPEC_SIZE = 0.075;    // порог блика (меньше — крупнее пятно)
const WORLD3D_TOON_RIM = 0.28;           // светлый ободок по краю силуэта объектов (0 — нет)
const WORLD3D_TOON_RIM_WIDTH = 0.24;    // ширина ободка
// Контур рёбер (EdgesRenderer): рёбра, изломанные круче порога
const WORLD3D_TOON_INK = 0;             // 0 — нет, 1 — главные объекты, 2 — и окружение
const WORLD3D_TOON_INK_WIDTH = 25;      // толщина линии (≈ мировых px × 100; тоньше с удалением камеры)
const WORLD3D_TOON_INK_COLOR = 0x171717; // цвет чернил: контур рёбер и обводка силуэта
const WORLD3D_TOON_INK_ANGLE = 40;      // °: ребро рисуется, если грани изломаны круче
const WORLD3D_TOON_INK_MAX_TRIS = 20000; // часть модели тяжелее (треугольников) — без контура рёбер; 0 — без предела
// Обводка внешнего силуэта: постэффект (HighlightLayer, isStroke), толщина — в экранных px
const WORLD3D_TOON_OUTLINE = 2;         // 0 — нет, 1 — главные объекты, 2 — и окружение (только при WORLD3D_TOON = 1)
const WORLD3D_TOON_OUTLINE_ACTOR_WIDTH = 1.5;   // экранных px: обводка главных объектов
const WORLD3D_TOON_OUTLINE_PROP_WIDTH = 1;  // экранных px: обводка окружения (его в кадре много — тоньше)

// --- ИГРА «Аура Шлепка»: ядро (js/Game*.js, DESIGN.md). Единицы — px мира (1 м = 100 px),
// секунды, градусы. Модули читают их через typeof с дефолтом (GameCfg в Game.js). ---
const GAME_RUN_SPEED = 520;            // px/с: бег игрока (боты — доля от неё)
const GAME_RUN_ACCEL = 3600;           // px/с²: разгон до скорости бега
const GAME_RUN_DECEL = 4600;           // px/с²: торможение, когда стик отпущен
const GAME_AIR_CONTROL = 0.35;         // доля разгона в воздухе (прыжок, сошёл с края)
const GAME_TURN_RATE = 13;             // 1/с: доворот корпуса к направлению бега
const GAME_GRAVITY = 1900;             // px/с²
const GAME_CHAR_RADIUS = 42;           // px: радиус тела (расталкивание, препятствия)
const GAME_PUSH_RATE = 14;             // 1/с: мягкость расталкивания персонажей
const GAME_KO_HEIGHT = -1400;          // px: ниже — упал в бездну (KO)
const GAME_KO_CREDIT = 6;              // с: KO засчитывается последнему шлёпнувшему
const GAME_SLAP_RANGE = 190;           // px: радиус автошлепка (× дальность перчатки)
const GAME_SLAP_LOCK = 1.6;            // ×радиус: цель в момент удара ещё засчитывается
const GAME_SLAP_AURA = 0;              // аура за попадание шлепком (главный источник — зоны и позы)
const GAME_SLAP_MAGNET = 90;           // px: «примагничивание» игрока к цели за замах
const GAME_SLAP_CONTACT = 0.5;         // доля фазы удара: момент контакта (рука перед корпусом)
const GAME_SLAP_HEIGHT = 160;          // px: шлепок достаёт, если высоты отличаются меньше
const GAME_BOT_MISS_RANGE = 1.15;      // ×радиус: бот попадает, если цель в момент удара ближе
const GAME_BOT_MISS_ANGLE_DEG = 75;    // °: бот попадает, если цель в момент удара в этом конусе от курса
const GAME_KNOCK_H = 1.7;              // горизонталь отбрасывания = Сила × это, px/с
const GAME_KNOCK_V = 380;              // вертикаль отбрасывания: база, px/с
const GAME_KNOCK_V_K = 0.4;            // вертикаль: + Сила × это
const GAME_STUN = 0.9;                 // с: минимум полёта/оглушения после шлепка
const GAME_FRICTION = 1500;            // px/с²: скольжение после приземления
const GAME_BOUNCE = 0.32;              // доля скорости удара о землю на отскок
const GAME_BOUNCE_MIN = 420;           // px/с: удар о землю медленнее — без отскока
const GAME_DOWN_TIME = 0.4;            // с: лежит после полёта, прежде чем встать
const GAME_GETUP_TIME = 0.45;          // с: подъём с земли
const GAME_CHAR_LIFT = 0.16;           // доля цвета части в подсветке (теневая сторона не чернеет)
const GAME_DASH_TIME = 0.25;           // с: длительность рывка
const GAME_DASH_SPEED = 1450;          // px/с: скорость рывка
const GAME_DASH_COOLDOWN = 3;          // с: перезарядка рывка
const GAME_RESPAWN_DELAY = 1.6;        // с: пауза перед появлением игрока после падения
const GAME_SPAWN_SHIELD = 1.5;         // с: защита от шлепков после появления
const GAME_CAM_DIST = 520;             // px: камера за спиной (до точки взгляда)
const GAME_CAM_PITCH_DEG = 18;         // наклон камеры
const GAME_CAM_FOV_DEG = 70;           // вертикальный угол обзора
const GAME_CAM_LOOK_H = 230;           // px: точка взгляда над ногами игрока
const GAME_CAM_FOLLOW = 9;             // 1/с: плавность слежения
const GAME_CAM_AUTO_DELAY = 2;         // с без поворота игроком — камера сама доворачивает за спину
const GAME_CAM_AUTO_RATE = 1.3;        // 1/с: скорость доворота за спину
const GAME_CAM_DRAG_DEG = 0.3;         // градусов поворота на экранный px перетаскивания
const GAME_CAM_FAR = 40000;            // px: дальняя плоскость камеры
const GAME_CAM_FLY_FOLLOW = 2.5;       // × слежение, пока игрок летит/лежит после шлепка
const GAME_CAM_FLY_DIST = 1.25;        // × дистанция камеры, пока игрок летит/лежит
const GAME_CAM_COLLIDE = 20;           // px: отступ камеры перед препятствием (пальма, моаи, колонна)
const GAME_JOY_RADIUS = 64;            // px экрана: ход стика джойстика
const GAME_JOY_ZONE = 0.5;             // доля ширины экрана: зона плавающего стика (тач и мышь)
const GAME_JOY_TOP = 0;                // доля высоты экрана сверху без плавающего стика (кнопки HUD нажимаются и так)
const GAME_JOY_DEAD = 0.12;            // мёртвая зона стика (доля хода)
const GAME_FLASH_IN = 0.28;            // с: вспышка телепорта — нарастание
const GAME_FLASH_OUT = 0.12;           // с: вспышка телепорта — пауза перед угасанием
const GAME_ADS_BREAK_GAP = 20;        // с: реклама в паузе (Playables: лобби, окна, кнопки интерфейса) — не раньше, чем через столько после прошлой
const GAME_SAVE_DELAY = 1.5;           // с: сохранение через столько после изменения
const GAME_SAVE_MAX_DELAY = 5;         // с: изменения подряд — сохранение не позже этого
const GAME_BADGE_DIST = 2600;          // px: дальше бейджи над головами скрыты
const GAME_BADGE_SCALE = 1.15;         // масштаб бейджа вблизи
const GAME_BADGE_MAX = 8;              // бейджей на экране (ближайшие; бейдж игрока — всегда)
const GAME_GLOW = 0.75;                // сила свечения порталов и колец
const GAME_SKY_TOP = 0x180a40;         // небо: зенит (горизонт — WORLD3D_SKY_COLOR)
const GAME_SKY_BOTTOM = 0x3a1058;      // небо: низ купола (бездна под островами)
