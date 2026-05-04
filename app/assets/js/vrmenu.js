import * as THREE from 'three';

const PANEL_W = 1024;
const PANEL_H = 720;
const PANEL_WORLD_H = 1.0;
const PANEL_WORLD_W = PANEL_WORLD_H * (PANEL_W / PANEL_H);
const PANEL_DISTANCE = 2.5;

const COLORS = {
  bg: '#15110d',
  bgInner: '#1d1611',
  border: '#7a5c3c',
  borderInner: '#4a3825',
  title: '#f5c489',
  text: '#ede0c4',
  dim: '#a89478',
  btnBg: '#3a2818',
  btnBgHover: '#d4a373',
  btnText: '#ede0c4',
  btnTextHover: '#15110d',
  btnBorder: '#7a5c3c',
};

export class VRMenu {
  constructor(scene) {
    this.scene = scene;
    this.canvas = document.createElement('canvas');
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const geometry = new THREE.PlaneGeometry(PANEL_WORLD_W, PANEL_WORLD_H);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.title = '';
    this.message = '';
    this.buttons = [];
    this.hoveredButton = null;
  }

  setContent({title = '', msg = '', buttons = []}) {
    this.title = title;
    this.message = msg;
    this.buttons = buttons.map((b) => ({
      label: b.label,
      onClick: b.onClick,
      secondary: !!b.secondary,
      hovered: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    }));
    this.hoveredButton = null;
    this._draw();
  }

  show(camera) {
    const cameraPos = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    else fwd.normalize();

    this.mesh.position
      .copy(cameraPos)
      .addScaledVector(fwd, PANEL_DISTANCE);
    this.mesh.position.y = cameraPos.y;
    const lookTarget = this.mesh.position.clone().multiplyScalar(2).sub(cameraPos);
    this.mesh.lookAt(lookTarget);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
    if (this.hoveredButton) {
      this.hoveredButton.hovered = false;
      this.hoveredButton = null;
      this._draw();
    }
  }

  isVisible() {
    return this.mesh.visible;
  }

  setHover(button) {
    if (this.hoveredButton === button) return;
    if (this.hoveredButton) this.hoveredButton.hovered = false;
    this.hoveredButton = button || null;
    if (this.hoveredButton) this.hoveredButton.hovered = true;
    this._draw();
  }

  hitTestUV(uv) {
    if (!uv) return null;
    const x = uv.x * PANEL_W;
    const y = (1 - uv.y) * PANEL_H;
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  clickHovered() {
    if (this.hoveredButton) {
      const b = this.hoveredButton;
      b.onClick?.();
      return true;
    }
    return false;
  }

  _draw() {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, PANEL_W, PANEL_H);

    const grad = ctx.createLinearGradient(0, 0, 0, PANEL_H);
    grad.addColorStop(0, COLORS.bgInner);
    grad.addColorStop(1, COLORS.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(20, 20, PANEL_W - 40, PANEL_H - 40);

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, PANEL_W - 44, PANEL_H - 44);
    ctx.strokeStyle = COLORS.borderInner;
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, PANEL_W - 80, PANEL_H - 80);

    ctx.fillStyle = COLORS.title;
    ctx.font = 'bold 78px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(this.title.toUpperCase(), PANEL_W / 2, 160);

    ctx.fillStyle = COLORS.text;
    ctx.font = '34px Inter, sans-serif';
    this._wrapText(this.message, PANEL_W / 2, 230, PANEL_W - 200, 44);

    const tight = this.buttons.length > 4;
    const btnW = tight ? 360 : 380;
    const btnH = tight ? 64 : 80;
    const gap = tight ? 12 : 24;
    const total = this.buttons.length * btnH + (this.buttons.length - 1) * gap;
    const startY = tight ? 290 : Math.min(380, PANEL_H - total - 80);

    this.buttons.forEach((b, i) => {
      b.x = (PANEL_W - btnW) / 2;
      b.y = startY + i * (btnH + gap);
      b.w = btnW;
      b.h = btnH;

      ctx.fillStyle = b.hovered ? COLORS.btnBgHover : COLORS.btnBg;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = COLORS.btnBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);

      ctx.fillStyle = b.hovered ? COLORS.btnTextHover : COLORS.btnText;
      ctx.font = `bold ${tight ? 28 : 34}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label.toUpperCase(), b.x + b.w / 2, b.y + b.h / 2);
    });

    ctx.textBaseline = 'alphabetic';
    this.texture.needsUpdate = true;
  }

  _wrapText(text, cx, y, maxWidth, lineHeight) {
    const ctx = this.ctx;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, y + i * lineHeight);
    }
  }
}

export class VRPointer {
  constructor(controller, menu) {
    this.controller = controller;
    this.menu = menu;
    this.raycaster = new THREE.Raycaster();
    this._tmpDir = new THREE.Vector3();
    this._tmpOrigin = new THREE.Vector3();

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffaa55,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });
    this.laser = new THREE.Line(lineGeom, lineMat);
    this.laser.renderOrder = 998;
    this.laser.scale.z = 5;
    this.laser.visible = false;
    controller.add(this.laser);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 8, 8),
      new THREE.MeshBasicMaterial({color: 0xffd070, depthTest: false}),
    );
    tip.renderOrder = 999;
    tip.visible = false;
    controller.add(tip);
    this.tip = tip;
  }

  update() {
    if (!this.menu.isVisible()) {
      this.laser.visible = false;
      this.tip.visible = false;
      this.menu.setHover(null);
      return;
    }
    this.laser.visible = true;
    this.tip.visible = true;

    this.controller.getWorldPosition(this._tmpOrigin);
    this.controller.getWorldDirection(this._tmpDir).multiplyScalar(-1);
    this.raycaster.set(this._tmpOrigin, this._tmpDir);
    this.raycaster.far = 8;

    const hits = this.raycaster.intersectObject(this.menu.mesh, false);
    if (hits.length) {
      const hit = hits[0];
      const dist = hit.distance;
      this.laser.scale.z = dist;
      this.tip.position.set(0, 0, -dist);
      const button = this.menu.hitTestUV(hit.uv);
      this.menu.setHover(button);
    } else {
      this.laser.scale.z = 5;
      this.tip.position.set(0, 0, -5);
      this.menu.setHover(null);
    }
  }
}
