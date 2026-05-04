import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as skeletonClone} from 'three/addons/utils/SkeletonUtils.js';

const ENEMY_DEFS = [
  {name: 'orc', url: 'assets/models/orc.glb', scale: 0.50, yOffset: 0, yawOffset: 0},
  {name: 'goleling', url: 'assets/models/goleling.glb', scale: 0.55, yOffset: 0, yawOffset: 0},
  {name: 'demon', url: 'assets/models/demon.glb', scale: 0.45, yOffset: 0, yawOffset: 0},
];

const cache = new Map();
let _loadPromise = null;

function loadOne(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, resolve, undefined, reject);
  });
}

export function preloadEnemyModels() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = Promise.all(
    ENEMY_DEFS.map(async (def) => {
      const gltf = await loadOne(def.url);
      cache.set(def.name, {gltf, def});
    }),
  );
  return _loadPromise;
}

function findClip(clips, names) {
  for (const n of names) {
    const found = clips.find((c) => c.name === n);
    if (found) return found;
  }
  const lower = names.map((n) => n.toLowerCase());
  for (const c of clips) {
    const cl = c.name.toLowerCase();
    for (const n of lower) {
      if (cl.includes(n)) return c;
    }
  }
  return null;
}

export function spawnEnemyModel(rng = Math.random, opts = {}) {
  const names = Array.from(cache.keys());
  if (names.length === 0) throw new Error('Enemy models not preloaded');
  const name = opts.forceName || names[Math.floor(rng() * names.length)];
  const entry = cache.get(name);
  if (!entry) throw new Error(`Enemy model ${name} not loaded`);

  const scaleMul = opts.scaleMul ?? 1;
  const object = skeletonClone(entry.gltf.scene);
  object.scale.setScalar(entry.def.scale * scaleMul);
  object.position.y = entry.def.yOffset;
  object.rotation.y = entry.def.yawOffset || 0;

  object.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => (m && m.clone ? m.clone() : m));
      } else if (o.material && o.material.clone) {
        o.material = o.material.clone();
      }
    }
  });

  const clips = entry.gltf.animations || [];
  const idle = findClip(clips, ['Idle', 'Flying_Idle', 'idle']);
  const walk = findClip(clips, ['Walk', 'Walking', 'Run', 'Running', 'Fast_Flying', 'Flying', 'Fly']);
  const attack = findClip(clips, ['Attack', 'Bite', 'Bite_Front', 'Punch', 'Headbutt', 'Slash']);
  const death = findClip(clips, ['Death', 'Die', 'Defeat']);
  const fallback = clips[0] || null;

  const mixer = new THREE.AnimationMixer(object);
  const actions = {};
  const idleClip = idle || fallback;
  const walkClip = walk || idle || fallback;
  const attackClip = attack || idle || fallback;
  const deathClip = death || idle || fallback;
  if (idleClip) actions.idle = mixer.clipAction(idleClip);
  if (walkClip) actions.walk = mixer.clipAction(walkClip);
  if (attackClip) actions.attack = mixer.clipAction(attackClip);
  if (deathClip) {
    actions.death = mixer.clipAction(deathClip);
    actions.death.setLoop(THREE.LoopOnce, 1);
    actions.death.clampWhenFinished = true;
  }

  return {name, object, mixer, actions};
}
