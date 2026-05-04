import * as THREE from 'three';
import {spawnEnemyModel} from './models.js';

const ENEMY_HP = 100;
const ENEMY_SPEED = 1.7;
const ENEMY_RADIUS = 0.45;
const ENEMY_HEIGHT = 1.4;
const CONTACT_DAMAGE = 12;
const CONTACT_RANGE = 1.0;
const SIGHT_RANGE = 22;
const REPATH_INTERVAL = 0.45;
const WAYPOINT_REACHED = 0.35;
const FADE = 0.18;

export class Enemy {
  constructor(scene, position, audio = null, rng = Math.random, opts = {}) {
    this.scene = scene;
    this.audio = audio;
    this.alive = true;
    this.isBoss = !!opts.isBoss;
    this.hp = opts.hp ?? ENEMY_HP;
    this.maxHp = this.hp;
    this.contactDamage = opts.contactDamage ?? CONTACT_DAMAGE;
    this.roomIdx = opts.roomIdx ?? -1;
    this.lastAttackTime = -999;
    this.spotted = false;
    this._flashId = 0;

    this.path = null;
    this.pathIdx = 0;
    this.nextRepathTime = rng() * REPATH_INTERVAL;

    const spawned = spawnEnemyModel(rng, {
      forceName: opts.modelName,
      scaleMul: opts.scaleMul ?? 1,
    });
    this.modelName = spawned.name;
    this.model = spawned.object;
    this.mixer = spawned.mixer;
    this.actions = spawned.actions;

    this._meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        this._meshes.push(o);
        o.castShadow = true;
      }
    });
    this._origColors = this._meshes.map((m) => m.material.color?.getHex() ?? 0xffffff);

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.add(this.model);
    scene.add(this.group);

    this._activeAction = null;
    this._setAction('idle', 0);
  }

  _setAction(name, fade = FADE) {
    const next = this.actions[name];
    if (!next || next === this._activeAction) return;
    if (this._activeAction) {
      this._activeAction.fadeOut(fade);
    }
    next.reset().fadeIn(fade).play();
    this._activeAction = next;
  }

  update(dt, player, dungeon, now) {
    this.mixer.update(dt);
    if (!this.alive) return;

    const ep = this.group.position;
    const pp = player.rig.position;
    const dxAll = pp.x - ep.x;
    const dzAll = pp.z - ep.z;
    const distAll = Math.hypot(dxAll, dzAll);

    if (distAll > SIGHT_RANGE) {
      this._setAction('idle');
      return;
    }

    const hasLOS = dungeon.hasLOS(ep.x, ep.z, pp.x, pp.z);
    if (hasLOS && !this.spotted) {
      this.spotted = true;
      this.audio?.playAt('growl', ep, 0.7);
    }

    if (distAll <= CONTACT_RANGE) {
      if (now - this.lastAttackTime > 0.8) {
        player.damage(this.contactDamage, now);
        this.audio?.playAt('attack', ep, this.isBoss ? 1.1 : 0.9);
        this.lastAttackTime = now;
      }
      this.group.rotation.y = Math.atan2(dxAll, dzAll);
      this._setAction('attack');
      return;
    }

    let tgtX;
    let tgtZ;
    if (hasLOS) {
      tgtX = pp.x;
      tgtZ = pp.z;
      this.path = null;
    } else {
      if (now >= this.nextRepathTime) {
        const startCell = dungeon.worldToCell(ep.x, ep.z);
        const endCell = dungeon.worldToCell(pp.x, pp.z);
        const newPath = dungeon.findPath(startCell.gx, startCell.gz, endCell.gx, endCell.gz);
        this.path = newPath;
        this.pathIdx = 0;
        this.nextRepathTime = now + REPATH_INTERVAL * (0.85 + Math.random() * 0.3);
      }
      const wp = this._currentWaypointWorld(dungeon);
      if (wp) {
        tgtX = wp.x;
        tgtZ = wp.z;
        if (Math.hypot(tgtX - ep.x, tgtZ - ep.z) < WAYPOINT_REACHED) {
          this.pathIdx++;
        }
      } else {
        tgtX = pp.x;
        tgtZ = pp.z;
      }
    }

    const dx = tgtX - ep.x;
    const dz = tgtZ - ep.z;
    const d = Math.hypot(dx, dz);
    let moved = false;
    if (d > 1e-3) {
      const ux = dx / d;
      const uz = dz / d;
      const step = ENEMY_SPEED * dt;
      const nx = ep.x + ux * step;
      const nz = ep.z + uz * step;
      const beforeX = ep.x;
      const beforeZ = ep.z;
      if (!dungeon.isWall(nx, ep.z)) ep.x = nx;
      if (!dungeon.isWall(ep.x, nz)) ep.z = nz;
      moved = ep.x !== beforeX || ep.z !== beforeZ;
      this.group.rotation.y = Math.atan2(ux, uz);
    }
    this._setAction(moved ? 'walk' : 'idle');
  }

  _currentWaypointWorld(dungeon) {
    if (!this.path || this.pathIdx >= this.path.length) return null;
    const c = this.path[this.pathIdx];
    return dungeon.cellToWorld(c.gx, c.gz);
  }

  intersectRay(origin, dir) {
    const cx = this.group.position.x;
    const cz = this.group.position.z;
    const cyMin = this.group.position.y;
    const cyMax = this.group.position.y + ENEMY_HEIGHT;
    const r = ENEMY_RADIUS;

    const ox = origin.x - cx;
    const oz = origin.z - cz;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-6) return null;
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    const tCandidates = [t1, t2].filter((t) => t >= 0);
    for (const t of tCandidates) {
      const y = origin.y + dir.y * t;
      if (y >= cyMin - 0.1 && y <= cyMax + 0.1) return t;
    }
    return null;
  }

  damage(amount, info = null) {
    if (!this.alive) return;
    this.hp -= amount;
    if (info?.headshot) this._lastHitWasHeadshot = true;
    const flashId = ++this._flashId;
    for (let i = 0; i < this._meshes.length; i++) {
      const mat = this._meshes[i].material;
      if (mat && mat.color) {
        mat.color.setHex(0xffffff);
      }
    }
    setTimeout(() => {
      if (!this.alive) return;
      if (flashId !== this._flashId) return;
      for (let i = 0; i < this._meshes.length; i++) {
        const mat = this._meshes[i].material;
        if (mat && mat.color) mat.color.setHex(this._origColors[i]);
      }
    }, 70);
    if (this.hp <= 0) this.kill();
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.audio?.playAt('death', this.group.position, 0.9);
    this._setAction('death', 0.05);
    const deathClip = this.actions.death?.getClip?.();
    const deathDurationMs = deathClip ? deathClip.duration * 1000 : 800;
    this._removeAt = performance.now() + Math.max(800, deathDurationMs);
  }

  cleanup() {
    this.scene.remove(this.group);
    this.mixer.stopAllAction();
    this._meshes.forEach((m) => {
      m.material?.dispose?.();
    });
  }
}

function findFarthestRoomIdx(rooms) {
  if (rooms.length < 2) return -1;
  const start = rooms[0];
  let farIdx = 1;
  let farD2 = 0;
  for (let i = 1; i < rooms.length; i++) {
    const dx = rooms[i].cx - start.cx;
    const dy = rooms[i].cy - start.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > farD2) {
      farD2 = d2;
      farIdx = i;
    }
  }
  return farIdx;
}

export function spawnEnemiesInDungeon(scene, dungeon, audio = null, rng = Math.random, opts = {}) {
  const enemies = [];
  const hpMult = opts.difficulty ?? 1.0;
  const dmgMult = opts.damageMult ?? 1.0;
  const countMult = opts.countMult ?? 1.0;
  const bossRoomIdx = findFarthestRoomIdx(dungeon.rooms);

  for (let i = 1; i < dungeon.rooms.length; i++) {
    const room = dungeon.rooms[i];
    if (i === bossRoomIdx) {
      const p = dungeon.randomFloorPointInRoom(room, rng);
      enemies.push(new Enemy(scene, p, audio, rng, {
        isBoss: true,
        modelName: 'demon',
        scaleMul: 2.4,
        hp: 400 * hpMult,
        contactDamage: 25 * dmgMult,
        roomIdx: i,
      }));
      continue;
    }
    const count = 1 + Math.floor(rng() * 2 * countMult);
    for (let k = 0; k < count; k++) {
      const p = dungeon.randomFloorPointInRoom(room, rng);
      enemies.push(new Enemy(scene, p, audio, rng, {
        hp: ENEMY_HP * hpMult,
        contactDamage: CONTACT_DAMAGE * dmgMult,
        roomIdx: i,
      }));
    }
  }
  return enemies;
}

export function spawnWaveEnemy(scene, dungeon, audio, rng, roomIdx, opts = {}) {
  const room = dungeon.rooms[roomIdx];
  if (!room) return null;
  const p = dungeon.randomFloorPointInRoom(room, rng);
  const hpMult = opts.hpMult ?? 1.0;
  const dmgMult = opts.dmgMult ?? 1.0;
  return new Enemy(scene, p, audio, rng, {
    hp: ENEMY_HP * hpMult,
    contactDamage: CONTACT_DAMAGE * dmgMult,
    roomIdx,
  });
}
