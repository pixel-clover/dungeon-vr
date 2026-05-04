const STORAGE_KEY = 'dungeon-vr-settings';

const DEFAULTS = {
    volume: 60,
    turnMode: 'snap',
    snapAngle: 30,
    mouseSens: 22,
    moveSpeed: 35,
    invertVrForward: false,
    comfortVignette: true,
    moveSmoothing: 22,
    theme: 'castle',
};

export class Settings {
    constructor(audio, player) {
        this.audio = audio;
        this.player = player;
        this.values = { ...DEFAULTS, ...this._load() };
        this._apply();
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed ? parsed : {};
        } catch {
            return {};
        }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
        } catch {
            // localStorage disabled — runtime values still apply
        }
    }

    _apply() {
        this.audio.masterGain.gain.value = this.values.volume / 100;
        this.player.smoothTurn = this.values.turnMode === 'smooth';
        this.player.snapTurnAngle = (this.values.snapAngle * Math.PI) / 180;
        this.player.mouseSensitivity = this.values.mouseSens / 10000;
        this.player.moveSpeed = this.values.moveSpeed / 10;
        this.player.invertVrForward = !!this.values.invertVrForward;
        this.player.comfortVignette = !!this.values.comfortVignette;
        this.player.movementSmoothing = this.values.moveSmoothing / 100;
        this.player.turnSmoothing = Math.max(0.05, this.values.moveSmoothing / 200);
    }

    set(key, value) {
        this.values[key] = value;
        this._apply();
        this._save();
    }

    bindUI() {
        const overlay = document.getElementById('settings-overlay');
        const closeBtn = document.getElementById('settings-close');

        const volumeEl = document.getElementById('setting-volume');
        const volumeValueEl = document.getElementById('setting-volume-value');
        const turnModeEl = document.getElementById('setting-turn-mode');
        const snapAngleEl = document.getElementById('setting-snap-angle');
        const mouseSensEl = document.getElementById('setting-mouse-sens');
        const mouseSensValueEl = document.getElementById('setting-mouse-sens-value');
        const moveSpeedEl = document.getElementById('setting-move-speed');
        const moveSpeedValueEl = document.getElementById('setting-move-speed-value');
        const moveSmoothingEl = document.getElementById('setting-move-smoothing');
        const moveSmoothingValueEl = document.getElementById('setting-move-smoothing-value');
        const invertEl = document.getElementById('setting-invert-vr-forward');
        const comfortEl = document.getElementById('setting-comfort-vignette');
        const themeEl = document.getElementById('setting-theme');

        volumeEl.value = this.values.volume;
        volumeValueEl.textContent = `${this.values.volume}%`;
        turnModeEl.value = this.values.turnMode;
        snapAngleEl.value = String(this.values.snapAngle);
        mouseSensEl.value = this.values.mouseSens;
        mouseSensValueEl.textContent = `${(this.values.mouseSens / 10).toFixed(1)}x`;
        moveSpeedEl.value = this.values.moveSpeed;
        moveSpeedValueEl.textContent = `${(this.values.moveSpeed / 10).toFixed(1)} m/s`;
        moveSmoothingEl.value = this.values.moveSmoothing;
        moveSmoothingValueEl.textContent = `${(this.values.moveSmoothing * 10).toFixed(0)} ms`;
        invertEl.checked = !!this.values.invertVrForward;
        comfortEl.checked = !!this.values.comfortVignette;
        themeEl.value = this.values.theme;

        volumeEl.addEventListener('input', () => {
            const v = parseInt(volumeEl.value, 10);
            this.set('volume', v);
            volumeValueEl.textContent = `${v}%`;
        });
        turnModeEl.addEventListener('change', () => {
            this.set('turnMode', turnModeEl.value);
        });
        snapAngleEl.addEventListener('change', () => {
            this.set('snapAngle', parseInt(snapAngleEl.value, 10));
        });
        mouseSensEl.addEventListener('input', () => {
            const v = parseInt(mouseSensEl.value, 10);
            this.set('mouseSens', v);
            mouseSensValueEl.textContent = `${(v / 10).toFixed(1)}x`;
        });
        moveSpeedEl.addEventListener('input', () => {
            const v = parseInt(moveSpeedEl.value, 10);
            this.set('moveSpeed', v);
            moveSpeedValueEl.textContent = `${(v / 10).toFixed(1)} m/s`;
        });
        moveSmoothingEl.addEventListener('input', () => {
            const v = parseInt(moveSmoothingEl.value, 10);
            this.set('moveSmoothing', v);
            moveSmoothingValueEl.textContent = `${(v * 10).toFixed(0)} ms`;
        });
        invertEl.addEventListener('change', () => {
            this.set('invertVrForward', invertEl.checked);
        });
        comfortEl.addEventListener('change', () => {
            this.set('comfortVignette', comfortEl.checked);
        });
        themeEl.addEventListener('change', () => {
            this.set('theme', themeEl.value);
        });

        closeBtn.addEventListener('click', () => this.close());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });
        this._overlayEl = overlay;
    }

    open() {
        this._overlayEl?.classList.remove('hidden');
    }

    close() {
        this._overlayEl?.classList.add('hidden');
    }
}
