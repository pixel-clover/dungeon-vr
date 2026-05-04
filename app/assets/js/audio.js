import * as THREE from 'three';

export class AudioSystem {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);
        this.ctx = this.listener.context;
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.6;
        this.masterGain.connect(this.ctx.destination);
        this.buffers = {};
        this._build();
    }

    resume() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    _build() {
        this.buffers.shoot = this._synth(0.22, (t) => {
            const envFast = Math.exp(-t * 38);
            const envBody = Math.exp(-t * 14);
            const envTail = Math.exp(-t * 5);
            const click = (Math.random() * 2 - 1) * envFast * 0.95;
            const bodyFreq = Math.max(45, 130 - t * 240);
            const body = Math.sin(2 * Math.PI * bodyFreq * t) * envBody * 0.85;
            const sub = Math.sin(2 * Math.PI * 55 * t) * envTail * 0.45;
            const crack = (Math.random() * 2 - 1) * envBody * 0.55;
            return click * 0.45 + body * 0.7 + crack * 0.4 + sub * 0.3;
        });

        this.buffers.explosion = this._synth(0.85, (t) => {
            const envBoom = Math.exp(-t * 4.5);
            const envCrackle = Math.exp(-t * 8);
            const envSub = Math.exp(-t * 2.5);
            const boomFreq = Math.max(28, 70 - t * 60);
            const boom = Math.sin(2 * Math.PI * boomFreq * t) * envBoom * 0.95;
            const sub = Math.sin(2 * Math.PI * 32 * t) * envSub * 0.6;
            const crackle = (Math.random() * 2 - 1) * envCrackle * 0.75;
            const rumble = (Math.random() * 2 - 1) * envSub * 0.35;
            return boom * 0.55 + sub * 0.35 + crackle * 0.45 + rumble * 0.25;
        });

        this.buffers.hit = this._synth(0.18, (t) => {
            const env = Math.exp(-t * 14);
            const f = 220 - t * 600;
            return Math.sin(2 * Math.PI * f * t) * env * 0.9;
        });

        this.buffers.death = this._synth(0.45, (t) => {
            const env = Math.exp(-t * 5);
            const noise = (Math.random() * 2 - 1) * 0.7;
            const f = 160 - t * 200;
            const tone = Math.sin(2 * Math.PI * Math.max(40, f) * t) * 0.5;
            return (noise * 0.6 + tone) * env;
        });

        this.buffers.hurt = this._synth(0.25, (t) => {
            const env = Math.exp(-t * 9);
            const f = 380 - t * 700;
            return Math.sin(2 * Math.PI * Math.max(80, f) * t) * env * 0.85;
        });

        this.buffers.step = this._synth(0.08, (t) => {
            const env = Math.exp(-t * 35);
            const noise = (Math.random() * 2 - 1) * 0.6;
            const tone = Math.sin(2 * Math.PI * 70 * t) * 0.5;
            return (noise + tone) * env;
        });

        this.buffers.attack = this._synth(0.22, (t) => {
            const env = (1 - t / 0.22) * Math.min(1, t * 12);
            const f = 90 + Math.sin(t * 30) * 40;
            return Math.sin(2 * Math.PI * f * t) * env * 0.8;
        });

        this.buffers.pickup = this._synth(0.35, (t) => {
            const env = Math.exp(-t * 6);
            const f = 600 + t * 800;
            return Math.sin(2 * Math.PI * f * t) * env * 0.7;
        });

        this.buffers.emptyclick = this._synth(0.05, (t) => {
            const env = Math.exp(-t * 80);
            const noise = (Math.random() * 2 - 1);
            return noise * env * 0.5;
        });

        this.buffers.reload = this._synth(0.4, (t) => {
            const click1 = Math.exp(-Math.abs(t - 0.05) * 60) * (Math.random() * 2 - 1) * 0.7;
            const click2 = Math.exp(-Math.abs(t - 0.25) * 70) * (Math.random() * 2 - 1) * 0.6;
            const click3 = Math.exp(-Math.abs(t - 0.35) * 80) * (Math.random() * 2 - 1) * 0.55;
            return click1 + click2 + click3;
        });

        this.buffers.growl = this._synth(0.5, (t) => {
            const env = Math.sin(Math.PI * t / 0.5);
            const f = 70 + Math.sin(t * 18) * 12;
            const tone = Math.sin(2 * Math.PI * f * t);
            const noise = (Math.random() * 2 - 1) * 0.3;
            return (tone * 0.7 + noise) * env * 0.7;
        });
    }

    _synth(duration, fn) {
        const sr = this.ctx.sampleRate;
        const n = (duration * sr) | 0;
        const buf = this.ctx.createBuffer(1, n, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = fn(i / sr, sr);
        return buf;
    }

    playPlayer(name, volume = 0.7, pitch = 1) {
        const buf = this.buffers[name];
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = pitch;
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain).connect(this.masterGain);
        src.onended = () => {
            try { src.disconnect(); gain.disconnect(); } catch {}
        };
        src.start();
    }

    playAt(name, position, volume = 1, pitch = 1) {
        const buf = this.buffers[name];
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = pitch;

        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1.5;
        panner.maxDistance = 30;
        panner.rolloffFactor = 1.5;
        if (panner.positionX) {
            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;
        } else {
            panner.setPosition(position.x, position.y, position.z);
        }

        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        src.connect(panner).connect(gain).connect(this.masterGain);
        src.onended = () => {
            try { src.disconnect(); panner.disconnect(); gain.disconnect(); } catch {}
        };
        src.start();
    }
}
