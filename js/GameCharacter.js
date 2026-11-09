// GameCharacter.js — класс Character (DESIGN.md §3, §6): блочный R6-персонаж игрока, ботов
// и манекенов. Риг из assets/models/char/r6.glb (части Torso, Head, Face, LeftArm, RightArm,
// LeftLeg, RightLeg; запасной риг — боксы тех же размеров), внешность (цвета частей, лицо,
// аксессуары), перчатка на палке в правой руке, эмодзи-маска, процедурные анимации с
// плавным смешиванием, физика (гравитация, пол GameWorld, препятствия, расталкивание),
// отбрасывание -> ragdoll -> лежит -> встаёт, падение в бездну и KO.
// Внешность (setAppearance) — два формата: старый { colors, face, accessories } (манекены,
// запасной вид без гардероба) и каталожный { skin, hair, face, shirt, pants, hat, glasses, back, aura } — id вещей
// COSMETICS (GameCosmeticsData.js) или null: причёски/аксессуары — модели каталога (Tint красится
// color вещи), лицо — текстура, рубашка и штаны — композит шаблона одежды Roblox на торсе, руках и
// ногах (см. «Косметика каталога»); эффект ауры рисует GameWardrobe.
//
// Риг: root (позиция x/h/y, курс) -> body (центр масс COM_H над ногами, кватернион:
//   наклон, кувырки ragdoll) -> torso (пояс) -> head / armL / armR; ноги — от body.
//   В каждом шарнире — TransformNode в pivot части, меш части — его ребёнок со сдвигом
//   −pivot (вершины Model3D.build — в координатах модели). Материалы — свои у персонажа.
// Оси части (Babylon): +X — вперёд (нос), +Y — вверх, +Z — правая сторона персонажа.
//   Рука/нога: rotation.z > 0 — мах вперёд, rotation.x — в сторону (правая рука наружу —
//   x < 0, левая — x > 0), rotation.y — поворот вокруг вертикали плеча.
//
// Состояния (state): 'idle' | 'run' | 'slap' | 'dash' | 'ragdoll' | 'down' | 'getup' |
//   'falling' | 'dead'. Управление — намерение движения setMove(dx, dy) (направление на
//   карте, длина 0..1), рывок dash(), прыжок jump(), эмоции emote(); шлепок начинает
//   GameCombat.trySlap (он зовёт startSlap и в момент удара — GameCombat.contact).
// Шлепок: замах 0.08 / удар 0.12 / возврат 0.2 с (÷ скорость перчатки × mods.slapSpeed);
//   контакт — на доле GAME_SLAP_CONTACT удара, когда рука с перчаткой проходит перед
//   корпусом (Character.SLAP_POSE). Рывок во время замаха гарантированного шлепка (игрок)
//   сначала засчитывает удар, мах доигрывает в рывке; шлепок бота рывком отменяется.
//
// Кадр (Game.update): step(dt) — физика всех -> Character.separate(chars, dt) ->
//   animate(dt) — поза и трансформы. dt — игровое время (с учётом Game.timeScale).

class Character {
    /**
     * @param {{ name?: string, isPlayer?: boolean, isBot?: boolean, zone?: string, x?: number, y?: number, h?: number,
     *           heading?: number, look?: any, glove?: string, team?: string | null, avatar?: string | null }} [opts]
     */
    constructor(opts) {
        const o = opts || {};
        this.id = ++Character._ids;
        this.name = o.name || ('#' + this.id);
        this.aura = 0;
        this.isPlayer = !!o.isPlayer;
        this.isBot = !!o.isBot;
        this.isDummy = false;
        /** @type {string | null} */
        this.team = o.team || null;
        this.zone = o.zone || 'lobby';
        this.x = o.x || 0;
        this.y = o.y || 0;
        this.h = o.h || 0;
        this.vx = 0;
        this.vy = 0;
        this.vh = 0;
        this.heading = o.heading || 0;
        this.onGround = true;
        this.state = 'idle';
        this.glove = 'default';
        /** @type {string | null} картинка-аватар бейджа (url / dataURL); null — нарисует UI */
        this.avatar = o.avatar || null;
        // Множители способностей и перчаток (меняют модули перчаток/способностей; 1 — как есть).
        this.mods = { power: 1, speed: 1, slapSpeed: 1, cooldown: 1, range: 1, dashCooldown: 1, friction: 1, gravity: 1 };
        this.speedMul = 1;            // базовая скорость персонажа (боты — свои)
        this.moveX = 0;               // намерение движения: направление на карте × 0..1
        this.moveY = 0;
        /** @type {Character | null} */
        this.lastHitBy = null;
        this.lastHitTime = -99;
        /** @type {{ t: number, wind: number, strike: number, rec: number, target: Character | null, opts: any, hitDone: boolean } | null} */
        this.slap = null;
        this.nextSlapAt = 0;
        this.dashT = 0;
        this.nextDashAt = 0;
        this.dashX = 1;
        this.dashY = 0;
        this.stunT = 0;
        this.downT = 0;
        this.getupT = 0;
        this.shieldUntil = 0;
        this.invisible = false;       // невидим для ботов (способность «Призрак»); шлепать можно
        this.hidden = false;          // скрыт целиком (setHidden)
        /** @type {string | null} */
        this.emoteName = null;
        this.emoteUntil = 0;
        this.disposed = false;
        this.data = {};               // свободное место для модулей (ИИ ботов и т.п.)
        /** @type {any} */
        this.badge = null;            // DOM-бейдж (GameUI)
        this.look = null;
        this.animT = Math.random() * 10;
        this.runPhase = 0;
        this._groundedOnce = false;
        this._faceTo = null;
        this._spin = 0;
        this._spinAxis = new BABYLON.Vector3(0, 0, 1);
        this._q = BABYLON.Quaternion.Identity();
        this._qLie = BABYLON.Quaternion.Identity();
        this._qUp = BABYLON.Quaternion.Identity();
        this._gloveToken = 0;
        /** @type {BABYLON.Mesh | null} */
        this._gloveRoot = null;
        this._accToken = 0;
        /** @type {BABYLON.StandardMaterial | null} */
        this._maskMat = null;
        /** @type {BABYLON.Mesh | null} */
        this.mask = null;
        /** @type {BABYLON.TransformNode} */
        this.root = null;
        /** @type {BABYLON.TransformNode} */
        this.body = null;
        /** @type {BABYLON.TransformNode} */
        this.grip = null;
        /** @type {BABYLON.TransformNode} */
        this.maskNode = null;
        /** @type {{ torso: BABYLON.TransformNode, head: BABYLON.TransformNode, armL: BABYLON.TransformNode, armR: BABYLON.TransformNode, legL: BABYLON.TransformNode, legR: BABYLON.TransformNode }} */
        this.joints = null;
        /** @type {Record<string, number[]>} */
        this.pivots = null;
        this._maskT = 0;
        this._gw = 0;                 // вес поворота кисти в шлепке (0 — перчатка поперёк руки)
        this._prevGround = true;
        this._phase = [0, 1, 2, 3, 4, 5, 6].map(() => Math.random() * 6.28);
        // Поза (текущая и цель) и скорости пружин ragdoll.
        this.P = Character.basePose();
        this.T = Character.basePose();
        this.V = Character.basePose(0);
        this.scene = GameWorld.scene;
        this.view = GameWorld.view;
        /** @type {BABYLON.AbstractMesh[]} */
        this.meshes = [];
        /** @type {Record<string, BABYLON.Material[]>} */
        this.mats = {};
        /** @type {BABYLON.AbstractMesh[]} */
        this.accMeshes = [];
        /** @type {BABYLON.TransformNode[]} узлы вращения деталей аксессуаров (Propeller) */
        this._spinners = [];
        /** @type {any} композит одежды (Character.clothRec) или null */
        this._cloth = null;
        /** @type {any} фарм ауры (GameFarm): серия, тик, блокировка */
        this._fm = null;
        this._accSig = '';            // подпись набора аксессуаров каталожной внешности (без пересборки при том же наборе)
        this._buildRig();
        this.setAppearance(o.look || Character.BASE_LOOK);
        this.setGlove(o.glove || 'default');
        this._applyTransforms();
    }

    // --- Ресурсы (общие на всех персонажей) ----------------------------------------------

    // Модель R6, перчатки и аксессуары — заранее (Game.init): построение персонажа тогда без «дозагрузки».
    // Нет файла — запасной риг/перчатка из примитивов.
    static async preload() {
        try { Character.model = await Model3D.load(Character.R6_URL); }
        catch (e) { Character.model = null; console.warn('Character: нет модели R6 (' + ((e && e.message) || e) + ') — риг из боксов'); }
        const urls = Object.values(Character.GLOVE_URLS).concat(Object.values(Character.ACCESSORY_URLS));
        await Promise.all(urls.map(u => Model3D.load(u).catch(() => null)));
    }

    // Поза покоя (углы шарниров, высота корпуса by); v === 0 — нули (скорости пружин).
    static basePose(v) {
        const p = Object.assign({}, Character.BASE);
        p.by = v === 0 ? 0 : Character.COM_H;
        return p;
    }

    // --- Риг ------------------------------------------------------------------------------

    _buildRig() {
        const scene = this.scene;
        const N = (n, parent) => { const t = new BABYLON.TransformNode('c' + this.id + '/' + n, scene); if (parent) t.parent = parent; return t; };
        this.root = N('root', null);
        this.body = N('body', this.root);
        this.body.rotationQuaternion = BABYLON.Quaternion.Identity();
        const model = Character.model;
        // Шарниры из модели (pivot частей), иначе — из контракта DESIGN §3.
        const piv = Object.assign({}, Character.PIVOTS);
        /** @type {Record<string, BABYLON.AbstractMesh[]>} */
        const parts = {};
        let built = null;
        if (model) {
            built = Model3D.build(model, scene, { name: 'c' + this.id });
            for (const m of built.getChildMeshes(true)) {
                const key = Character.PART_KEYS[m.metadata && m.metadata.part] || 'torso';
                (parts[key] || (parts[key] = [])).push(m);
                if (key !== 'face' && m.metadata && Array.isArray(m.metadata.pivot) && Character.PART_KEYS[m.metadata.part]) piv[key] = m.metadata.pivot;
            }
        }
        const C = Character.COM_H;
        const J = this.joints = {
            torso: N('torso', this.body), head: null, armL: null, armR: null, legL: null, legR: null };
        J.head = N('head', J.torso);
        J.armL = N('armL', J.torso);
        J.armR = N('armR', J.torso);
        J.legL = N('legL', this.body);
        J.legR = N('legR', this.body);
        const v = (p) => new BABYLON.Vector3(p[0], p[1], p[2]);
        J.torso.position = v(piv.torso).subtract(new BABYLON.Vector3(0, C, 0));
        J.head.position = v(piv.head).subtract(v(piv.torso));
        J.armL.position = v(piv.armL).subtract(v(piv.torso));
        J.armR.position = v(piv.armR).subtract(v(piv.torso));
        J.legL.position = v(piv.legL).subtract(new BABYLON.Vector3(0, C, 0));
        J.legR.position = v(piv.legR).subtract(new BABYLON.Vector3(0, C, 0));
        this.pivots = piv;
        if (built) {
            /** @type {Set<BABYLON.Material>} */
            const orig = new Set();
            for (const m of built.getChildMeshes(true)) if (m.material) { orig.add(m.material); for (const s of /** @type {any} */ (m.material).subMaterials || []) if (s) orig.add(s); }
            for (const key in parts) {
                const joint = key === 'face' ? J.head : J[key];
                const p = key === 'face' ? piv.head : piv[key];
                for (const m of parts[key]) {
                    m.parent = joint;
                    m.position = v(p).negate();
                    this._ownMaterials(m, key);
                    this._register(m);
                }
            }
            built.dispose(true);
            for (const x of orig) x.dispose(false, false);   // исходные материалы сборки — у частей свои копии
            if (!parts.face) this._fallbackFace();
        } else {
            this._boxRig();
        }
        // Перчатка — в кисти правой руки (низ RightArm), палка вперёд.
        this.grip = N('grip', J.armR);
        this.grip.position = new BABYLON.Vector3(0, Character.HAND_Y - piv.armR[1], 0);
        // Свои пропорции «стритового» персонажа (не блочный нуб): крупная голова, тонкие руки и ноги.
        // Перчатка в руке компенсирует сужение руки.
        const PR = Character.PROPORTIONS;
        J.head.scaling.setAll(PR.head);
        J.armL.scaling.set(PR.arm, 1, PR.arm);
        J.armR.scaling.set(PR.arm, 1, PR.arm);
        J.legL.scaling.set(PR.leg, 1, PR.leg);
        J.legR.scaling.set(PR.leg, 1, PR.leg);
        this.grip.scaling.set(1 / PR.arm, 1, 1 / PR.arm);
        this.maskNode = N('mask', J.head);
        this.maskNode.position = new BABYLON.Vector3(29, 24, 0);
    }

    // Каждой части — свой материал (цвета персонажа не текут к другим).
    _ownMaterials(mesh, key) {
        const mat = mesh.material;
        if (!mat) return;
        // Материал «Face» (узел Face или грань головы) — в список лица, остальные — части.
        const own = (sm) => {
            if (!sm) return null;
            const c = sm.clone(sm.name + '/c' + this.id);
            const k = key === 'face' || /\/Face$/i.test(sm.name) ? 'face' : key;
            (this.mats[k] || (this.mats[k] = [])).push(c);
            return c;
        };
        const sub = /** @type {any} */ (mat).subMaterials;
        if (sub) {
            const multi = new BABYLON.MultiMaterial(mesh.name + '/own', this.scene);
            multi.subMaterials = sub.map(own);
            mesh.material = multi;
        } else {
            mesh.material = own(mat);
        }
    }

    _register(mesh) {
        World3D.addObject(this.view, mesh, 'actor');
        this.meshes.push(mesh);
    }

    // Запасной риг: боксы размеров DESIGN §3 (px), шарниры — те же.
    _boxRig() {
        const scene = this.scene, J = this.joints, piv = this.pivots;
        const add = (key, mesh, cx, cy, cz) => {
            const p = piv[key];
            mesh.parent = J[key];
            mesh.position = new BABYLON.Vector3(cx - p[0], cy - p[1], cz - p[2]);
            const mat = new BABYLON.StandardMaterial(mesh.name + '/mat', scene);
            mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
            mesh.material = mat;
            (this.mats[key] || (this.mats[key] = [])).push(mat);
            this._register(mesh);
        };
        const B = (n, w, h, d) => BABYLON.MeshBuilder.CreateBox('c' + this.id + '/' + n, { width: w, height: h, depth: d }, scene);
        add('torso', B('Torso', 40, 80, 80), 0, 120, 0);
        add('head', BABYLON.MeshBuilder.CreateCylinder('c' + this.id + '/Head', { height: 48, diameter: 50, tessellation: 20 }, scene), 0, 184, 0);
        add('armL', B('LeftArm', 40, 80, 40), 0, 120, -60);
        add('armR', B('RightArm', 40, 80, 40), 0, 120, 60);
        add('legL', B('LeftLeg', 40, 80, 40), 0, 40, -20);
        add('legR', B('RightLeg', 40, 80, 40), 0, 40, 20);
        this._fallbackFace();
    }

    // Пластина лица перед головой (нет узла Face в модели).
    _fallbackFace() {
        const plane = BABYLON.MeshBuilder.CreatePlane('c' + this.id + '/Face', { width: 38, height: 38, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        plane.parent = this.joints.head;
        plane.position = new BABYLON.Vector3(25.6, 24, 0);
        plane.rotation.y = Math.PI / 2;
        const mat = new BABYLON.StandardMaterial(plane.name + '/mat', this.scene);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        plane.material = mat;
        this.mats.face = [mat];
        this._register(plane);
    }

    // --- Внешность -----------------------------------------------------------------------

    /**
     * look: { colors: { head, torso, leftArm, rightArm, leftLeg, rightLeg } (0xRRGGBB или '#rrggbb'),
     *         face: ключ Character.FACES ('smile', 'cool' …) или url PNG с alpha,
     *         accessories: [{ id, color? }] — id из Character.ACCESSORY_URLS }
     * или каталожная: { skin, hair, face, shirt, pants, hat, glasses, back, aura } (Character.isCosLook).
     */
    setAppearance(look) {
        const l = look || Character.BASE_LOOK;
        this.look = l;
        if (Character.isCosLook(l)) { this._setCosLook(l); return; }
        this._clearCloth();
        this._accSig = '#legacy';
        const c = l.colors || {};
        const map = { head: c.head, torso: c.torso, armL: c.leftArm, armR: c.rightArm, legL: c.leftLeg, legR: c.rightLeg };
        for (const key in map) {
            if (map[key] == null) continue;
            const col = Character.color3(map[key]);
            // Лёгкая собственная подсветка: теневая сторона блочного персонажа не уходит в черноту (вид Roblox).
            for (const m of this.mats[key] || []) { /** @type {any} */ (m).diffuseColor = col; /** @type {any} */ (m).emissiveColor = col.scale(GameCfg.charLift); }
        }
        this._setFace(l.face || 'smile');
        this._setAccessories(l.accessories || []);
    }

    _setFace(face) {
        const mats = this.mats.face || [];
        // Узел Face модели может нести и другие материалы — лицо ставится на все его материалы.
        const tex = Character.faceTexture(this.scene, face, mats);
        for (const m of mats) {
            const sm = /** @type {BABYLON.StandardMaterial} */ (m);
            sm.diffuseTexture = tex;
            sm.diffuseColor = new BABYLON.Color3(1, 1, 1);
            sm.specularColor = new BABYLON.Color3(0, 0, 0);
            sm.useAlphaFromDiffuseTexture = true;
            sm.backFaceCulling = false;
            if (tex) tex.hasAlpha = true;
        }
    }

    // list: [{ id, color?, url?, carrier?, tintOnly?, noTail?, glow? }] — url — модель каталога (иначе
    // Character.ACCESSORY_URLS[id]); carrier ('head'|'torso') — носитель деталей без префикса acc_
    // (Glow, Propeller …), узлы acc_* — по своему шарниру; tintOnly — color только материалам Tint;
    // noTail — без частей причёски на торсе (хвост длинных волос под рюкзаком/крыльями); glow —
    // цвет ореола узлов Glow. Узел Propeller вращается (animate).
    _setAccessories(list) {
        for (const m of this.accMeshes) this._dropMesh(m);
        this.accMeshes = [];
        for (const n of this._spinners) n.dispose(false, false);
        this._spinners = [];
        const token = ++this._accToken;
        for (const a of list || []) {
            const url = (a && a.url) || Character.ACCESSORY_URLS[a && a.id];
            if (!url) continue;
            Model3D.load(url).then(model => {
                if (this.disposed || token !== this._accToken) return;
                const root = Model3D.build(model, this.scene, { name: 'c' + this.id + '/acc' });
                for (const m of root.getChildMeshes(true)) {
                    const p = (m.metadata && m.metadata.pivot) || [0, 160, 0];
                    const nm = String((m.metadata && m.metadata.part) || '');
                    // Головное (шарнир на шее) — к голове, остальное — к торсу; детали вещи — к её носителю.
                    const key = a.carrier && !/^acc_/i.test(nm) ? a.carrier : p[1] >= 140 ? 'head' : 'torso';
                    if (a.noTail && key === 'torso') { m.dispose(false, false); continue; }
                    const jp = this.pivots[key];
                    if (/propeller/i.test(nm)) {
                        // Пропеллер крутится вокруг своего начала (ось — вверх головы).
                        const spin = new BABYLON.TransformNode('c' + this.id + '/spin', this.scene);
                        spin.parent = this.joints[key];
                        spin.position = new BABYLON.Vector3(p[0] - jp[0], p[1] - jp[1], p[2] - jp[2]);
                        m.parent = spin;
                        m.position = new BABYLON.Vector3(-p[0], -p[1], -p[2]);
                        this._spinners.push(spin);
                    } else {
                        m.parent = this.joints[key];
                        m.position = new BABYLON.Vector3(-jp[0], -jp[1], -jp[2]);
                    }
                    // Материалы сборки и так свои у этого вызова Model3D.build — без копий.
                    const mat = m.material;
                    const own = mat ? (/** @type {any} */ (mat).subMaterials ? /** @type {any} */ (mat).subMaterials.filter(Boolean) : [mat]) : [];
                    // Цвет аксессуара — материалам Tint* / Main*, а если такого нет — первому (tintOnly — никому).
                    if (a.color != null && own.length) {
                        const tint = own.filter(x => /^(tint|main|color)/i.test(x.name.split('/').pop() || ''));
                        for (const x of (tint.length ? tint : a.tintOnly ? [] : [own[0]])) /** @type {any} */ (x).diffuseColor = Character.color3(a.color);
                    }
                    // Та же подсветка, что у частей тела (GAME_CHAR_LIFT): emissive = цвет × доля —
                    // умножается на текстуру/цвет вершин, теневая сторона не уходит в черноту.
                    for (const x of own) {
                        const d = /** @type {any} */ (x).diffuseColor;
                        if (d && 'emissiveColor' in x) /** @type {any} */ (x).emissiveColor = d.scale(GameCfg.charLift);
                    }
                    // Узел Glow — светится сам (цвет — в вершинах/текстуре) + ореол GlowLayer.
                    if (/glow/i.test(nm)) {
                        for (const x of own) if ('emissiveColor' in x) /** @type {any} */ (x).emissiveColor = new BABYLON.Color3(1, 1, 1);
                        GameWorld.addGlow(m, Character.color3(a.glow != null ? a.glow : 0xffd34d).scale(0.7));
                    }
                    // Полупрозрачное (стёкла очков) — с depth pre-pass: верный порядок с пластиной лица.
                    for (const x of own) if (x.alpha < 1) x.needDepthPrePass = true;
                    this._register(m);
                    this.accMeshes.push(m);
                }
                root.dispose(true);
            }).catch(() => { /* нет файла аксессуара — без него */ });
        }
    }

    // --- Косметика каталога ------------------------------------------------------------------
    // look { skin, hair, face, shirt, pants, hat, glasses, back } — id вещей COSMETICS или null.
    // Шапка поверх объёмной причёски (Character.hatHidesHair) — причёска снимается; хвост
    // длинных волос со спинным аксессуаром — без хвоста. Рубашка и штаны — Character.clothRec.

    _setCosLook(l) {
        const I = (id) => Character.cosItem(id);
        const skin = l.skin != null ? l.skin : Character.SKIN;
        const sc = Character.color3(skin), lift = GameCfg.charLift;
        for (const m of this.mats.head || []) { /** @type {any} */ (m).diffuseColor = sc; /** @type {any} */ (m).emissiveColor = sc.scale(lift); }
        this._setCloth(skin, I(l.shirt), I(l.pants));
        const face = I(l.face);
        this._setFace(face && face.texture ? face.texture : 'smile');
        const hat = I(l.hat), hair = I(l.hair), glasses = I(l.glasses), back = I(l.back);
        /** @type {any[]} */
        const list = [];
        const add = (it, carrier, extra) => {
            if (!it || !it.model) return;
            list.push(Object.assign({ id: it.id, url: it.model, color: it.color, carrier, tintOnly: true,
                glow: it.glow != null ? it.glow : (it.color != null ? it.color : null) }, extra || {}));
        };
        if (!Character.hatHidesHair(hat, hair)) add(hair, 'head', { noTail: !!(back && back.model) });
        add(hat, 'head');
        add(glasses, 'head');
        add(back, 'torso');
        const sig = list.map(a => a.url + ':' + a.color + ':' + (a.noTail ? 1 : 0)).join(',');
        if (sig === this._accSig) return;      // тот же набор (уже стоит или ещё грузится)
        this._accSig = sig;
        this._setAccessories(list);
    }

    // Рубашка/штаны: композит на торс и руки (upper) и ноги (lower); цвет материалов — белый.
    // Запасной риг из боксов (нет UV шаблона) — части красятся тоном вещей.
    _setCloth(skin, shirt, pants) {
        const lift = GameCfg.charLift;
        if (!Character.model) {
            const st = shirt && shirt.tone != null ? shirt.tone : skin, pt = pants && pants.tone != null ? pants.tone : skin;
            const map = { torso: st, armL: shirt && shirt.cut === 'long' ? st : skin, armR: shirt && shirt.cut === 'long' ? st : skin, legL: pt, legR: pt };
            for (const k in map) {
                const c = Character.color3(map[k]);
                for (const m of this.mats[k] || []) { /** @type {any} */ (m).diffuseColor = c; /** @type {any} */ (m).emissiveColor = c.scale(lift); }
            }
            return;
        }
        const size = this.isPlayer ? 512 : 256;
        const key = Character.clothKey(this.scene, skin, shirt, pants, size);
        if (this._cloth && this._cloth.key === key) return;
        const rec = Character.clothRec(this.scene, skin, shirt, pants, size);
        if (this._cloth) Character.clothRelease(this._cloth);
        this._cloth = rec;
        const white = new BABYLON.Color3(1, 1, 1);
        for (const k of ['torso', 'armL', 'armR', 'legL', 'legR']) {
            for (const m of this.mats[k] || []) {
                const sm = /** @type {BABYLON.StandardMaterial} */ (m);
                sm.diffuseTexture = k === 'legL' || k === 'legR' ? rec.lower : rec.upper;
                sm.diffuseColor = white;
                // emissive умножается на текстуру (StandardMaterial) — подсветка пропорциональна цвету ткани.
                sm.emissiveColor = white.scale(lift);
            }
        }
    }

    // Снять композит одежды (старый формат внешности — цвета частей).
    _clearCloth() {
        if (!this._cloth) return;
        for (const k of ['torso', 'armL', 'armR', 'legL', 'legR']) for (const m of this.mats[k] || []) /** @type {any} */ (m).diffuseTexture = null;
        Character.clothRelease(this._cloth);
        this._cloth = null;
    }

    // Каталожная внешность? (старая — с colors).
    static isCosLook(l) {
        return !!l && typeof l === 'object' && !l.colors && (l.skin != null || l.shirt !== undefined || l.pants !== undefined || l.hair !== undefined || l.face !== undefined);
    }

    // Вещь каталога по id (null — нет такой / нет каталога).
    static cosItem(id) {
        if (!id || typeof COSMETICS === 'undefined') return null;
        if (!Character._cosById) Character._cosById = new Map(COSMETICS.items.map(i => [i.id, i]));
        return Character._cosById.get(id) || null;
    }

    // Шапка снимает причёску, если та под ней не помещается (Character.HAIR_HAT_CONFLICTS — проверка
    // геометрии художником); парящие над головой (Character.HAT_OVER_HAIR — нимб) не снимают.
    static hatHidesHair(hat, hair) {
        if (!hat || !hair || !hat.model || !hair.model) return false;
        const base = (u) => String(u).split('/').pop().replace(/\.glb$/i, '').replace(/^acc_/, '');
        const hatId = base(hat.model);
        if (Character.HAT_OVER_HAIR['acc_' + hatId]) return false;
        const list = Character.HAIR_HAT_CONFLICTS[base(hair.model)];
        return !!list && (' ' + list + ' ').indexOf(' ' + hatId + ' ') >= 0;
    }

    // --- Одежда: композит шаблона Roblox (585×559) --------------------------------------------
    // upper (торс + руки): кожа -> штаны (только область торса) -> рубашка целиком; lower (ноги):
    // кожа -> штаны (области «рукавов» шаблона штанов = штанины). Прозрачное в PNG = кожа. Нет
    // картинки (ещё грузится / нет файла) — заглушка тоном вещи (tone, cut). Кэш по
    // skin|shirt|pants|размер; без пользователей держится Character.CLOTH_KEEP штук, потом освобождается.

    static clothKey(scene, skin, shirt, pants, size) {
        return scene.uid + '|' + Character.hex(skin) + '|' + (shirt ? shirt.id : '') + '|' + (pants ? pants.id : '') + '|' + size;
    }

    static clothRec(scene, skin, shirt, pants, size) {
        const key = Character.clothKey(scene, skin, shirt, pants, size);
        let rec = Character._cloth.get(key);
        if (rec) { rec.refs++; rec.freeAt = 0; return rec; }
        const mk = (n) => {
            const t = new BABYLON.DynamicTexture('cloth-' + n + '|' + key, { width: size, height: size }, scene, true);
            t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            return t;
        };
        rec = { key, upper: mk('up'), lower: mk('low'), refs: 1, freeAt: 0, skin, shirt, pants, size, disposed: false };
        Character._cloth.set(key, rec);
        Character._drawCloth(rec);
        for (const it of [shirt, pants]) {
            if (it && it.texture) Character.clothImage(it.texture, () => { if (!rec.disposed) Character._drawCloth(rec); });
        }
        Character._sweepCloth();
        return rec;
    }

    static clothRelease(rec) {
        if (!rec || rec.disposed) return;
        rec.refs = Math.max(0, rec.refs - 1);
        if (!rec.refs) rec.freeAt = performance.now();
        Character._sweepCloth();
    }

    // Неиспользуемые композиты сверх CLOTH_KEEP — освободить (самые старые первыми).
    static _sweepCloth() {
        const free = [...Character._cloth.values()].filter(r => !r.refs).sort((a, b) => a.freeAt - b.freeAt);
        while (free.length > Character.CLOTH_KEEP) {
            const r = free.shift();
            r.disposed = true;
            Character._cloth.delete(r.key);
            r.upper.dispose();
            r.lower.dispose();
        }
    }

    // Картинка одежды по url: загружена — HTMLImageElement, иначе null (onReady — после загрузки).
    static clothImage(url, onReady) {
        if (typeof Image === 'undefined') return null;
        let r = Character._clothImgs.get(url);
        if (!r) {
            const img = new Image();
            /** @type {{ img: HTMLImageElement, ok: boolean, failed: boolean, cbs: Function[] }} */
            const rr = r = { img, ok: false, failed: false, cbs: [] };
            img.onload = () => { rr.ok = true; const l = rr.cbs; rr.cbs = []; for (const fn of l) { try { fn(); } catch (e) { console.error(e); } } };
            img.onerror = () => { rr.failed = true; rr.cbs = []; };
            img.src = url;
            Character._clothImgs.set(url, r);
        }
        if (r.ok) return r.img;
        if (!r.failed && onReady) r.cbs.push(onReady);
        return null;
    }

    static _drawCloth(rec) {
        const S = rec.size, R = Character.CLOTH_UV;
        const shirt = rec.shirt, pants = rec.pants;
        const sImg = shirt && shirt.texture ? Character.clothImage(shirt.texture, null) : null;
        const pImg = pants && pants.texture ? Character.clothImage(pants.texture, null) : null;
        const hx = (v) => '#' + Character.hex(v);
        const skin = hx(rec.skin);
        const shoe = '#2b2d33';
        for (const part of ['upper', 'lower']) {
            const tex = rec[part];
            const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.fillStyle = skin;
            ctx.fillRect(0, 0, S, S);
            ctx.setTransform(S / 585, 0, 0, S / 559, 0, 0);
            ctx.imageSmoothingEnabled = true;
            // Доля стороны конечности/торса сверху (from..to — 0..1 высоты) цветом col.
            const band = (r, from, to, col) => { ctx.fillStyle = col; ctx.fillRect(r[0], r[1] + r[3] * from, r[2], r[3] * (to - from) + 0.5); };
            const sides = (g) => [g.L, g.R, g.F, g.B];
            if (part === 'upper') {
                if (pants) {
                    if (pImg) {
                        ctx.save();
                        ctx.beginPath();
                        for (const k in R.torso) { const r = R.torso[k]; ctx.rect(r[0], r[1], r[2], r[3]); }
                        ctx.clip();
                        ctx.drawImage(pImg, 0, 0, 585, 559);
                        ctx.restore();
                    } else if (pants.tone != null) {
                        const pc = hx(pants.tone);
                        for (const r of sides(R.torso)) band(r, 0.76, 1, pc);
                        band(R.torso.D, 0, 1, pc);
                    }
                }
                if (shirt) {
                    if (sImg) ctx.drawImage(sImg, 0, 0, 585, 559);
                    else if (shirt.tone != null) {
                        const sc = hx(shirt.tone);
                        band(R.torso.U, 0, 1, sc);
                        for (const r of sides(R.torso)) band(r, 0, pants ? 0.76 : 1, sc);
                        if (!pants) band(R.torso.D, 0, 1, sc);
                        const sl = shirt.cut === 'long' ? 0.92 : shirt.cut === 'none' ? 0 : 0.38;
                        for (const g of [R.right, R.left]) {
                            if (sl > 0) band(g.U, 0, 1, sc);
                            for (const r of sides(g)) if (sl > 0) band(r, 0, sl, sc);
                        }
                    }
                }
            } else if (pants) {
                if (pImg) ctx.drawImage(pImg, 0, 0, 585, 559);
                else if (pants.tone != null) {
                    const pc = hx(pants.tone), len = pants.cut === 'short' ? 0.45 : 0.86;
                    for (const g of [R.right, R.left]) {
                        band(g.U, 0, 1, pc);
                        for (const r of sides(g)) { band(r, 0, len, pc); band(r, 0.86, 1, shoe); }
                        band(g.D, 0, 1, shoe);
                    }
                }
            }
            tex.update();
        }
    }

    // 0xRRGGBB | '#rrggbb' -> 'rrggbb'.
    static hex(v) {
        if (typeof v === 'string') return v.replace('#', '').toLowerCase();
        return ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    }

    // Снять меш персонажа: обводка, тень, меш; материалы — свои, текстуры общие.
    _dropMesh(m) {
        const i = this.meshes.indexOf(m);
        if (i >= 0) this.meshes.splice(i, 1);
        const mats = [];
        if (m.material) { mats.push(m.material); for (const s of /** @type {any} */ (m.material).subMaterials || []) if (s) mats.push(s); }
        GameWorld.removeGlow(m);
        World3D.removeObject(this.view, m);
        for (const x of mats) if (this.scene.materials.indexOf(x) >= 0) x.dispose(false, false);
    }

    // --- Перчатка -------------------------------------------------------------------------

    // Перчатка в правую руку: glove_<id>.glb (Character.GLOVE_URLS), нет файла — из примитивов.
    setGlove(id) {
        const gid = id || 'default';
        const changed = gid !== this.glove || !this._gloveRoot;
        this.glove = gid;
        if (!changed) return;
        const token = ++this._gloveToken;
        const url = Character.GLOVE_URLS[gid];
        const put = (root) => {
            if (this.disposed || token !== this._gloveToken) { this._disposeTree(root); return; }
            if (this._gloveRoot) this._disposeTree(this._gloveRoot);
            this._gloveRoot = root;
            root.parent = this.grip;
            // «Гигант» крупный уже в файле (×1.8) — второй раз не масштабируется.
            const st = typeof GameCombat !== 'undefined' ? GameCombat.gloveStats(gid) : null;
            const s = (st && st.scale) || 1;
            if (s !== 1 && gid !== 'giant') root.scaling.scaleInPlace(s);
            World3D.addObject(this.view, root, 'actor');
            Character.lightGlove(root, gid);
        };
        if (!url) { put(this._primitiveGlove(gid)); return; }
        Model3D.load(url).then(model => put(Model3D.build(model, this.scene, { name: 'c' + this.id + '/glove' })))
            .catch(() => put(this._primitiveGlove(gid)));
    }

    _disposeTree(root) {
        if (!root) return;
        for (const m of root.getChildMeshes(false)) GameWorld.removeGlow(m);
        const mats = new Set();
        for (const m of [root].concat(root.getChildMeshes(false))) {
            if (!m.material) continue;
            mats.add(m.material);
            for (const s of /** @type {any} */ (m.material).subMaterials || []) if (s) mats.add(s);
        }
        World3D.removeObject(this.view, root);
        for (const x of mats) /** @type {BABYLON.Material} */ (x).dispose(false, false);
    }

    // Свечение перчатки (рецепт lightGlove, tools/blender/gloves/README.md): узел Glow — emissive
    // (1,1,1) всегда (цвет детали — в вершинах/текстуре) + ореол GlowLayer цвета GLOVE_GLOW;
    // «Призрак» — слабый emissive руки; полупрозрачным материалам — needDepthPrePass (пальцы не
    // просвечивают друг сквозь друга). Перед удалением — GameWorld.removeGlow (см. _disposeTree).
    // Общая для перчатки в руке и на пьедестале (GameGloves).
    static lightGlove(root, id) {
        if (!root) return;
        for (const m of root.getChildMeshes(false)) {
            const part = m.metadata && m.metadata.part;
            const mat = /** @type {any} */ (m.material);
            /** @type {any[]} */
            const mats = mat ? (mat.subMaterials || [mat]).filter(Boolean) : [];
            if (part === 'Glow') {
                for (const x of mats) x.emissiveColor = new BABYLON.Color3(1, 1, 1);
                if (Character.GLOVE_GLOW[id] != null) GameWorld.addGlow(m, Character.GLOVE_GLOW[id]);
            } else if (part === 'Glove' && Character.GLOVE_SELF_LIGHT[id]) {
                const e = Character.GLOVE_SELF_LIGHT[id];
                for (const x of mats) x.emissiveColor = new BABYLON.Color3(e, e, e);
            }
            for (const x of mats) if (x.alpha < 1) x.needDepthPrePass = true;
        }
    }

    // Перчатка из примитивов: тёмная палка вдоль +X, ладонь на конце (ладонь — к −Z, сторона удара).
    _primitiveGlove(id) {
        const scene = this.scene;
        const root = new BABYLON.Mesh('c' + this.id + '/glove', scene);
        const col = Character.color3(Character.GLOVE_COLORS[id] != null ? Character.GLOVE_COLORS[id] : 0xffffff);
        const hand = new BABYLON.StandardMaterial(root.name + '/hand', scene);
        hand.diffuseColor = col;
        hand.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const dark = new BABYLON.StandardMaterial(root.name + '/stick', scene);
        dark.diffuseColor = new BABYLON.Color3(0.16, 0.14, 0.13);
        dark.specularColor = new BABYLON.Color3(0, 0, 0);
        const P = (mesh, x, y, z, mat) => { mesh.parent = root; mesh.position = new BABYLON.Vector3(x, y, z); mesh.material = mat; return mesh; };
        const stick = BABYLON.MeshBuilder.CreateCylinder(root.name + '/s', { height: 48, diameter: 7, tessellation: 8 }, scene);
        stick.rotation.z = -Math.PI / 2;
        P(stick, 22, 0, 0, dark);
        P(BABYLON.MeshBuilder.CreateBox(root.name + '/palm', { width: 30, height: 32, depth: 13 }, scene), 58, 2, 0, hand);
        for (let i = 0; i < 4; i++) {
            const f = BABYLON.MeshBuilder.CreateBox(root.name + '/f' + i, { width: 24 - Math.abs(i - 1.5) * 3, height: 7.5, depth: 10 }, scene);
            P(f, 84 - Math.abs(i - 1.5) * 1.5, -10.5 + i * 8, 0, hand);
        }
        const th = BABYLON.MeshBuilder.CreateBox(root.name + '/th', { width: 18, height: 8, depth: 10 }, scene);
        th.rotation.z = 0.9;
        P(th, 50, 22, 0, hand);
        if (id === 'giant') root.scaling.setAll(1.8);   // модель «Гиганта» уже крупная, примитив — нет
        return root;
    }

    // --- Маска ---------------------------------------------------------------------------

    // Эмодзи-маска поверх лица (url PNG с alpha или ключ Character.MASKS), null — снять.
    // Появляется с «поп»-анимацией масштаба.
    setMask(url) {
        const src = url && Character.MASKS[url] ? Character.MASKS[url] : url;
        if (this.mask) { this.mask.dispose(false, false); this.mask = null; }
        if (this._maskMat) { this._maskMat.dispose(false, false); this._maskMat = null; }
        if (!src) return;
        const plane = BABYLON.MeshBuilder.CreatePlane('c' + this.id + '/maskPlane', { size: 78, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        plane.parent = this.maskNode;
        plane.rotation.y = Math.PI / 2;
        const mat = new BABYLON.StandardMaterial(plane.name + '/mat', this.scene);
        const rec = Character.textureRec(this.scene, src);
        if (rec.failed) { plane.dispose(); mat.dispose(); return; }
        rec.fails.push(() => { if (this.mask === plane) this.setMask(null); });
        const tex = rec.tex;
        mat.disableLighting = true;
        mat.emissiveTexture = tex;
        mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.opacityTexture = tex;
        mat.backFaceCulling = false;
        mat.metadata = { toon: false };
        plane.material = mat;
        plane.isPickable = false;
        this.mask = plane;
        this._maskMat = mat;
        this._maskT = 0;
        this.maskNode.scaling.setAll(0.01);
    }

    // --- Управление ------------------------------------------------------------------------

    // Намерение движения: направление на карте (dx, dy), длина 0..1 (больше 1 — режется).
    setMove(dx, dy) {
        const l = Math.hypot(dx, dy);
        const k = l > 1 ? 1 / l : 1;
        this.moveX = (dx || 0) * k;
        this.moveY = (dy || 0) * k;
    }

    // Повернуться к точке (на время, в секундах; по умолчанию — один кадр).
    faceTo(x, y, seconds) {
        this._faceTo = { x, y, until: Game.time + (seconds || 0) };
    }

    get speed() { return Math.hypot(this.vx, this.vy); }
    get alive() { return this.state !== 'dead'; }

    canAct() {
        const s = this.state;
        return s === 'idle' || s === 'run';
    }

    canSlap() { return this.canAct() && !this.slap && Game.time >= this.nextSlapAt; }

    // Можно ли шлёпнуть этого персонажа (не в полёте, не лежит, не под защитой появления).
    canBeSlapped() {
        const s = this.state;
        return s !== 'ragdoll' && s !== 'down' && s !== 'dead' && s !== 'falling' && !this.hidden &&
            Game.time >= this.shieldUntil && this.h > -200;
    }

    // Начать замах (зовёт GameCombat.trySlap). Тайминги — DESIGN §3 × скорость перчатки.
    startSlap(target, opts) {
        const st = GameCombat.gloveStats(this.glove);
        const sp = Math.max(0.2, (st.speed || 1) * this.mods.slapSpeed);
        this.slap = { t: 0, wind: 0.08 / sp, strike: 0.12 / sp, rec: 0.2 / sp, target: target || null, opts: opts || {}, hitDone: false };
        const total = this.slap.wind + this.slap.strike + this.slap.rec;
        this.nextSlapAt = Game.time + Math.max((st.cooldown || 0.55) * this.mods.cooldown, total * 0.85);
        this.state = 'slap';
        this.emoteName = null;
        Game.emit('swing', { char: this });
    }

    // Рывок по направлению (dx, dy) или по курсу. false — перезарядка или нельзя.
    dash(dx, dy) {
        if (!(this.state === 'idle' || this.state === 'run' || this.state === 'slap') || Game.time < this.nextDashAt) return false;
        // Гарантированный шлепок игрока: удар засчитывается сразу (по курсу замаха), мах руки
        // доигрывает в рывке. Шлепок бота рывком отменяется.
        if (!this._forceContact() && this.slap && !this.slap.hitDone) this.slap = null;
        const after = /** @type {string} */ (this.state);   // удар мог изменить состояние (способность «на шлепок»)
        if (after === 'dead' || after === 'ragdoll') return false;
        let x = dx, y = dy;
        if (!x && !y) { x = Math.cos(this.heading); y = Math.sin(this.heading); }
        const l = Math.hypot(x, y) || 1;
        this.dashX = x / l; this.dashY = y / l;
        this.heading = Math.atan2(this.dashY, this.dashX);
        this.dashT = GameCfg.dashTime;
        this.nextDashAt = Game.time + GameCfg.dashCooldown * this.mods.dashCooldown;
        this.state = 'dash';
        Game.emit('dash', { char: this });
        return true;
    }

    dashCooldownLeft() { return Math.max(0, this.nextDashAt - Game.time); }

    jump(speed) {
        if (!this.onGround || !this.canAct()) return false;
        this.vh = speed || 620;
        this.onGround = false;
        return true;
    }

    // Эмоция ботов: 'dance' | 'wave' | 'jump' | 'cheer' | 'sit' | 'laugh' | 'point' на seconds (по умолчанию 3 с).
    emote(name, seconds) {
        this.emoteName = name || null;
        this.emoteUntil = Game.time + (seconds || 3);
        if (name === 'jump') this.jump(560);
    }

    // Отбрасывание (px/с по карте и вверх) -> полёт ragdoll; stun — минимум «оглушения», с.
    knockback(vx, vy, vh, stun) {
        if (this.state === 'dead') return;
        const was = this.state;
        if (was !== 'ragdoll' && was !== 'down') this._q.copyFrom(this.body.rotationQuaternion);
        this.slap = null;
        this.dashT = 0;
        this.emoteName = null;
        this.state = 'ragdoll';
        this.vx = vx || 0;
        this.vy = vy || 0;
        this.vh = vh || 0;
        if (this.vh > 0) { this.onGround = false; this.h += 2; }
        this.stunT = stun == null ? GameCfg.stun : stun;
        this._groundedOnce = false;
        // Кувырок: ось поперёк полёта (в осях корпуса) + немного случайного вращения.
        const hd = this.heading, c = Math.cos(hd), s = Math.sin(hd);
        const sp = Math.hypot(this.vx, this.vy) || 1;
        const a = (this.vx * c + this.vy * s) / sp, b = (-this.vx * s + this.vy * c) / sp;
        const sign = Math.random() < 0.5 ? -1 : 1;
        this._spinAxis.set(b + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.9, -a + (Math.random() - 0.5) * 0.6).normalize().scaleInPlace(sign);
        this._spin = 6 + sp / 200 + Math.random() * 4;
        // Конечности — толчок пружинам.
        for (const k of ['aLx', 'aRx', 'aLz', 'aRz', 'lLz', 'lRz', 'hZ']) this.V[k] += (Math.random() - 0.5) * 30;
    }

    // Мгновенно в точку (смена зоны, респаун): скорость 0, стоит, видим.
    teleport(x, y, h, heading) {
        this.x = x; this.y = y;
        const fh = GameWorld.floorAt(x, y);
        this.h = h != null ? h : (fh != null ? fh : 0);
        if (heading != null) this.heading = heading;
        this.vx = this.vy = this.vh = 0;
        this.moveX = this.moveY = 0;
        this.onGround = fh != null && this.h <= fh + 1;
        this.slap = null;
        this.dashT = 0;
        this.state = 'idle';
        this.emoteName = null;
        this._q.copyFrom(BABYLON.Quaternion.Identity());
        Object.assign(this.P, Character.basePose());
        Object.assign(this.V, Character.basePose(0));
        this.root.setEnabled(!this.hidden);
        this._applyTransforms();
    }

    // Появление (после KO или входа в зону): телепорт + защита + событие respawn.
    respawn(x, y, heading) {
        this.teleport(x, y, null, heading);
        this.shieldUntil = Game.time + GameCfg.spawnShield;
        this.lastHitBy = null;
        this.zone = GameWorld.zoneAt(x, y, 300) || this.zone;
        Game.emit('respawn', { char: this, zone: this.zone });
    }

    setHidden(on) {
        this.hidden = !!on;
        this.root.setEnabled(!this.hidden && this.state !== 'dead');
    }

    // Пузырь чата над головой (рисует GameUI).
    say(text) {
        if (typeof GameUI !== 'undefined' && typeof GameUI.bubble === 'function') GameUI.bubble(this, text);
    }

    // Точка над головой на экране (CSS px): { x, y, visible, behind } — для бейджа и пузыря.
    headScreenPos(extra) {
        return this.view.projectToScreen(this.x, this.y, this.h + this.P.by + 118 + (extra || 0));
    }

    // --- Кадр: физика ------------------------------------------------------------------

    step(dt) {
        if (this.state === 'dead' || this.disposed) return;
        const C = GameCfg;
        this.animT += dt;
        if (this.slap) this._stepSlap(dt);
        const st = this.state;
        if (st === 'dash') {
            this.dashT -= dt;
            this.vx = this.dashX * C.dashSpeed;
            this.vy = this.dashY * C.dashSpeed;
            if (this.dashT <= 0) {
                this.state = 'idle';
                const k = C.runSpeed / C.dashSpeed;
                this.vx *= k; this.vy *= k;
            }
        } else if (st === 'idle' || st === 'run' || st === 'slap') {
            const maxS = C.runSpeed * this.speedMul * this.mods.speed * (st === 'slap' ? 0.7 : 1);
            const tx = this.moveX * maxS, ty = this.moveY * maxS;
            const moving = this.moveX !== 0 || this.moveY !== 0;
            let acc = (moving ? C.accel : C.decel) * dt;
            if (!this.onGround) acc *= C.airControl;
            const dx = tx - this.vx, dy = ty - this.vy, d = Math.hypot(dx, dy);
            if (d <= acc) { this.vx = tx; this.vy = ty; } else { this.vx += dx / d * acc; this.vy += dy / d * acc; }
            // Курс: к цели шлепка / faceTo, иначе — по движению.
            let want = null, rate = C.turnRate;
            const s = this.slap;
            if (s && s.target && s.t < s.wind + s.strike) { want = Math.atan2(s.target.y - this.y, s.target.x - this.x); rate = 34; }
            else if (this._faceTo) { want = Math.atan2(this._faceTo.y - this.y, this._faceTo.x - this.x); rate = 22; if (Game.time > this._faceTo.until) this._faceTo = null; }
            else if (moving && Math.hypot(this.moveX, this.moveY) > 0.08) want = Math.atan2(this.moveY, this.moveX);
            if (want != null) this.heading = Character.turn(this.heading, want, rate * dt);
            if (st !== 'slap') this.state = this.speed > 40 && this.onGround ? 'run' : 'idle';
        } else {
            // ragdoll / down / getup / falling — без управления; на земле — трение.
            if (this.onGround) {
                const sp = this.speed, fr = C.friction * this.mods.friction * (st === 'ragdoll' ? 1 : 3) * dt;
                if (sp <= fr) { this.vx = 0; this.vy = 0; } else { this.vx -= this.vx / sp * fr; this.vy -= this.vy / sp * fr; }
            } else if (st === 'falling') {
                const dx = this.moveX * C.runSpeed * 0.5 - this.vx, dy = this.moveY * C.runSpeed * 0.5 - this.vy;
                this.vx += dx * Math.min(1, dt * 1.5); this.vy += dy * Math.min(1, dt * 1.5);
            }
        }
        // Вертикаль и перемещение.
        if (!this.onGround) this.vh -= C.gravity * this.mods.gravity * dt;
        const prevH = this.h;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.h += this.vh * dt;
        // Препятствия.
        if (this.h > -300 && GameWorld.colliders.length) {
            const r = GameWorld.resolveCollision(this.x, this.y, C.charRadius, this.h);
            if (r.hit) {
                this.x = r.x; this.y = r.y;
                const vn = this.vx * r.nx + this.vy * r.ny;
                if (vn < 0) {
                    const k = this.state === 'ragdoll' ? 1.4 : 1;
                    this.vx -= k * vn * r.nx; this.vy -= k * vn * r.ny;
                }
            }
        }
        // Пол: приземление только сверху (снизу острова — дальше в бездну).
        const fh = GameWorld.floorAt(this.x, this.y);
        if (fh !== null && this.h <= fh && (prevH >= fh - 80 || this.onGround)) this._land(fh);
        else if (fh === null || this.h > fh + 0.5) this.onGround = false;
        if (this.onGround && fh !== null) this.h = fh;
        // Сошёл с края — падение в бездну.
        if (!this.onGround && fh === null && this.h < -140 && this.state !== 'ragdoll' && this.state !== 'falling') {
            this.state = 'falling';
            this.slap = null;
        }
        this._stepTimers(dt);
        if (this.h < C.koHeight) this._ko();
    }

    _land(fh) {
        const impact = -this.vh;
        if (this.state === 'ragdoll') {
            if (impact > GameCfg.bounceMin) {
                this.h = fh + 0.5;
                this.vh = impact * GameCfg.bounce;
                this.vx *= 0.72; this.vy *= 0.72;
                this._spin *= 0.55;
                this.onGround = false;
                Game.emit('land', { char: this, speed: impact });
                return;
            }
            this.h = fh; this.vh = 0; this.onGround = true;
            if (!this._groundedOnce) {
                this._groundedOnce = true;
                this._pickLie();
                if (impact > 120) Game.emit('land', { char: this, speed: impact });
            }
            return;
        }
        const was = this.onGround;
        this.h = fh; this.vh = 0; this.onGround = true;
        if (this.state === 'falling') this.state = 'idle';
        if (!was && impact > 200) Game.emit('land', { char: this, speed: impact });
        if (!was && this.emoteName === 'jump' && Game.time < this.emoteUntil) { this.vh = 560; this.onGround = false; }
    }

    // Куда лечь после полёта: на спину (лицо вверх) или ничком — что ближе к текущей позе.
    _pickLie() {
        const m = new BABYLON.Matrix();
        this._q.toRotationMatrix(m);
        const up = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0, 1, 0), m);
        const fw = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(1, 0, 0), m);
        let ux = up.x, uz = up.z;
        if (Math.hypot(ux, uz) < 0.05) { ux = -fw.x; uz = -fw.z; }
        if (fw.y >= 0) BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(uz, -ux), 0, Math.PI / 2, this._qLie);
        else BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(-uz, ux), 0, -Math.PI / 2, this._qLie);
    }

    _stepTimers(dt) {
        const st = this.state;
        if (st === 'ragdoll') {
            this.stunT -= dt;
            if (this.onGround && this.stunT <= 0 && this.speed < 60) { this.state = 'down'; this.downT = GameCfg.downTime; this._pickLie(); }
        } else if (st === 'down') {
            this.downT -= dt;
            if (this.downT <= 0) { this.state = 'getup'; this.getupT = 0; this._q.copyFrom(this.body.rotationQuaternion); }
        } else if (st === 'getup') {
            this.getupT += dt;
            if (this.getupT >= GameCfg.getupTime) { this.state = 'idle'; this._q.copyFrom(BABYLON.Quaternion.Identity()); }
        }
        if (this.emoteName && Game.time > this.emoteUntil) this.emoteName = null;
    }

    // Момент контакта шлепка, с от начала замаха (рука проходит перед корпусом).
    _slapContactT(s) { return s.wind + s.strike * GameCfg.slapContact; }

    _stepSlap(dt) {
        const s = this.slap;
        s.t += dt;
        const hitT = this._slapContactT(s);
        // Примагничивание игрока к цели во время замаха (гарантированный шлепок).
        if (s.opts && s.opts.forced && !s.hitDone && s.target && s.t < hitT && this.onGround) {
            const dx = s.target.x - this.x, dy = s.target.y - this.y, d = Math.hypot(dx, dy);
            const want = GameCombat.range(this) * 0.62;
            if (d > want) {
                const step = Math.min(d - want, GameCfg.slapMagnet * dt / Math.max(0.04, hitT));
                this.x += dx / d * step; this.y += dy / d * step;
            }
        }
        if (!s.hitDone && s.t >= hitT) {
            s.hitDone = true;
            GameCombat.contact(this, s);
        }
        if (this.slap === s && s.t >= s.wind + s.strike + s.rec) {
            this.slap = null;
            if (this.state === 'slap') this.state = 'idle';
        }
    }

    // Гарантированный шлепок (игрок) ещё не дошёл до контакта — засчитать попадание сейчас
    // (рывок или другое действие не отменяет «гарантированное» попадание).
    _forceContact() {
        const s = this.slap;
        if (!s || s.hitDone || !(s.opts && s.opts.forced)) return false;
        s.hitDone = true;
        GameCombat.contact(this, s);
        return true;
    }

    _ko() {
        const t = Game.time;
        const killer = this.lastHitBy && this.lastHitBy !== this && t - this.lastHitTime <= GameCfg.koCredit ? this.lastHitBy : null;
        this.state = 'dead';
        this.slap = null;
        this.vx = this.vy = this.vh = 0;
        this.root.setEnabled(false);
        if (this.mask) this.setMask(null);
        Game.emit('ko', { victim: this, killer });
    }

    // Мягкое расталкивание стоящих персонажей (зовёт Game после step всех).
    static separate(list, dt) {
        const R = GameCfg.charRadius * 2, k = Math.min(1, GameCfg.pushRate * dt);
        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (a.state === 'dead' || a.state === 'ragdoll' || a.hidden) continue;
            for (let j = i + 1; j < list.length; j++) {
                const b = list[j];
                if (b.state === 'dead' || b.state === 'ragdoll' || b.hidden || Math.abs(a.h - b.h) > 150) continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                if (dx > R || dx < -R || dy > R || dy < -R) continue;
                const d = Math.hypot(dx, dy);
                if (d >= R) continue;
                const nx = d > 0.01 ? dx / d : Math.cos(a.id + b.id), ny = d > 0.01 ? dy / d : Math.sin(a.id + b.id);
                const push = (R - d) * 0.5 * k;
                a.x -= nx * push; a.y -= ny * push;
                b.x += nx * push; b.y += ny * push;
            }
        }
    }

    // --- Кадр: анимация -------------------------------------------------------------------

    animate(dt) {
        if (this.state === 'dead' || this.disposed) return;
        const P = this.P, T = this.T, V = this.V;
        const t = this.animT, st = this.state, C = Character.COM_H;
        Object.assign(T, Character.BASE);
        T.by = C;
        let rate = 12;
        let spring = false;
        const breathe = Math.sin(t * 2.2);
        // Базовая стойка: дыхание, руки чуть в стороны, перчатка вперёд.
        T.by = C + breathe * 0.8;
        T.hZ = breathe * 0.02;
        T.aLx = 0.08 + breathe * 0.02; T.aLz = 0.04 * Math.sin(t * 1.1);
        // Правая рука с перчаткой — чуть в сторону и вперёд (перчатка видна сбоку справа, Character.GRIP_REST).
        T.aRx = -0.2 - breathe * 0.02; T.aRz = 0.3 + 0.04 * Math.sin(t * 1.1 + 1);
        const speed = this.speed, k = Math.min(1.2, speed / GameCfg.runSpeed);
        if (st === 'run' || ((st === 'idle' || st === 'slap') && speed > 40 && this.onGround)) {
            this.runPhase += speed * dt * (Math.PI * 2 / 230);
            const sw = Math.sin(this.runPhase), kk = Math.min(1, k);
            T.lLz = sw * 0.85 * kk; T.lRz = -sw * 0.85 * kk;
            T.aLz = -sw * 0.75 * kk; T.aRz = sw * 0.7 * kk + 0.1;
            T.aLx = 0.14; T.aRx = -0.14;
            T.bLz = -0.13 * kk;
            T.by = C + Math.abs(Math.cos(this.runPhase)) * 6 * kk - 2;
            T.bYaw = sw * 0.08 * kk; T.tY = -sw * 0.12 * kk;
            rate = 16;
        }
        if (!this.onGround && (st === 'idle' || st === 'run' || st === 'slap')) {
            T.aLx = 0.9; T.aRx = -0.9; T.aLz = 0.3; T.aRz = 0.35; T.lLz = 0.5; T.lRz = -0.3; T.by = C;
        }
        if (st === 'dash') {
            T.bLz = -0.5; T.aLz = -1.1; T.aRz = -0.9; T.aLx = 0.3; T.aRx = -0.3; T.lLz = 0.75; T.lRz = -0.6; T.by = C - 6;
            rate = 22;
        }
        if (st === 'falling') {
            const w = t * 15;
            T.aLx = 2.5 + Math.sin(w) * 0.45; T.aRx = -(2.5 + Math.sin(w + 1.3) * 0.45);
            T.aLz = Math.sin(w * 0.7) * 0.4; T.aRz = Math.cos(w * 0.7) * 0.4;
            T.lLz = Math.sin(t * 11) * 0.8; T.lRz = -Math.sin(t * 11) * 0.8;
            T.bLz = 0.35; T.hZ = 0.35;
            rate = 18;
        }
        if (this.emoteName && (st === 'idle' || st === 'run')) this._emotePose(T, t);
        if (st === 'ragdoll' || st === 'down') {
            spring = st === 'ragdoll' && !this.onGround;
            const ph = this._phase;
            if (spring) {
                T.aLx = 1.4 + Math.sin(t * 7 + ph[0]) * 1.0; T.aRx = -(1.4 + Math.sin(t * 6.3 + ph[1]) * 1.0);
                T.aLz = Math.sin(t * 5 + ph[2]) * 1.4; T.aRz = Math.cos(t * 5.5 + ph[3]) * 1.4;
                T.lLz = Math.sin(t * 6 + ph[4]) * 0.9; T.lRz = -Math.sin(t * 6.6 + ph[5]) * 0.9;
                T.lLx = 0.35; T.lRx = -0.35; T.hZ = Math.sin(t * 4 + ph[6]) * 0.4;
                T.by = C;
            } else {
                T.aLx = 1.15; T.aRx = -1.15; T.aLz = 0.3; T.aRz = 0.2; T.lLx = 0.18; T.lRx = -0.18; T.lLz = 0.1; T.lRz = -0.1;
                T.by = Character.LIE_H; rate = 10;
            }
        }
        if (st === 'getup') {
            const u = Math.min(1, this.getupT / GameCfg.getupTime);
            T.by = Character.LIE_H + (C - Character.LIE_H) * Character.ease(u);
            T.aLz = -0.7 * (1 - u); T.aRz = -0.7 * (1 - u); T.lLz = 0.6 * (1 - u); T.lRz = 0.2 * (1 - u);
            rate = 14;
        }
        // Шлепок поверх: плоский мах правой рукой поперёк корпуса. Рука поднята вперёд почти
        // горизонтально (aRz) с самого замаха, мах ведёт поворот плеча (aRy) и корпуса (tY):
        // замах — рука вперёд-вправо, удар — через центр (момент контакта) вперёд-влево,
        // возврат — вниз в стойку. Кисть (grip) поворачивается против подъёма руки (вес gw):
        // палка продолжает линию руки, ладонь (−Z перчатки) смотрит по ходу удара.
        const s = this.slap;
        let slapK = 0, gw = 0;
        if (s) {
            const e = Character.ease, A = Character.SLAP_POSE;
            const se = s.wind + s.strike;
            if (s.t < s.wind) {
                const u = e(s.t / s.wind);
                T.aRz = A.armUp; T.aRx = 0; T.aRy = A.yawFrom * u; T.tY = A.torsoFrom * u;
                T.aLz = 0.25 * u; T.aLx = 0.22;
                slapK = 1;
            } else if (s.t < se) {
                const u = e((s.t - s.wind) / s.strike), arc = Math.sin(Math.PI * u);
                T.aRz = A.armUp + A.arc * arc; T.aRx = 0;
                T.aRy = A.yawFrom + (A.yawTo - A.yawFrom) * u; T.tY = A.torsoFrom + (A.torsoTo - A.torsoFrom) * u;
                T.aLz = 0.25 - 0.65 * u; T.aLx = 0.3; T.bLz -= A.lean * arc;
                slapK = 2;
            } else {
                const u = e((s.t - se) / s.rec);
                T.aRz = A.armUp + (T.aRz - A.armUp) * u; T.aRx *= u;
                T.aRy = A.yawTo * (1 - u); T.tY = A.torsoTo * (1 - u) + T.tY * u;
                slapK = 3;
                gw = 1 - u;
            }
            if (slapK < 3) gw = 1;
        }
        this._gw += (gw - this._gw) * Math.min(1, dt * (gw > this._gw ? 60 : 20));
        // Смешивание: пружины в полёте, иначе экспонента к цели.
        if (spring) {
            const K = 150, D = 9;
            for (const key in T) {
                if (key === 'by' || key === 'bLx' || key === 'bLz' || key === 'bYaw') { P[key] += (T[key] - P[key]) * Math.min(1, dt * 10); continue; }
                V[key] += (K * (T[key] - P[key]) - D * V[key]) * dt;
                P[key] += V[key] * dt;
            }
        } else {
            // Рука шлепка: замах — быстрое смешивание, удар — точно по кривой (момент контакта
            // совпадает с позой), возврат — мягче обычного.
            const a = 1 - Math.exp(-rate * dt), af = 1 - Math.exp(-48 * dt);
            for (const key in T) {
                const arm = slapK > 0 && (key === 'aRx' || key === 'aRy' || key === 'aRz' || key === 'tY');
                P[key] += (T[key] - P[key]) * (!arm ? a : slapK === 1 ? af : slapK === 2 ? 1 : Math.min(1, a * 1.6));
                V[key] = 0;
            }
        }
        // Корпус: кватернион.
        const q = this.body.rotationQuaternion;
        if (st === 'ragdoll') {
            if (!this.onGround) {
                BABYLON.Quaternion.RotationAxisToRef(this._spinAxis, this._spin * dt, Character._tmpQ);
                this._q.multiplyInPlace(Character._tmpQ);
                this._q.normalize();
            } else {
                BABYLON.Quaternion.SlerpToRef(this._q, this._qLie, Math.min(1, dt * 12), this._q);
            }
            q.copyFrom(this._q);
        } else if (st === 'down') {
            BABYLON.Quaternion.SlerpToRef(this._q, this._qLie, Math.min(1, dt * 12), this._q);
            q.copyFrom(this._q);
        } else if (st === 'getup') {
            const u = Character.ease(Math.min(1, this.getupT / GameCfg.getupTime));
            BABYLON.Quaternion.RotationYawPitchRollToRef(P.bYaw, P.bLx, P.bLz, this._qUp);
            BABYLON.Quaternion.SlerpToRef(this._q, this._qUp, u, q);
        } else {
            BABYLON.Quaternion.RotationYawPitchRollToRef(P.bYaw, P.bLx, P.bLz, q);
        }
        // Маска: «поп».
        if (this.mask) {
            this._maskT += dt;
            const u = Math.min(1, this._maskT / 0.28);
            const sc = u < 1 ? (u < 0.6 ? 1.3 * Character.ease(u / 0.6) : 1.3 - 0.3 * Character.ease((u - 0.6) / 0.4)) : 1;
            this.maskNode.scaling.setAll(Math.max(0.01, sc));
        }
        // Пропеллеры аксессуаров (propeller_cap).
        for (const sp of this._spinners) sp.rotation.y += dt * Character.SPIN_RATE;
        this._applyTransforms();
    }

    _emotePose(T, t) {
        const n = this.emoteName, C = Character.COM_H;
        if (n === 'wave') {
            T.aRx = -2.65 + Math.sin(t * 10) * 0.3; T.aRz = 0.15; T.aRy = 0; T.hZ = 0.08;
        } else if (n === 'dance') {
            const b = Math.sin(t * 8);
            T.bYaw = Math.sin(t * 4) * 0.45; T.by = C + Math.abs(b) * 10;
            T.aLx = 1.2 + b * 0.6; T.aRx = -(1.2 - b * 0.6); T.aLz = Math.sin(t * 4) * 0.8; T.aRz = -Math.sin(t * 4) * 0.8;
            T.lLz = b * 0.3; T.lRz = -b * 0.3; T.hY = Math.sin(t * 4) * 0.3;
        } else if (n === 'cheer') {
            const b = Math.abs(Math.sin(t * 7));
            T.aLx = 2.6 + b * 0.2; T.aRx = -2.6 - b * 0.2; T.by = C + b * 8; T.hZ = 0.2;
        } else if (n === 'jump' && !this.onGround) {
            T.aLx = 2.4; T.aRx = -2.4; T.lLz = 0.4; T.lRz = -0.4;
        } else if (n === 'sit') {
            // Сидит на земле (боты AFK): таз у пола, ноги вперёд, руки на коленях, голова чуть вниз.
            T.by = 42 + Math.sin(t * 2.2) * 0.6; T.lLz = 1.5; T.lRz = 1.5; T.lLx = 0.06; T.lRx = -0.06;
            T.aLz = 0.42; T.aRz = 0.5; T.aLx = 0.1; T.aRx = -0.12; T.hZ = -0.08;
        } else if (n === 'laugh') {
            // Смеётся: откинулся назад, трясётся, руки на животе.
            const b = Math.sin(t * 16);
            T.bLz = 0.12 + b * 0.04; T.by = C + Math.abs(b) * 3; T.hZ = 0.24 + b * 0.06;
            T.aLz = 0.55; T.aLx = -0.22; T.aRz = 0.6; T.aRx = 0.22;
        } else if (n === 'pose') {
            // Поза ауры: корпус развёрнут, голова назад, рука к небу, вторая на поясе, ноги шире.
            const b = Math.sin(t * 5);
            T.tY = 0.35; T.bYaw = -0.25; T.hZ = 0.2; T.hY = 0.3;
            T.aLx = 2.5; T.aLz = 0.2; T.aRx = -0.6; T.aRz = -0.9 + b * 0.04;
            T.lLz = 0.18; T.lRz = -0.18; T.by = C - 4 + b * 1.2;
        } else if (n === 'point') {
            // Показывает левой рукой вперёд (правая держит перчатку).
            T.aLz = 1.5 + Math.sin(t * 6) * 0.05; T.aLx = 0.05; T.tY = 0.12; T.hZ = 0.05;
        }
    }

    _applyTransforms() {
        const P = this.P, J = this.joints;
        this.root.position.set(this.x, this.h, this.y);
        this.root.rotation.y = -this.heading;
        this.body.position.y = P.by;
        J.torso.rotation.set(0, P.tY, P.tZ);
        J.head.rotation.set(0, P.hY, P.hZ);
        J.armL.rotation.set(P.aLx, P.aLy, P.aLz);
        J.armR.rotation.set(P.aRx, P.aRy, P.aRz);
        // Кисть: в шлепке (вес _gw) палка продолжает линию руки; в покое — поза GRIP_REST
        // (перчатка вправо-вперёд и приподнята, ладонью по ходу удара).
        const gw = this._gw, rest = 1 - gw, G = Character.GRIP_REST;
        this.grip.rotation.set(G.x * rest, G.y * rest, -P.aRz * gw + G.z * rest);
        J.legL.rotation.set(P.lLx, 0, P.lLz);
        J.legR.rotation.set(P.lRx, 0, P.lRz);
    }

    // Убрать персонажа со сцены (меши, свои материалы; общие текстуры остаются).
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (this._gloveRoot) this._disposeTree(this._gloveRoot);
        this._gloveRoot = null;
        this.setMask(null);
        for (const m of this.meshes.slice()) this._dropMesh(m);
        this.meshes = [];
        if (this._cloth) Character.clothRelease(this._cloth);
        this._cloth = null;
        this.root.dispose(false, false);
    }

    // --- Утилиты ---------------------------------------------------------------------------

    static ease(u) { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); }

    // Повернуть угол a к b не больше чем на step (радианы).
    static turn(a, b, step) {
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) <= step) return b;
        return a + Math.sign(d) * step;
    }

    static color3(v) {
        if (v instanceof BABYLON.Color3) return v.clone();
        return World3D.hexColor3(v);
    }

    // Текстура по url, общая на сцену: { tex, failed, fails: [колбэки ошибки] }. Не
    // загрузилась — колбэки снимают её с материалов (иначе материал «не готов» навсегда).
    static textureRec(scene, url) {
        const key = scene.uid + '|' + url;
        let rec = Character._tex.get(key);
        if (!rec) {
            const r = rec = { tex: null, failed: false, fails: [] };
            r.tex = new BABYLON.Texture(url, scene, { invertY: true, samplingMode: BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                onError: () => {
                    r.failed = true;
                    console.warn('Character: текстура не загрузилась — ' + url);
                    for (const fn of r.fails) { try { fn(); } catch (e) { /* ok */ } }
                    r.fails = [];
                } });
            r.tex.hasAlpha = true;
            Character._tex.set(key, rec);
        }
        return rec;
    }

    // Лицо: ключ Character.FACES или url; нет файла — нарисованная улыбка.
    static faceTexture(scene, face, mats) {
        const url = Character.FACES[face] || (typeof face === 'string' && /\.(png|webp|jpg)$/i.test(face) ? face : null);
        if (!url) return Character.smileTexture(scene);
        const rec = Character.textureRec(scene, url);
        if (rec.failed) return Character.smileTexture(scene);
        rec.fails.push(() => {
            const sm = Character.smileTexture(scene);
            for (const m of mats || []) if (/** @type {any} */ (m).diffuseTexture === rec.tex) /** @type {any} */ (m).diffuseTexture = sm;
        });
        return rec.tex;
    }

    // Нарисованная классическая улыбка (запасное лицо).
    static smileTexture(scene) {
        const key = scene.uid + '|smile';
        const rec = Character._tex.get(key);
        if (rec) return rec.tex;
        const S = 256;
        const tex = new BABYLON.DynamicTexture('face-smile', { width: S, height: S }, scene, true);
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        ctx.clearRect(0, 0, S, S);
        ctx.fillStyle = '#141414';
        ctx.beginPath(); ctx.ellipse(S * 0.36, S * 0.38, S * 0.045, S * 0.085, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(S * 0.64, S * 0.38, S * 0.045, S * 0.085, 0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = S * 0.045; ctx.lineCap = 'round'; ctx.strokeStyle = '#141414';
        ctx.beginPath(); ctx.arc(S * 0.5, S * 0.5, S * 0.22, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
        tex.hasAlpha = true;
        tex.update(true);
        Character._tex.set(key, { tex, failed: false, fails: [] });
        return tex;
    }

    // Аватар для бейджа: голова цвета персонажа с улыбкой (dataURL, кэш по цвету); каталожная
    // внешность — Character.cosAvatar.
    static avatarFor(look) {
        if (Character.isCosLook(look)) return Character.cosAvatar(look);
        const c = (look && look.colors && look.colors.head) != null ? look.colors.head : Character.SKIN;
        const hex = typeof c === 'string' ? c : '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
        if (Character._avatars[hex]) return Character._avatars[hex];
        const S = 64, cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#9fd8ff'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hex;
        const r = 9, x0 = 13, y0 = 14, w = 38, h = 38;
        ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
        ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.fill();
        ctx.fillStyle = '#151515';
        ctx.fillRect(24, 26, 4, 7); ctx.fillRect(36, 26, 4, 7);
        ctx.lineWidth = 3; ctx.strokeStyle = '#151515'; ctx.beginPath(); ctx.arc(32, 34, 9, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
        return (Character._avatars[hex] = cv.toDataURL('image/png'));
    }

    // Картинка для аватара по url: загружена — элемент, иначе null (по загрузке Character.avatarVer++ —
    // владельцы аватаров перерисовывают: GameWardrobe — игрока и ботов).
    static avatarImage(url) {
        if (!url || typeof Image === 'undefined') return null;
        let r = Character._avImgs.get(url);
        if (!r) {
            const img = new Image();
            /** @type {{ img: HTMLImageElement, ok: boolean }} */
            const rr = r = { img, ok: false };
            img.onload = () => { rr.ok = true; Character.avatarVer++; };
            img.onerror = () => { /* нет файла — рисуется без неё */ };
            img.src = url;
            Character._avImgs.set(url, r);
        }
        return r.ok ? r.img : null;
    }

    // Аватар каталожной внешности (64 px, dataURL): плечи цвета рубашки, голова цвета кожи с лицом,
    // причёска (силуэт по модели и цвету), шапка — иконка вещи (нет — силуэт цветом), очки.
    static cosAvatar(look) {
        if (typeof document === 'undefined') return '';
        const I = (id) => Character.cosItem(id);
        const face = I(look.face), hair = I(look.hair), hat = I(look.hat), shirt = I(look.shirt), glasses = I(look.glasses);
        const skin = look.skin != null ? look.skin : Character.SKIN;
        const fImg = face && face.texture ? Character.avatarImage(face.texture) : null;
        const hImg = hat ? Character.avatarImage(hat.icon) : null;
        const hideHair = Character.hatHidesHair(hat, hair);
        const key = ['cos', Character.hex(skin), look.face, hideHair ? '' : look.hair, look.hat, look.glasses, look.shirt, fImg ? 1 : 0, hImg ? 1 : 0].join('|');
        if (Character._avatars[key]) return Character._avatars[key];
        const S = 64, cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        if (!ctx) return '';
        const hx = (v) => '#' + Character.hex(v);
        const mix = (a, b, k) => BABYLON.Color3.Lerp(World3D.hexColor3(a), World3D.hexColor3(b), k).toHexString();
        const rr = (x, y, w, h, r) => {
            ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
        };
        const tone = shirt && shirt.tone != null ? shirt.tone : 0xe76b19;
        ctx.save();
        ctx.beginPath(); ctx.arc(32, 32, 32, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = mix(tone, 0xffffff, 0.6); ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = hx(tone); rr(6, 50, 52, 24, 8); ctx.fill();
        const style = hair && !hideHair && hair.model ? String(hair.model).replace(/^.*acc_hair_|\.glb$/g, '') : '';
        const hc = hair && hair.color != null ? hx(hair.color) : '#3b2616';
        if (style === 'long' || style === 'curly' || style === 'afro') {
            ctx.fillStyle = hc;
            if (style === 'afro') { ctx.beginPath(); ctx.arc(32, 26, 27, 0, Math.PI * 2); ctx.fill(); }
            else { rr(9, 12, 46, style === 'long' ? 44 : 34, 10); ctx.fill(); }
        }
        ctx.fillStyle = hx(skin); rr(14, 13, 36, 36, 9); ctx.fill();
        if (fImg) ctx.drawImage(fImg, 14, 13, 36, 36);
        else {
            ctx.fillStyle = '#151515'; ctx.fillRect(24, 25, 4, 7); ctx.fillRect(36, 25, 4, 7);
            ctx.lineWidth = 3; ctx.strokeStyle = '#151515'; ctx.beginPath(); ctx.arc(32, 33, 9, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
        }
        if (style) {
            ctx.fillStyle = hc;
            if (style === 'spiky') {
                ctx.beginPath(); ctx.moveTo(12, 22);
                for (let i = 0; i <= 6; i++) ctx.lineTo(12 + i * 6.7, i % 2 ? 4 : 11);
                ctx.lineTo(52, 22); ctx.lineTo(49, 18); ctx.lineTo(15, 18); ctx.closePath(); ctx.fill();
            } else if (style === 'mohawk') {
                rr(26, 0, 12, 20, 5); ctx.fill();
            } else if (style === 'afro') {
                rr(12, 6, 40, 12, 6); ctx.fill();
            } else {
                rr(11, 8, 42, 12, 6); ctx.fill();
                const side = style === 'long' || style === 'pigtails' ? 30 : style === 'buzz' ? 4 : 14;
                ctx.fillRect(11, 13, 5, side); ctx.fillRect(48, 13, 5, side);
                if (style === 'bun') { ctx.beginPath(); ctx.arc(32, 5, 8, 0, Math.PI * 2); ctx.fill(); }
                if (style === 'pigtails') { ctx.beginPath(); ctx.arc(8, 40, 7, 0, Math.PI * 2); ctx.arc(56, 40, 7, 0, Math.PI * 2); ctx.fill(); }
            }
        }
        if (glasses) {
            ctx.fillStyle = glasses.color != null ? hx(glasses.color) : '#141414';
            if (/eyepatch/.test(glasses.model || '')) { ctx.beginPath(); ctx.arc(25, 28, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(14, 22, 36, 2); }
            else { rr(17, 23, 13, 9, 3); ctx.fill(); rr(34, 23, 13, 9, 3); ctx.fill(); ctx.fillRect(29, 25, 6, 2); }
        }
        if (hat) {
            if (hImg) ctx.drawImage(hImg, 11, -7, 42, 42);
            else { ctx.fillStyle = hat.color != null ? hx(hat.color) : '#c4281c'; rr(12, 4, 40, 15, 7); ctx.fill(); }
        }
        ctx.restore();
        return (Character._avatars[key] = cv.toDataURL('image/png'));
    }
}

Character._ids = 0;
Character._tex = new Map();
/** @type {Map<string, any>} композиты одежды (clothRec) */
Character._cloth = new Map();
/** @type {Map<string, { img: HTMLImageElement, ok: boolean, failed: boolean, cbs: Function[] }>} */
Character._clothImgs = new Map();
/** @type {Map<string, { img: HTMLImageElement, ok: boolean }>} */
Character._avImgs = new Map();
/** @type {Map<string, any> | null} */
Character._cosById = null;
Character.avatarVer = 0;            // растёт по загрузке картинок аватаров (перерисовать бейджи)
/** @type {Record<string, string>} */
Character._avatars = {};
Character._tmpQ = new BABYLON.Quaternion();
/** @type {any} */
Character.model = null;
// Геометрия рига (px модели, DESIGN §3 — не настройка): центр масс над ногами (шарнир
// корпуса body), высота центра лежащего, хват перчатки у низа RightArm (низ руки — 80).
// Тайминги лёжа/подъёма и подсветка — GAME_DOWN_TIME, GAME_GETUP_TIME, GAME_CHAR_LIFT.
Character.COM_H = 100;
Character.LIE_H = 22;
Character.HAND_Y = 82;
// Поза шлепка (радианы): armUp — рука вперёд (aRz, π/2 — горизонталь), arc — подъём в
// середине маха, yawFrom/yawTo — плечо (aRy: − вправо, + влево), torsoFrom/torsoTo — корпус
// (tY), lean — наклон вперёд в ударе. Мах проходит через центр (yaw плеча + корпуса = 0) в
// середине удара — там же момент контакта (GAME_SLAP_CONTACT = 0.5).
Character.SLAP_POSE = { armUp: 1.45, arc: 0.08, yawFrom: -1.0, yawTo: 0.85, torsoFrom: -0.3, torsoTo: 0.4, lean: 0.1 };
Character.BASE = { by: 100, bLx: 0, bLz: 0, bYaw: 0, tY: 0, tZ: 0, hY: 0, hZ: 0,
    aLx: 0, aLy: 0, aLz: 0, aRx: 0, aRy: 0, aRz: 0, lLx: 0, lLz: 0, lRx: 0, lRz: 0 };
// Шарниры частей по контракту (Babylon px: Blender (x, y, z) м -> (x, z, −y) × 100).
Character.PIVOTS = { torso: [0, 80, 0], head: [0, 160, 0], armL: [0, 150, -60], armR: [0, 150, 60], legL: [0, 80, -20], legR: [0, 80, 20] };
// Пропорции по умолчанию (множители шарниров): голова, толщина рук, толщина ног.
Character.PROPORTIONS = { head: 1.16, arm: 0.8, leg: 0.88 };
Character.PART_KEYS = { Torso: 'torso', Head: 'head', Face: 'face', LeftArm: 'armL', RightArm: 'armR', LeftLeg: 'legL', RightLeg: 'legR' };
Character.R6_URL = 'assets/models/char/r6.glb';
// Кожа по умолчанию (каталожная внешность без skin); стандартный вид игрока — GameWardrobe.
Character.SKIN = 0xf2c49b;
// Причёска -> шапки, под которыми она не помещается (tools/blender/char/accessories_back_hair.conflicts.json;
// стандартный пробор не прячем — небольшое касание короны/цилиндра лучше лысой головы).
/** @type {Record<string, string>} */
Character.HAIR_HAT_CONFLICTS = {
    hair_spiky: 'beanie bunny_ears cap cat_ears chef_hat cowboy crown flower_crown hardhat headphones party_hat pirate_hat propeller_cap santa_hat tophat viking wizard headphones_neon snapback bucket',
    hair_mohawk: 'beanie cap chef_hat cowboy crown hardhat headphones party_hat pirate_hat propeller_cap santa_hat tophat viking wizard headphones_neon snapback bucket',
    hair_afro: 'beanie bunny_ears cap cat_ears chef_hat cowboy crown flower_crown halo hardhat headphones horns party_hat pirate_hat propeller_cap santa_hat ski_goggles tophat viking wizard headphones_neon snapback bucket',
    hair_curly: 'beanie bunny_ears cap cat_ears chef_hat cowboy crown flower_crown hardhat headphones party_hat pirate_hat propeller_cap santa_hat ski_goggles tophat viking wizard headphones_neon snapback bucket',
    hair_bun: 'beanie bunny_ears cap cat_ears cowboy crown hardhat headphones party_hat pirate_hat propeller_cap viking headphones_neon snapback bucket',
    hair_ponytail: 'beanie cap chef_hat cowboy hardhat pirate_hat propeller_cap santa_hat tophat viking wizard snapback bucket',
    hair_pigtails: 'beanie cap chef_hat cowboy flower_crown hardhat headphones pirate_hat propeller_cap santa_hat tophat viking wizard headphones_neon snapback bucket',
};
/** @type {Record<string, number>} */
Character.HAT_OVER_HAIR = { acc_halo: 1, acc_halo_neon_cyan: 1, acc_halo_neon_pink: 1, acc_halo_double: 1 };
Character.SPIN_RATE = 16;            // рад/с: пропеллер шапки
Character.CLOTH_KEEP = 6;            // неиспользуемых композитов одежды в кэше
// Шаблон одежды Roblox 585×559 (px: x, y, w, h): торс; правый/левый рукав (у штанов — штанины).
// Стороны: U верх, D низ, F перёд, B спина, L/R — левая/правая сторона части (tools/blender/char/README.md).
/** @type {Record<string, Record<string, number[]>>} */
Character.CLOTH_UV = {
    torso: { U: [231, 8, 128, 64], R: [165, 74, 64, 128], F: [231, 74, 128, 128], L: [361, 74, 64, 128], B: [427, 74, 128, 128], D: [231, 204, 128, 64] },
    right: { U: [217, 289, 64, 64], L: [19, 355, 64, 128], B: [85, 355, 64, 128], R: [151, 355, 64, 128], F: [217, 355, 64, 128], D: [217, 485, 64, 64] },
    left: { U: [308, 289, 64, 64], F: [308, 355, 64, 128], L: [374, 355, 64, 128], B: [440, 355, 64, 128], R: [506, 355, 64, 128], D: [308, 485, 64, 64] },
};
// Запасной вид (старый формат: цвета частей) — фиолетовое худи и тёмные штаны (одежду-текстуры рисует арт-агент).
Character.BASE_LOOK = { colors: { head: Character.SKIN, torso: 0x7a3df0, leftArm: 0x7a3df0, rightArm: 0x7a3df0, leftLeg: 0x1c2a3a, rightLeg: 0x1c2a3a }, face: 'cool' };
// Лица (PNG с alpha, UV квадрата лица). Ключ -> файл.
Character.FACES = {
    smile: 'assets/textures/faces/face_smile.png',
    angry: 'assets/textures/faces/face_angry.png',
    cool: 'assets/textures/faces/face_cool.png',
    cute: 'assets/textures/faces/face_cute.png',
    derp: 'assets/textures/faces/face_derp.png',
    evil: 'assets/textures/faces/face_evil.png',
    girl: 'assets/textures/faces/face_girl.png',
    grin: 'assets/textures/faces/face_grin.png',
    happy: 'assets/textures/faces/face_happy.png',
    shocked: 'assets/textures/faces/face_shocked.png',
    silly: 'assets/textures/faces/face_silly.png',
    sleepy: 'assets/textures/faces/face_sleepy.png',
    smirk: 'assets/textures/faces/face_smirk.png',
    wink: 'assets/textures/faces/face_wink.png',
    worried: 'assets/textures/faces/face_worried.png',
};
// Эмодзи-маски Фонк Моментов. Ключ -> файл.
Character.MASKS = {
    clown: 'assets/textures/masks/mask_clown.png',
    cold: 'assets/textures/masks/mask_cold.png',
    cool: 'assets/textures/masks/mask_cool.png',
    cry_blue: 'assets/textures/masks/mask_cry_blue.png',
    devil: 'assets/textures/masks/mask_devil.png',
    dizzy: 'assets/textures/masks/mask_dizzy.png',
    fearful: 'assets/textures/masks/mask_fearful.png',
    grin_purple: 'assets/textures/masks/mask_grin_purple.png',
    grin_red: 'assets/textures/masks/mask_grin_red.png',
    grin_shadow: 'assets/textures/masks/mask_grin_shadow.png',
    scared_blue: 'assets/textures/masks/mask_scared_blue.png',
    mindblown: 'assets/textures/masks/mask_mindblown.png',
    moai: 'assets/textures/masks/mask_moai.png',
    money: 'assets/textures/masks/mask_money.png',
    ogre: 'assets/textures/masks/mask_ogre.png',
    scream: 'assets/textures/masks/mask_scream.png',
    skull: 'assets/textures/masks/mask_skull.png',
    smirk: 'assets/textures/masks/mask_smirk.png',
    sob: 'assets/textures/masks/mask_sob.png',
};
// Модели перчаток: id -> файл (литералы — для сборщика). Нет записи/файла — перчатка из примитивов.
/** @type {Record<string, string>} */
Character.GLOVE_URLS = {
    default: 'assets/models/gloves/glove_default.glb',
    slime: 'assets/models/gloves/glove_slime.glb',
    love: 'assets/models/gloves/glove_love.glb',
    ice: 'assets/models/gloves/glove_ice.glb',
    fire: 'assets/models/gloves/glove_fire.glb',
    bomb: 'assets/models/gloves/glove_bomb.glb',
    meteor: 'assets/models/gloves/glove_meteor.glb',
    tile: 'assets/models/gloves/glove_tile.glb',
    brainrot: 'assets/models/gloves/glove_brainrot.glb',
    ghost: 'assets/models/gloves/glove_ghost.glb',
    gravity: 'assets/models/gloves/glove_gravity.glb',
    speed: 'assets/models/gloves/glove_speed.glb',
    blackhole: 'assets/models/gloves/glove_blackhole.glb',
    giant: 'assets/models/gloves/glove_giant.glb',
    golden: 'assets/models/gloves/glove_golden.glb',
    diamond: 'assets/models/gloves/glove_diamond.glb',
    rainbow: 'assets/models/gloves/glove_rainbow.glb',
    neon: 'assets/models/gloves/glove_neon.glb',
    pixel: 'assets/models/gloves/glove_pixel.glb',
    dragon: 'assets/models/gloves/glove_dragon.glb',
};
// Цвет перчатки из примитивов (пока нет модели).
Character.GLOVE_COLORS = { default: 0xffffff, slime: 0x4cff3a, love: 0xff6fb5, ice: 0x8fe3ff, fire: 0xff5a1f, bomb: 0x222222,
    meteor: 0x5a3020, tile: 0xf2f6ff, brainrot: 0xc86bff, ghost: 0xeef6ff, gravity: 0x8a4dff, speed: 0x3fb8ff,
    blackhole: 0x2a0f45, giant: 0x8a5a35, golden: 0xffcc33, diamond: 0x9ef3ff };
// Цвет ореола GlowLayer узла Glow перчатки (нет записи — нет узла Glow); яркость цвета = сила
// ореола (README перчаток). GLOVE_SELF_LIGHT — слабый emissive руки («светящийся» призрак).
/** @type {Record<string, number>} */
Character.GLOVE_GLOW = { default: 0x1fb8c8, slime: 0x8ad028, love: 0xb83a7c, ice: 0x2ab8e0, fire: 0xff6a1a, bomb: 0xffb030, meteor: 0xe0560c, tile: 0x1aa8c0, brainrot: 0xc8307e, ghost: 0x4a8098, gravity: 0x8a5cff, speed: 0x8ad028, blackhole: 0xb83ec8, giant: 0x7ab020, golden: 0xd8b040, diamond: 0xa8d8f0, rainbow: 0x8070c0, neon: 0x8a4ae0, pixel: 0xd8a820, dragon: 0xe86010 };
/** @type {Record<string, number>} */
Character.GLOVE_SELF_LIGHT = { ghost: 0.3 };
// Кисть в покое (радианы, Euler шарнира grip в осях руки): z — палка вверх, y — вправо
// (−), x — поворот вокруг палки. Перчатка видна сбоку справа и приподнята (референс t_30, t_13).
Character.GRIP_REST = { x: 0, y: -0.95, z: 0.35 };
// Аксессуары: id -> файл acc_*.glb (origin в шарнире своей части).
/** @type {Record<string, string>} */
Character.ACCESSORY_URLS = {
    cap: 'assets/models/char/acc_cap.glb',
    tophat: 'assets/models/char/acc_tophat.glb',
    beanie: 'assets/models/char/acc_beanie.glb',
    crown: 'assets/models/char/acc_crown.glb',
    horns: 'assets/models/char/acc_horns.glb',
    cat_ears: 'assets/models/char/acc_cat_ears.glb',
    headphones: 'assets/models/char/acc_headphones.glb',
    hair_spiky: 'assets/models/char/acc_hair_spiky.glb',
    hair_long: 'assets/models/char/acc_hair_long.glb',
    hair_bob: 'assets/models/char/acc_hair_bob.glb',
    sunglasses: 'assets/models/char/acc_sunglasses.glb',
    backpack: 'assets/models/char/acc_backpack.glb',
    sword_back: 'assets/models/char/acc_sword_back.glb',
    wings: 'assets/models/char/acc_wings.glb',
};
