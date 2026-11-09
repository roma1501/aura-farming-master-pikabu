// GameFarm.js — «фарм ауры» (docs/RESKIN.md): три механики Aura Farming Master.
//
// 1. Зоны ауры. На арене светятся FARM_ZONES зоны (маркеры карты aurazone, aurazone-2 …:
//    центр, радиус scale[0] × 100; нет маркеров — точки внутри пола арены). Каждая переезжает
//    раз в FARM_LIFE_MIN..MAX с (за FARM_WARN с — предупреждение). Кто стоит в зоне на земле —
//    получает ауру раз в секунду; серия (время в зоне подряд) поднимает множитель x1…x5.
//    Шлепок сбивает серию и на FARM_LOCK с запрещает фарм; выбитый из зоны даёт ударившему
//    FARM_STEAL ауры. Боты фармят так же (GameBots ходит в зону через GameFarm.zoneAt/pointIn).
// 2. Поза ауры. Кнопка «Поза» (E): вокруг неё бежит стрелка, нажми ещё раз в окне —
//    «Идеально»: всплеск ауры (×2 в зоне) и Фонк Момент (GamePhonk.trigger с надписью).
//    Промах — ничего, только перезарядка.
// 3. Прокачка за ауру: «Скорость фарма», «Окно позы», «Сила шлепка» (save.up). Окно прокачки —
//    кнопка «Прокачка» в HUD. Аура тратится (Game.spendAura), рекорды и перчатки — по общей
//    заработанной (Game.auraTotal).
//
// API: zones(), zoneAt(x, y, pad), nearestZone(x, y), pointIn(zone, k), inZone(ch), multOf(streak),
// slapMult(ch), poseWindow(), openUpgrades(), state(). События: zoneMove {zone}, pose {perfect}.
// Debug (?debug): Game.debug.farm(), .pose(), .toZone(), .buy(id), .moveZones().

const FARM_ZONES = 2;                // зон на арене одновременно
const FARM_LIFE_MIN = 25;            // с: зона живёт на месте
const FARM_LIFE_MAX = 35;
const FARM_WARN = 5;                 // с до переезда: зона мигает
const FARM_R_DEFAULT = 330;          // px: радиус зоны без маркера
const FARM_MIN_GAP = 1100;           // px: расстояние между зонами
const FARM_EDGE = 140;               // px: запас зоны до края арены
const FARM_STREAK_STEPS = [0, 3, 7, 12, 18];   // с в зоне подряд -> множитель 1…5
const FARM_GRACE = 1.4;              // с вне зоны до сброса серии
const FARM_LOCK = 1.6;               // с: после шлепка фарм запрещён
const FARM_STEAL = 2;                // аура ударившему за выбитого из зоны
const FARM_UP_RATE = 0.22;           // доля к ауре за уровень «Скорости фарма»
const FARM_POWER_RATE = 0.07;        // доля к силе шлепка за уровень
const FARM_POSE_TURN = 1.5;          // с: оборот стрелки позы
const FARM_POSE_WIN = 42;            // °: окно «Идеально» (уровень 0)
const FARM_POSE_WIN_STEP = 9;        // ° за уровень «Окна позы»
const FARM_POSE_CD = 13;             // с: перезарядка после «Идеально»
const FARM_POSE_CD_STEP = 1;         // с минус за уровень
const FARM_POSE_MISS_CD = 3;         // с: перезарядка после промаха
const FARM_POSE_BURST = 20;          // аура за «Идеально» (×2 в зоне)
const FARM_POSE_BURST_STEP = 4;      // аура за уровень «Окна позы»
const FARM_BEAM_H = 900;             // px: высота светового столба

/** @type {Record<string, { max: number, base: number, mul: number, icon: string }>} */
const FARM_UPS = {
    farm: { max: 8, base: 50, mul: 1.55, icon: 'assets/ui/icon_bolt.png' },
    pose: { max: 6, base: 60, mul: 1.6, icon: 'assets/ui/icon_timer.png' },
    slap: { max: 6, base: 40, mul: 1.5, icon: 'assets/ui/icon_hand.png' },
};

Object.assign(LANG_STRINGS.ru, {
    'zoneWord': 'ЗОНА',
    'zoneMoveIn': 'Зона переезжает через {n} с',
    'zoneMoving': 'Зона переезжает!',
    'zoneNew': 'Новая зона ауры!',
    'zoneIn': 'В зоне — аура капает!',
    'streak': 'СЕРИЯ',
    'perSec': '{n}/с',
    'stolen': 'Выбил из зоны! +{n}',
    'knocked': 'Тебя выбили из зоны!',
    'pose': 'Поза',
    'poseKey': 'E',
    'posePerfect': 'ИДЕАЛЬНО!',
    'poseMiss': 'Мимо!',
    'poseGain': 'ИДЕАЛЬНО! +{n} ауры',
    'posePractice': 'Идеально! В зоне боя это даёт ауру.',
    'phonkPose': 'АУРА +{n}',
    'phonkPoseSub': 'ПОЗА ПРОКАЧАНА',
    'phonkSlap': 'АУРА ПОДРЕЗАНА',
    'upgrades': 'Прокачка',
    'upTitle': 'Прокачка ауры',
    'upBalance': 'Баланс',
    'upEarned': 'Заработано за всё время: {n}',
    'upFarm': 'Скорость фарма',
    'upFarmD': 'Больше ауры в секунду в зоне: +{n}%',
    'upPose': 'Окно позы',
    'upPoseD': 'Шире окно «Идеально», больше всплеск, короче перезарядка',
    'upSlap': 'Сила шлепка',
    'upSlapD': 'Шлепки отбрасывают дальше: +{n}%',
    'upLevel': 'Ур. {n}',
    'upMax': 'МАКС',
    'upBuy': 'Купить',
    'upBought': 'Прокачано: {name}!',
    'upNoAura': 'Не хватает ауры',
});
Object.assign(LANG_STRINGS.en, {
    'zoneWord': 'ZONE',
    'zoneMoveIn': 'Zone moves in {n}s',
    'zoneMoving': 'The zone is moving!',
    'zoneNew': 'New aura zone!',
    'zoneIn': 'In the zone — aura is flowing!',
    'streak': 'STREAK',
    'perSec': '{n}/s',
    'stolen': 'Knocked out of the zone! +{n}',
    'knocked': 'You were knocked out of the zone!',
    'pose': 'Pose',
    'poseKey': 'E',
    'posePerfect': 'PERFECT!',
    'poseMiss': 'Miss!',
    'poseGain': 'PERFECT! +{n} aura',
    'posePractice': 'Perfect! In the arena this earns aura.',
    'phonkPose': 'AURA +{n}',
    'phonkPoseSub': 'POSE MAXED',
    'phonkSlap': 'AURA CHECK',
    'upgrades': 'Upgrades',
    'upTitle': 'Aura upgrades',
    'upBalance': 'Balance',
    'upEarned': 'Earned in total: {n}',
    'upFarm': 'Farm speed',
    'upFarmD': 'More aura per second in a zone: +{n}%',
    'upPose': 'Pose window',
    'upPoseD': 'Wider Perfect window, bigger burst, shorter cooldown',
    'upSlap': 'Slap power',
    'upSlapD': 'Slaps knock rivals further: +{n}%',
    'upLevel': 'Lv {n}',
    'upMax': 'MAX',
    'upBuy': 'Buy',
    'upBought': 'Upgraded: {name}!',
    'upNoAura': 'Not enough aura',
});

/** @typedef {{ id: number, x: number, y: number, r: number, born: number, life: number, warned: boolean, appear: number, color: number, root: BABYLON.TransformNode | null, mats: BABYLON.StandardMaterial[], marker: number }} FarmZone */

/** @satisfies {Record<string, any>} */
const GameFarm = {
    on: false,                 // фарм идёт (игрок на арене)
    /** @type {FarmZone[]} */
    list: [],
    /** @type {Record<string, HTMLElement>} */
    el: {},
    /** @type {{ phase: 'idle' | 'run' | 'cool', t: number, win: number, half: number, cd: number, cdTotal: number }} */
    pose: { phase: 'idle', t: 0, win: 200, half: 21, cd: 0, cdTotal: 1 },
    _shownStreak: -1,
    _upModal: null,
    _toastAt: 0,
    _seq: 0,
    _bonusSecs: 0,

    // --- Жизненный цикл ----------------------------------------------------------------------

    init(game) {
        this._css();
        this._dom();
        this._fx();
        Game.on('slap', (e) => this._onSlap(e));
        Game.on('ko', (e) => { if (e.victim === Game.player) this._poseCancel(); });
        Game.on('aura', (e) => { if (e.char === Game.player) this._badge(); });
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyE' && !e.repeat && !e.ctrlKey && !e.metaKey) this.posePress();
        });
        void game;
    },

    ready() { this._debugApi(); this._badge(); },

    onZone(zone) {
        const was = this.on;
        this.on = zone === 'arena';
        this._poseCancel();
        if (this.on) {
            this._ensure();
            for (const z of this.list) this._relocate(z, true);
            this.list[1].born -= this.list[1].life * 0.45;   // вторая зона переезжает в другое время
        } else if (was) this._hideAll();
        for (const c of Game.chars) { if (c._fm) { c._fm.streak = 0; c._fm.acc = 0; c._fm.tick = 0; c._fm.lock = 0; } }
    },

    update(dt, realDt) {
        this._poseStep(realDt);
        if (this.on) {
            this._zonesStep(dt);
            this._tickChars(dt);
        }
        this._visuals(realDt);
        this._hud();
    },

    // --- Данные для остальных модулей ------------------------------------------------------------

    zones() { return this.on ? this.list : []; },

    // Зона, в круг которой попадает точка (pad — запас, px), иначе null.
    zoneAt(x, y, pad) {
        if (!this.on) return null;
        const p = pad || 0;
        for (const z of this.list) if (Math.hypot(x - z.x, y - z.y) <= z.r + p) return z;
        return null;
    },

    nearestZone(x, y) {
        let best = null, bd = Infinity;
        for (const z of this.zones()) { const d = Math.hypot(x - z.x, y - z.y) - z.r; if (d < bd) { bd = d; best = z; } }
        return best;
    },

    // Случайная точка внутри зоны (k — доля радиуса).
    pointIn(z, k) {
        const a = Math.random() * Math.PI * 2, r = z.r * (k == null ? 0.7 : k) * Math.sqrt(Math.random());
        return { x: z.x + Math.cos(a) * r, y: z.y + Math.sin(a) * r };
    },

    // Персонаж сейчас фармит.
    inZone(ch) { return !!(ch && ch._fm && ch._fm.in); },

    multOf(streak) {
        let m = 1;
        for (let i = 0; i < FARM_STREAK_STEPS.length; i++) if (streak >= FARM_STREAK_STEPS[i]) m = i + 1;
        return m;
    },

    level(id) { const u = Game.save && Game.save.up; return u ? Math.min(FARM_UPS[id].max, Math.max(0, u[id] | 0)) : 0; },

    // Множители прокачки — только игроку.
    farmMult(ch) { return ch && ch.isPlayer ? 1 + FARM_UP_RATE * this.level('farm') : 1; },
    slapMult(ch) { return ch && ch.isPlayer ? 1 + FARM_POWER_RATE * this.level('slap') : 1; },
    poseWindow() { return FARM_POSE_WIN + FARM_POSE_WIN_STEP * this.level('pose'); },
    poseCooldown() { return Math.max(5, FARM_POSE_CD - FARM_POSE_CD_STEP * this.level('pose')); },
    poseBurst() { return FARM_POSE_BURST + FARM_POSE_BURST_STEP * this.level('pose'); },

    price(id) { const u = FARM_UPS[id]; return Math.round(u.base * Math.pow(u.mul, this.level(id))); },

    // --- Зоны ------------------------------------------------------------------------------------

    _ensure() {
        while (this.list.length < FARM_ZONES) {
            const id = this.list.length;
            this.list.push({ id, x: 0, y: 0, r: FARM_R_DEFAULT, born: 0, life: 30, warned: false, appear: 0, marker: -1,
                color: id === 0 ? 0xff3fa8 : 0x3fe8ff, root: null, mats: [] });
        }
    },

    // Новое место зоны: маркер aurazone (не занятый и не рядом с другой зоной) или точка внутри пола арены.
    _relocate(z, silent) {
        const others = this.list.filter(o => o !== z);
        const far = (x, y) => others.every(o => Math.hypot(o.x - x, o.y - y) > FARM_MIN_GAP);
        const markers = GameWorld.markers('aurazone');
        let pick = null;
        if (markers.length) {
            const order = markers.map((m, i) => i).sort(() => Math.random() - 0.5);
            for (const i of order) {
                const m = markers[i], x = +m.x || 0, y = +m.y || 0;
                if (i === z.marker && markers.length > 1) continue;
                if (others.some(o => o.marker === i)) continue;
                if (!far(x, y) && markers.length > FARM_ZONES) continue;
                const s = Array.isArray(m.scale) ? +m.scale[0] : +m.scale;
                pick = { x, y, r: Math.max(150, (s || 3.3) * 100), marker: i };
                break;
            }
        }
        if (!pick) {
            const r = FARM_R_DEFAULT, c = GameWorld.zoneCenter('arena') || { x: 10000, y: 8000 }, zr = GameWorld.zones.arena ? GameWorld.zones.arena.r : 2600;
            for (let n = 0; n < 80 && !pick; n++) {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zr;
                const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
                if (GameWorld.edgeDist(x, y, 'arena') < r + FARM_EDGE) continue;
                if (!far(x, y) || Math.hypot(x - z.x, y - z.y) < r * 1.6) continue;
                if (GameWorld.colliders.some(k => Math.hypot(k.x - x, k.y - y) < k.r + r * 0.6)) continue;
                pick = { x, y, r, marker: -1 };
            }
            if (!pick) { const sp = GameWorld.spawnPoint('arena-spawn') || { x: c.x, y: c.y }; pick = { x: sp.x, y: sp.y, r, marker: -1 }; }
        }
        z.x = pick.x; z.y = pick.y; z.r = pick.r; z.marker = pick.marker;
        z.born = Game.time;
        z.life = FARM_LIFE_MIN + Math.random() * (FARM_LIFE_MAX - FARM_LIFE_MIN);
        z.warned = false;
        z.appear = 0;
        this._build(z);
        if (!silent) {
            Game.emit('zoneMove', { zone: z });
            if (Game.zone === 'arena') this._toast(Lang.t('zoneNew'));
        }
    },

    _zonesStep(dt) {
        for (const z of this.list) {
            z.appear = Math.min(1, z.appear + dt / 0.7);
            const left = z.life - (Game.time - z.born);
            if (left <= FARM_WARN && !z.warned) {
                z.warned = true;
                if (Game.zone === 'arena' && this.nearestZone(Game.player.x, Game.player.y) === z) this._toast(Lang.t('zoneMoving'));
            }
            if (left <= 0) this._relocate(z, false);
        }
    },

    _tickChars(dt) {
        for (const c of Game.chars) {
            if (c.disposed || c.zone !== 'arena') continue;
            const f = c._fm || (c._fm = { streak: 0, grace: 0, acc: 0, tick: 0, in: false, lock: 0, emoteAt: Game.time + 5 + Math.random() * 12 });
            const z = c.state !== 'dead' ? this.zoneAt(c.x, c.y) : null;
            const alive = c.state === 'idle' || c.state === 'run' || c.state === 'slap' || c.state === 'dash' || c.state === 'getup';
            const ok = !!z && alive && c.onGround && c.h > -60 && Game.time >= f.lock && (!c.isPlayer || !Game.transitioning);
            if (ok) {
                if (!f.in && c.isPlayer) this._toast(Lang.t('zoneIn'), 1.4);
                f.in = true; f.grace = 0; f.streak += dt; f.tick += dt;
                if (f.tick >= 1) { f.tick -= 1; this._award(c, f); }
                // Боты «фармят ауру»: позируют в зоне.
                if (!c.isPlayer && Game.time > f.emoteAt && c.state === 'idle') { c.emote('pose', 2.2); f.emoteAt = Game.time + 7 + Math.random() * 14; }
            } else {
                f.in = false; f.grace += dt;
                if (f.grace > FARM_GRACE) { f.streak = 0; f.tick = 0; }
            }
        }
    },

    _award(c, f) {
        const mult = this.multOf(f.streak);
        f.acc += mult * this.farmMult(c);
        const n = Math.floor(f.acc);
        f.acc -= n;
        if (n > 0) Game.addAura(c, n);
        if (c.isPlayer && Game.save) { Game.save.stats.zoneSecs = (Game.save.stats.zoneSecs | 0) + 1; }
    },

    _onSlap(e) {
        const v = e.victim, a = e.attacker;
        if (!v || !this.on || v.zone !== 'arena') return;
        const f = v._fm;
        if (f && (f.in || f.streak > 0)) {
            const wasIn = f.in;
            f.streak = 0; f.tick = 0; f.acc = 0; f.in = false;
            f.lock = Game.time + FARM_LOCK;
            if (wasIn && a && a !== v) {
                Game.addAura(a, FARM_STEAL);
                if (a === Game.player) this._toast(Lang.t('stolen', { n: FARM_STEAL }), 1.6);
            }
            if (v === Game.player) this._toast(Lang.t('knocked'), 1.6);
        }
    },

    // --- Визуал зон ------------------------------------------------------------------------------

    // Меши зоны (один раз на зону, дальше — только положение и радиус): заливка, кольца, столб света.
    _build(z) {
        const sc = GameWorld.scene;
        if (!sc) return;
        if (!z.root) {
            const root = z.root = new BABYLON.TransformNode('farmZone' + z.id, sc);
            const mk = (name, mesh, alpha) => {
                const mat = new BABYLON.StandardMaterial('fz' + z.id + name, sc);
                mat.disableLighting = true;
                mat.emissiveColor = World3D.hexColor3(z.color);
                mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.backFaceCulling = false;
                mat.alpha = alpha;
                mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
                mat.metadata = { toon: false };
                mat.disableDepthWrite = true;
                mesh.material = mat;
                mesh.parent = root;
                mesh.isPickable = false;
                mesh.receiveShadows = false;
                mesh.alwaysSelectAsActiveMesh = true;
                z.mats.push(mat);
                return mesh;
            };
            const N = 72;
            // Плоская заливка (диск радиуса 1, масштаб — по x/z).
            const disc = BABYLON.MeshBuilder.CreateDisc('fzDisc' + z.id, { radius: 1, tessellation: N }, sc);
            disc.rotation.x = Math.PI / 2;
            disc.position.y = 5;
            mk('fill', disc, 0.22);
            const ring = (name, r0, r1, y, dashes) => {
                const pos = [], idx = [], col = [];
                for (let i = 0; i <= N; i++) {
                    const a = i / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
                    pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1);
                    const on = dashes ? (Math.floor(i / 2) % 2 === 0 ? 1 : 0) : 1;
                    col.push(1, 1, 1, on, 1, 1, 1, on);
                    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
                }
                const m = new BABYLON.Mesh('fzRing' + name + z.id, sc);
                const vd = new BABYLON.VertexData();
                vd.positions = pos; vd.indices = idx; vd.colors = col;
                vd.applyToMesh(m);
                m.hasVertexAlpha = true;
                m.position.y = y;
                return m;
            };
            const outer = mk('ring', ring('o', 0.93, 1, 7, false), 0.95);
            const inner = mk('dash', ring('i', 0.8, 0.84, 7, true), 0.7);
            // Столб света: прозрачность гаснет к верху.
            const beam = BABYLON.MeshBuilder.CreateCylinder('fzBeam' + z.id, { height: FARM_BEAM_H, diameterTop: 1.7, diameterBottom: 1.9, tessellation: 40, subdivisions: 1, cap: 0 }, sc);
            const bp = beam.getVerticesData(BABYLON.VertexBuffer.PositionKind), bc = [];
            for (let i = 0; i < bp.length; i += 3) bc.push(1, 1, 1, 0.5 * (1 - (bp[i + 1] + FARM_BEAM_H / 2) / FARM_BEAM_H));
            beam.setVerticesData(BABYLON.VertexBuffer.ColorKind, bc);
            beam.hasVertexAlpha = true;
            beam.position.y = FARM_BEAM_H / 2 + 5;
            mk('beam', beam, 0.3);
            z.parts = { disc, outer, inner, beam };
            try { GameWorld.addGlow(outer, z.color); } catch (e) { /* без свечения */ }
        }
        z.root.setEnabled(true);
    },

    _hideAll() { for (const z of this.list) if (z.root) z.root.setEnabled(false); },

    _visuals(realDt) {
        if (!this.on) return;
        const t = Game.realTime, low = GameWorld.quality === 'low';
        const p = Game.player;
        for (const z of this.list) {
            const root = z.root;
            if (!root) continue;
            const k = this._ease(z.appear);
            root.position.set(z.x, 0, z.y);
            root.scaling.set(Math.max(0.001, z.r * k), 1, Math.max(0.001, z.r * k));
            const left = z.life - (Game.time - z.born);
            const blink = left < FARM_WARN ? (Math.sin(t * 14) > 0 ? 1 : 0.25) : 1;
            const pulse = 0.82 + 0.18 * Math.sin(t * 2.4 + z.id);
            const inside = p && Math.hypot(p.x - z.x, p.y - z.y) <= z.r && this.inZone(p);
            const boost = inside ? 1.12 : 1;
            const base = World3D.hexColor3(z.color);
            const white = inside ? 0.2 : 0;
            const col = new BABYLON.Color3(base.r + (1 - base.r) * white, base.g + (1 - base.g) * white, base.b + (1 - base.b) * white);
            const al = [0.2, 0.95, 0.7, 0.45];
            for (let i = 0; i < z.mats.length; i++) {
                z.mats[i].alpha = Math.min(1, al[i] * pulse * blink * boost);
                z.mats[i].emissiveColor = col;
            }
            if (z.parts) {
                z.parts.inner.rotation.y = t * 0.5 * (z.id ? -1 : 1);
                z.parts.beam.setEnabled(!low);
                // Столб не масштабируется по y: ширина — по радиусу.
            }
        }
        void realDt;
    },

    _ease(u) { const c = 1.70158 + 1, x = u - 1; return u >= 1 ? 1 : Math.max(0, 1 + c * x * x * x + 1.70158 * x * x); },

    // --- Поза ----------------------------------------------------------------------------------------

    // Первое нажатие — стрелка побежала; второе — в окне «Идеально».
    posePress() {
        const P = this.pose, p = Game.player;
        if (!Game.started || !p || !GameInput.enabled || !GameInput.visible || Game.transitioning) return;
        if (this._blocked()) return;
        if (P.phase === 'cool') return;
        if (P.phase === 'idle') {
            if (!p.canAct() && p.state !== 'slap') return;
            const win = this.poseWindow();
            P.phase = 'run'; P.t = 0; P.half = win / 2;
            P.win = 90 + Math.random() * 190;     // центр окна: 90…280°
            p.emote('pose', FARM_POSE_TURN + 0.4);
            Game.emit('poseTry', {});
            this._ringShow(true);
            if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/ui_open.mp3', 0.8);
            return;
        }
        // Нажатие в процессе: попал ли стрелка в окно.
        const ang = (P.t / FARM_POSE_TURN) * 360;
        const hit = Math.abs(ang - P.win) <= P.half;
        this._poseResolve(hit);
    },

    // Открыто окно (диалог, настройки, гардероб) — поза не нажимается.
    _blocked() {
        const ui = typeof GameUI !== 'undefined' ? /** @type {any} */ (GameUI) : null;
        if (ui && ((ui._modals && ui._modals.length) || (ui.settingsEl && ui.settingsEl.classList.contains('gu-open')))) return true;
        const w = typeof GameWardrobe !== 'undefined' ? /** @type {any} */ (GameWardrobe) : null;
        return !!(w && w.isOpen);
    },

    _poseResolve(hit) {
        const P = this.pose, p = Game.player;
        P.phase = 'cool';
        P.cdTotal = hit ? this.poseCooldown() : FARM_POSE_MISS_CD;
        P.cd = P.cdTotal;
        this._ringFlash(hit);
        if (!p) return;
        if (!hit) { this._toast(Lang.t('poseMiss'), 0.9); if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/record_scratch.mp3', 0.35); return; }
        const pvp = Game.pvp(Game.zone);
        const inZ = this.inZone(p);
        if (Game.save) { Game.save.stats.perfects = (Game.save.stats.perfects | 0) + 1; }
        p.emote('pose', 2.4);
        let gain = 0;
        if (pvp) {
            gain = this.poseBurst() * (inZ ? 2 : 1);
            const before = p.aura;
            Game.addAura(p, gain);
            gain = p.aura - before;
            if (typeof GamePhonk === 'undefined') this._toast(Lang.t('poseGain', { n: gain }), 1.8);   // с Фонк Момент надпись и так на весь экран
        } else this._toast(Lang.t('posePractice'), 2);
        if (typeof GameFX !== 'undefined') GameFX.play('poseBurst', p, { follow: p, height: 90, force: true });
        if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/aura_gain.mp3', 1);
        if (typeof GameCamera !== 'undefined') GameCamera.shake(0.4, 0.3);
        if (inZ && p._fm) p._fm.streak += 3;
        Game.emit('pose', { perfect: true, gain });
        if (typeof GamePhonk !== 'undefined') {
            try { GamePhonk.trigger(p, null, { text: Lang.t('phonkPose', { n: Math.max(gain, 1) }), sub: Lang.t('phonkPoseSub'), kind: 'pose' }); } catch (e) { console.error('GamePhonk.trigger:', e); }
        }
    },

    _poseCancel() {
        const P = this.pose;
        if (P.phase === 'run') { P.phase = 'idle'; this._ringShow(false); }
    },

    _poseStep(realDt) {
        const P = this.pose, p = Game.player;
        if (P.phase === 'run') {
            P.t += realDt;
            if (!p || p.state === 'ragdoll' || p.state === 'falling' || p.state === 'dead') { this._poseCancel(); return; }
            if (P.t >= FARM_POSE_TURN) this._poseResolve(false);
        } else if (P.phase === 'cool') {
            P.cd -= realDt;
            if (P.cd <= 0) { P.phase = 'idle'; P.cd = 0; }
        }
        // Кольцо и кнопка.
        const el = this.el;
        if (!el.pose) return;
        const frac = P.phase === 'cool' ? Math.max(0, P.cd / P.cdTotal) : 0;
        el.pose.style.setProperty('--cd', frac.toFixed(3));
        el.pose.classList.toggle('gf-cool', P.phase === 'cool');
        el.pose.classList.toggle('gf-run', P.phase === 'run');
        const cdTxt = P.phase === 'cool' ? String(Math.ceil(P.cd)) : '';
        if (el.poseCd.textContent !== cdTxt) el.poseCd.textContent = cdTxt;
        const show = !!(Game.started && GameInput.visible && !(Game.transitioning));
        el.pose.classList.toggle('gf-hide', !show);
        if (P.phase === 'run') {
            const ang = (P.t / FARM_POSE_TURN) * 360;
            el.arrow.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
            const C = 2 * Math.PI * 80, len = P.half * 2 / 360 * C, a0 = (P.win - P.half) / 360 * C;
            el.win.setAttribute('stroke-dasharray', len.toFixed(1) + ' ' + (C - len).toFixed(1));
            el.win.setAttribute('stroke-dashoffset', (-a0).toFixed(1));
        }
    },

    _ringShow(on) {
        const el = this.el.ring;
        if (!el) return;
        el.classList.toggle('gf-on', on);
        if (on) el.classList.remove('gf-ok', 'gf-bad');
    },

    _ringFlash(ok) {
        const el = this.el.ring;
        if (!el) return;
        el.classList.add(ok ? 'gf-ok' : 'gf-bad');
        el.classList.add('gf-on');
        setTimeout(() => el.classList.remove('gf-on', 'gf-ok', 'gf-bad'), 650);
    },

    // --- Прокачка -----------------------------------------------------------------------------------

    openUpgrades() {
        const ui = typeof GameUI !== 'undefined' ? /** @type {any} */ (GameUI) : null;
        if (!ui || typeof ui.modal !== 'function' || this._upModal) return;
        const body = document.createElement('div');
        body.className = 'gf-up';
        const m = this._upModal = ui.modal({ title: Lang.t('upTitle'), theme: 'purple', body, backdrop: true, pause: false, onClose: () => { this._upModal = null; this._badge(); } });
        this._upFill(body);
        void m;
    },

    _upFill(body) {
        body.textContent = '';
        const total = typeof Game.auraTotal === 'function' ? Game.auraTotal() : 0;
        const head = document.createElement('div');
        head.className = 'gf-up-head';
        head.innerHTML = '<img src="assets/ui/icon_aura.png" alt=""><span class="gf-up-bal"></span><small></small>';
        head.querySelector('.gf-up-bal').textContent = Lang.t('upBalance') + ': ' + (Game.player ? Game.player.aura : 0);
        head.querySelector('small').textContent = Lang.t('upEarned', { n: total });
        body.appendChild(head);
        const names = { farm: ['upFarm', 'upFarmD'], pose: ['upPose', 'upPoseD'], slap: ['upSlap', 'upSlapD'] };
        for (const id of Object.keys(FARM_UPS)) {
            const u = FARM_UPS[id], lv = this.level(id), maxed = lv >= u.max;
            const row = document.createElement('div');
            row.className = 'gf-row';
            const d = Lang.t(names[id][1], { n: Math.round((id === 'farm' ? FARM_UP_RATE : FARM_POWER_RATE) * 100) });
            row.innerHTML = '<img class="gf-ic" alt=""><div class="gf-tx"><b></b><span></span><div class="gf-pips"></div></div><div class="gf-buy"></div>';
            /** @type {HTMLImageElement} */ (row.querySelector('.gf-ic')).src = u.icon;
            row.querySelector('b').textContent = Lang.t(names[id][0]) + '  ' + Lang.t('upLevel', { n: lv });
            row.querySelector('span').textContent = d;
            const pips = row.querySelector('.gf-pips');
            for (let i = 0; i < u.max; i++) { const pip = document.createElement('i'); if (i < lv) pip.className = 'on'; pips.appendChild(pip); }
            const buy = row.querySelector('.gf-buy');
            if (maxed) { const t = document.createElement('div'); t.className = 'gf-max'; t.textContent = Lang.t('upMax'); buy.appendChild(t); }
            else {
                const price = this.price(id), can = Game.player && Game.player.aura >= price;
                const btn = /** @type {any} */ (GameUI).button(price + '  ' + Lang.t('upBuy'), can ? 'green' : 'blue', () => this.buy(id, body));
                btn.classList.add('gf-b');
                if (!can) btn.classList.add('gf-off');
                buy.appendChild(btn);
            }
            body.appendChild(row);
        }
    },

    buy(id, body) {
        const u = FARM_UPS[id];
        if (!u || this.level(id) >= u.max) return false;
        if (!Game.spendAura(this.price(id))) { this._toast(Lang.t('upNoAura'), 1.4); return false; }
        if (!Game.save.up) Game.save.up = { farm: 0, pose: 0, slap: 0 };
        Game.save.up[id] = this.level(id) + 1;
        Game.saveSoon();
        const names = { farm: 'upFarm', pose: 'upPose', slap: 'upSlap' };
        this._toast(Lang.t('upBought', { name: Lang.t(names[id]) }), 1.6);
        if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/unlock.mp3', 1);
        const b = body || (this._upModal && this._upModal.body);
        if (b) this._upFill(b);
        this._badge();
        return true;
    },

    _badge() {
        const ui = typeof GameUI !== 'undefined' ? /** @type {any} */ (GameUI) : null;
        if (!ui || !Game.player || !Game.save) return;
        let cheapest = Infinity;
        for (const id of Object.keys(FARM_UPS)) if (this.level(id) < FARM_UPS[id].max) cheapest = Math.min(cheapest, this.price(id));
        ui.setHudBadge('up', Game.player.aura >= cheapest ? true : null);
    },

    // --- HUD -------------------------------------------------------------------------------------------

    _toast(text, seconds) {
        if (typeof GameUI !== 'undefined') GameUI.toast(text, seconds || 2);
    },

    _dom() {
        const hud = document.createElement('div');
        hud.id = 'gf-hud';
        hud.innerHTML =
            '<div id="gf-plate" class="gf-hide"><div class="gf-pt"><i class="gf-pin"></i><span class="gf-zl"></span><b class="gf-zs"></b></div><div class="gf-bar"><i></i></div></div>' +
            '<div id="gf-arrow" class="gf-hide"><i></i><span></span></div>';
        document.body.appendChild(hud);
        const streak = document.createElement('div');
        streak.id = 'gf-streak';
        streak.className = 'gf-hide';
        streak.innerHTML = '<b class="gf-x">x1</b><div class="gf-sc"><span class="gf-sl"></span><div class="gf-sb"><i></i></div></div><small class="gf-rate"></small>';
        streak.querySelector('.gf-sl').textContent = Lang.t('streak');
        const tl = document.getElementById('gu-tl');
        if (tl) tl.insertBefore(streak, tl.children[1] || null); else hud.appendChild(streak);
        // Кнопка позы и кольцо с бегущей стрелкой.
        const pose = document.createElement('button');
        pose.type = 'button';
        pose.id = 'gf-pose';
        pose.className = 'gf-hide' + (IS_MOBILE ? ' gf-mobile' : '');
        pose.innerHTML = '<svg class="gf-ringsvg" viewBox="0 0 200 200" aria-hidden="true"><circle class="gf-track" cx="100" cy="100" r="80"/>' +
            '<circle class="gf-win" cx="100" cy="100" r="80" stroke-dasharray="0 600"/></svg>' +
            '<div class="gf-arrow"><i></i></div><span class="gf-pl"></span><span class="gf-pk"></span><b class="gf-pcd"></b>';
        pose.querySelector('.gf-pl').textContent = Lang.t('pose');
        pose.querySelector('.gf-pk').textContent = IS_MOBILE ? '' : Lang.t('poseKey');
        pose.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.posePress(); });
        document.body.appendChild(pose);
        const ring = document.createElement('div');
        ring.id = 'gf-ring';
        document.body.appendChild(ring);
        if (typeof GameUI !== 'undefined' && typeof /** @type {any} */ (GameUI).addHudButton === 'function') {
            /** @type {any} */ (GameUI).addHudButton({ id: 'up', icon: 'assets/ui/icon_bolt.png', text: Lang.t('upgrades'), theme: 'pink', order: 3, onClick: () => this.openUpgrades() });
        }
        this.el = {
            plate: hud.querySelector('#gf-plate'), zl: hud.querySelector('.gf-zl'), zs: hud.querySelector('.gf-zs'), bar: hud.querySelector('.gf-bar i'),
            arrow2: hud.querySelector('#gf-arrow'), arr: hud.querySelector('#gf-arrow i'), arrd: hud.querySelector('#gf-arrow span'),
            streak, sx: streak.querySelector('.gf-x'), sb: streak.querySelector('.gf-sb i'), sr: streak.querySelector('.gf-rate'),
            pose, poseCd: pose.querySelector('.gf-pcd'), arrow: pose.querySelector('.gf-arrow'), win: pose.querySelector('.gf-win'), ring: pose,
        };
        // Узкий экран: таймер зоны — в левой колонке под серией (в центре он налез бы на рейку кнопок).
        const mq = window.matchMedia ? window.matchMedia('(max-width:560px)') : null;
        const place = () => {
            const tl = document.getElementById('gu-tl'), plate = this.el.plate;
            if (!plate) return;
            if (mq && mq.matches && tl) { plate.classList.add('gf-narrow'); tl.insertBefore(plate, streak.nextSibling); }
            else { plate.classList.remove('gf-narrow'); hud.appendChild(plate); }
        };
        if (mq) { place(); if (mq.addEventListener) mq.addEventListener('change', place); }
    },

    _hud() {
        const el = this.el;
        if (!el.plate) return;
        const p = Game.player;
        const farm = this.on && !!p && Game.started && Game.zone === 'arena' && p.state !== 'dead';
        el.plate.classList.toggle('gf-hide', !farm);
        el.streak.classList.toggle('gf-hide', !farm);
        el.arrow2.classList.add('gf-hide');
        if (!farm) return;
        const near = this.nearestZone(p.x, p.y);
        const f = p._fm;
        if (near) {
            const left = Math.max(0, near.life - (Game.time - near.born));
            el.zl.textContent = Lang.t('zoneWord');
            el.zs.textContent = Math.ceil(left) + 's';
            el.bar.style.width = (100 * Math.max(0, Math.min(1, left / near.life))).toFixed(1) + '%';
            el.plate.classList.toggle('gf-warn', left <= FARM_WARN);
        }
        const streak = f ? f.streak : 0, mult = this.multOf(streak);
        if (mult !== this._shownStreak) {
            this._shownStreak = mult;
            el.sx.textContent = 'x' + mult;
            el.streak.classList.remove('gf-pop');
            void el.streak.offsetWidth;
            el.streak.classList.add('gf-pop');
        }
        el.streak.classList.toggle('gf-live', !!(f && f.in));
        const steps = FARM_STREAK_STEPS, i = mult - 1;
        const frac = i >= steps.length - 1 ? 1 : (streak - steps[i]) / (steps[i + 1] - steps[i]);
        el.sb.style.width = (100 * Math.max(0, Math.min(1, frac))).toFixed(1) + '%';
        el.sr.textContent = '+' + (mult * this.farmMult(p)).toFixed(mult * this.farmMult(p) % 1 ? 1 : 0) + '/s';
        // Указатель на ближайшую зону, пока игрок вне её.
        if (near && !(f && f.in) && GameWorld.view) {
            const pr = GameWorld.view.projectToScreen(near.x, near.y, 120);
            const W = VIEW.w, H = VIEW.h, cx = W / 2, cy = H / 2;
            let dx = pr.x - cx, dy = pr.y - cy;
            if (pr.behind) { dx = -dx; dy = -dy; }
            const l = Math.hypot(dx, dy) || 1;
            const mx = 54, my0 = 118, my1 = H - 170;
            let x = pr.x, y = pr.y, edge = false;
            if (pr.behind || x < mx || x > W - mx || y < my0 || y > my1) {
                edge = true;
                const kx = dx > 0 ? (W - mx - cx) / dx : (mx - cx) / dx, ky = dy > 0 ? (my1 - cy) / dy : (my0 - cy) / dy;
                const k = Math.min(Math.abs(kx) || 1e9, Math.abs(ky) || 1e9);
                x = cx + dx * k; y = cy + dy * k;
            }
            el.arrow2.classList.remove('gf-hide');
            el.arrow2.style.left = x.toFixed(0) + 'px';
            el.arrow2.style.top = y.toFixed(0) + 'px';
            el.arr.style.transform = edge ? 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(0) + 'deg)' : 'rotate(180deg)';
            el.arrd.textContent = Math.round(Math.max(0, Math.hypot(near.x - p.x, near.y - p.y) - near.r) / 100) + 'm';
        }
    },

    // --- Эффекты ---------------------------------------------------------------------------------------

    _fx() {
        const fx = typeof GameFX !== 'undefined' ? /** @type {any} */ (GameFX) : null;
        if (!fx || !fx.RECIPES) return;
        fx.RECIPES.poseBurst = () => [
            { name: 'fxPoseRing', texture: 'assets/textures/fx/ring_shockwave.png', burst: 1, capacity: 1, life: [0.55, 0.55], size: [150, 150], speed: [0, 0],
                sizeGradient: [[0, 0.2], [1, 3.2]], colorGradient: [[0, '#ff3fa8', 0.95], [0.5, '#9a5cff', 0.6], [1, '#3fe8ff', 0]] },
            { name: 'fxPoseSpark', texture: 'assets/textures/fx/sparkle.png', burst: 26, capacity: 26, life: [0.7, 1.2], size: [18, 40], speed: [160, 420],
                box: [[-40, -40, -40], [40, 80, 40]], direction: [[-1, 0.1, -1], [1, 1.2, 1]], gravity: [0, -260, 0], rot: true, spin: [-5, 5],
                colorGradient: [[0, '#ffffff', 1], [0.4, '#ffd24a', 0.95], [1, '#ff3fa8', 0]] },
            { name: 'fxPoseGlow', texture: 'assets/textures/fx/glow_dot.png', burst: 10, capacity: 10, life: [0.6, 1], size: [40, 80], speed: [30, 120],
                box: [[-60, 0, -60], [60, 120, 60]], direction: [[-0.2, 1, -0.2], [0.2, 1.4, 0.2]], colorGradient: [[0, '#3fe8ff', 0.9], [1, '#9a5cff', 0]] },
        ];
    },

    // --- Отладка ----------------------------------------------------------------------------------------

    state() {
        return {
            on: this.on, zones: this.list.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), left: +(z.life - (Game.time - z.born)).toFixed(1), marker: z.marker })),
            pose: { phase: this.pose.phase, cd: +this.pose.cd.toFixed(1), win: this.poseWindow() },
            up: Game.save && Game.save.up, player: Game.player && Game.player._fm ? { streak: +Game.player._fm.streak.toFixed(1), in: Game.player._fm.in } : null,
        };
    },

    _debugApi() {
        const d = Game.debug;
        if (!d) return;
        const G = this;
        d.farm = () => JSON.stringify(G.state());
        // Игрок — в центр ближайшей зоны.
        d.toZone = () => {
            const p = Game.player, z = G.nearestZone(p.x, p.y) || G.list[0];
            if (!z) return false;
            p.teleport(z.x, z.y, null, p.heading);
            GameCamera.snap();
            return true;
        };
        // Нажать «Позу» и попасть/не попасть в окно (perfect: по умолчанию попасть).
        d.pose = (perfect) => {
            const P = G.pose;
            if (P.phase === 'idle') { G.posePress(); P.t = 0.45; return P.phase; }   // первый вызов — стрелка побежала
            if (P.phase === 'run') { P.t = (perfect === false ? (P.win + P.half + 20) : P.win) / 360 * FARM_POSE_TURN; if (perfect === false && P.t >= FARM_POSE_TURN) P.t = FARM_POSE_TURN - 0.05; G.posePress(); }
            return P.phase;
        };
        d.buy = (id) => G.buy(id);
        d.moveZones = () => { for (const z of G.list) G._relocate(z, false); return true; };
        d.openUp = () => { G.openUpgrades(); return true; };
    },

    // --- Стиль -----------------------------------------------------------------------------------------

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gf-hud{position:fixed;inset:0;z-index:6;pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff}
.gf-hide{display:none!important}
#gf-plate{position:absolute;left:50%;top:calc(58px + env(safe-area-inset-top));transform:translateX(-50%);min-width:176px;padding:6px 14px 8px;border-radius:6px;
 background:rgba(12,6,30,.78);border:2px solid #3fe8ff;box-shadow:0 0 14px rgba(63,232,255,.55),inset 0 0 10px rgba(63,232,255,.18);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
#gf-plate .gf-pt{display:flex;align-items:center;justify-content:center;gap:8px;font-size:17px;letter-spacing:1.5px;text-shadow:0 0 8px #3fe8ff}
#gf-plate .gf-pin{width:12px;height:12px;border-radius:50%;background:#ff3fa8;box-shadow:0 0 10px #ff3fa8}
#gf-plate .gf-zs{font-size:21px;color:#ffe14d;text-shadow:0 0 8px #ff9a2f}
#gf-plate .gf-bar{margin-top:5px;height:6px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}
#gf-plate .gf-bar i{display:block;height:100%;background:linear-gradient(90deg,#3fe8ff,#ff3fa8);transition:width .25s linear}
#gf-plate.gf-narrow{position:static;transform:none;min-width:0;width:188px;box-sizing:border-box;pointer-events:none}
#gf-plate.gf-warn{border-color:#ff3fa8;box-shadow:0 0 16px rgba(255,63,168,.8);animation:gf-blink .5s steps(2) infinite}
@keyframes gf-blink{50%{opacity:.55}}
#gf-streak{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 8px;border-radius:6px;background:rgba(12,6,30,.78);border:2px solid #9a5cff;
 box-shadow:0 0 12px rgba(154,92,255,.5);pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff;margin-top:-2px}
#gf-streak .gf-x{font-size:30px;line-height:1;color:#ffe14d;text-shadow:0 0 10px #ff9a2f,2px 2px 0 #7a1a5c;min-width:48px;text-align:center}
#gf-streak .gf-sc{display:flex;flex-direction:column;gap:3px;min-width:70px}
#gf-streak .gf-sl{font-size:12px;letter-spacing:2px;color:#cdb6ff}
#gf-streak .gf-sb{height:6px;border-radius:3px;background:rgba(255,255,255,.16);overflow:hidden}
#gf-streak .gf-sb i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff3fa8,#ffe14d)}
#gf-streak .gf-rate{font-size:15px;color:#7dffb0;text-shadow:0 0 6px #1fe07a}
#gf-streak:not(.gf-live) .gf-rate{opacity:.35}
#gf-streak.gf-pop .gf-x{animation:gf-pop .4s cubic-bezier(.2,1.6,.4,1)}
@keyframes gf-pop{0%{transform:scale(.4)}100%{transform:scale(1)}}
#gf-arrow{position:absolute;display:flex;flex-direction:column;align-items:center;gap:2px;transform:translate(-50%,-50%)}
#gf-arrow i{display:block;width:0;height:0;border:16px solid transparent;border-bottom:26px solid #ff3fa8;border-top:0;filter:drop-shadow(0 0 8px #ff3fa8);animation:gf-bob .8s ease-in-out infinite alternate}
#gf-arrow span{font-size:15px;color:#fff;text-shadow:0 0 6px #000,0 0 8px #ff3fa8}
@keyframes gf-bob{to{translate:0 5px}}
#gf-pose{position:fixed;right:calc(52px + env(safe-area-inset-right));bottom:calc(58px + env(safe-area-inset-bottom));z-index:8;width:118px;height:118px;padding:0;border-radius:50%;
 border:4px solid #ff3fa8;background:radial-gradient(circle at 50% 35%,#5a1a8a,#1d0b3d 70%);color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;
 box-shadow:0 0 18px rgba(255,63,168,.75),inset 0 0 16px rgba(255,63,168,.35);-webkit-tap-highlight-color:transparent;touch-action:none;font-family:GameFont,system-ui,sans-serif;font-weight:900}
#gf-pose .gf-pl{font-size:26px;letter-spacing:1px;text-shadow:0 0 10px #ff3fa8;pointer-events:none}
#gf-pose .gf-pk{position:absolute;left:50%;bottom:-16px;transform:translateX(-50%);padding:2px 10px;border-radius:4px;background:#1d0b3d;border:2px solid #ff3fa8;font-size:15px;pointer-events:none}
#gf-pose .gf-pk:empty{display:none}
#gf-pose .gf-pcd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:40px;color:#fff;text-shadow:0 0 10px #000;pointer-events:none;
 background:conic-gradient(rgba(8,4,20,.72) calc(var(--cd,0)*360deg),transparent 0)}
#gf-pose.gf-cool{border-color:#6b4a8a;box-shadow:0 0 6px rgba(107,74,138,.5)}
#gf-pose:active{transform:scale(.95)}
#gf-pose .gf-ringsvg{position:absolute;left:-41px;top:-41px;width:200px;height:200px;transform:rotate(-90deg);pointer-events:none;opacity:0;transition:opacity .15s}
#gf-pose.gf-run .gf-ringsvg{opacity:1}
#gf-pose .gf-track{fill:rgba(12,6,30,.55);stroke:rgba(255,255,255,.35);stroke-width:12}
#gf-pose .gf-win{fill:none;stroke:#7dff5a;stroke-width:16;filter:drop-shadow(0 0 8px #7dff5a)}
#gf-pose .gf-arrow{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0}
#gf-pose.gf-run .gf-arrow{opacity:1}
#gf-pose .gf-arrow i{position:absolute;left:-13px;top:-96px;width:0;height:0;border:13px solid transparent;border-top:0;border-bottom:22px solid #ffe14d;filter:drop-shadow(0 0 7px #ff9a2f);transform:rotate(180deg)}
#gf-pose.gf-mobile{right:calc(42px + env(safe-area-inset-right));bottom:calc(max(62px,8vh) + env(safe-area-inset-bottom));width:100px;height:100px}
#gf-pose.gf-mobile .gf-ringsvg{left:-50px;top:-50px;width:200px;height:200px}
#gf-pose.gt-hl{animation:gf-hl 1s ease-in-out infinite}
@keyframes gf-hl{50%{box-shadow:0 0 0 14px rgba(255,225,77,0),0 0 24px rgba(255,225,77,.9)}}
@media (max-height:430px){#gf-pose.gf-mobile{bottom:calc(48px + env(safe-area-inset-bottom));scale:.82}}
#gf-ring{display:none}
.gf-up{display:flex;flex-direction:column;gap:10px;min-width:min(440px,86vw)}
.gf-up-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.16)}
.gf-up-head img{width:36px;height:36px}
.gf-up-bal{font-size:24px;color:#ffe14d}
.gf-up-head small{flex-basis:100%;font-size:13px;color:#cdb6ff;font-weight:700}
.gf-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:6px;background:rgba(12,6,30,.55);border:2px solid #6a3fc0;text-align:left}
.gf-ic{width:46px;height:46px;flex:none;filter:drop-shadow(0 0 6px #ff3fa8)}
.gf-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.gf-tx b{font-size:19px}
.gf-tx span{font-size:13.5px;font-weight:700;color:#cdb6ff;line-height:1.2}
.gf-pips{display:flex;gap:4px;margin-top:2px}
.gf-pips i{width:14px;height:8px;border-radius:2px;background:rgba(255,255,255,.18)}
.gf-pips i.on{background:linear-gradient(#ffe14d,#ff9a2f);box-shadow:0 0 6px #ff9a2f}
.gf-buy{flex:none}
.gf-b{min-width:110px;padding:8px 12px!important;font-size:17px!important}
.gf-b.gf-off{filter:saturate(.35) brightness(.8)}
.gf-max{padding:8px 14px;border-radius:6px;background:#2a1a4a;color:#7dffb0;font-size:16px;border:2px solid #7dffb0}
@media (max-width:420px){.gf-row{gap:8px;padding:8px}.gf-ic{width:36px;height:36px}.gf-tx b{font-size:16px}.gf-b{min-width:88px;font-size:15px!important}}
`;
        document.head.appendChild(st);
    },
};
