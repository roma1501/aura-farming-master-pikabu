// GameWorld.js — мир «Ауры Шлепка» (DESIGN.md §2, §9): пол и зоны из маркеров карты
// (floor / floorbox), препятствия — круговые коллайдеры по имени модели (COLLIDERS),
// небо (шейдер: градиент зенит -> горизонт, дымка у горизонта, мягкий ореол солнца),
// туман, облака (модели карты плавно дрейфуют + «море облаков» — слои ниже островов,
// бесконечные за камерой), свечение (GlowLayer), роли узлов моделей: PortalInner (цвет
// режима + свечение), PortalLabel (надпись DynamicTexture, читается с обеих сторон),
// Ring пьедестала (жёлтое свечение). Узлы Sign (пьедесталы) и Screen (доска рекордов) не
// трогаются — их заполняют модули перчаток и UI через findParts(modelName, partName).
//
// Пол — ДАННЫЕ карты, не меши: floorAt / onFloor / edgeDist считают по фигурам маркеров
// (инвариант 4 — логика не спрашивает высоты у Babylon). Острова — модели карты
// (их ставит Maps.js); нет модели острова над фигурой — строится запасной остров из
// примитивов, сцена не ломается.
//
// Фигуры пола: { kind: 'circle' | 'box', name, x, y, r, hx, hy, round, h, comp, zone }.
// Зона фигуры — по маркеру спавна внутри её связной группы: spawn -> lobby,
// arena-spawn -> arena, royale-spawn -> royale, duel-a -> duel.
//
// Свечение и заслонки: карта GlowLayer рисует ВСЕ меши сцены — светящиеся своим цветом
// (addGlow), остальные непрозрачным чёрным. Так любой объект (персонаж, стена, остров, доска)
// закрывает ореол за собой: свечение не «просвечивает» сквозь предметы. Include-only режим
// GlowLayer (addIncludedOnlyMesh) не использовать — в нём заслонок нет.
//
// Качество (setQuality 'high' | 'low'): low — плотность пикселей ≤ 1, без свечения, тени
// с жёстким краем и только от персонажей, один слой моря облаков; GameFX.setQuality
// вызывается отсюда же (и наоборот — без рекурсии).

// --- Числа модуля (полировка мира) ---
const GW_SKY_MID = 0xb8387c;          // небо: середина между горизонтом и зенитом
const GW_SKY_HAZE = 0xffb070;         // дымка у горизонта (светлее тумана)
const GW_SKY_HAZE_K = 12;             // резкость полосы дымки (больше — уже)
const GW_SKY_HAZE_AMOUNT = 0.62;      // сила дымки у самого горизонта
const GW_SUN_GLOW = 0xffa050;         // ореол солнца на небе
const GW_SUN_GLOW_K = 0.3;           // сила широкого ореола солнца
const GW_CLOUD_SEA = [                // слои моря облаков: высота, размер повтора текстуры, ветер (доля/с), непрозрачность, оттенок
    { h: -4400, tile: 5200, wind: 0.0016, alpha: 0.95, tint: 0xff9ac0, seed: 11 },
    { h: -7000, tile: 9000, wind: 0.0009, alpha: 0.8, tint: 0x8a5cc8, seed: 29 },
];
const GW_CLOUD_SEA_R = 26000;         // px: радиус слоя моря облаков (дальше — туман)
const GW_CLOUD_DRIFT = 170;           // px: размах дрейфа облаков-моделей
const GW_STONE_AMBIENT = 0.6;         // подсветка теневой стороны камня (моаи, арки, камни)
const GW_OCCLUDE_EVERY = 0.2;         // с: пересчёт персонажей-заслонок карты свечения
const GW_OCCLUDE_NEAR = 900;          // px: персонаж ближе к светящемуся объекту — заслонка
const GW_LOD_DETAIL = 2600;           // px от камеры: дальше лицо и аксессуары персонажа не рисуются (≈10 px головы)
const GW_LOD_CHAR = 7000;             // px от камеры: дальше персонаж не рисуется совсем (точка в дымке)

/** @typedef {{ kind: string, name: string, x: number, y: number, r: number, hx: number, hy: number, round: number, h: number, comp: number, zone: string }} FloorShape */
/** @typedef {{ x: number, y: number, r: number, top: number, model: string, def: LocationObjectDef | null }} Collider */
/** @typedef {{ mode: string, name: string, x: number, y: number, r: number, color: number }} Portal */

/** @satisfies {Record<string, any>} */
const GameWorld = {
    /** @type {LoryApp | null} */
    app: null,
    /** @type {View3D | null} */
    view: null,
    /** @type {BABYLON.Scene | null} */
    scene: null,
    /** @type {FloorShape[]} */
    floors: [],
    /** @type {Collider[]} */
    colliders: [],
    /** @type {Portal[]} */
    portals: [],
    /** @type {Record<string, { name: string, x: number, y: number, r: number }>} */
    zones: {},
    /** @type {BABYLON.GlowLayer | null} */
    glow: null,
    /** @type {BABYLON.Mesh | null} */
    sky: null,
    /** @type {BABYLON.Mesh | null} */
    clouds: null,
    quality: 'high',
    _res: { x: 0, y: 0, nx: 0, ny: 0, hit: false },
    /** @type {Array<{ mesh: BABYLON.Mesh, tex: BABYLON.DynamicTexture, tile: number, wind: number }>} */
    _seas: [],
    /** @type {Array<{ mesh: BABYLON.AbstractMesh, x: number, z: number, ph: number }>} */
    _cloudRecs: [],
    /** @type {Array<{ x: number, y: number }>} */
    _glowSpots: [],
    /** @type {Set<BABYLON.AbstractMesh>} */
    _occluders: new Set(),
    _occludeAt: 0,
    /** @type {Set<BABYLON.AbstractMesh>} */
    _propMeshes: new Set(),

    // Скругление углов прямоугольника пола (floorbox), px — часть контракта DESIGN §2.
    FLOOR_ROUND: 300,

    // Коллайдеры препятствий: часть имени файла модели (без папки и расширения, без
    // учёта регистра) -> круги в координатах МОДЕЛИ (px при scale 1): dx — вдоль носа
    // модели (+X), dz — вбок (+Z Babylon), r — радиус, top — высота препятствия (выше —
    // летящий персонаж проходит). Масштаб и курс объекта карты учитываются: правка
    // объекта в редакторе двигает и коллайдер. Первое совпадение по порядку ключей.
    COLLIDERS: {
        neon_sign: [{ dx: 0, dz: -110, r: 26, top: 420 }, { dx: 0, dz: 110, r: 26, top: 420 }],
        graffiti_wall: [{ dx: 0, dz: -120, r: 45, top: 260 }, { dx: 0, dz: 0, r: 45, top: 260 }, { dx: 0, dz: 120, r: 45, top: 260 }],
        antenna: [{ dx: 0, dz: 0, r: 34, top: 900 }],
        water_tank: [{ dx: 0, dz: 0, r: 135, top: 560 }],
        ac_unit: [{ dx: 0, dz: 0, r: 95, top: 140 }],
        vent: [{ dx: 0, dz: 0, r: 60, top: 130 }],
        planter: [{ dx: 0, dz: 0, r: 95, top: 90 }],
        palm: [{ dx: 0, dz: 0, r: 32, top: 640 }],
        moai: [{ dx: 10, dz: 0, r: 108, top: 520 }],
        portal: [{ dx: 0, dz: -140, r: 52, top: 390 }, { dx: 0, dz: 140, r: 52, top: 390 }],
        pedestal: [{ dx: 0, dz: 0, r: 66, top: 60 }],
        leaderboard: [{ dx: -8, dz: -190, r: 34, top: 630 }, { dx: -8, dz: -95, r: 34, top: 630 }, { dx: -8, dz: 0, r: 34, top: 630 },
            { dx: -8, dz: 95, r: 34, top: 630 }, { dx: -8, dz: 190, r: 34, top: 630 }],
        rock_1: [{ dx: 0, dz: -10, r: 100, top: 100 }],
        rock_2: [{ dx: 0, dz: 0, r: 170, top: 200 }],
        rock_3: [{ dx: 20, dz: 0, r: 100, top: 75 }],
        rock: [{ dx: 0, dz: 0, r: 100, top: 100 }],
    },

    // Режимы порталов: маркер portal-<режим>. Цвет плоскости, подпись (ключ Lang) и цвет
    // обводки белых букв надписи (тёмный оттенок цвета режима).
    PORTALS: {
        arena: { color: 0x6dff5a, label: 'portalArena', ink: '#1f6b12' },
        royale: { color: 0xffde4a, label: 'portalRoyale', ink: '#5a2e00' },
        hardcore: { color: 0xff3d3d, label: 'portalHardcore', ink: '#6e0000' },
        duel: { color: 0x5fe0ff, label: 'portalDuel', ink: '#0b5a75' },
    },

    // Маркеры спавна -> зона (связная группа фигур пола, где лежит маркер).
    ZONE_MARKERS: { lobby: 'spawn', arena: 'arena-spawn', royale: 'royale-spawn', duel: 'duel-a' },

    // Статичные модели карты (мировые матрицы замораживаются — меньше работы ЦП за кадр).
    STATIC_MODELS: ['island', 'islet', 'rock', 'palm', 'bush', 'moai', 'antenna', 'water_tank', 'ac_unit', 'vent', 'planter', 'neon_sign', 'graffiti_wall', 'skyline'],
    // Декор, который сливается в один меш на «модель + часть» (_mergeStatic). Острова зон не
    // сливаются: королевская битва сжимает их модели.
    MERGE_MODELS: ['islet', 'rock', 'palm', 'bush', 'moai', 'vent', 'planter'],   // модели с неоном не сливаются: у слитого меша пропадает подсветка
    /** @type {BABYLON.Mesh[]} */
    _merged: [],

    async init(game) {
        const app = this.app = game.app;
        const loc = app.location;
        this.view = loc.view;
        this.scene = loc.view.scene;
        // Террейн движка не нужен: землю дают модели островов (DESIGN §2).
        if (loc.terrain) {
            if (loc.terrain.mesh) loc.terrain.mesh.setEnabled(false);
            if (loc.terrain.outer) loc.terrain.outer.setEnabled(false);
        }
        const cam = this.view.camera;
        cam.maxZ = GameCfg.camFar;
        cam.minZ = 8;
        // Тени — только кастеры вблизи (кадр ставит GameCamera); туман — к горизонту.
        this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        this._readFloors();
        this._readColliders();
        this._readPortals();
        try {
            const fonts = /** @type {any} */ (document).fonts;
            if (fonts && fonts.load) await Promise.race([fonts.load('900 64px GameFont'), new Promise(r => setTimeout(r, 2500))]);
        } catch (e) { /* шрифт не обязателен для мира */ }
        this._setupShadows();
        this._buildSky();
        this._buildCloudSea();
        // Облака-модели уже стоят на карте — свои «капли» не нужны.
        if (!this.objectsOf('cloud').length) this._buildClouds();
        this._decorate();
        this._fallbackIslands();
        this._mergeStatic();
        this._freezeStatic();
    },

    update(dt, realDt) {
        const rdt = realDt == null ? dt : realDt;
        if (this.clouds) this.clouds.position.x = (this.clouds.position.x + rdt * 9) % 4000;
        this._animateSky(rdt);
        this._glowCheck();
        this._updateOccluders();
        this._lodChars();
    },

    // Дальние персонажи дешевле: меши получают «пустой» уровень LOD Babylon — лицо и аксессуары
    // дальше GW_LOD_DETAIL, всё остальное дальше GW_LOD_CHAR не рисуются (видимость и
    // скрытие персонажа — его собственные, LOD их не трогает). Новые меши (смена перчатки,
    // аксессуары грузятся позже) — раз в полсекунды.
    _lodChars() {
        if (Game.realTime < this._lodAt) return;
        this._lodAt = Game.realTime + 0.5;
        for (const c of Game.chars) {
            if (c.disposed) continue;
            const g = c._gloveRoot;
            const lists = [c.meshes, c.accMeshes, g ? g.getChildMeshes(false) : []];
            for (let i = 0; i < lists.length; i++) {
                for (const m of lists[i]) {
                    const mesh = /** @type {BABYLON.Mesh} */ (m);
                    if (this._lodSeen.has(mesh) || typeof mesh.addLODLevel !== 'function' || mesh.isDisposed()) continue;
                    this._lodSeen.add(mesh);
                    const detail = i === 1 || (mesh.metadata && mesh.metadata.part === 'Face');
                    mesh.addLODLevel(detail ? GW_LOD_DETAIL : GW_LOD_CHAR, null);
                }
            }
        }
    },
    _lodAt: 0,
    /** @type {WeakSet<BABYLON.AbstractMesh>} */
    _lodSeen: new WeakSet(),

    // --- Маркеры -----------------------------------------------------------------

    markers(name) { return this.app && this.app.location ? this.app.location.markers(name) : []; },
    marker(name) { return this.app && this.app.location ? this.app.location.marker(name) : null; },

    // Точка появления: маркеры name (name, name-2 …); i — номер, иначе случайный.
    // { x, y, h, heading } — курс в радианах (rot[1] маркера), null — маркера нет.
    spawnPoint(name, i) {
        const list = this.markers(name);
        if (!list.length) return null;
        const m = list[i == null ? Math.floor(Math.random() * list.length) : ((i % list.length) + list.length) % list.length];
        const rot = Array.isArray(m.rot) ? m.rot : [0, Number(m.rot) || 0, 0];
        return { x: Number(m.x) || 0, y: Number(m.y) || 0, h: Number(m.h) || 0, heading: (Number(rot[1]) || 0) * Math.PI / 180 };
    },

    // --- Пол -------------------------------------------------------------------------

    _readFloors() {
        /** @type {FloorShape[]} */
        const out = [];
        for (const m of this.markers('floor')) {
            const s = Array.isArray(m.scale) ? m.scale : [m.scale, 1, m.scale];
            out.push({ kind: 'circle', name: m.name, x: +m.x || 0, y: +m.y || 0, r: Math.max(10, +s[0] || 100), hx: 0, hy: 0, round: 0, h: +m.h || 0, comp: -1, zone: '' });
        }
        for (const m of this.markers('floorbox')) {
            const s = Array.isArray(m.scale) ? m.scale : [m.scale, 1, m.scale];
            const hx = Math.max(10, +s[0] || 100), hy = Math.max(10, +s[2] || hx);
            out.push({ kind: 'box', name: m.name, x: +m.x || 0, y: +m.y || 0, r: Math.hypot(hx, hy), hx, hy,
                round: Math.min(this.FLOOR_ROUND, hx, hy), h: +m.h || 0, comp: -1, zone: '' });
        }
        // Связные группы (пересекающиеся фигуры) -> зоны по маркерам спавна.
        const parent = out.map((_, i) => i);
        const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                if (this._overlap(out[i], out[j])) parent[find(i)] = find(j);
            }
        }
        const comps = [];
        out.forEach((f, i) => { const c = find(i); if (comps.indexOf(c) < 0) comps.push(c); f.comp = comps.indexOf(c); });
        this.floors = out;
        this.zones = {};
        for (let c = 0; c < comps.length; c++) {
            const shapes = out.filter(f => f.comp === c);
            let zone = '';
            for (const z in this.ZONE_MARKERS) {
                const mk = this.marker(this.ZONE_MARKERS[z]);
                if (mk && shapes.some(f => this._sd(f, +mk.x, +mk.y) > -60)) { zone = z; break; }
            }
            if (!zone) zone = 'island' + c;
            let ax = 0, ay = 0, aw = 0;
            for (const f of shapes) { const w = f.r * f.r; ax += f.x * w; ay += f.y * w; aw += w; }
            const cx = ax / aw, cy = ay / aw;
            let r = 0;
            for (const f of shapes) r = Math.max(r, Math.hypot(f.x - cx, f.y - cy) + f.r);
            for (const f of shapes) f.zone = zone;
            this.zones[zone] = { name: zone, x: cx, y: cy, r };
        }
    },

    _overlap(a, b) {
        if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
        if (a.kind === 'circle') return this._sd(b, a.x, a.y) > -a.r;
        if (b.kind === 'circle') return this._sd(a, b.x, b.y) > -b.r;
        return Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.y - b.y) < a.hy + b.hy;
    },

    // Знаковое расстояние до края фигуры: > 0 — внутри.
    _sd(f, x, y) {
        if (f.kind === 'circle') return f.r - Math.hypot(x - f.x, y - f.y);
        const qx = Math.abs(x - f.x) - (f.hx - f.round), qy = Math.abs(y - f.y) - (f.hy - f.round);
        const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)), inside = Math.min(Math.max(qx, qy), 0);
        return f.round - (out + inside);
    },

    // Высота верха пола в точке или null (бездна). margin > 0 — точка дальше от края.
    floorAt(x, y, margin) {
        const m = margin || 0;
        let best = null;
        for (const f of this.floors) {
            if (this._sd(f, x, y) >= m && (best === null || f.h > best)) best = f.h;
        }
        return best;
    },

    onFloor(x, y, margin) { return this.floorAt(x, y, margin) !== null; },

    // До края объединения фигур, px: > 0 — внутри (насколько далеко от края), < 0 — снаружи.
    // zone — только фигуры этой зоны.
    edgeDist(x, y, zone) {
        let best = -Infinity;
        for (const f of this.floors) {
            if (zone && f.zone !== zone) continue;
            const d = this._sd(f, x, y);
            if (d > best) best = d;
        }
        return best;
    },

    // Зона под точкой (или ближайшая в пределах near px) — 'lobby' | 'arena' | 'royale' | 'duel' | null.
    zoneAt(x, y, near) {
        let best = null, bd = -(near || 0);
        for (const f of this.floors) {
            const d = this._sd(f, x, y);
            if (d >= bd) { bd = d; best = f.zone; }
        }
        return best;
    },

    zoneCenter(zone) { const z = this.zones[zone]; return z ? { x: z.x, y: z.y } : null; },

    // --- Препятствия -----------------------------------------------------------------

    _base(def) { return String((def && def.model) || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase(); },

    _readColliders() {
        this.colliders = [];
        const loc = this.app.location;
        for (const rec of loc.objects) {
            const def = rec.def;
            if (!def || def.kind === 'marker' || !def.model) continue;
            const base = this._base(def);
            let list = null;
            for (const key in this.COLLIDERS) if (base.indexOf(key) >= 0) { list = this.COLLIDERS[key]; break; }
            if (!list) continue;
            const s = Array.isArray(def.scale) ? def.scale : [def.scale, def.scale, def.scale];
            const sx = +s[0] || 1, sy = +s[1] || 1, sz = +s[2] || 1;
            const rot = Array.isArray(def.rot) ? def.rot : [0, def.rot, 0];
            const hd = (+rot[1] || 0) * Math.PI / 180, c = Math.cos(hd), sn = Math.sin(hd);
            for (const k of list) {
                const lx = k.dx * sx, lz = k.dz * sz;
                this.colliders.push({ x: (+def.x || 0) + lx * c - lz * sn, y: (+def.y || 0) + lx * sn + lz * c,
                    r: k.r * Math.max(sx, sz), top: (+def.h || 0) + k.top * sy, model: base, def });
            }
        }
    },

    // Свой коллайдер (способности, временные объекты). Возвращает запись — removeCollider(rec).
    addCollider(x, y, r, top) {
        const c = { x, y, r, top: top == null ? 400 : top, model: '', def: null };
        this.colliders.push(c);
        return c;
    },

    removeCollider(c) { const i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1); },

    // Вытолкнуть круг (x, y, r) на высоте h из препятствий. Результат — ОБЩИЙ объект
    // { x, y, nx, ny, hit } (нормаль последнего столкновения): скопировать, если нужен дольше.
    resolveCollision(x, y, r, h) {
        const res = this._res;
        res.x = x; res.y = y; res.nx = 0; res.ny = 0; res.hit = false;
        const hh = h == null ? 0 : h;
        for (const c of this.colliders) {
            if (hh > c.top || hh < -300) continue;
            const dx = res.x - c.x, dy = res.y - c.y, rr = c.r + r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 0.001;
            const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
            res.x = c.x + nx * rr; res.y = c.y + ny * rr;
            res.nx = nx; res.ny = ny; res.hit = true;
        }
        return res;
    },

    // --- Части моделей карты ----------------------------------------------------------

    // Объекты карты, у которых имя файла модели содержит modelName (без учёта регистра).
    objectsOf(modelName) {
        const want = String(modelName || '').toLowerCase().replace(/\.[a-z0-9]+$/i, '');
        if (!this.app || !this.app.location) return [];
        return this.app.location.objects.filter(rec => rec.def && rec.def.model && this._base(rec.def).indexOf(want) >= 0);
    },

    // Части моделей по имени узла Blender: [{ mesh, def, rec }] — mesh части (metadata.part
    // === partName), def — объект карты (x, y, rot…), rec — запись Location3D.objects.
    // Пример: GameWorld.findParts('pedestal', 'Sign'), GameWorld.findParts('leaderboard', 'Screen').
    findParts(modelName, partName) {
        const out = [];
        for (const rec of this.objectsOf(modelName)) {
            if (!rec.mesh) continue;
            for (const m of rec.mesh.getChildMeshes(false)) {
                if (m.metadata && m.metadata.part === partName) out.push({ mesh: /** @type {BABYLON.Mesh} */ (m), def: rec.def, rec });
            }
        }
        return out;
    },

    // --- Порталы ---------------------------------------------------------------------

    _readPortals() {
        this.portals = [];
        for (const m of this.markers('portal')) {
            const mode = String(m.name).replace(/^portal-/, '').replace(/-\d+$/, '');
            const p = this.PORTALS[mode];
            if (!p) continue;
            const s = Array.isArray(m.scale) ? m.scale : [m.scale, 1, m.scale];
            this.portals.push({ mode, name: m.name, x: +m.x || 0, y: +m.y || 0, r: Math.max(30, +s[0] || 130), color: p.color });
        }
    },

    // Портал, в зоне входа которого точка (x, y), или null.
    portalAt(x, y) {
        for (const p of this.portals) if (Math.hypot(x - p.x, y - p.y) < p.r) return p;
        return null;
    },

    portalNear(x, y) {
        let best = null, bd = Infinity;
        for (const p of this.portals) { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = p; } }
        return best;
    },

    // Плоскости порталов в мире (для эффектов): [{ mode, color, center: Vector3, u: Vector3 —
    // горизонталь в плоскости, n: Vector3 — нормаль, w: полуширина, h: полувысота }].
    portalPlanes() {
        const out = [];
        for (const { mesh, def } of this.findParts('portal', 'PortalInner')) {
            const p = this._portalOf(def);
            mesh.computeWorldMatrix(true);
            const bb = mesh.getBoundingInfo().boundingBox, ext = bb.extendSize;
            const wm = mesh.getWorldMatrix();
            // Плоскость тонкая по одной из локальных осей X/Z: другая — горизонталь в плоскости.
            const alongX = ext.x >= ext.z;
            const u = BABYLON.Vector3.TransformNormal(alongX ? new BABYLON.Vector3(1, 0, 0) : new BABYLON.Vector3(0, 0, 1), wm);
            const n = BABYLON.Vector3.TransformNormal(alongX ? new BABYLON.Vector3(0, 0, 1) : new BABYLON.Vector3(1, 0, 0), wm);
            const w = (alongX ? ext.x : ext.z) * u.length(), h = ext.y * BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0, 1, 0), wm).length();
            out.push({ mode: p ? p.mode : '', color: p ? p.color : 0xffffff, center: bb.centerWorld.clone(), u: u.normalize(), n: n.normalize(), w, h });
        }
        return out;
    },

    // --- Свечение ----------------------------------------------------------------------

    // Меш -> в слой свечения (создаётся по первому запросу). color — свой цвет свечения
    // (BABYLON.Color3 или 0xRRGGBB), иначе — emissiveColor материала.
    // Неоновые и «горящие» части моделей (Neon*, Lit*): самосвечение без освещения и теней; Neon* — ещё и ореол
    // цветом из суффикса материала «…/Neon_rrggbb» × 0.6 (нет суффикса — серый 0.5).
    _selfLit(mesh, glow) {
        const mat = mesh.material;
        if (!mat) return;
        const list = /** @type {any} */ (mat).subMaterials ? /** @type {any} */ (mat).subMaterials.filter(Boolean) : [mat];
        let color = null;
        for (const m of list) {
            if (!(m instanceof BABYLON.StandardMaterial)) continue;
            m.disableLighting = true;
            m.specularColor = new BABYLON.Color3(0, 0, 0);
            m.metadata = Object.assign(m.metadata || {}, { toon: false });
            if (m.diffuseTexture) { m.emissiveTexture = m.diffuseTexture; m.diffuseTexture = null; m.emissiveColor = new BABYLON.Color3(0, 0, 0); }
            else m.emissiveColor = new BABYLON.Color3(1, 1, 1);
            const hex = /Neon_([0-9a-f]{6})$/i.exec(String(m.name));
            if (hex && !color) color = World3D.hexColor3(parseInt(hex[1], 16)).scale(0.6);
        }
        mesh.receiveShadows = false;
        if (this.view) this.view.removeShadowCaster(mesh);
        if (glow) this.addGlow(mesh, color || new BABYLON.Color3(0.5, 0.5, 0.5));
    },

    addGlow(mesh, color) {
        if (!mesh || !this.scene) return;
        if (!this.glow) {
            this.glow = new BABYLON.GlowLayer('gameGlow', this.scene, {
                mainTextureRatio: IS_MOBILE ? 0.25 : 0.5, blurKernelSize: IS_MOBILE ? 24 : 32 });
            this.glow.intensity = GameCfg.glow;
            this.glow.isEnabled = this.quality !== 'low';
            // Светящийся меш — свой цвет (или emissive материала); любой другой — чёрная заслонка.
            this.glow.customEmissiveColorSelector = (m, sub, mat, out) => {
                if (!this._glowMeshes.has(m)) { out.set(0, 0, 0, 1); return; }
                const c = this._glowColors.get(m) || (mat && /** @type {any} */ (mat).emissiveColor);
                if (c) out.set(c.r, c.g, c.b, 1); else out.set(0, 0, 0, 1);
            };
        }
        if (color != null) this._glowColors.set(mesh, color instanceof BABYLON.Color3 ? color : World3D.hexColor3(color));
        this._glowMeshes.add(mesh);
        this._glowCheckAt = 0;
    },
    /** @type {Set<BABYLON.AbstractMesh>} */
    _glowMeshes: new Set(),
    _glowCheckAt: 0,

    // Слой свечения работает, только если светящийся меш рядом с камерой (на арене порталов
    // и колец нет — проходы свечения там не нужны). Раз в полсекунды.
    _glowCheck() {
        if (!this.glow || Game.realTime < this._glowCheckAt) return;
        this._glowCheckAt = Game.realTime + 0.5;
        let near = false;
        const cam = this.view.camera.position;
        for (const m of this._glowMeshes) {
            if (m.isDisposed()) { this._glowMeshes.delete(m); this._glowColors.delete(m); continue; }
            if (near || this.quality === 'low') continue;
            if (!m.isEnabled() || !this._glowColors.get(m) && !(m.material && /** @type {any} */ (m.material).emissiveColor)) continue;
            const w = m.getBoundingInfo().boundingSphere.centerWorld;
            if (Math.hypot(w.x - cam.x, w.z - cam.z) < 3800) { const gc = this._glowColors.get(m); if (!gc || gc.r + gc.g + gc.b > 0) near = true; }
        }
        if (this.glow.isEnabled !== near) this.glow.isEnabled = near;
    },
    /** @type {Map<BABYLON.AbstractMesh, BABYLON.Color3>} */
    _glowColors: new Map(),

    removeGlow(mesh) {
        this._glowColors.delete(mesh);
        this._glowMeshes.delete(mesh);
    },

    // Персонажи рядом со светящимися объектами карты -> чёрные заслонки в карте свечения
    // (ореол портала не ложится поверх персонажа, стоящего перед ним).
    _updateOccluders() {
        // Заслонки отдельно не нужны: карта свечения рисует все меши (чёрные — не светятся).
    },
    /** @type {BABYLON.Color3 | null} */
    _black: null,

    // 'high' | 'low': свечение, плотность пикселей рендера, тени, слои облаков. Зовёт
    // Game.applySettings (настройка «Графика»); синхронизирует GameFX.setQuality.
    setQuality(q) {
        this.quality = q === 'low' ? 'low' : 'high';
        const low = this.quality === 'low';
        this._glowCheckAt = 0;
        this._occludeAt = 0;
        if (this.glow) this.glow.isEnabled = !low;
        const eng = World3D.engine;
        if (eng) {
            const dpr = window.devicePixelRatio || 1;
            const cap = low ? 1 : (IS_MOBILE ? 1.5 : 2);
            eng.setHardwareScalingLevel(1 / Math.max(0.5, Math.min(dpr, cap)));
            World3D.resize();
        }
        // Тени: low — жёсткий край (одна выборка) и только от персонажей (_setupShadows).
        const view = this.view;
        if (view && view.shadow) {
            if (low) {
                const sg = view.shadow;
                sg.usePercentageCloserFiltering = false;
                sg.usePoissonSampling = false;
                view._normalBiasTexels = Math.max(0, World3D.cfg().shadowNormalBias);
                if (view._lightAt) view.updateLightFrustum(view._lightAt.x, view._lightAt.y, view._lightAt.h, view._lightAt.r);
            } else {
                view.applyLighting();
            }
            this._fogFromSky();
        }
        for (let i = 0; i < this._seas.length; i++) this._seas[i].mesh.setEnabled(!low || i === 0);
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (fx && typeof fx.setQuality === 'function' && fx.quality !== this.quality) fx.setQuality(this.quality);
    },

    // --- Тени -------------------------------------------------------------------------

    // Карта теней рисует только кастеры у кадра солнца (по умолчанию RTT рисовал бы все
    // кастеры мира — сотни мешей). Список кастеров не трогается: модули по-прежнему
    // добавляют объекты через World3D.addObject. На low — только персонажи (не модели карты).
    _setupShadows() {
        const sg = this.view && this.view.shadow;
        if (!sg) return;
        const sm = sg.getShadowMap();
        /** @type {BABYLON.AbstractMesh[]} */
        const out = [];
        sm.getCustomRenderList = (layer, list, len) => {
            out.length = 0;
            const c = this.shadowCenter, R = c.r + 180, low = this.quality === 'low';
            for (let i = 0; i < len; i++) {
                const m = list[i];
                if (!m) continue;
                if (low && this._propMeshes.has(m)) continue;
                if (m.hasThinInstances) { out.push(m); continue; }   // центр габарита россыпи врёт — рисовать всегда
                if (!m.isEnabled()) continue;
                const bs = m.getBoundingInfo().boundingSphere, w = bs.centerWorld;
                const lim = R + bs.radiusWorld;
                if (Math.abs(w.x - c.x) < lim && Math.abs(w.z - c.y) < lim) out.push(m);
            }
            return out;
        };
    },

    shadowCenter: { x: 0, y: 0, h: 0, r: 800 },

    // Кадр солнца: центр (x, y карты) и высота; радиус — предел вида (WORLD3D_SHADOW_RADIUS),
    // центр — по сетке текселей (кромка тени не «ползёт» при движении камеры).
    shadowAt(x, y, h) {
        const view = this.view;
        if (!view || !view.shadow) return;
        const R = view._shadowRadius || 800, size = view._mapSize || 1024;
        const q = 2 * R / size;
        const cx = Math.round(x / q) * q, cy = Math.round(y / q) * q;
        const c = this.shadowCenter;
        c.x = cx; c.y = cy; c.h = h || 0; c.r = R;
        view.updateLightFrustum(cx, cy, h || 0, R);
    },

    // --- Статика: заморозка мировых матриц ---------------------------------------------

    // Декор одной модели и части (пальмы, кусты, камни, моаи, островки) — один меш на группу:
    // ~65 draw calls -> ~12 (и в проходе теней). Оригиналы выключаются, записи карты остаются
    // (коллайдеры и логика — по def, не по мешам). Части с несколькими материалами — как есть.
    _mergeStatic() {
        /** @type {Map<string, BABYLON.Mesh[]>} */
        const groups = new Map();
        for (const rec of this.app.location.objects) {
            if (!rec.mesh || !rec.def || !rec.def.model) continue;
            const base = this._base(rec.def);
            if (!this.MERGE_MODELS.some(k => base.indexOf(k) >= 0)) continue;
            rec.mesh.computeWorldMatrix(true);
            for (const m of rec.mesh.getChildMeshes(false)) {
                const mesh = /** @type {BABYLON.Mesh} */ (m);
                if (!mesh.getTotalVertices || mesh.getTotalVertices() <= 0 || !mesh.isEnabled(false)) continue;
                if (!mesh.material || mesh.material instanceof BABYLON.MultiMaterial || (mesh.subMeshes && mesh.subMeshes.length > 1)) continue;
                const key = base + '/' + ((mesh.metadata && mesh.metadata.part) || '') + '/' + mesh.getVerticesDataKinds().slice().sort().join(',');
                let list = groups.get(key);
                if (!list) groups.set(key, list = []);
                list.push(mesh);
            }
        }
        for (const [key, list] of groups) {
            if (list.length < 2) continue;
            for (const m of list) m.computeWorldMatrix(true);
            /** @type {BABYLON.Mesh | null} */
            let merged = null;
            try { merged = BABYLON.Mesh.MergeMeshes(list, false, true); } catch (e) { merged = null; }
            if (!merged) continue;
            merged.name = 'gameMerged:' + key;
            merged.material = list[0].material;
            merged.metadata = { part: list[0].metadata && list[0].metadata.part, merged: true };
            merged.receiveShadows = true;
            merged.isPickable = false;
            this.view.addShadowCaster(merged, false);
            for (const m of list) m.setEnabled(false);
            this._merged.push(merged);
        }
    },

    _freezeStatic() {
        for (const m of this._merged) {
            this._propMeshes.add(m);
            m.freezeWorldMatrix();
            m.doNotSyncBoundingInfo = true;
        }
        for (const rec of this.app.location.objects) {
            if (!rec.mesh || !rec.def || !rec.def.model) continue;
            const parts = [rec.mesh].concat(rec.mesh.getChildMeshes(false));
            for (const m of parts) this._propMeshes.add(m);
            const base = this._base(rec.def);
            if (!this.STATIC_MODELS.some(k => base.indexOf(k) >= 0)) continue;
            for (const m of parts) {
                m.isPickable = false;
                m.freezeWorldMatrix();
                m.doNotSyncBoundingInfo = true;
            }
        }
    },

    // --- Небо, облака ---------------------------------------------------------------

    // Небо — сфера с шейдером: градиент горизонт -> середина -> зенит, вниз — к цвету бездны,
    // полоса светлой дымки у горизонта (туман сцены — того же цвета: дальние острова тают в
    // ней без шва), широкий тёплый ореол солнца, дизеринг против полос градиента.
    _buildSky() {
        const scene = this.scene;
        const R = Math.min(30000, GameCfg.camFar * 0.75);
        const sky = BABYLON.MeshBuilder.CreateSphere('gameSky', { diameter: 2 * R, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
        const S = BABYLON.Effect.ShadersStore;
        if (!S.gameSkyVertexShader) {
            S.gameSkyVertexShader = 'precision highp float;\n' +
                'attribute vec3 position;\nuniform mat4 worldViewProjection;\nvarying vec3 vDir;\n' +
                'void main(void) { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }\n';
            S.gameSkyFragmentShader = 'precision highp float;\n' +
                'varying vec3 vDir;\n' +
                'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 horColor; uniform vec3 botColor; uniform vec3 hazeColor;\n' +
                'uniform vec3 sunDir; uniform vec3 sunColor; uniform vec4 params;\n' +
                'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n' +
                'void main(void) {\n' +
                '  vec3 d = normalize(vDir);\n' +
                '  float y = d.y;\n' +
                '  vec3 col;\n' +
                '  if (y >= 0.0) {\n' +
                '    col = mix(horColor, midColor, smoothstep(0.0, 0.3, y));\n' +
                '    col = mix(col, topColor, smoothstep(0.18, 0.95, y));\n' +
                '  } else {\n' +
                '    col = mix(horColor, botColor, smoothstep(0.0, 0.5, -y));\n' +
                '  }\n' +
                '  float haze = exp(-abs(y) * params.x);\n' +
                '  col = mix(col, hazeColor, haze * params.y);\n' +
                '  float s = max(dot(d, sunDir), 0.0);\n' +
                '  col += sunColor * (pow(s, 6.0) * params.z + pow(s, 70.0) * params.w);\n' +
                '  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;\n' +
                '  gl_FragColor = vec4(col, 1.0);\n' +
                '}\n';
        }
        const mat = new BABYLON.ShaderMaterial('gameSkyMat', scene, { vertex: 'gameSky', fragment: 'gameSky' }, {
            attributes: ['position'],
            uniforms: ['worldViewProjection', 'topColor', 'midColor', 'horColor', 'botColor', 'hazeColor', 'sunDir', 'sunColor', 'params'],
        });
        const hor = World3D.hexColor3(typeof WORLD3D_SKY_COLOR !== 'undefined' ? WORLD3D_SKY_COLOR : 0xbfe8f3);
        mat.setColor3('topColor', World3D.hexColor3(GameCfg.skyTop));
        mat.setColor3('midColor', World3D.hexColor3(GW_SKY_MID));
        mat.setColor3('horColor', hor);
        mat.setColor3('botColor', World3D.hexColor3(GameCfg.skyBottom));
        mat.setColor3('hazeColor', World3D.hexColor3(GW_SKY_HAZE));
        const sun = World3D.sunDirection(World3D.cfg()).negate().normalize();
        mat.setVector3('sunDir', sun);
        mat.setColor3('sunColor', World3D.hexColor3(GW_SUN_GLOW));
        mat.setVector4('params', new BABYLON.Vector4(GW_SKY_HAZE_K, GW_SKY_HAZE_AMOUNT, GW_SUN_GLOW_K, GW_SUN_GLOW_K * 1.6));
        mat.backFaceCulling = false;
        mat.metadata = { toon: false };
        sky.material = mat;
        sky.infiniteDistance = true;
        sky.isPickable = false;
        sky.applyFog = false;
        sky.receiveShadows = false;
        sky.alwaysSelectAsActiveMesh = true;
        this.sky = sky;
        this._fogFromSky();
    },

    // Туман и фон — цвет неба у самого горизонта (горизонт + дымка): острова вдали тают без шва.
    _fogFromSky() {
        const hor = World3D.hexColor3(typeof WORLD3D_SKY_COLOR !== 'undefined' ? WORLD3D_SKY_COLOR : 0xbfe8f3);
        const fog = BABYLON.Color3.Lerp(hor, World3D.hexColor3(GW_SKY_HAZE), GW_SKY_HAZE_AMOUNT);
        this.scene.fogColor = fog;
        this.scene.clearColor = new BABYLON.Color4(fog.r, fog.g, fog.b, 1);
    },

    // Море облаков: широкие слои ниже островов с процедурной текстурой мягких облаков.
    // Слой ездит за камерой шагом повтора текстуры (узор привязан к миру, край — в тумане и
    // гаснет по альфе вершин), ветер — сдвиг текстуры.
    _buildCloudSea() {
        const scene = this.scene;
        const R = GW_CLOUD_SEA_R;
        GW_CLOUD_SEA.forEach((L, i) => {
            const mesh = BABYLON.MeshBuilder.CreateGround('gameCloudSea' + i, { width: 2 * R, height: 2 * R, subdivisions: 16 }, scene);
            const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const cols = new Float32Array(pos.length / 3 * 4);
            for (let v = 0, j = 0; v < pos.length; v += 3, j += 4) {
                const r = Math.hypot(pos[v], pos[v + 2]) / R;
                const t = Math.max(0, Math.min(1, (r - 0.5) / 0.48));
                cols[j] = cols[j + 1] = cols[j + 2] = 1;
                cols[j + 3] = 1 - t * t * (3 - 2 * t);
            }
            mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
            mesh.hasVertexAlpha = true;
            const tex = this._cloudTexture('gameCloudSeaTex' + i, L.seed);
            tex.uScale = tex.vScale = 2 * R / L.tile;
            const mat = new BABYLON.StandardMaterial('gameCloudSeaMat' + i, scene);
            mat.disableLighting = true;
            mat.diffuseTexture = tex;
            mat.useAlphaFromDiffuseTexture = true;
            mat.diffuseColor = World3D.hexColor3(L.tint);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            mat.alpha = L.alpha;
            mat.backFaceCulling = false;
            mat.disableDepthWrite = true;
            mat.metadata = { toon: false };
            mesh.material = mat;
            mesh.position.y = L.h;
            mesh.isPickable = false;
            mesh.receiveShadows = false;
            mesh.alwaysSelectAsActiveMesh = true;
            this._seas.push({ mesh, tex, tile: L.tile, wind: L.wind });
        });
    },

    // Текстура мягких облаков (бесшовная): скопления размытых белых пятен с лёгкой
    // голубоватой «тенью» снизу-справа. Детерминированный разброс (seed).
    _cloudTexture(name, seed) {
        const S = 512;
        const tex = new BABYLON.DynamicTexture(name, { width: S, height: S }, this.scene, true);
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        ctx.clearRect(0, 0, S, S);
        let s = seed || 7;
        const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        const blob = (x, y, r, rgb, a) => {
            for (const ox of [-S, 0, S]) {
                for (const oy of [-S, 0, S]) {
                    const cx = x + ox, cy = y + oy;
                    if (cx + r < 0 || cx - r > S || cy + r < 0 || cy - r > S) continue;
                    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
                    g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.55).toFixed(3) + ')');
                    g.addColorStop(1, 'rgba(' + rgb + ',0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
                }
            }
        };
        const clusters = [];
        for (let i = 0; i < 14; i++) clusters.push({ x: rnd() * S, y: rnd() * S, r: 40 + rnd() * 60, n: 5 + Math.floor(rnd() * 6) });
        // Тень (снизу-справа, голубоватая), затем белые пятна поверх.
        for (const pass of [0, 1]) {
            let s2 = seed * 31 + 5;
            const r2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
            for (const c of clusters) {
                for (let k = 0; k < c.n; k++) {
                    const a = r2() * Math.PI * 2, d = r2() * c.r * 0.8, rr = c.r * (0.45 + r2() * 0.55);
                    const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
                    if (pass === 0) blob(x + rr * 0.18, y + rr * 0.22, rr * 1.05, '170,196,222', 0.35);
                    else blob(x, y, rr, '255,255,255', 0.5 + r2() * 0.35);
                }
            }
        }
        // Редкие мелкие клочки между скоплениями.
        for (let i = 0; i < 40; i++) blob(rnd() * S, rnd() * S, 8 + rnd() * 18, '255,255,255', 0.25 + rnd() * 0.3);
        tex.update(true);
        tex.hasAlpha = true;
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = IS_MOBILE ? 2 : 8;
        return tex;
    },

    // Кадр неба: слои моря облаков — за камерой (шагом повтора), ветер; облака-модели дрейфуют.
    _animateSky(rdt) {
        const cam = this.view && this.view.camera ? this.view.camera.position : null;
        if (cam) {
            for (const L of this._seas) {
                if (!L.mesh.isEnabled()) continue;
                L.mesh.position.x = Math.round(cam.x / L.tile) * L.tile;
                L.mesh.position.z = Math.round(cam.z / L.tile) * L.tile;
                L.tex.uOffset = (L.tex.uOffset + rdt * L.wind) % 1;
                L.tex.vOffset = (L.tex.vOffset + rdt * L.wind * 0.35) % 1;
            }
        }
        const t = Game.realTime;
        for (const c of this._cloudRecs) {
            c.mesh.position.x = c.x + Math.sin(t * 0.045 + c.ph) * GW_CLOUD_DRIFT;
            c.mesh.position.z = c.z + Math.cos(t * 0.031 + c.ph * 1.3) * GW_CLOUD_DRIFT * 0.6;
        }
    },

    _buildClouds() {
        const scene = this.scene;
        const blob = BABYLON.MeshBuilder.CreateSphere('gameCloud', { diameter: 1, segments: 7 }, scene);
        const mat = new BABYLON.StandardMaterial('gameCloudMat', scene);
        mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        mat.emissiveColor = new BABYLON.Color3(0.62, 0.66, 0.7);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.metadata = { toon: false };
        blob.material = mat;
        blob.isPickable = false;
        blob.receiveShadows = false;
        // Детерминированный разброс: облака одинаковые на всех устройствах.
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const W = this.app.location.width, H = this.app.location.height;
        const mats = [];
        const count = IS_MOBILE ? 26 : 44;
        for (let i = 0; i < count; i++) {
            const cx = -2000 + rnd() * (W + 4000), cy = -2000 + rnd() * (H + 4000), ch = -1300 - rnd() * 1700;
            const n = 3 + Math.floor(rnd() * 3), size = 500 + rnd() * 700;
            for (let k = 0; k < n; k++) {
                const sx = size * (0.6 + rnd() * 0.6), sz = size * (0.5 + rnd() * 0.5), sy = size * (0.25 + rnd() * 0.15);
                const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(sx, sy, sz), BABYLON.Quaternion.Identity(),
                    new BABYLON.Vector3(cx + (k - n / 2) * size * 0.45, ch + rnd() * 60, cy + (rnd() - 0.5) * size * 0.6));
                mats.push(m);
            }
        }
        const buf = new Float32Array(mats.length * 16);
        mats.forEach((m, i) => m.copyToArray(buf, i * 16));
        blob.thinInstanceSetBuffer('matrix', buf, 16, true);
        blob.alwaysSelectAsActiveMesh = true;
        this.clouds = blob;
    },

    // --- Роли узлов моделей карты -------------------------------------------------------

    _decorate() {
        const view = this.view;
        let ci = 0;
        for (const rec of this.app.location.objects) {
            if (!rec.mesh || !rec.def || !rec.def.model) continue;
            const base = this._base(rec.def);
            // Острова и облака тени не отбрасывают: кадр теней — вокруг игрока, острова плоские сверху,
            // а жёсткая тень облака на траве выглядела бы пятном.
            if (base.indexOf('island') >= 0 || base.indexOf('cloud') >= 0) view.removeShadowCaster(rec.mesh);
            if (base.indexOf('cloud') >= 0) {
                this._cloudLook(rec.mesh);
                this._cloudRecs.push({ mesh: rec.mesh, x: rec.mesh.position.x, z: rec.mesh.position.z, ph: (ci++) * 2.39 });
            }
            const stone = base.indexOf('moai') >= 0 || base.indexOf('rock') >= 0;
            rec.mesh.computeWorldMatrix(true);
            for (const m of rec.mesh.getChildMeshes(false)) {
                m.computeWorldMatrix(true);
                const part = m.metadata && m.metadata.part;
                if (typeof part === 'string' && /^(Neon|Lit)/.test(part)) this._selfLit(m, /^Neon/.test(part));
                if (part === 'PortalInner') this._portalInner(/** @type {BABYLON.Mesh} */ (m), rec.def);
                else if (part === 'PortalLabel') this._portalLabel(/** @type {BABYLON.Mesh} */ (m), rec.def);
                else if (part === 'Ring') this._ring(/** @type {BABYLON.Mesh} */ (m));
                if (stone || part === 'Arch') this._stoneLift(m);
            }
        }
    },

    // Камень (моаи, арки порталов, валуны) в тени не уходит в черноту: своя подсветка ambient.
    _stoneLift(mesh) {
        const mat = mesh.material;
        const mats = mat ? (/** @type {any} */ (mat).subMaterials || [mat]) : [];
        for (const sm of mats) {
            if (sm && sm instanceof BABYLON.StandardMaterial) sm.ambientColor = new BABYLON.Color3(GW_STONE_AMBIENT, GW_STONE_AMBIENT, GW_STONE_AMBIENT);
        }
    },

    // Облака-модели: светлые, мягкая голубоватая теневая сторона, без блика.
    _cloudLook(root) {
        for (const m of [root].concat(root.getChildMeshes(false))) {
            const mat = m.material;
            const mats = mat ? (/** @type {any} */ (mat).subMaterials || [mat]) : [];
            for (const sm of mats) {
                if (!(sm instanceof BABYLON.StandardMaterial)) continue;
                sm.diffuseColor = new BABYLON.Color3(1, 1, 1);
                sm.emissiveColor = new BABYLON.Color3(0.5, 0.55, 0.62);
                sm.specularColor = new BABYLON.Color3(0, 0, 0);
            }
            m.receiveShadows = false;
            m.isPickable = false;
        }
    },

    _portalOf(def) {
        const p = this.portalNear(+def.x || 0, +def.y || 0);
        return p && Math.hypot(p.x - def.x, p.y - def.y) < 900 ? p : null;
    },

    _portalInner(mesh, def) {
        const p = this._portalOf(def);
        const color = World3D.hexColor3(p ? p.color : 0xffffff);
        const mat = new BABYLON.StandardMaterial(mesh.name + '/glow', this.scene);
        mat.disableLighting = true;
        // Пастельная светящаяся плоскость (как на референсе); свечение вокруг — насыщенный цвет режима.
        mat.emissiveColor = BABYLON.Color3.Lerp(color, new BABYLON.Color3(1, 1, 1), 0.28);
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.alpha = 0.92;
        mat.backFaceCulling = false;
        mat.metadata = { toon: false };
        mesh.material = mat;
        mesh.receiveShadows = false;
        // Прозрачные плоскость и надпись почти в одной плоскости: порядок задан явно
        // (сортировка по расстоянию до центров «мигала» бы), раньше прочей прозрачности.
        mesh.alphaIndex = 10;
        this.view.removeShadowCaster(mesh);
        // Свечение вокруг арки; слабее, чтобы ореол не заливал надпись на плоскости.
        this.addGlow(mesh, color.scale(0.4));
        const w = mesh.getBoundingInfo().boundingBox.centerWorld;
        this._glowSpots.push({ x: w.x, y: w.z });
    },

    _portalLabel(mesh, def) {
        const p = this._portalOf(def);
        if (!p) return;
        const info = this.PORTALS[p.mode];
        const ext = mesh.getBoundingInfo().boundingBox.extendSize;
        const w = Math.max(ext.x, ext.z) || 1, h = ext.y || 1;
        const W = 1024, H = Math.max(256, Math.min(2048, Math.round(W * h / w / 64) * 64));
        const tex = new BABYLON.DynamicTexture(mesh.name + '/text', { width: W, height: H }, this.scene, true);
        tex.hasAlpha = true;
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        ctx.clearRect(0, 0, W, H);
        // Белые буквы с тёмной обводкой цвета режима и тенью — читаются на светящейся
        // плоскости. Кегль — у каждой строки свой (короткие строки «БИТВА», «+50 ауры» крупнее
        // длинной «КОРОЛЕВСКАЯ»), по ширине плоскости; весь блок — по высоте.
        const lines = Lang.t(info.label).split('\n');
        const font = (px) => '900 ' + Math.round(px) + 'px GameFont, sans-serif';
        const base = Math.min(W / 3.6, H / (lines.length * 1.1 + 0.15));
        const sizes = lines.map(s => {
            ctx.font = font(base);
            const tw = ctx.measureText(s).width;
            return tw > W * 0.9 ? base * W * 0.9 / tw : base;
        });
        let total = sizes.reduce((a, b) => a + b * 1.1, 0);
        const fit = Math.min(1, H * 0.94 / total);
        for (let i = 0; i < sizes.length; i++) sizes[i] *= fit;
        total *= fit;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        let y = H / 2 - total / 2;
        lines.forEach((s, i) => {
            const size = sizes[i], cy = y + size * 0.55;
            y += size * 1.1;
            ctx.font = font(size);
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = size * 0.1;
            ctx.shadowOffsetY = size * 0.06;
            ctx.lineWidth = size * 0.2;
            ctx.strokeStyle = info.ink;
            ctx.strokeText(s, W / 2, cy);
            ctx.restore();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(s, W / 2, cy);
        });
        tex.update(true);
        const mat = new BABYLON.StandardMaterial(mesh.name + '/label', this.scene);
        mat.disableLighting = true;
        mat.emissiveTexture = tex;
        mat.emissiveColor = new BABYLON.Color3(0, 0, 0);   // с emissiveTexture — чёрный, иначе выбелит
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.opacityTexture = tex;
        // Сзади надпись читалась бы зеркально: своя грань — только спереди, а для взгляда
        // сзади — копия, развёрнутая на 180° вокруг вертикали через центр ПЛОСКОСТИ портала
        // (оказывается по другую сторону плоскости: плоскость пишет глубину и закрыла бы
        // копию, оставшуюся спереди).
        mat.backFaceCulling = true;
        mat.disableDepthWrite = true;   // прозрачный прямоугольник надписи не режет эффекты за собой
        mat.metadata = { toon: false };
        mesh.material = mat;
        mesh.receiveShadows = false;
        mesh.alphaIndex = 11;
        this.view.removeShadowCaster(mesh);
        // Чёрным в маску свечения: надпись закрывает свечение плоскости за собой.
        this.addGlow(mesh, new BABYLON.Color3(0, 0, 0));
        const back = mesh.clone(mesh.name + '/back', mesh.parent);
        if (back) {
            back.material = mat;
            back.metadata = Object.assign({}, mesh.metadata, { part: 'PortalLabelBack' });
            const lc = mesh.getBoundingInfo().boundingBox.center;
            const inner = mesh.parent ? mesh.parent.getChildMeshes(false).find(m => m.metadata && m.metadata.part === 'PortalInner') : null;
            const ic = inner ? inner.getBoundingInfo().boundingBox.center : lc;
            back.setPivotPoint(new BABYLON.Vector3(ic.x, lc.y, ic.z));
            back.rotation.y += Math.PI;
            back.alphaIndex = 11;
            back.receiveShadows = false;
            this.view.removeShadowCaster(back);
            this.addGlow(back, new BABYLON.Color3(0, 0, 0));
        }
    },

    _ring(mesh) {
        const mat = new BABYLON.StandardMaterial(mesh.name + '/ring', this.scene);
        mat.diffuseColor = new BABYLON.Color3(1, 0.88, 0.25);
        mat.emissiveColor = new BABYLON.Color3(1, 0.85, 0.2);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.metadata = { toon: false };
        mesh.material = mat;
        this.addGlow(mesh, new BABYLON.Color3(0.85, 0.7, 0.12));
        const w = mesh.getBoundingInfo().boundingBox.centerWorld;
        this._glowSpots.push({ x: w.x, y: w.z });
    },

    // --- Запасные острова (нет модели острова над группой фигур) -------------------------

    _fallbackIslands() {
        const islands = this.objectsOf('island').filter(rec => rec.mesh);
        const comps = [...new Set(this.floors.map(f => f.comp))];
        for (const c of comps) {
            const shapes = this.floors.filter(f => f.comp === c);
            const covered = islands.some(rec => shapes.some(f => this._sd(f, +rec.def.x || 0, +rec.def.y || 0) > -200));
            if (covered) continue;
            for (const f of shapes) this._buildIsland(f);
        }
    },

    _outline(f) {
        const pts = [];
        if (f.kind === 'circle') {
            const n = 56;
            for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r]); }
        } else {
            const r = f.round, ax = f.hx - r, ay = f.hy - r, seg = 8;
            const corners = [[ax, ay, 0], [-ax, ay, 0.5], [-ax, -ay, 1], [ax, -ay, 1.5]];
            for (const [cx, cy, a0] of corners) {
                for (let i = 0; i <= seg; i++) {
                    const a = (a0 + i / seg * 0.5) * Math.PI;
                    pts.push([f.x + cx + Math.cos(a) * r, f.y + cy + Math.sin(a) * r]);
                }
            }
        }
        return pts;
    },

    _buildIsland(f) {
        const scene = this.scene;
        const pts = this._outline(f), n = pts.length;
        const depth = Math.min(1200, 500 + f.r * 0.35);
        // Кольца боковины: [доля размера, высота, цвет]
        /** @type {Array<[number, number, number[]]>} */
        const rings = [[1, 0, [0.42, 0.76, 0.3]], [1, -40, [0.4, 0.7, 0.28]], [0.97, -90, [0.55, 0.43, 0.3]],
            [0.84, -depth * 0.45, [0.48, 0.42, 0.38]], [0.5, -depth * 0.85, [0.36, 0.33, 0.33]], [0.12, -depth * 1.15, [0.28, 0.26, 0.27]]];
        const pos = [], col = [], idx = [];
        for (const [k, dh, c] of rings) {
            for (const [px, py] of pts) {
                pos.push(f.x + (px - f.x) * k, f.h + dh, f.y + (py - f.y) * k);
                col.push(c[0], c[1], c[2], 1);
            }
        }
        for (let r = 0; r < rings.length - 1; r++) {
            for (let i = 0; i < n; i++) {
                const a = r * n + i, b = r * n + (i + 1) % n, c2 = (r + 1) * n + i, d = (r + 1) * n + (i + 1) % n;
                idx.push(a, c2, b, b, c2, d);
            }
        }
        const side = new BABYLON.Mesh('island-side:' + f.name, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = pos; vd.indices = idx; vd.colors = col;
        const normals = [];
        BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        vd.normals = normals;
        vd.applyToMesh(side);
        const sm = new BABYLON.StandardMaterial('island-side-mat:' + f.name, scene);
        sm.diffuseColor = new BABYLON.Color3(1, 1, 1);
        sm.specularColor = new BABYLON.Color3(0, 0, 0);
        sm.backFaceCulling = false;
        side.material = sm;
        // Верх: веер из центра, UV — мировые (плитка лобби).
        const tp = [f.x, f.h, f.y], tu = [f.x / 400, f.y / 400], ti = [];
        for (const [px, py] of pts) { tp.push(px, f.h, py); tu.push(px / 400, py / 400); }
        for (let i = 0; i < n; i++) ti.push(0, 1 + (i + 1) % n, 1 + i);
        const top = new BABYLON.Mesh('island-top:' + f.name, scene);
        const tv = new BABYLON.VertexData();
        tv.positions = tp; tv.indices = ti; tv.uvs = tu;
        tv.normals = tp.map((_, i) => (i % 3 === 1 ? 1 : 0));
        tv.applyToMesh(top);
        const tm = new BABYLON.StandardMaterial('island-top-mat:' + f.name, scene);
        tm.specularColor = new BABYLON.Color3(0, 0, 0);
        tm.backFaceCulling = false;
        tm.diffuseTexture = this._tileTexture(f.zone === 'lobby');
        top.material = tm;
        for (const m of [side, top]) World3D.addObject(this.view, m, 'prop', { castShadow: false });
    },

    _tiles: {},

    // Плитка верха запасного острова: лобби — «baseplate» (квадраты с тёмной сеткой), арены — трава.
    _tileTexture(grid) {
        const key = grid ? 'grid' : 'grass';
        if (this._tiles[key]) return this._tiles[key];
        const S = 256;
        const tex = new BABYLON.DynamicTexture('tile-' + key, { width: S, height: S }, this.scene, true);
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        if (grid) {
            ctx.fillStyle = '#7fcf62'; ctx.fillRect(0, 0, S, S);
            ctx.strokeStyle = 'rgba(40,90,30,0.35)'; ctx.lineWidth = 4;
            for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * S / 4, 0); ctx.lineTo(i * S / 4, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * S / 4); ctx.lineTo(S, i * S / 4); ctx.stroke(); }
        } else {
            ctx.fillStyle = '#5fc23f'; ctx.fillRect(0, 0, S, S);
            const shades = ['#58b83a', '#67cb46', '#52ad35', '#6bd04a'];
            let s = 3;
            const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
            for (let i = 0; i < 40; i++) {
                ctx.fillStyle = shades[i % shades.length];
                const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 40;
                ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.6); ctx.lineTo(x - r, y + r * 0.7); ctx.closePath(); ctx.fill();
            }
        }
        tex.update(true);
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = 4;
        this._tiles[key] = tex;
        return tex;
    },
};
