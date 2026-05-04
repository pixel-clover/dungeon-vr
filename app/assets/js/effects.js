import * as THREE from 'three';

const SHARD_GEO = new THREE.BoxGeometry(0.07, 0.07, 0.07);
const SHARD_MAT = new THREE.MeshStandardMaterial({
  color: 0x401010,
  emissive: 0xff5020,
  emissiveIntensity: 1.4,
  roughness: 0.8,
});

const FIREBALL_GEO = new THREE.IcosahedronGeometry(0.3, 1);

export class Explosion {
  constructor(scene, position, audio = null, options = {}) {
    this.scene = scene;
    this.life = 0;
    this.duration = options.duration ?? 0.7;
    this.alive = true;

    this.fireballMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fireball = new THREE.Mesh(FIREBALL_GEO, this.fireballMat);
    this.fireball.position.copy(position);
    this.fireball.renderOrder = 50;
    scene.add(this.fireball);

    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0x161208,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.smoke = new THREE.Mesh(FIREBALL_GEO, this.smokeMat);
    this.smoke.position.copy(position);
    scene.add(this.smoke);

    const lightIntensity = options.lightIntensity ?? 22;
    const lightRange = options.lightRange ?? 7;
    this.light = new THREE.PointLight(0xff8030, lightIntensity, lightRange, 1.4);
    this.light.position.copy(position);
    this._lightBaseIntensity = lightIntensity;
    scene.add(this.light);

    this.shards = [];
    const shardCount = options.shardCount ?? 10;
    for (let i = 0; i < shardCount; i++) {
      const m = new THREE.Mesh(SHARD_GEO, SHARD_MAT);
      m.position.copy(position);
      m.scale.setScalar(0.5 + Math.random() * 0.6);
      const phi = Math.random() * Math.PI * 2;
      const cosTheta = Math.random() * 0.6 + 0.2;
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const dir = new THREE.Vector3(
        Math.cos(phi) * sinTheta,
        cosTheta,
        Math.sin(phi) * sinTheta,
      );
      const speed = 3 + Math.random() * 4;
      this.shards.push({
        mesh: m,
        vel: dir.multiplyScalar(speed),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ),
      });
      scene.add(m);
    }

    audio?.playAt('explosion', position, 1.0, 0.9 + Math.random() * 0.2);
  }

  update(dt) {
    if (!this.alive) return false;
    this.life += dt;
    const t = this.life / this.duration;
    if (t >= 1) {
      this.dispose();
      return false;
    }

    const grow = 1 - Math.pow(1 - t, 2.2);
    this.fireball.scale.setScalar(0.4 + grow * 5);
    this.fireballMat.opacity = Math.max(0, 1 - t * 1.4);
    this.fireballMat.color.setHSL(0.07 - t * 0.05, 1.0, 0.5 - t * 0.3);

    this.smoke.scale.setScalar(0.4 + grow * 6);
    this.smokeMat.opacity = Math.min(0.55, t * 0.9) * Math.max(0, 1 - (t - 0.6) * 2.5);

    this.light.intensity = this._lightBaseIntensity * Math.max(0, 1 - t * t * 1.6);

    for (const s of this.shards) {
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
    }

    return true;
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.fireball);
    this.scene.remove(this.smoke);
    this.scene.remove(this.light);
    this.fireballMat.dispose();
    this.smokeMat.dispose();
    for (const s of this.shards) this.scene.remove(s.mesh);
  }
}

export function applyExplosionDamage(enemies, position, radius, damage, exclude = null) {
  const r2 = radius * radius;
  for (const e of enemies) {
    if (!e.alive || e === exclude) continue;
    const dx = e.group.position.x - position.x;
    const dz = e.group.position.z - position.z;
    const dy = (e.group.position.y + 0.7) - position.y;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2) {
      const falloff = 1 - Math.sqrt(d2) / radius;
      e.damage(damage * falloff);
    }
  }
}
