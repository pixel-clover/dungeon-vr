import * as THREE from 'three';
import { makeFloorTexture, makeWallTexture, makeCeilingTexture } from './textures.js';

export const CELL = 2;
export const WALL_H = 3;

let _floorTex = null;
let _wallTex = null;
let _ceilTex = null;

function sharedTextures() {
    if (!_floorTex) _floorTex = makeFloorTexture();
    if (!_wallTex) _wallTex = makeWallTexture();
    if (!_ceilTex) _ceilTex = makeCeilingTexture();
    return { floor: _floorTex, wall: _wallTex, ceil: _ceilTex };
}

export class Dungeon {
    constructor() {
        this.group = new THREE.Group();
        this.grid = null;
        this.explored = null;
        this.W = 0;
        this.H = 0;
        this.rooms = [];
    }

    generate({
        width = 32,
        height = 32,
        roomCount = 10,
        minRoom = 4,
        maxRoom = 8,
        rng = Math.random,
    } = {}) {
        this.W = width;
        this.H = height;
        this.grid = new Uint8Array(width * height).fill(1);
        this.explored = new Uint8Array(width * height);
        this.rooms = [];

        for (let i = 0; i < roomCount; i++) {
            const r = this.tryPlaceRoom(minRoom, maxRoom, rng);
            if (r) this.rooms.push(r);
        }

        for (const r of this.rooms) {
            for (let yy = r.y; yy < r.y + r.h; yy++) {
                for (let xx = r.x; xx < r.x + r.w; xx++) {
                    this.grid[yy * width + xx] = 0;
                }
            }
        }

        for (let i = 1; i < this.rooms.length; i++) {
            const a = this.rooms[i - 1];
            const b = this.rooms[i];
            this.carveCorridor(a.cx, a.cy, b.cx, b.cy, rng);
        }

        this.buildMesh();
    }

    tryPlaceRoom(minRoom, maxRoom, rng) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const w = Math.floor(rng() * (maxRoom - minRoom + 1)) + minRoom;
            const h = Math.floor(rng() * (maxRoom - minRoom + 1)) + minRoom;
            const x = 1 + Math.floor(rng() * (this.W - w - 2));
            const y = 1 + Math.floor(rng() * (this.H - h - 2));
            let ok = true;
            for (const r of this.rooms) {
                if (
                    x < r.x + r.w + 1 &&
                    x + w + 1 > r.x &&
                    y < r.y + r.h + 1 &&
                    y + h + 1 > r.y
                ) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
            }
        }
        return null;
    }

    carveCorridor(x1, y1, x2, y2, rng) {
        if (rng() < 0.5) {
            this.carveH(x1, x2, y1);
            this.carveV(y1, y2, x2);
        } else {
            this.carveV(y1, y2, x1);
            this.carveH(x1, x2, y2);
        }
    }
    carveH(x1, x2, y) {
        const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
        for (let x = a; x <= b; x++) this.grid[y * this.W + x] = 0;
    }
    carveV(y1, y2, x) {
        const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
        for (let y = a; y <= b; y++) this.grid[y * this.W + x] = 0;
    }

    cellToWorld(gx, gz) {
        return new THREE.Vector3(
            (gx - this.W / 2 + 0.5) * CELL,
            0,
            (gz - this.H / 2 + 0.5) * CELL,
        );
    }

    worldToCell(worldX, worldZ) {
        return {
            gx: Math.floor(worldX / CELL + this.W / 2),
            gz: Math.floor(worldZ / CELL + this.H / 2),
        };
    }

    isWallCell(gx, gz) {
        if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.H) return true;
        return this.grid[gz * this.W + gx] === 1;
    }

    isWall(worldX, worldZ) {
        const { gx, gz } = this.worldToCell(worldX, worldZ);
        return this.isWallCell(gx, gz);
    }

    hasLOS(x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-3) return true;
        const step = 0.25;
        const steps = Math.ceil(dist / step);
        const ux = dx / steps;
        const uz = dz / steps;
        for (let i = 1; i < steps; i++) {
            if (this.isWall(x1 + ux * i, z1 + uz * i)) return false;
        }
        return true;
    }

    updateFog(worldX, worldZ, radiusCells = 5) {
        if (!this.explored) return;
        const { gx, gz } = this.worldToCell(worldX, worldZ);
        const r2 = radiusCells * radiusCells;
        for (let dy = -radiusCells; dy <= radiusCells; dy++) {
            for (let dx = -radiusCells; dx <= radiusCells; dx++) {
                if (dx * dx + dy * dy > r2) continue;
                const cx = gx + dx;
                const cz = gz + dy;
                if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) continue;
                const cw = this.cellToWorld(cx, cz);
                if (this.hasLOS(worldX, worldZ, cw.x, cw.z)) {
                    this.explored[cz * this.W + cx] = 1;
                }
            }
        }
    }

    findPath(startGx, startGz, endGx, endGz) {
        const W = this.W;
        const H = this.H;
        if (this.isWallCell(endGx, endGz)) return null;
        const startIdx = startGz * W + startGx;
        const endIdx = endGz * W + endGx;
        if (startIdx === endIdx) return [];
        const visited = new Uint8Array(W * H);
        const came = new Int32Array(W * H).fill(-1);
        const queue = new Int32Array(W * H);
        let head = 0;
        let tail = 0;
        queue[tail++] = startIdx;
        visited[startIdx] = 1;
        const dirs = [1, -1, W, -W];
        let found = false;
        while (head < tail) {
            const idx = queue[head++];
            if (idx === endIdx) {
                found = true;
                break;
            }
            const x = idx % W;
            for (let k = 0; k < 4; k++) {
                const ni = idx + dirs[k];
                if (k === 0 && x === W - 1) continue;
                if (k === 1 && x === 0) continue;
                if (ni < 0 || ni >= W * H) continue;
                if (visited[ni]) continue;
                if (this.grid[ni] === 1) continue;
                visited[ni] = 1;
                came[ni] = idx;
                queue[tail++] = ni;
            }
        }
        if (!found) return null;
        const path = [];
        let cur = endIdx;
        while (cur !== startIdx) {
            path.push({ gx: cur % W, gz: (cur / W) | 0 });
            cur = came[cur];
            if (cur === -1) return null;
        }
        return path.reverse();
    }

    spawnPoint() {
        const r = this.rooms[0];
        return this.cellToWorld(r.cx, r.cy);
    }

    randomFloorPointInRoom(room, rng = Math.random) {
        const x = room.x + Math.floor(rng() * room.w);
        const y = room.y + Math.floor(rng() * room.h);
        return this.cellToWorld(x, y);
    }

    isVisibleWall(x, y) {
        if (this.grid[y * this.W + x] !== 1) return false;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
                if (this.grid[ny * this.W + nx] === 0) return true;
            }
        }
        return false;
    }

    buildMesh() {
        while (this.group.children.length) {
            const c = this.group.children[0];
            this.group.remove(c);
            c.geometry?.dispose?.();
            c.material?.dispose?.();
        }

        let wallCount = 0;
        let floorCount = 0;
        for (let y = 0; y < this.H; y++) {
            for (let x = 0; x < this.W; x++) {
                const v = this.grid[y * this.W + x];
                if (v === 0) floorCount++;
                else if (this.isVisibleWall(x, y)) wallCount++;
            }
        }

        const tex = sharedTextures();
        const tileGeo = new THREE.BoxGeometry(CELL, 0.2, CELL);
        const floorMat = new THREE.MeshStandardMaterial({
            map: tex.floor,
            roughness: 0.9,
            color: 0xffffff,
        });
        const ceilMat = new THREE.MeshStandardMaterial({
            map: tex.ceil,
            roughness: 1,
            color: 0x999999,
        });
        const floor = new THREE.InstancedMesh(tileGeo, floorMat, floorCount);
        const ceil = new THREE.InstancedMesh(tileGeo, ceilMat, floorCount);
        floor.receiveShadow = true;

        const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
        const wallMat = new THREE.MeshStandardMaterial({
            map: tex.wall,
            roughness: 0.85,
            color: 0xffffff,
        });
        const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
        walls.castShadow = true;
        walls.receiveShadow = true;

        const m = new THREE.Matrix4();
        let fi = 0;
        let wi = 0;
        for (let y = 0; y < this.H; y++) {
            for (let x = 0; x < this.W; x++) {
                const v = this.grid[y * this.W + x];
                const wp = this.cellToWorld(x, y);
                if (v === 0) {
                    m.makeTranslation(wp.x, -0.1, wp.z);
                    floor.setMatrixAt(fi, m);
                    m.makeTranslation(wp.x, WALL_H + 0.1, wp.z);
                    ceil.setMatrixAt(fi, m);
                    fi++;
                } else if (this.isVisibleWall(x, y)) {
                    m.makeTranslation(wp.x, WALL_H / 2, wp.z);
                    walls.setMatrixAt(wi, m);
                    wi++;
                }
            }
        }
        floor.instanceMatrix.needsUpdate = true;
        ceil.instanceMatrix.needsUpdate = true;
        walls.instanceMatrix.needsUpdate = true;

        this.wallsMesh = walls;
        this.group.add(floor, ceil, walls);
    }
}
