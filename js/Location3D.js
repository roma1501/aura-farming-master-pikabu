// Location3D.js — локация: 3D-вид (свет, небо, туман, тени), земля (Terrain3D) и
// объекты ОДНОЙ карты из Maps.js (GAME_MAPS). Карта задаёт размер, текстуру
// земли, рельеф и объекты: модели (FBX / OBJ / glTF), маркеры — точки для логики
// игры (спавн, враги, финиш; в игре невидимы, в редакторе — булавки). Карты
// расставляет и правит редактор. Смена карты — loadMap(map): вид (сцена, камера,
// свет) остаётся, земля и объекты пересобираются.
// Общая для игры (main.js) и редактора (_utils/editor/lab.js): оба зовут
// update(dt) каждый кадр — вращение частей моделей (def.anim). Свои объекты игра
// создаёт в location.view.scene и регистрирует World3D.addObject(location.view,
// mesh, 'actor' | 'prop'); ставить на землю — по location.terrain.heightAt(x, y).

class Location3D {
    // opts: { assetBase?: '' — игра (пути от index.html) | '/' — редактор (от корня сервера),
    //         map?: запись GAME_MAPS (правится на месте: объекты — её objects),
    //         showMarkers?: булавки маркеров (редактор) }
    constructor(opts) {
        this.opts = opts || {};
        this.view = World3D.createView({});
        this.terrain = null;
        /** @type {LocationObject[]} */
        this.objects = [];   // { def, mesh, error, loaded } — см. addObject
        /** @type {GameMap} */
        this.map = null;
        this._groundImage = null;
        this._groundIndex = -1;
        /** @type {Promise<any>} */
        this.ready = this.loadMap(this.opts.map || Location3D.newMap('map'));
    }

    // Размеры и рельеф — из карты; нет поля — дефолт (карта старше кода или пустая).
    get width() { return Math.max(64, Number(this.map && this.map.width) || 2048); }
    get height() { return Math.max(64, Number(this.map && this.map.height) || 2048); }

    // Показать карту: прежние объекты уходят, земля и объекты — по новой карте.
    // map правится на месте: addObject/removeObject держат map.objects в том же
    // порядке, что this.objects. Игре — копия (Location3D.copyMap), чтобы правки
    // во время игры не попадали в GAME_MAPS. Промис — как ready.
    /** @param {GameMap} map */
    loadMap(map) {
        for (const rec of this.objects.slice()) this._drop(rec);
        this.objects = [];
        this.map = map;
        if (!Array.isArray(map.objects)) map.objects = [];
        this.buildTerrain();
        let completed = 0;
        const models = map.objects.slice().map(def => this._add(def).loaded.then(rec => {
            completed++;
            if (this.opts.onProgress) this.opts.onProgress(completed, map.objects.length);
            return rec;
        }));
        // Готова — текстура земли и модели объектов пришли (или не нашлись) и шейдеры сцены
        // собраны. Не дольше READY_TIMEOUT: сломанный ассет не держит экран загрузки вечно.
        const view = this.view;
        this.ready = Promise.all([this.loadGround()].concat(models))
            .then(() => new Promise(resolve => {
                view.scene.executeWhenReady(() => resolve(undefined));
                setTimeout(resolve, Location3D.READY_TIMEOUT);
            }));
        return this.ready;
    }

    // (Пере)собрать землю по размерам и рельефу карты (редактор — живо).
    // Объекты карты встают на новую землю; свои объекты игры — забота владельца.
    buildTerrain() {
        if (this.terrain) this.terrain.dispose();
        const t = /** @type {any} */ ((this.map && this.map.terrain) || {});
        const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
        this.terrain = new Terrain3D(this.view, {
            worldW: this.width,
            worldH: this.height,
            groundImage: this._groundImage,
            noise: { amp: Math.max(0, num(t.amp, 40)), scale: num(t.scale, 800), seed: num(t.seed, 1), base: num(t.base, 0) }
        });
        this.placeObjects();
        return this.terrain;
    }

    // --- Объекты карты --------------------------------------------------------------

    // Запись карты -> объект: { def, mesh, error, loaded }. Запись
    // возвращается сразу, меш появляется, когда модель догрузится (loaded —
    // промис). Нет файла — объект без меша (error), сцена не падает.
    // def: { name, model, kind, x, y, h, rot, scale, anim? } — поля живые: правка +
    // placeObject; anim читается каждый кадр (spinPart). kind 'marker' — маркер без модели.
    // at — место в списке (по умолчанию — в конец); def попадает и в map.objects.
    /** @param {LocationObjectDef} def @param {number} [at] @returns {LocationObject} */
    addObject(def, at) {
        const list = this.map.objects;
        const i = list.indexOf(def);
        if (i >= 0) list.splice(i, 1);
        const pos = at == null || at < 0 || at > this.objects.length ? this.objects.length : at;
        list.splice(pos, 0, def);
        return this._add(def, pos);
    }

    /** @param {LocationObjectDef} def @param {number} [at] @returns {LocationObject} */
    _add(def, at) {
        /** @type {LocationObject} */
        const rec = { def, mesh: null, error: null, loaded: null };
        this.objects.splice(at == null ? this.objects.length : at, 0, rec);
        if (def.kind === 'marker') {
            if (this.opts.showMarkers) {
                rec.mesh = Location3D.markerMesh(this.view.scene, def.name || 'marker');
                rec.mesh.metadata = { locationObject: rec };
                this.placeObject(rec);
            }
            rec.loaded = Promise.resolve(rec);
            return rec;
        }
        rec.loaded = Model3D.load((this.opts.assetBase || '') + def.model).then((model) => {
            if (this.objects.indexOf(rec) < 0 || !this.view) return rec;   // сняли, пока грузилась
            rec.mesh = Model3D.build(model, this.view.scene, { name: def.name || 'object' });
            rec.mesh.metadata = { locationObject: rec };
            World3D.addObject(this.view, rec.mesh, def.kind);
            this.placeObject(rec);
            return rec;
        }).catch((e) => {
            rec.error = (e && e.message) || String(e);
            console.warn('Location3D: не загрузилась модель ' + def.model + ' — ' + rec.error);
            return rec;
        });
        return rec;
    }

    // Меш — по полям def: позиция на земле + h; rot — [x, y, z] градусы (y — курс по
    // карте, как heading: rotation.y = −y; x, z — наклон); scale — [x, y, z]. Старая
    // запись с числами (rot — только курс, scale — равномерный) тоже читается.
    /** @param {LocationObject} rec */
    placeObject(rec) {
        const m = rec.mesh, d = rec.def;
        if (!m) return;
        const x = Number(d.x) || 0, y = Number(d.y) || 0, D = Math.PI / 180;
        const r = Array.isArray(d.rot) ? d.rot : [0, d.rot, 0];
        const s = Array.isArray(d.scale) ? d.scale : [d.scale, d.scale, d.scale];
        const k = (v) => (Number(v) > 0 ? Number(v) : 1);
        m.position.set(x, (this.terrain ? this.terrain.heightAt(x, y) : 0) + (Number(d.h) || 0), y);
        m.rotationQuaternion = null;   // кватернион (его может поставить гизмо) перекрыл бы rotation
        m.rotation.set((Number(r[0]) || 0) * D, -(Number(r[1]) || 0) * D, (Number(r[2]) || 0) * D);
        m.scaling.set(k(s[0]), k(s[1]), k(s[2]));
    }

    placeObjects() {
        for (const rec of this.objects) this.placeObject(rec);
    }

    // Маркеры карты для логики игры: записи с kind 'marker' и именем name или
    // name-2, name-3… (так их нумерует редактор). Без имени — все маркеры.
    // Запись: { name, x, y, h, rot: [x, курс, z], scale } — поля карты как есть.
    /** @param {string} [name] @returns {LocationObjectDef[]} */
    markers(name) {
        const all = this.map.objects.filter(d => d.kind === 'marker');
        if (!name) return all;
        return all.filter(d => d.name === name || String(d.name).startsWith(name + '-'));
    }

    /** @param {string} name @returns {LocationObjectDef | null} */
    marker(name) {
        return this.markers(name)[0] || null;
    }

    // Кадр анимации объектов — до World3D.renderFrame().
    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        for (const rec of this.objects) this.spinPart(rec, dt);
    }

    // def.anim = { part, axis, speed, dir }: часть модели (объект FBX) вращается вокруг
    // своего центра (origin из Blender) по своей оси axis — 'x' | 'y' | 'z', с минусом —
    // обратный конец; speed — об/мин; dir — 'cw' | 'ccw', по/против часовой, если
    // смотреть с конца оси. Сняли анимацию или сменили часть — прежняя встаёт на место.
    /** @param {LocationObject} rec @param {number} dt */
    spinPart(rec, dt) {
        const a = rec.def.anim;
        const name = a && rec.mesh ? String(a.part || '') : '';
        let s = rec.spin;
        if (s && (s.name !== name || s.root !== rec.mesh)) {
            if (s.mesh && !s.mesh.isDisposed()) {
                s.mesh.rotationQuaternion = null;
                s.mesh.setPivotPoint(BABYLON.Vector3.Zero());
            }
            s = rec.spin = null;
        }
        if (!name) return;
        if (!s) {
            const mesh = rec.mesh.getChildMeshes(true).find(m => m.metadata && m.metadata.part === name) || null;
            s = rec.spin = { name, root: rec.mesh, mesh, angle: 0, axis: new BABYLON.Vector3(), q: new BABYLON.Quaternion() };
            if (mesh) mesh.setPivotPoint(BABYLON.Vector3.FromArray(mesh.metadata.pivot));
        }
        if (!s.mesh) return;
        const axis = String(a.axis || 'y'), dirs = s.mesh.metadata.axes;
        const v = dirs[axis.slice(-1)] || dirs.y, sign = axis[0] === '-' ? -1 : 1;
        s.axis.set(v[0] * sign, v[1] * sign, v[2] * sign);
        // Сцена правосторонняя: положительный угол — против часовой с конца оси.
        const turn = Math.max(0, Number(a.speed) || 0) * Math.PI / 30 * (a.dir === 'ccw' ? 1 : -1);
        s.angle = (s.angle + turn * dt) % (2 * Math.PI);
        BABYLON.Quaternion.RotationAxisToRef(s.axis, s.angle, s.q);
        s.mesh.rotationQuaternion = s.q;
    }

    // Снять объект со сцены и из карты.
    /** @param {LocationObject} rec */
    removeObject(rec) {
        const i = this.map ? this.map.objects.indexOf(rec.def) : -1;
        if (i >= 0) this.map.objects.splice(i, 1);
        this._drop(rec);
    }

    /** @param {LocationObject} rec */
    _drop(rec) {
        const i = this.objects.indexOf(rec);
        if (i >= 0) this.objects.splice(i, 1);
        if (rec.mesh && this.view) {
            if (rec.def.kind === 'marker') rec.mesh.dispose(false, true);
            else Model3D.dispose(this.view, rec.mesh);
        }
        rec.mesh = null;
    }

    // Текстура земли по map.ground. Пути — ЛИТЕРАЛАМИ в GROUNDS: сканер
    // сборщика (tools/asset-scan.mjs) находит ассеты только так. Нет файла —
    // земля остаётся ровного цвета, сцена не падает.
    loadGround() {
        const list = Location3D.GROUNDS;
        const n = Number(this.map && this.map.ground) || 0;
        const idx = Math.max(0, Math.min(list.length - 1, Math.round(n) || 0));
        if (idx === this._groundIndex && this._groundImage) return Promise.resolve(this._groundImage);
        this._groundIndex = idx;
        const url = (this.opts.assetBase || '') + list[idx];
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                if (this._groundIndex === idx) {
                    this._groundImage = img;
                    if (this.terrain) this.terrain.setGroundImage(img);
                }
                resolve(img);
            };
            img.onerror = () => {
                console.warn('Location3D: не загрузилась текстура земли ' + url);
                resolve(null);
            };
            img.src = url;
        });
    }

    applyRenderConstants() {
        World3D.applyRenderConstants(this.view);
    }

    dispose() {
        this.objects = [];   // меши и материалы умирают со сценой
        if (this.terrain) this.terrain.dispose();
        this.terrain = null;
        if (this.view) this.view.dispose();
        this.view = null;
    }

    // Новая пустая карта (редактор — «Новая карта»; игра без Maps.js).
    /** @param {string} id @param {string} [name] @returns {GameMap} */
    static newMap(id, name) {
        return { id, name: name || id, width: 2048, height: 2048, ground: 0,
            terrain: { amp: 40, scale: 800, seed: 1, base: 0 }, objects: [] };
    }

    // Глубокая копия карты: игра правит её, GAME_MAPS остаётся как в файле.
    /** @param {GameMap} map @returns {GameMap} */
    static copyMap(map) {
        return JSON.parse(JSON.stringify(map));
    }

    // Булавка маркера (редактор): шест, шар и стрелка курса вдоль +X. Без света
    // и теней — toon не квантует, тень не падает; в карту теней не ставится.
    static markerMesh(scene, name) {
        const B = BABYLON.MeshBuilder;
        const pole = B.CreateCylinder('pole', { height: 70, diameter: 5, tessellation: 8 }, scene);
        pole.position.y = 35;
        const head = B.CreateSphere('head', { diameter: 22, segments: 8 }, scene);
        head.position.y = 76;
        const arrow = B.CreateCylinder('arrow', { height: 34, diameterTop: 0, diameterBottom: 14, tessellation: 3 }, scene);
        arrow.rotation.z = -Math.PI / 2;
        arrow.position.set(20, 3, 0);
        const ring = B.CreateTorus('ring', { diameter: 40, thickness: 3, tessellation: 24 }, scene);
        ring.position.y = 1;
        const mesh = BABYLON.Mesh.MergeMeshes([pole, head, arrow, ring], true, true);
        mesh.name = 'marker:' + name;
        const mat = new BABYLON.StandardMaterial('marker-mat:' + name, scene);
        mat.disableLighting = true;
        mat.emissiveColor = World3D.hexColor3(Location3D.markerColor(name));
        mat.diffuseColor = BABYLON.Color3.Black();
        mat.specularColor = BABYLON.Color3.Black();
        mat.metadata = { toon: false };
        mesh.material = mat;
        mesh.renderingGroupId = World3D.LAYER.ACTOR;
        return mesh;
    }

    // Цвет булавки — по имени без номера: у всех spawn-N один цвет.
    static markerColor(name) {
        const stem = String(name || '').replace(/-\d+$/, '');
        let h = 0;
        for (let i = 0; i < stem.length; i++) h = (h * 31 + stem.charCodeAt(i)) >>> 0;
        return Location3D.MARKER_COLORS[h % Location3D.MARKER_COLORS.length];
    }
}

// Текстуры земли по map.ground: 0 — трава, 1 — песок, 2 — снег.
Location3D.GROUNDS = [
    'assets/ground_texture_g.jpg',
    'assets/ground_texture_d.jpg',
    'assets/ground_texture_s.jpg'
];

// ms: дольше карта «готовой» не ждёт (шейдеры, текстуры) — игра стартует и так.
Location3D.READY_TIMEOUT = 15000;

// Цвета булавок маркеров в редакторе.
Location3D.MARKER_COLORS = [0xffb020, 0x35d0ff, 0xff5a8a, 0x7cff6b, 0xb58cff, 0xffef5a];
