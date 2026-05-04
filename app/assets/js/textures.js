import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function makeFloorTexture(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(11);

  ctx.fillStyle = '#5a4f44';
  ctx.fillRect(0, 0, size, size);

  const cells = 4;
  const cellW = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const ox = x * cellW;
      const oy = y * cellW;
      const w = cellW - 2;
      const h = cellW - 2;
      const shade = 110 + (r() * 40) | 0;
      ctx.fillStyle = `rgb(${shade + 18},${shade + 8},${shade})`;
      ctx.fillRect(ox + 1, oy + 1, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + 1, oy + 1, w, h);
      for (let i = 0; i < 12; i++) {
        const px = ox + 1 + r() * w;
        const py = oy + 1 + r() * h;
        const v = (r() * 24) | 0;
        ctx.fillStyle = `rgba(0,0,0,${v / 100})`;
        ctx.fillRect(px, py, 1 + (r() * 2) | 0, 1 + (r() * 2) | 0);
      }
    }
  }
  return canvasToRepeatTexture(c);
}

export function makeWallTexture(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(7);

  ctx.fillStyle = '#3a342c';
  ctx.fillRect(0, 0, size, size);

  const rows = 6;
  const brickH = size / rows;
  const brickW = size / 3;
  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (brickW / 2);
    for (let bx = -brickW; bx < size + brickW; bx += brickW) {
      const x = bx + offset;
      const y = row * brickH;
      const shade = 150 + (r() * 40) | 0;
      ctx.fillStyle = `rgb(${shade + 10},${shade},${shade - 18})`;
      ctx.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, brickW - 4, brickH - 4);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.15})`;
        ctx.fillRect(x + 4 + r() * (brickW - 8), y + 4 + r() * (brickH - 8), 2, 1);
      }
      if (r() < 0.15) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 4);
        ctx.lineTo(x + brickW - 4, y + brickH - 4);
        ctx.stroke();
      }
    }
  }
  return canvasToRepeatTexture(c);
}

export function makeCeilingTexture(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = rng(31);
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 200; i++) {
    const x = r() * size;
    const y = r() * size;
    const v = 60 + (r() * 30) | 0;
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    ctx.fillRect(x, y, 1 + (r() * 2) | 0, 1 + (r() * 2) | 0);
  }
  return canvasToRepeatTexture(c);
}

function canvasToRepeatTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _loader = new THREE.TextureLoader();
let _anisotropy = 4;

export function setTextureAnisotropy(val) {
  _anisotropy = Math.max(1, val | 0);
}

function configureColor(t) {
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = _anisotropy;
  return t;
}

function configureLinear(t) {
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = _anisotropy;
  return t;
}

let _wallSet = null;
let _floorSet = null;

export function getWallPBRSet() {
  if (!_wallSet) {
    const ao = configureLinear(_loader.load('assets/textures/walls/ao.jpg'));
    ao.channel = 0;
    _wallSet = {
      map: configureColor(_loader.load('assets/textures/walls/diff.jpg')),
      normalMap: configureLinear(_loader.load('assets/textures/walls/nor_gl.jpg')),
      roughnessMap: configureLinear(_loader.load('assets/textures/walls/rough.jpg')),
      aoMap: ao,
    };
  }
  return _wallSet;
}

export function getFloorPBRSet() {
  if (!_floorSet) {
    _floorSet = {
      map: configureColor(_loader.load('assets/textures/floor/diff.jpg')),
      normalMap: configureLinear(_loader.load('assets/textures/floor/nor_gl.jpg')),
      roughnessMap: configureLinear(_loader.load('assets/textures/floor/rough.jpg')),
    };
  }
  return _floorSet;
}
