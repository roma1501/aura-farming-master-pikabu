// GameCamera.js — своя камера третьего лица (DESIGN.md §4). Движковый CameraController на
// время игры отключён (ввод снят, его update — пустой): камеру ставит только этот модуль.
//
// Режимы: 'follow' — за спиной игрока (GAME_CAM_DIST, наклон GAME_CAM_PITCH_DEG, FOV
// GAME_CAM_FOV_DEG), поворот — перетаскиванием (GameInput), без него при беге мягко
// доворачивает за спину; 'orbit' — облёт точки (стартовый экран); 'focus' — наезд на
// персонажей (Фонк Момент), потом обратно в follow. Камера не опускается под верх
// острова. Время камеры — реальное (slow-mo Фонк Момента её не замедляет).
//
// Кадр: персонаж в нижней-центральной трети, горизонт ~1/3 сверху (точка взгляда —
// над головой, GAME_CAM_LOOK_H). Кадр теней — вокруг игрока чуть впереди по взгляду.
// Игрок летит/лежит после шлепка — слежение быстрее (GAME_CAM_FLY_FOLLOW) с упреждением по
// скорости, камера чуть дальше и выше (GAME_CAM_FLY_DIST): полёт на камеру не уходит из кадра.
// Препятствия (GameWorld.colliders ниже их верха) между точкой взгляда и глазом — глаз
// встаёт перед ними (GAME_CAM_COLLIDE), обратно отъезжает плавно; тонкие стволы (пальмы)
// двигают камеру, только если глаз оказался бы внутри ствола.
//
// API: shake(intensity 0..1, seconds), focus(chars, seconds, {az}?), unfocus(), orbit(x, y, dist?), follow(),
// snap() — мгновенно за спину игрока, set(azDeg, pitchDeg, dist) — отладка (держит ракурс).

/** @satisfies {Record<string, any>} */
const GameCamera = {
    mode: 'follow',
    az: 0,            // радианы: куда смотрит камера по карте (вперёд = (cos az, sin az))
    pitch: 0.31,      // радианы: наклон вниз
    dist: 520,        // px: от глаза до точки взгляда
    zoom: 1,          // множитель дистанции (колесо)
    hold: false,      // ракурс задан вручную (debug) — без автодоворота
    tx: 0, ty: 0, th: 0,          // сглаженная точка взгляда (x, y карты, высота)
    _shakeT: 0, _shakeDur: 0, _shakeI: 0,
    /** @type {Character[]} */
    _focus: [],
    _focusUntil: 0,
    _focusAz: 0,
    _orbit: { x: 0, y: 0, dist: 1100, h: 160 },
    _eye: null,
    _flyK: 0,         // 0..1: игрок летит/лежит после шлепка (плавно)
    _clipK: 1,        // доля дистанции после препятствий (1 — свободно)
    THIN: 45,         // px: коллайдер тоньше — «ствол» (камера сдвигается, только если внутри него)
    /** @type {BABYLON.TargetCamera | null} */
    cam: null,

    init(game) {
        const app = game.app;
        this.cam = /** @type {BABYLON.TargetCamera} */ (app.location.view.camera);
        // Движковая камера не мешает: без ввода и без своего update.
        if (app.camera) {
            app.camera.detach();
            app.camera.follow(null);
            app.camera.update = () => {};
        }
        this.pitch = GameCfg.camPitch * Math.PI / 180;
        this.dist = GameCfg.camDist;
        this._eye = new BABYLON.Vector3();
        this._applyFov();
        window.addEventListener('resize', () => this._applyFov());
    },

    // Вертикальный FOV; на узком (портретном) экране шире, чтобы по горизонтали было ≥ ~46°.
    _applyFov() {
        if (!this.cam) return;
        const eng = World3D.engine;
        const aspect = eng ? eng.getRenderWidth() / Math.max(1, eng.getRenderHeight()) : 16 / 9;
        let v = GameCfg.camFov * Math.PI / 180;
        const hMin = 46 * Math.PI / 180;
        const vNeed = 2 * Math.atan(Math.tan(hMin / 2) / Math.max(0.2, aspect));
        if (vNeed > v) v = Math.min(100 * Math.PI / 180, vNeed);
        this.cam.fov = v;
        this._portrait = aspect < 1;
    },
    _portrait: false,

    follow() { this.mode = 'follow'; },

    orbit(x, y, dist) {
        this.mode = 'orbit';
        this._orbit.x = x; this._orbit.y = y;
        if (dist) this._orbit.dist = dist;
    },

    // Наезд на персонажей на seconds (реальных) — Фонк Момент. opts.az — свой курс взгляда
    // на время наезда (ставится сразу — «склейка»). Потом — прежний режим: ракурс плавно
    // (0.6 с) возвращается к тому, что был до наезда.
    focus(chars, seconds, opts) {
        this._focus = (chars || []).filter(Boolean);
        if (!this._focus.length) return;
        if (this.mode !== 'focus') { this._focusAz = this.az; this._focusPrev = this.mode; }
        this.mode = 'focus';
        this._focusUntil = Game.realTime + (seconds || 2);
        if (opts && opts.az != null) this.az = opts.az;
    },
    _focusPrev: 'follow',

    // Закончить наезд раньше срока (плавный возврат).
    unfocus() { if (this.mode === 'focus') this._endFocus(); },

    _endFocus() {
        if (this._focusPrev === 'orbit') { this.mode = 'orbit'; return; }
        this.mode = 'follow';
        const p = Game.player;
        if (!p || !this.cam || !this._eye) return;
        this._from = { pos: this.cam.position.clone(), tgt: this._eye.clone() };
        this._blendDur = this._blendT = 0.6;
        this.az = this._focusAz;
        this.tx = p.x; this.ty = p.y; this.th = Math.max(p.h, -1300) + GameCfg.camLookH;
    },

    // Тряска: intensity 0..1 (0.3 — шлепок, 1 — взрыв рядом), time — секунды.
    shake(intensity, time) {
        const i = Math.max(0, Math.min(1.5, intensity || 0.3));
        if (i >= this._shakeI * (this._shakeT / Math.max(0.01, this._shakeDur))) {
            this._shakeI = i; this._shakeDur = this._shakeT = Math.max(0.05, time || 0.25);
        }
    },

    // Отладка: ракурс в градусах (az — курс взгляда по карте), держится до перетаскивания.
    set(azDeg, pitchDeg, dist) {
        if (azDeg != null) this.az = azDeg * Math.PI / 180;
        if (pitchDeg != null) this.pitch = pitchDeg * Math.PI / 180;
        if (dist != null) this.dist = dist;
        this.hold = true;
        this.mode = 'follow';
    },

    // Плавный переход из текущего ракурса в слежение за seconds (после стартового экрана).
    swoop(seconds) {
        const p = Game.player;
        if (!p || !this.cam) return;
        this._from = { pos: this.cam.position.clone(), tgt: this._eye.clone() };
        this._blendDur = this._blendT = Math.max(0.05, seconds || 0.8);
        this.az = p.heading;
        this.tx = p.x; this.ty = p.y; this.th = p.h + GameCfg.camLookH;
        this.mode = 'follow';
    },
    /** @type {{ pos: BABYLON.Vector3, tgt: BABYLON.Vector3 } | null} */
    _from: null,
    _fallK: 1,
    _blendT: 0,
    _blendDur: 1,

    // Мгновенно за спину игрока (после телепорта).
    snap() {
        const p = Game.player;
        if (!p) return;
        this.az = p.heading;
        this.tx = p.x; this.ty = p.y; this.th = p.h + GameCfg.camLookH;
        this._fallK = 1;
        this._flyK = 0;
        if (this.mode === 'focus') this.mode = 'follow';
        this.apply(0);
    },

    update(dt, realDt) {
        const rdt = Math.min(0.1, realDt || dt || 0);
        const p = Game.player;
        // Ввод камеры: перетаскивание и колесо.
        const look = GameInput.consumeLook();
        const k = GameCfg.camDrag * Math.PI / 180;
        if (look.dx || look.dy) {
            this.az += look.dx * k;
            this.pitch = Math.max(0.03, Math.min(1.1, this.pitch + look.dy * k * 0.6));
            this.hold = false;
        }
        const z = GameInput.consumeZoom();
        if (z) this.zoom = Math.max(0.6, Math.min(1.7, this.zoom * Math.pow(1.1, z)));
        if (this.mode === 'focus' && Game.realTime > this._focusUntil) this._endFocus();
        // Игрок летит/лежит после шлепка (не падает в бездну): слежение быстрее и с упреждением.
        const fly = this.mode === 'follow' && !!p && (p.state === 'ragdoll' || p.state === 'down') && p.h > -40;
        this._flyK += ((fly ? 1 : 0) - this._flyK) * (1 - Math.exp(-(fly ? 8 : 1.5) * rdt));
        const rate = GameCfg.camFollow * (1 + (GameCfg.camFlyFollow - 1) * this._flyK);
        const f = 1 - Math.exp(-rate * rdt);
        if (this.mode === 'follow' && p) {
            // Точка взгляда: над игроком; в полёте — с упреждением по скорости (без отставания
            // слежения), вертикаль догоняет мягче.
            const lead = this._flyK / rate;
            this.tx += (p.x + p.vx * lead - this.tx) * f;
            this.ty += (p.y + p.vy * lead - this.ty) * f;
            const wantH = Math.max(p.h, -1300) + GameCfg.camLookH;
            this.th += (wantH - this.th) * (1 - Math.exp(-GameCfg.camFollow * 0.7 * rdt));
            // Доворот за спину при беге, если игрок давно не крутил камеру.
            const idle = Game.realTime - GameInput.lastLookTime;
            if (!this.hold && idle > GameCfg.camAutoDelay && (p.state === 'run' || p.state === 'dash') && p.speed > 120) {
                let d = p.heading - this.az;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                // Бежит на камеру — не крутимся вокруг (только мягко, если угол не больше ~125°).
                // Только когда стик ведёт в основном «вперёд»: при беге вбок камера не кружит.
                const mv = GameInput.move, ml = Math.hypot(mv.x, mv.y);
                const fwd = p.state === 'dash' ? 1 : (ml > 0.2 ? Math.max(0, mv.y / ml) : 0);
                if (Math.abs(d) < 2.2 && fwd > 0) {
                    const ramp = Math.min(1, (idle - GameCfg.camAutoDelay) / 1.2) * Math.min(1, p.speed / GameCfg.runSpeed) * fwd * fwd;
                    this.az += d * (1 - Math.exp(-GameCfg.camAutoRate * ramp * rdt));
                }
            }
        } else if (this.mode === 'orbit') {
            const o = this._orbit;
            this.az += rdt * 0.07;
            this.tx += (o.x - this.tx) * f; this.ty += (o.y - this.ty) * f; this.th += (o.h - this.th) * f;
        } else if (this.mode === 'focus') {
            let cx = 0, cy = 0, ch = 0;
            // Высота — не ниже края острова: жертва улетает в бездну, а кадр остаётся на арене.
            for (const c of this._focus) { cx += c.x; cy += c.y; ch += Math.max(c.h, -250); }
            const n = this._focus.length;
            cx /= n; cy /= n; ch /= n;
            const ff = 1 - Math.exp(-6 * rdt);
            this.tx += (cx - this.tx) * ff; this.ty += (cy - this.ty) * ff; this.th += (ch + 130 - this.th) * ff;
            this.az += rdt * 0.35;
        }
        if (this._shakeT > 0) this._shakeT = Math.max(0, this._shakeT - rdt);
        const falling = this.mode === 'follow' && p && p.h < -40;
        this._fallK += ((falling ? 0.18 : 1) - this._fallK) * (1 - Math.exp(-(falling ? 2.5 : 8) * rdt));
        if (this._blendT > 0) { this._blendT = Math.max(0, this._blendT - rdt); if (!this._blendT) this._from = null; }
        this.apply(rdt);
    },

    // Поставить камеру Babylon по az/pitch/dist и точке взгляда. rdt — реальное время кадра
    // (плавный отъезд от препятствий); 0 / нет — мгновенно (snap).
    apply(rdt) {
        const cam = this.cam;
        if (!cam) return;
        let dist = this.dist * this.zoom, pitch = this.pitch;
        if (this.mode === 'follow' && this._flyK > 0) {
            dist *= 1 + (GameCfg.camFlyDist - 1) * this._flyK;
            pitch += 0.1 * this._flyK;
        }
        if (this.mode === 'orbit') { dist = this._orbit.dist; pitch = 0.2; }
        if (this.mode === 'focus') {
            let spread = 0;
            for (const c of this._focus) spread = Math.max(spread, Math.hypot(c.x - this.tx, c.y - this.ty));
            dist = Math.min(this.dist * this.zoom * 1.1, (360 + spread * 1.5) * (this._portrait ? 1.3 : 1));
            pitch = 0.22;
        }
        const ca = Math.cos(this.az), sa = Math.sin(this.az), cp = Math.cos(pitch), sp = Math.sin(pitch);
        let back = cp * dist * this._fallK;   // при падении в бездну камера подъезжает и смотрит сверху
        let up = sp * dist;
        // Препятствия между точкой взгляда и глазом: глаз — перед ними (не в стволе, не за моаи).
        const p0 = Game.player;
        const collide = this.mode !== 'orbit' && !(this.mode === 'follow' && p0 && p0.h < -40);
        const want = collide ? this._occlusion(this.tx, this.ty, this.th, this.tx - ca * back, this.ty - sa * back, this.th + up) : 1;
        if (!rdt || want < this._clipK) this._clipK = want;
        else this._clipK += (want - this._clipK) * (1 - Math.exp(-3 * rdt));
        back *= this._clipK; up *= this._clipK;
        let ex = this.tx - ca * back, ey = this.ty - sa * back, eh = this.th + up;
        // Не под верх острова: над полом глаз не ниже пола + 40.
        const fh = GameWorld.floorAt(ex, ey, -60);
        if (fh !== null && eh < fh + 40) eh = fh + 40;
        // Игрок падает в бездну: камера остаётся у края острова и смотрит вниз ему вслед
        // (не ныряет в скалу под островом).
        const p = Game.player;
        if (this.mode === 'follow' && p && p.h < -40) eh = Math.max(eh, 300);
        let sx = 0, sy = 0, sh = 0;
        if (this._shakeT > 0) {
            const a = this._shakeI * 22 * (this._shakeT / this._shakeDur);
            sx = (Math.random() * 2 - 1) * a; sy = (Math.random() * 2 - 1) * a; sh = (Math.random() * 2 - 1) * a * 0.6;
        }
        cam.position.set(ex + sx, eh + sh, ey + sy);
        this._eye.set(this.tx + sx * 0.5, this.th + sh * 0.5, this.ty + sy * 0.5);
        if (this._from && this._blendT > 0) {
            const u = Character.ease(1 - this._blendT / this._blendDur);
            BABYLON.Vector3.LerpToRef(this._from.pos, cam.position, u, cam.position);
            BABYLON.Vector3.LerpToRef(this._from.tgt, this._eye, u, this._eye);
        }
        cam.setTarget(this._eye);
        // Тени: кадр солнца вокруг точки чуть впереди игрока (кастеры отбирает GameWorld.shadowCenter).
        const ahead = this.mode === 'orbit' ? 0 : 300;
        GameWorld.shadowAt(this.tx + ca * ahead, this.ty + sa * ahead, Math.max(-200, this.th - GameCfg.camLookH));
    },

    // Доля отрезка «точка взгляда (tx, ty, th) -> глаз (ex, ey, eh)» до первого препятствия
    // (минус отступ GAME_CAM_COLLIDE): 1 — свободно. Круги коллайдеров, луч ниже их верха.
    _occlusion(tx, ty, th, ex, ey, eh) {
        const dx = ex - tx, dy = ey - ty, L2 = dx * dx + dy * dy;
        if (L2 < 1) return 1;
        const m = GameCfg.camCollide;
        let best = 1;
        for (const c of GameWorld.colliders) {
            const r = c.r + m, fx = tx - c.x, fy = ty - c.y;
            const cc = fx * fx + fy * fy - r * r;
            if (cc <= 0) continue;                  // точка взгляда у самого препятствия — не трогать
            const b = fx * dx + fy * dy;
            if (b >= 0) continue;                   // препятствие не в сторону глаза
            const disc = b * b - L2 * cc;
            if (disc <= 0) continue;
            const s = (-b - Math.sqrt(disc)) / L2;  // вход луча в круг
            if (s >= best) continue;
            if (th + (eh - th) * s > c.top) continue;   // луч проходит над препятствием
            if (c.r < this.THIN && c.model !== 'leaderboard') {
                const qx = ex - c.x, qy = ey - c.y;
                if (qx * qx + qy * qy > r * r) continue; // тонкий ствол между — пусть, глаз не внутри
            }
            best = s;
        }
        return Math.max(0.12, best);
    },
};
