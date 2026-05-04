import * as THREE from 'three';

function addEcho(buf, delaySec, gain) {
  const sr = buf.sampleRate;
  const data = buf.getChannelData(0);
  const delay = Math.floor(delaySec * sr);
  if (delay <= 0 || delay >= data.length) return;
  for (let i = data.length - 1; i >= delay; i--) {
    data[i] += data[i - delay] * gain;
  }
}

export class AudioSystem {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.masterGain);
    this.buffers = {};
    this.musicBuffers = {};
    this.musicSrc = null;
    this.musicTheme = null;
    this._build();
    this._buildMusic();
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _build() {
    this.buffers.shoot = this._synth(0.42, (t) => {
      const envSnap = Math.exp(-t * 110);
      const snap = (Math.random() * 2 - 1) * envSnap;
      const envBody = Math.exp(-t * 17);
      const bodyFreq = Math.max(50, 230 - t * 720);
      const body = Math.sin(2 * Math.PI * bodyFreq * t) * envBody;
      const envCrack = Math.exp(-t * 30);
      const crack = (Math.random() * 2 - 1) * envCrack;
      const envChamber = Math.exp(-t * 9) * (1 - Math.exp(-t * 80));
      const chamber = Math.sin(2 * Math.PI * 320 * t) * envChamber;
      const envSub = Math.exp(-t * 5);
      const sub = Math.sin(2 * Math.PI * Math.max(35, 65 - t * 60) * t) * envSub;
      const envTail = Math.exp(-t * 3);
      const tail = (Math.random() * 2 - 1) * envTail;
      return snap * 0.55 + body * 0.85 + crack * 0.5 + chamber * 0.22 + sub * 0.5 + tail * 0.16;
    });
    addEcho(this.buffers.shoot, 0.16, 0.32);
    addEcho(this.buffers.shoot, 0.31, 0.14);

    this.buffers.explosion = this._synth(1.3, (t) => {
      const envBoom = Math.exp(-t * 4.5);
      const envCrackle = Math.exp(-t * 8);
      const envSub = Math.exp(-t * 2.2);
      const boomFreq = Math.max(28, 70 - t * 60);
      const boom = Math.sin(2 * Math.PI * boomFreq * t) * envBoom * 0.95;
      const sub = Math.sin(2 * Math.PI * 32 * t) * envSub * 0.7;
      const crackle = (Math.random() * 2 - 1) * envCrackle * 0.75;
      const rumble = (Math.random() * 2 - 1) * envSub * 0.35;
      return boom * 0.55 + sub * 0.4 + crackle * 0.45 + rumble * 0.3;
    });
    addEcho(this.buffers.explosion, 0.22, 0.4);
    addEcho(this.buffers.explosion, 0.5, 0.18);

    this.buffers.hit = this._synth(0.24, (t) => {
      const envImpact = Math.exp(-t * 38);
      const impact = (Math.random() * 2 - 1) * envImpact;
      const envBody = Math.exp(-t * 13);
      const f = Math.max(60, 290 - t * 850);
      const body = Math.sin(2 * Math.PI * f * t) * envBody;
      const envCrunch = Math.exp(-t * 8);
      const crunch = (Math.random() * 2 - 1) * envCrunch * 0.45;
      return impact * 0.55 + body * 0.8 + crunch * 0.5;
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

    this.buffers.emptyclick = this._synth(0.08, (t) => {
      const env = Math.exp(-t * 60);
      const noise = (Math.random() * 2 - 1);
      const ring = Math.sin(2 * Math.PI * 850 * t) * Math.exp(-t * 90) * 0.4;
      return (noise + ring) * env * 0.6;
    });

    this.buffers.reload = this._synth(1.2, (t) => {
      const env1 = Math.exp(-Math.abs(t - 0.08) * 60);
      const click1 = (Math.random() * 2 - 1) * env1 * 0.8;
      const thud1 = Math.sin(2 * Math.PI * 65 * t) * env1 * 0.3;
      const env2 = Math.exp(-Math.abs(t - 0.42) * 22);
      const click2 = (Math.random() * 2 - 1) * env2 * 0.7;
      const env3 = Math.exp(-Math.abs(t - 0.58) * 70);
      const click3 = (Math.random() * 2 - 1) * env3 * 0.85;
      const env4 = Math.exp(-Math.abs(t - 0.88) * 70);
      const click4 = (Math.random() * 2 - 1) * env4 * 0.9;
      const thunk = Math.sin(2 * Math.PI * 80 * t) * env4 * 0.35;
      const env5 = Math.exp(-Math.abs(t - 1.05) * 80);
      const click5 = (Math.random() * 2 - 1) * env5;
      const snap = Math.sin(2 * Math.PI * 320 * t) * env5 * 0.5;
      return click1 + thud1 + click2 + click3 + click4 + thunk + click5 + snap;
    });

    this.buffers.growl = this._synth(0.5, (t) => {
      const env = Math.sin(Math.PI * t / 0.5);
      const f = 70 + Math.sin(t * 18) * 12;
      const tone = Math.sin(2 * Math.PI * f * t);
      const noise = (Math.random() * 2 - 1) * 0.3;
      return (tone * 0.7 + noise) * env * 0.7;
    });
  }

  _buildMusic() {
    const D = 16;
    this.musicBuffers.castle = this._synth(D, (t) => {
      const slow = (Math.sin(t * 0.1 * 2 * Math.PI) + 1) * 0.5;
      const a = Math.sin(2 * Math.PI * 110 * t) * 0.4;
      const b = Math.sin(2 * Math.PI * 165 * t) * 0.3;
      const c = Math.sin(2 * Math.PI * 220 * t) * 0.18 * slow;
      const swell = Math.sin(2 * Math.PI * 0.075 * t) * 0.5 + 0.5;
      return (a + b + c) * (0.55 + 0.35 * swell);
    });

    this.musicBuffers.hellfire = this._synth(D, (t) => {
      const a = Math.sin(2 * Math.PI * 55 * t) * 0.55;
      const b = Math.sin(2 * Math.PI * 82 * t) * 0.35;
      const dissonant = Math.sin(2 * Math.PI * 88 * t) * 0.18;
      const noise = (Math.random() * 2 - 1) * 0.05;
      const flicker = Math.sin(t * 0.6 * 2 * Math.PI);
      return (a + b + dissonant + noise) * (0.6 + 0.3 * flicker);
    });

    this.musicBuffers.frostvault = this._synth(D, (t) => {
      const a = Math.sin(2 * Math.PI * 220 * t) * 0.32;
      const b = Math.sin(2 * Math.PI * 330 * t) * 0.26;
      const c = Math.sin(2 * Math.PI * 440 * t) * 0.18;
      const shimmer = Math.sin(2 * Math.PI * 880 * t) * 0.06 *
        Math.max(0, Math.sin(t * 1.7));
      return a + b + c + shimmer;
    });

    this.musicBuffers.dukebase = this._synth(D, (t) => {
      const a = Math.sin(2 * Math.PI * 80 * t) * 0.45;
      const pulsePhase = (t * 1.6) % 1;
      const pulse = Math.exp(-pulsePhase * 6);
      const noise = (Math.random() * 2 - 1) * 0.18 * pulse;
      const click = Math.sin(2 * Math.PI * 220 * t) * 0.08 * pulse;
      return a + noise + click;
    });

    this.musicBuffers.tomb = this._synth(D, (t) => {
      const a = Math.sin(2 * Math.PI * 73 * t) * 0.42;
      const b = Math.sin(2 * Math.PI * 110 * t) * 0.22;
      const wind = (Math.random() * 2 - 1) * 0.04;
      const distantBell = Math.sin(2 * Math.PI * 293 * t) * 0.05 *
        Math.exp(-((t * 0.5) % 1) * 3);
      return a + b + wind + distantBell;
    });
  }

  playMusic(themeKey) {
    if (this.musicTheme === themeKey && this.musicSrc) return;
    this.stopMusic();
    const buf = this.musicBuffers[themeKey];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSrc = src;
    this.musicTheme = themeKey;
  }

  stopMusic() {
    if (this.musicSrc) {
      try {
        this.musicSrc.stop();
      } catch {
      }
      try {
        this.musicSrc.disconnect();
      } catch {
      }
      this.musicSrc = null;
    }
    this.musicTheme = null;
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
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
      }
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
      try {
        src.disconnect();
        panner.disconnect();
        gain.disconnect();
      } catch {
      }
    };
    src.start();
  }
}
