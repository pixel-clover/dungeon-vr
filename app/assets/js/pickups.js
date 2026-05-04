import * as THREE from 'three';

const MEDKIT_BASE_GEO = new THREE.BoxGeometry(0.3, 0.16, 0.22);
const MEDKIT_BASE_MAT = new THREE.MeshStandardMaterial({
    color: 0xf2f2f2,
    roughness: 0.4,
    emissive: 0x331010,
});
const CROSS_GEO_V = new THREE.BoxGeometry(0.06, 0.165, 0.18);
const CROSS_GEO_H = new THREE.BoxGeometry(0.22, 0.165, 0.06);
const CROSS_MAT = new THREE.MeshBasicMaterial({ color: 0xff2828 });

const AMMO_BOX_GEO = new THREE.BoxGeometry(0.3, 0.18, 0.22);
const AMMO_BOX_MAT = new THREE.MeshStandardMaterial({
    color: 0xddaa20,
    roughness: 0.6,
    emissive: 0x553808,
});
const AMMO_BAND_GEO = new THREE.BoxGeometry(0.31, 0.04, 0.23);
const AMMO_BAND_MAT = new THREE.MeshStandardMaterial({
    color: 0x352608,
    roughness: 0.7,
});

export class Medkit {
    constructor() {
        this.group = new THREE.Group();
        const base = new THREE.Mesh(MEDKIT_BASE_GEO, MEDKIT_BASE_MAT);
        const crossV = new THREE.Mesh(CROSS_GEO_V, CROSS_MAT);
        const crossH = new THREE.Mesh(CROSS_GEO_H, CROSS_MAT);
        this.light = new THREE.PointLight(0xff5050, 1.6, 3, 1.5);
        this.light.position.y = 0.3;
        this.group.add(base, crossV, crossH, this.light);

        this.t = Math.random() * Math.PI * 2;
        this.baseY = 0.45;
        this.alive = true;
        this.healAmount = 30;
        this.kind = 'medkit';
    }

    update(dt) {
        this.t += dt;
        this.group.rotation.y = this.t * 1.4;
        this.group.position.y = this.baseY + Math.sin(this.t * 2.2) * 0.07;
    }

    cleanup(scene) {
        scene.remove(this.group);
    }
}

export class AmmoCrate {
    constructor() {
        this.group = new THREE.Group();
        const base = new THREE.Mesh(AMMO_BOX_GEO, AMMO_BOX_MAT);
        const bandTop = new THREE.Mesh(AMMO_BAND_GEO, AMMO_BAND_MAT);
        bandTop.position.y = 0.06;
        const bandBottom = new THREE.Mesh(AMMO_BAND_GEO, AMMO_BAND_MAT);
        bandBottom.position.y = -0.06;
        this.light = new THREE.PointLight(0xffcc40, 1.2, 2.8, 1.5);
        this.light.position.y = 0.3;
        this.group.add(base, bandTop, bandBottom, this.light);

        this.t = Math.random() * Math.PI * 2;
        this.baseY = 0.45;
        this.alive = true;
        this.ammoAmount = 12;
        this.kind = 'ammo';
    }

    update(dt) {
        this.t += dt;
        this.group.rotation.y = this.t * 1.4;
        this.group.position.y = this.baseY + Math.sin(this.t * 2.2) * 0.07;
    }

    cleanup(scene) {
        scene.remove(this.group);
    }
}

export function spawnPickups(scene, dungeon, rng = Math.random) {
    const pickups = [];
    const rooms = dungeon.rooms.slice(1).sort(() => rng() - 0.5);
    if (rooms.length === 0) return pickups;

    const medkitCount = 1 + Math.floor(rng() * 2);
    const ammoCount = 1 + Math.floor(rng() * 2);

    let idx = 0;
    for (let i = 0; i < medkitCount; i++) {
        const room = rooms[idx++ % rooms.length];
        const wp = dungeon.randomFloorPointInRoom(room, rng);
        const m = new Medkit();
        m.group.position.set(wp.x, m.baseY, wp.z);
        scene.add(m.group);
        pickups.push(m);
    }
    for (let i = 0; i < ammoCount; i++) {
        const room = rooms[idx++ % rooms.length];
        const wp = dungeon.randomFloorPointInRoom(room, rng);
        const a = new AmmoCrate();
        a.group.position.set(wp.x, a.baseY, wp.z);
        scene.add(a.group);
        pickups.push(a);
    }
    return pickups;
}

export function disposePickups(scene, pickups) {
    for (const p of pickups) p.cleanup(scene);
}

export function checkPickups(pickups, playerPos, scene, audio, player, weapon) {
    const RANGE2 = 1.1 * 1.1;
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        if (!p.alive) continue;
        const dx = p.group.position.x - playerPos.x;
        const dz = p.group.position.z - playerPos.z;
        if (dx * dx + dz * dz < RANGE2) {
            let consumed = false;
            if (p.kind === 'medkit') {
                if (player.hp < player.maxHp) {
                    player.hp = Math.min(player.maxHp, player.hp + p.healAmount);
                    consumed = true;
                }
            } else if (p.kind === 'ammo') {
                if (weapon.reserveAmmo < weapon.maxReserveAmmo) {
                    weapon.reserveAmmo = Math.min(
                        weapon.maxReserveAmmo,
                        weapon.reserveAmmo + p.ammoAmount,
                    );
                    consumed = true;
                }
            }
            if (consumed) {
                p.alive = false;
                p.cleanup(scene);
                pickups.splice(i, 1);
                audio?.playPlayer('pickup', 0.7);
            }
        }
    }
}
