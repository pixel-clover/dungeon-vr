import * as THREE from 'three';

export class Minimap {
    constructor({ size = 256, viewRadius = 9 } = {}) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = size;
        this.canvas.height = size;
        this.ctx = this.canvas.getContext('2d');
        this.size = size;
        this.viewRadius = viewRadius;
        this.cellPx = size / (viewRadius * 2 + 1);
        this.canvasTexture = null;
        this._fwd = new THREE.Vector3();
    }

    bindTexture(canvasTexture) {
        this.canvasTexture = canvasTexture;
    }

    draw(dungeon, player, enemies) {
        const ctx = this.ctx;
        const s = this.size;
        const cellPx = this.cellPx;
        const half = s / 2;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, s, s);

        const playerCell = dungeon.worldToCell(player.rig.position.x, player.rig.position.z);

        for (let dy = -this.viewRadius; dy <= this.viewRadius; dy++) {
            for (let dx = -this.viewRadius; dx <= this.viewRadius; dx++) {
                const gx = playerCell.gx + dx;
                const gz = playerCell.gz + dy;
                if (gx < 0 || gz < 0 || gx >= dungeon.W || gz >= dungeon.H) continue;
                const idx = gz * dungeon.W + gx;
                if (!dungeon.explored[idx]) continue;
                const px = half + dx * cellPx - cellPx / 2;
                const py = half + dy * cellPx - cellPx / 2;
                ctx.fillStyle = dungeon.grid[idx] === 1 ? '#605040' : '#1a1812';
                ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);
            }
        }

        for (const e of enemies) {
            if (!e.alive) continue;
            const c = dungeon.worldToCell(e.group.position.x, e.group.position.z);
            const idx = c.gz * dungeon.W + c.gx;
            if (idx < 0 || idx >= dungeon.explored.length) continue;
            if (!dungeon.explored[idx]) continue;
            const dx = c.gx - playerCell.gx;
            const dy = c.gz - playerCell.gz;
            if (Math.abs(dx) > this.viewRadius || Math.abs(dy) > this.viewRadius) continue;
            const px = half + dx * cellPx;
            const py = half + dy * cellPx;
            ctx.fillStyle = '#ff3838';
            ctx.beginPath();
            ctx.arc(px, py, cellPx * 0.35, 0, Math.PI * 2);
            ctx.fill();
        }

        player.headForward(this._fwd);
        const yaw = Math.atan2(this._fwd.x, -this._fwd.z);
        ctx.save();
        ctx.translate(half, half);
        ctx.rotate(yaw);
        ctx.fillStyle = '#ffe060';
        ctx.beginPath();
        ctx.moveTo(0, -cellPx * 0.7);
        ctx.lineTo(-cellPx * 0.45, cellPx * 0.4);
        ctx.lineTo(cellPx * 0.45, cellPx * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, s - 2, s - 2);

        if (this.canvasTexture) this.canvasTexture.needsUpdate = true;
    }
}
