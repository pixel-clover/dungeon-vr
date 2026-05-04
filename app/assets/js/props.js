import * as THREE from 'three';
import { CELL } from './dungeon.js';

const SCONCE_GEO = new THREE.BoxGeometry(0.18, 0.1, 0.08);
const STICK_GEO = new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6);
const FLAME_GEO = new THREE.SphereGeometry(0.07, 10, 10);

const WOOD_DARK_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.85 });
const WOOD_MID_MAT = new THREE.MeshStandardMaterial({ color: 0x5a3e22, roughness: 0.85 });
const IRON_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.5, metalness: 0.6 });
const FLAME_MAT = new THREE.MeshBasicMaterial({
    color: 0xffaa55,
    transparent: true,
    opacity: 0.95,
});
const FLAME_GLOW_MAT = new THREE.MeshBasicMaterial({
    color: 0xff6020,
    transparent: true,
    opacity: 0.45,
});

const BARREL_BODY_GEO = new THREE.CylinderGeometry(0.32, 0.36, 0.85, 14);
const BARREL_BAND_GEO = new THREE.TorusGeometry(0.36, 0.02, 6, 16);
const BARREL_LID_GEO = new THREE.CylinderGeometry(0.33, 0.33, 0.04, 14);

const CRATE_GEO = new THREE.BoxGeometry(0.7, 0.6, 0.7);
const CRATE_PLANK_MAT = new THREE.MeshStandardMaterial({ color: 0x6a4828, roughness: 0.85 });

export class Torch {
    constructor() {
        this.group = new THREE.Group();

        const sconce = new THREE.Mesh(SCONCE_GEO, WOOD_DARK_MAT);
        sconce.position.set(0, 0, -0.04);

        const stick = new THREE.Mesh(STICK_GEO, WOOD_DARK_MAT);
        stick.rotation.x = Math.PI / 8;
        stick.position.set(0, 0.18, -0.12);

        const flame = new THREE.Mesh(FLAME_GEO, FLAME_MAT.clone());
        flame.position.set(0, 0.36, -0.18);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 12, 12),
            FLAME_GLOW_MAT.clone(),
        );
        glow.position.copy(flame.position);

        this.light = new THREE.PointLight(0xffaa55, 4.5, 9, 1.4);
        this.light.position.set(0, 0.42, -0.22);

        this.group.add(sconce, stick, flame, glow, this.light);

        this.flame = flame;
        this.glow = glow;
        this.baseIntensity = 4.5;
        this.t = Math.random() * 100;
    }

    update(dt) {
        this.t += dt;
        const flicker =
            Math.sin(this.t * 9.1) * 0.18 +
            Math.sin(this.t * 23.7) * 0.09 +
            Math.sin(this.t * 41.3) * 0.05;
        const k = 1 + flicker;
        this.light.intensity = this.baseIntensity * k;
        const scale = 0.9 + flicker * 0.5;
        this.flame.scale.setScalar(scale);
        this.glow.scale.setScalar(scale * 0.95);
        this.flame.material.opacity = 0.85 + flicker * 0.1;
        this.glow.material.opacity = 0.35 + flicker * 0.15;
    }

    dispose() {
        this.flame.material.dispose();
        this.glow.material.dispose();
    }
}

export class Barrel {
    constructor() {
        this.group = new THREE.Group();
        const body = new THREE.Mesh(BARREL_BODY_GEO, WOOD_MID_MAT);
        body.position.y = 0.425;
        const lid = new THREE.Mesh(BARREL_LID_GEO, WOOD_DARK_MAT);
        lid.position.y = 0.86;
        const upperBand = new THREE.Mesh(BARREL_BAND_GEO, IRON_MAT);
        upperBand.rotation.x = Math.PI / 2;
        upperBand.position.y = 0.7;
        const lowerBand = new THREE.Mesh(BARREL_BAND_GEO, IRON_MAT);
        lowerBand.rotation.x = Math.PI / 2;
        lowerBand.position.y = 0.18;
        this.group.add(body, lid, upperBand, lowerBand);
    }
    update() {}
    dispose() {}
}

export class Crate {
    constructor() {
        this.group = new THREE.Group();
        const body = new THREE.Mesh(CRATE_GEO, CRATE_PLANK_MAT);
        body.position.y = 0.3;
        this.group.add(body);
        for (let i = 0; i < 4; i++) {
            const edge = new THREE.Mesh(
                new THREE.BoxGeometry(0.72, 0.04, 0.04),
                IRON_MAT,
            );
            edge.position.set(0, i % 2 === 0 ? 0.04 : 0.56, i < 2 ? 0.36 : -0.36);
            this.group.add(edge);
        }
    }
    update() {}
    dispose() {}
}

function findRoomEdgeWalls(dungeon, room) {
    const sides = [];
    for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
            const dirs = [
                [1, 0], [-1, 0], [0, 1], [0, -1],
            ];
            for (const [dx, dz] of dirs) {
                if (dungeon.isWallCell(x + dx, y + dz)) {
                    if (
                        x === room.x ||
                        x === room.x + room.w - 1 ||
                        y === room.y ||
                        y === room.y + room.h - 1
                    ) {
                        sides.push({ gx: x, gz: y, dx, dz });
                    }
                }
            }
        }
    }
    return sides;
}

export function populateDungeon(scene, dungeon, rng = Math.random, opts = {}) {
    const props = [];
    const maxTorches = opts.maxTorches ?? 8;
    let torchBudget = maxTorches;

    const rooms = dungeon.rooms.slice().sort(() => rng() - 0.5);
    for (const room of rooms) {
        const walls = findRoomEdgeWalls(dungeon, room);
        if (walls.length > 0 && torchBudget > 0 && rng() < 0.85) {
            const pick = walls[Math.floor(rng() * walls.length)];
            const torch = new Torch();
            const cellWorld = dungeon.cellToWorld(pick.gx, pick.gz);
            const wallOffset = (CELL / 2) - 0.08;
            torch.group.position.set(
                cellWorld.x + pick.dx * wallOffset,
                1.85,
                cellWorld.z + pick.dz * wallOffset,
            );
            torch.group.lookAt(cellWorld.x, 1.85, cellWorld.z);
            scene.add(torch.group);
            props.push(torch);
            torchBudget--;
        }

        const propCount = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < propCount; i++) {
            const px = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
            const pz = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
            const wp = dungeon.cellToWorld(px, pz);
            const jitterX = (rng() - 0.5) * (CELL - 1);
            const jitterZ = (rng() - 0.5) * (CELL - 1);
            const prop = rng() < 0.55 ? new Barrel() : new Crate();
            prop.group.position.set(wp.x + jitterX, 0, wp.z + jitterZ);
            prop.group.rotation.y = rng() * Math.PI * 2;
            scene.add(prop.group);
            props.push(prop);
        }
    }

    return props;
}

export function disposeProps(scene, props) {
    for (const p of props) {
        scene.remove(p.group);
        p.group.traverse((o) => {
            if (o.geometry && o.geometry !== SCONCE_GEO && o.geometry !== STICK_GEO &&
                o.geometry !== FLAME_GEO && o.geometry !== BARREL_BODY_GEO &&
                o.geometry !== BARREL_BAND_GEO && o.geometry !== BARREL_LID_GEO &&
                o.geometry !== CRATE_GEO) {
                o.geometry.dispose();
            }
        });
        p.dispose();
    }
}
