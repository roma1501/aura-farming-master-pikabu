// GameCombat.js — шлепок (DESIGN.md §4, §6, §10): замах, выбор цели в момент удара,
// отбрасывание по силе перчатки, оглушение, +1 аура атакующему, кредит KO (lastHitBy),
// событие slap. Игрок бьёт «гарантированно» (opts.forced): в момент удара цель берётся,
// если она в GAME_SLAP_LOCK × радиуса, иначе — ближайшая другая допустимая; боты могут
// промахнуться (opts.miss или цель ушла из радиуса/конуса).
//
// Сила/скорость/перезарядка/дальность — из GameGloves.LIST (DESIGN §10) через gloveStats(id)
// (кэш по id; таблица GLOVES ниже — запас, если модуля перчаток нет). Отбрасывание:
// горизонталь = Сила × GAME_KNOCK_H (px/с), вертикаль = GAME_KNOCK_V + Сила × GAME_KNOCK_V_K;
// множители персонажа — char.mods.power, .range, .slapSpeed, .cooldown (их ведёт GameAbilities).
//
// Способности «на шлепок» (GameAbilities): hit() зовёт GameAbilities.onHit(attacker, victim,
// fx, dx, dy) ДО отбрасывания — способность может поменять fx.power / fx.up (вертикаль) /
// fx.side (горизонталь) / fx.stun или отложить отбрасывание (fx.defer — «Лёд»), и
// GameAbilities.afterHit(attacker, victim, fx) ПОСЛЕ события slap и +1 ауры (бонусная аура,
// частицы). opts.noAbility — без них.
//
// Для способностей: canAffect(c, attacker) — можно ли задеть (жив, не скрыт, без защиты
// появления, зона с pvp, не своя команда); blast(...) задевает только таких; push(...) —
// без проверок (способность сама решает, кого толкать: зовите canAffect).

/** @satisfies {Record<string, any>} */
const GameCombat = {
    // Запас на случай, если GameGloves нет: id -> { power, speed (множитель анимации), cooldown (с), range (множитель радиуса) }.
    GLOVES: {
        default: { power: 600, speed: 1.0, cooldown: 0.55 },
        slime: { power: 650, speed: 1.0, cooldown: 0.55 },
        love: { power: 640, speed: 1.1, cooldown: 0.5 },
        ice: { power: 680, speed: 1.0, cooldown: 0.6 },
        fire: { power: 700, speed: 1.2, cooldown: 0.5 },
        bomb: { power: 720, speed: 1.4, cooldown: 0.53 },
        meteor: { power: 760, speed: 1.0, cooldown: 0.6 },
        tile: { power: 580, speed: 1.65, cooldown: 0.44 },
        brainrot: { power: 680, speed: 1.4, cooldown: 0.35 },
        ghost: { power: 700, speed: 1.3, cooldown: 0.5 },
        gravity: { power: 740, speed: 1.1, cooldown: 0.55 },
        speed: { power: 620, speed: 1.8, cooldown: 0.4 },
        blackhole: { power: 800, speed: 1.0, cooldown: 0.6 },
        giant: { power: 1000, speed: 0.8, cooldown: 0.8, range: 1.5 },
        golden: { power: 900, speed: 1.3, cooldown: 0.45 },
        diamond: { power: 1100, speed: 1.5, cooldown: 0.45 },
    },
    /** @type {Record<string, { id: string, power: number, speed: number, cooldown: number, range: number, scale: number }>} */
    _stats: {},

    // Характеристики перчатки { id, power, speed, cooldown, range, scale } — общий объект на id
    // (только читать). Источник — GameGloves.get(id), запас — GLOVES. scale — доп. масштаб
    // модели в руке (у всех 1: «Гигант» крупный уже в файле — второй раз не масштабируется).
    gloveStats(id) {
        const key = id || 'default';
        const hit = this._stats[key];
        if (hit) return hit;
        const s = { id: key, power: 600, speed: 1, cooldown: 0.55, range: 1, scale: 1 };
        Object.assign(s, this.GLOVES[key] || this.GLOVES.default);
        const g = typeof GameGloves !== 'undefined' && typeof GameGloves.get === 'function' ? GameGloves.get(key) : null;
        if (g) for (const k of ['power', 'speed', 'cooldown', 'range', 'scale']) if (typeof g[k] === 'number') s[k] = g[k];
        if (typeof GameGloves !== 'undefined') this._stats[key] = s;
        return s;
    },

    // Радиус шлепка персонажа, px.
    range(ch) {
        const st = this.gloveStats(ch.glove);
        return GameCfg.slapRange * (st.range || 1) * (ch.mods.range || 1);
    },

    // Можно ли attacker шлёпнуть victim: живы, одна зона, зона разрешает, не своя команда,
    // жертва не в полёте/не лежит/не под защитой, видна атакующему, высоты близки.
    canHit(attacker, victim) {
        if (!attacker || !victim || attacker === victim || victim.disposed) return false;
        if (!victim.canBeSlapped() || attacker.state === 'dead') return false;
        if (attacker.zone !== victim.zone || !Game.pvp(attacker.zone)) return false;
        if (attacker.team && attacker.team === victim.team) return false;
        // «Призрак»: невидимого не видят боты (игрок видит полупрозрачным и бьёт).
        if (victim.invisible && !attacker.isPlayer) return false;
        return Math.abs(attacker.h - victim.h) < GameCfg.slapHeight;
    },

    // Ближайшая допустимая цель в радиусе maxDist (по умолчанию — радиус шлепка). except — пропустить.
    nearestTarget(attacker, maxDist, except) {
        const R = maxDist == null ? this.range(attacker) : maxDist;
        let best = null, bd = R * R;
        for (const c of Game.chars) {
            if (c === except || !this.canHit(attacker, c)) continue;
            const dx = c.x - attacker.x, dy = c.y - attacker.y, d2 = dx * dx + dy * dy;
            if (d2 <= bd) { bd = d2; best = c; }
        }
        return best;
    },

    // Начать шлепок. opts: { forced: true — игрок (попадание гарантировано), miss: true —
    // бот промахивается нарочно }. false — перчатка не готова или персонаж занят.
    trySlap(attacker, target, opts) {
        if (!attacker || !attacker.canSlap()) return false;
        attacker.startSlap(target, opts || {});
        return true;
    },

    // Момент удара (зовёт Character на середине удара): выбрать жертву и ударить.
    contact(attacker, slap) {
        const o = slap.opts || {};
        let v = slap.target;
        const R = this.range(attacker);
        if (o.miss) v = null;
        else if (o.forced) {
            if (!this.canHit(attacker, v) || this._dist(attacker, v) > R * GameCfg.slapLock) v = this.nearestTarget(attacker, R * GameCfg.slapLock);
        } else if (!this.canHit(attacker, v) || this._dist(attacker, v) > R * GameCfg.botMissRange || !this._inFront(attacker, v, GameCfg.botMissAngle)) {
            v = null;
        }
        if (v) this.hit(attacker, v);
        else Game.emit('miss', { char: attacker });
    },

    _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

    _inFront(a, b, maxAngle) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        let d = ang - a.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= maxAngle;
    },

    // Попадание: способность «на шлепок», отбрасывание, кредит KO, событие slap (аура за шлепок — GAME_SLAP_AURA, по умолчанию 0).
    // opts: { power?: своя сила, stun?, noAura?, noAbility?, dir?: {x, y} — своё направление }.
    hit(attacker, victim, opts) {
        const o = opts || {};
        const st = this.gloveStats(attacker.glove);
        const up = typeof GameFarm !== 'undefined' ? GameFarm.slapMult(attacker) : 1;   // прокачка «Сила шлепка»
        const power = (o.power != null ? o.power : st.power) * (attacker.mods.power || 1) * up;
        let dx, dy;
        if (o.dir) { dx = o.dir.x; dy = o.dir.y; }
        else {
            dx = victim.x - attacker.x; dy = victim.y - attacker.y;
            const d = Math.hypot(dx, dy);
            // От атакующего, с долей его взгляда: удар справа налево сносит чуть вбок.
            const fx = Math.cos(attacker.heading), fy = Math.sin(attacker.heading);
            if (d < 1) { dx = fx; dy = fy; } else { dx = dx / d * 0.8 + fx * 0.2; dy = dy / d * 0.8 + fy * 0.2; }
        }
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const ab = !o.noAbility && typeof GameAbilities !== 'undefined' ? GameAbilities : null;
        const fx = { power, stun: o.stun, up: 1, side: 1, defer: false };
        if (ab) { try { ab.onHit(attacker, victim, fx, dx, dy); } catch (e) { console.error('GameAbilities.onHit:', e); } }
        if (!fx.defer) this.push(victim, dx, dy, fx.power, { attacker, stun: fx.stun, up: fx.up, side: fx.side });
        else { victim.lastHitBy = attacker; victim.lastHitTime = Game.time; }
        Game.emit('slap', { attacker, victim, glove: attacker.glove, power: fx.power, dir: { x: dx, y: dy } });
        if (!o.noAura && GameCfg.slapAura > 0) Game.addAura(attacker, GameCfg.slapAura);   // аура за шлепок убрана: её дают зоны и позы
        if (ab) { try { ab.afterHit(attacker, victim, fx); } catch (e) { console.error('GameAbilities.afterHit:', e); } }
        return true;
    },

    // Отбросить персонажа силой power по направлению (dx, dy) (единичный вектор).
    // opts: { attacker — кредит KO, stun, up — множитель вертикали, side — множитель горизонтали }.
    push(victim, dx, dy, power, opts) {
        const o = opts || {};
        const hs = power * GameCfg.knockH * (o.side == null ? 1 : o.side);
        const vs = (GameCfg.knockV + power * GameCfg.knockVK) * (o.up == null ? 1 : o.up);
        victim.knockback(dx * hs, dy * hs, vs, o.stun);
        if (o.attacker && o.attacker !== victim) { victim.lastHitBy = o.attacker; victim.lastHitTime = Game.time; }
    },

    // Можно ли задеть персонажа способностью/взрывом: жив, виден, не под защитой появления,
    // зона разрешает шлепки, не своя команда атакующего. Полёт/лежачие — можно (добивание).
    canAffect(c, attacker) {
        if (!c || c === attacker || c.disposed || c.state === 'dead' || c.hidden) return false;
        if (Game.time < c.shieldUntil || !Game.pvp(c.zone)) return false;
        return !(attacker && attacker.team && attacker.team === c.team);
    },

    // Взрыв: всех в радиусе (canAffect) — от центра, сила спадает к краю. Возвращает задетых.
    blast(x, y, radius, power, attacker, zone) {
        const out = [];
        for (const c of Game.chars) {
            if (!this.canAffect(c, attacker) || (zone && c.zone !== zone)) continue;
            const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy);
            if (d > radius) continue;
            const k = 0.55 + 0.45 * (1 - d / radius);
            this.push(c, d > 1 ? dx / d : 1, d > 1 ? dy / d : 0, power * k, { attacker, up: 1.25 });
            out.push(c);
        }
        return out;
    },
};
