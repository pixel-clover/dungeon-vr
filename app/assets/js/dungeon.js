import * as THREE from 'three';
import {getFloorPBRSet, getWallPBRSet} from './textures.js';

export const CELL = 2;
export const WALL_H = 3;

function makeWorldUVMaterial({
                               map,
                               normalMap = null,
                               roughnessMap = null,
                               aoMap = null,
                               color = 0xffffff,
                               roughness = 1.0,
                               tileSize = 2,
                               normalScale = 1.0,
                             }) {
  const opts = {map, color, roughness};
  if (normalMap) opts.normalMap = normalMap;
  if (roughnessMap) opts.roughnessMap = roughnessMap;
  if (aoMap) {
    opts.aoMap = aoMap;
    opts.aoMapIntensity = 1.0;
  }
  const mat = new THREE.MeshStandardMaterial(opts);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTileSize = {value: tileSize};
    shader.uniforms.uNormalScale = {value: normalScale};

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vObjectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vObjectNormal = normal;
vec4 _wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
_wp = instanceMatrix * _wp;
#endif
_wp = modelMatrix * _wp;
vWorldPos = _wp.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vObjectNormal;
uniform float uTileSize;
uniform float uNormalScale;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 _absN = abs(vObjectNormal);
vec3 _w = _absN / max(_absN.x + _absN.y + _absN.z, 0.0001);
vec2 _uvY = vWorldPos.xz / uTileSize;
vec2 _uvX = vWorldPos.zy / uTileSize;
vec2 _uvZ = vWorldPos.xy / uTileSize;
#ifdef USE_MAP
vec4 _sampX = texture2D(map, _uvX);
vec4 _sampY = texture2D(map, _uvY);
vec4 _sampZ = texture2D(map, _uvZ);
vec4 sampledDiffuseColor = _sampX * _w.x + _sampY * _w.y + _sampZ * _w.z;
diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
float _rX = texture2D(roughnessMap, _uvX).g;
float _rY = texture2D(roughnessMap, _uvY).g;
float _rZ = texture2D(roughnessMap, _uvZ).g;
roughnessFactor *= (_rX * _w.x + _rY * _w.y + _rZ * _w.z);
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP
vec3 _nmX = texture2D(normalMap, _uvX).xyz * 2.0 - 1.0;
vec3 _nmY = texture2D(normalMap, _uvY).xyz * 2.0 - 1.0;
vec3 _nmZ = texture2D(normalMap, _uvZ).xyz * 2.0 - 1.0;
_nmX.xy *= uNormalScale;
_nmY.xy *= uNormalScale;
_nmZ.xy *= uNormalScale;
vec3 _wnX = vec3(_nmX.z, _nmX.y, _nmX.x);
vec3 _wnY = vec3(_nmY.x, _nmY.z, _nmY.y);
vec3 _wnZ = vec3(_nmZ.x, _nmZ.y, _nmZ.z);
_wnX.x *= sign(vObjectNormal.x + 0.0001);
_wnY.y *= sign(vObjectNormal.y + 0.0001);
_wnZ.z *= sign(vObjectNormal.z + 0.0001);
vec3 _wnPert = normalize(_wnX * _w.x + _wnY * _w.y + _wnZ * _w.z);
normal = normalize((viewMatrix * vec4(_wnPert, 0.0)).xyz);
#endif`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#ifdef USE_AOMAP
float _aoX = texture2D(aoMap, _uvX).r;
float _aoY = texture2D(aoMap, _uvY).r;
float _aoZ = texture2D(aoMap, _uvZ).r;
float _ao = _aoX * _w.x + _aoY * _w.y + _aoZ * _w.z;
float ambientOcclusion = (_ao - 1.0) * aoMapIntensity + 1.0;
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_ENVMAP ) && defined( STANDARD )
float specularOcclusion = computeSpecularOcclusion( dotNL, ambientOcclusion, material.roughness );
reflectedLight.indirectAmbient *= specularOcclusion;
#endif
#endif`,
      );
  };
  return mat;
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
             theme = null,
           } = {}) {
    this.theme = theme;
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
        return {x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1)};
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
    const {gx, gz} = this.worldToCell(worldX, worldZ);
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
    const {gx, gz} = this.worldToCell(worldX, worldZ);
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
      path.push({gx: cur % W, gz: (cur / W) | 0});
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

    const wallSet = getWallPBRSet();
    const floorSet = getFloorPBRSet();
    const theme = this.theme;
    const wallTint = theme?.wallTint ?? 0xffffff;
    const floorTint = theme?.floorTint ?? 0xffffff;
    const ceilTint = theme?.ceilTint ?? 0x6a6055;

    const tileGeo = new THREE.BoxGeometry(CELL, 0.2, CELL);
    const floorMat = makeWorldUVMaterial({
      ...floorSet,
      color: floorTint,
      roughness: 1.0,
      tileSize: 2.5,
      normalScale: 1.0,
    });
    const ceilMat = makeWorldUVMaterial({
      ...wallSet,
      color: ceilTint,
      roughness: 1.0,
      tileSize: 2.5,
      normalScale: 0.6,
    });
    const floor = new THREE.InstancedMesh(tileGeo, floorMat, floorCount);
    const ceil = new THREE.InstancedMesh(tileGeo, ceilMat, floorCount);
    floor.receiveShadow = true;

    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const wallMat = makeWorldUVMaterial({
      ...wallSet,
      color: wallTint,
      roughness: 1.0,
      tileSize: 2.5,
      normalScale: 1.2,
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
