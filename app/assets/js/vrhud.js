import * as THREE from 'three';

const W = 256;
const H = 192;

export class VRHud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;

    const aspect = W / H;
    const height = 0.10;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(height * aspect, height),
      new THREE.MeshBasicMaterial({map: this.texture, transparent: true}),
    );
    this.mesh.position.set(0, 0.02, 0.18);
    this.mesh.rotation.set(-Math.PI / 3, 0, 0);

    this.lastDraw = 0;
  }

  attachTo(controller) {
    controller.add(this.mesh);
  }

  update(state, player, weapon, fps) {
    const ctx = this.ctx;
    ctx.fillStyle = '#15110d';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#7a5c3c';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const hp = Math.max(0, Math.round(player.hp));
    const hpFrac = Math.max(0, Math.min(1, player.hp / player.maxHp));

    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('HP', 12, 12);

    ctx.fillStyle = '#000';
    ctx.fillRect(40, 14, 200, 14);
    const grad = ctx.createLinearGradient(40, 0, 240, 0);
    grad.addColorStop(0, '#6f1f17');
    grad.addColorStop(0.5, '#c44a3d');
    grad.addColorStop(1, '#e87060');
    ctx.fillStyle = grad;
    ctx.fillRect(40, 14, 200 * hpFrac, 14);
    ctx.strokeStyle = '#7a5c3c';
    ctx.lineWidth = 1;
    ctx.strokeRect(40, 14, 200, 14);
    ctx.fillStyle = '#ede0c4';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(hp), 238, 14);

    const ammoText = weapon.reloading ? '... / ' + weapon.reserveAmmo : `${weapon.mag} / ${weapon.reserveAmmo}`;
    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.fillText('AMMO', 12, 42);
    ctx.fillStyle = '#f5c489';
    ctx.font = 'bold 22px Cinzel, serif';
    ctx.textAlign = 'right';
    ctx.fillText(ammoText, 244, 38);

    let elapsed = 0;
    if (state.runStartTime > 0) {
      elapsed = (state.runEndTime || performance.now()) - state.runStartTime;
    }
    const total = Math.max(0, Math.round(elapsed / 1000));
    const m = Math.floor(total / 60);
    const s = (total % 60).toString().padStart(2, '0');

    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.fillText('TIME', 12, 78);
    ctx.fillStyle = '#f5c489';
    ctx.font = 'bold 22px Cinzel, serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${m}:${s}`, 244, 74);

    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.fillText('KILLS', 12, 114);
    ctx.fillStyle = '#ede0c4';
    ctx.font = 'bold 22px Cinzel, serif';
    ctx.textAlign = 'right';
    const killsText = state.mode === 'wave'
      ? String(state.kills)
      : `${state.kills} / ${state.totalEnemies}`;
    ctx.fillText(killsText, 244, 110);

    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 11px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.fillText('FPS', 12, 152);
    ctx.fillStyle = '#80ff80';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(fps || '--'), 244, 148);

    ctx.fillStyle = '#a89478';
    ctx.font = 'bold 11px Cinzel, serif';
    ctx.textAlign = 'left';
    ctx.fillText('MODE', 100, 152);
    ctx.fillStyle = '#d4a373';
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.fillText((state.mode || 'mission').toUpperCase(), 138, 150);

    this.texture.needsUpdate = true;
  }
}
