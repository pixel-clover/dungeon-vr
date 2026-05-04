import * as THREE from 'three';

const _texts = [];

function makeTextTexture(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 56px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, 128, 48);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 48);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

export function spawnFloatingText(scene, position, text, options = {}) {
    const color = options.color ?? '#ffe060';
    const lifetime = options.lifetime ?? 0.9;
    const riseSpeed = options.riseSpeed ?? 1.4;
    const scale = options.scale ?? 0.55;

    const tex = makeTextTexture(text, color);
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.set(scale, scale * (96 / 256), 1);
    sprite.renderOrder = 200;
    scene.add(sprite);

    _texts.push({ scene, sprite, mat, tex, life: 0, lifetime, riseSpeed });
}

export function updateFloatingTexts(dt) {
    for (let i = _texts.length - 1; i >= 0; i--) {
        const t = _texts[i];
        t.life += dt;
        const k = t.life / t.lifetime;
        if (k >= 1) {
            t.scene.remove(t.sprite);
            t.mat.dispose();
            t.tex.dispose();
            _texts.splice(i, 1);
            continue;
        }
        t.sprite.position.y += t.riseSpeed * dt;
        t.mat.opacity = Math.max(0, 1 - k * k);
    }
}

export function clearFloatingTexts() {
    for (const t of _texts) {
        t.scene.remove(t.sprite);
        t.mat.dispose();
        t.tex.dispose();
    }
    _texts.length = 0;
}
