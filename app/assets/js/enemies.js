import * as THREE from 'three';

const ENEMY_HP = 100;
const ENEMY_SPEED = 1.7;
const ENEMY_RADIUS = 0.45;
const ENEMY_HEIGHT = 1.4;
const CONTACT_DAMAGE = 12;
const CONTACT_RANGE = 1.0;
const SIGHT_RANGE = 22;
const REPATH_INTERVAL = 0.45;
const WAYPOINT_REACHED = 0.35;

export class Enemy {
    constructor(scene, position, audio = null) {
        this.scene = scene;
        this.audio = audio;
        this.alive = true;
        this.hp = ENEMY_HP;
        this.lastAttackTime = -999;
        this.spotted = false;

        this.path = null;
        this.pathIdx = 0;
        this.nextRepathTime = Math.random() * REPATH_INTERVAL;

        const body = new THREE.Mesh(
            new THREE.CapsuleGeometry(ENEMY_RADIUS, ENEMY_HEIGHT - 2 * ENEMY_RADIUS, 4, 8),
            new THREE.MeshStandardMaterial({ color: 0x9a3030, roughness: 0.8 }),
        );
        body.position.y = ENEMY_HEIGHT / 2;
        body.castShadow = true;

        const eye = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 8),
            new THREE.MeshStandardMaterial({
                color: 0xffe040,
                emissive: 0xffaa00,
                emissiveIntensity: 1.5,
            }),
        );
        eye.position.set(0, ENEMY_HEIGHT * 0.78, ENEMY_RADIUS * 0.95);

        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.add(body, eye);
        scene.add(this.group);

        this.body = body;
    }

    update(dt, player, dungeon, now) {
        if (!this.alive) return;

        const ep = this.group.position;
        const pp = player.rig.position;
        const dxAll = pp.x - ep.x;
        const dzAll = pp.z - ep.z;
        const distAll = Math.hypot(dxAll, dzAll);

        if (distAll > SIGHT_RANGE) return;

        const hasLOS = dungeon.hasLOS(ep.x, ep.z, pp.x, pp.z);
        if (hasLOS && !this.spotted) {
            this.spotted = true;
            this.audio?.playAt('growl', ep, 0.7);
        }

        if (distAll <= CONTACT_RANGE) {
            if (now - this.lastAttackTime > 0.8) {
                player.damage(CONTACT_DAMAGE, now);
                this.audio?.playAt('attack', ep, 0.9);
                this.lastAttackTime = now;
            }
            this.group.rotation.y = Math.atan2(dxAll, dzAll);
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
        if (d > 1e-3) {
            const ux = dx / d;
            const uz = dz / d;
            const step = ENEMY_SPEED * dt;
            const nx = ep.x + ux * step;
            const nz = ep.z + uz * step;
            if (!dungeon.isWall(nx, ep.z)) ep.x = nx;
            if (!dungeon.isWall(ep.x, nz)) ep.z = nz;
            this.group.rotation.y = Math.atan2(ux, uz);
        }
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

    damage(amount) {
        if (!this.alive) return;
        this.hp -= amount;
        const flash = this.body.material;
        const orig = flash.color.getHex();
        flash.color.setHex(0xffffff);
        setTimeout(() => {
            if (this.alive) flash.color.setHex(orig);
        }, 60);
        if (this.hp <= 0) this.kill();
    }

    kill() {
        this.alive = false;
        this.audio?.playAt('death', this.group.position, 0.9);
        this.scene.remove(this.group);
        this.group.traverse((o) => {
            o.geometry?.dispose?.();
            o.material?.dispose?.();
        });
    }
}

export function spawnEnemiesInDungeon(scene, dungeon, audio = null, rng = Math.random) {
    const enemies = [];
    for (let i = 1; i < dungeon.rooms.length; i++) {
        const room = dungeon.rooms[i];
        const count = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < count; k++) {
            const p = dungeon.randomFloorPointInRoom(room, rng);
            enemies.push(new Enemy(scene, p, audio));
        }
    }
    return enemies;
}
