import * as THREE from 'three';

const EYE_HEIGHT = 1.6;
const STICK_DEADZONE = 0.2;
const PLAYER_RADIUS = 0.35;

export class Player {
  constructor(camera, dungeon, renderer, domElement, audio = null) {
    this.camera = camera;
    this.dungeon = dungeon;
    this.renderer = renderer;
    this.domElement = domElement;
    this.audio = audio;

    this.rig = new THREE.Group();
    this.rig.add(camera);
    camera.position.set(0, EYE_HEIGHT, 0);

    this.hp = 100;
    this.maxHp = 100;
    this.alive = true;
    this.invulnUntil = 0;

    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;

    this.controllerInputs = [null, null];
    this.handInputs = {left: null, right: null};
    this.snapTurnArmed = true;

    this.moveSpeed = 3.5;
    this.snapTurnAngle = Math.PI / 6;
    this.smoothTurn = false;
    this.smoothTurnSpeed = Math.PI;
    this.mouseSensitivity = 0.0022;
    this.invertVrForward = false;
    this.comfortVignette = true;
    this.movementSmoothing = 0.22;
    this.turnSmoothing = 0.12;
    this.inputCurveExp = 1.7;

    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._headWorld = new THREE.Vector3();
    this._stepAccum = 0;
    this._wasMoving = false;

    this._velX = 0;
    this._velZ = 0;
    this._turnVel = 0;
    this._moveIntensity = 0;
    this._blackoutTarget = 0;
    this._blackoutCurrent = 0;
    this._stepDistance = 0;

    this._setupComfort();
    this._bindDesktop();
  }

  _setupComfort() {
    const vigCanvas = document.createElement('canvas');
    vigCanvas.width = 256;
    vigCanvas.height = 256;
    const ctx = vigCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 70, 128, 128, 150);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const vigTex = new THREE.CanvasTexture(vigCanvas);
    vigTex.colorSpace = THREE.SRGBColorSpace;

    this._vignetteMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({
        map: vigTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this._vignetteMesh.position.z = -0.15;
    this._vignetteMesh.renderOrder = 1000;
    this.camera.add(this._vignetteMesh);

    this._blackoutMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this._blackoutMesh.position.z = -0.14;
    this._blackoutMesh.renderOrder = 1001;
    this.camera.add(this._blackoutMesh);
  }

  spawn(position) {
    this.rig.position.copy(position);
    this.rig.position.y = 0;
    this.rig.rotation.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.camera.rotation.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this._velX = 0;
    this._velZ = 0;
    this._turnVel = 0;
  }

  registerController(index, controller) {
    controller.addEventListener('connected', (e) => {
      this.controllerInputs[index] = e.data;
      const hand = e.data?.handedness;
      if (hand === 'left' || hand === 'right') this.handInputs[hand] = e.data;
    });
    controller.addEventListener('disconnected', () => {
      const prev = this.controllerInputs[index];
      this.controllerInputs[index] = null;
      if (prev) {
        if (this.handInputs.left === prev) this.handInputs.left = null;
        if (this.handInputs.right === prev) this.handInputs.right = null;
      }
    });
  }

  _bindDesktop() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape') document.exitPointerLock?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.domElement.addEventListener('click', () => {
      if (!this.renderer.xr.isPresenting) {
        this.domElement.requestPointerLock?.();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const sens = this.mouseSensitivity;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      this.rig.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    });
  }

  update(dt) {
    if (!this.alive) {
      this._updateComfort(dt, 0);
      return;
    }

    let mx = 0;
    let mz = 0;
    let snapDir = 0;
    const inXR = this.renderer.xr.isPresenting;

    if (inXR) {
      const left = this.handInputs.left;
      const right = this.handInputs.right;
      if (left?.gamepad) {
        const ax = left.gamepad.axes;
        const lx = ax[2] || ax[0] || 0;
        const ly = ax[3] || ax[1] || 0;
        if (Math.abs(lx) > STICK_DEADZONE) mx = lx;
        if (Math.abs(ly) > STICK_DEADZONE) mz = this.invertVrForward ? -ly : ly;
      }
      if (right?.gamepad) {
        const ax = right.gamepad.axes;
        const rx = ax[2] || ax[0] || 0;
        if (this.smoothTurn) {
          let targetTurn = 0;
          if (Math.abs(rx) > STICK_DEADZONE) {
            const t = (Math.abs(rx) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
            const curved = Math.sign(rx) * Math.pow(Math.max(0, t), this.inputCurveExp);
            targetTurn = -curved * this.smoothTurnSpeed;
          }
          const kT = 1 - Math.exp(-dt / Math.max(0.001, this.turnSmoothing));
          this._turnVel += (targetTurn - this._turnVel) * kT;
          this.rig.rotation.y += this._turnVel * dt;
          this.yaw = this.rig.rotation.y;
        } else {
          this._turnVel = 0;
          if (Math.abs(rx) > 0.7) {
            if (this.snapTurnArmed) {
              snapDir = Math.sign(rx);
              this.snapTurnArmed = false;
            }
          } else if (Math.abs(rx) < 0.3) {
            this.snapTurnArmed = true;
          }
        }
      }
    } else {
      if (this.keys.has('KeyW')) mz -= 1;
      if (this.keys.has('KeyS')) mz += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('KeyD')) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
    }

    if (snapDir !== 0) {
      this.rig.rotation.y -= snapDir * this.snapTurnAngle;
      this.yaw = this.rig.rotation.y;
    }

    const raw = Math.hypot(mx, mz);
    let targetVx = 0;
    let targetVz = 0;
    if (raw > 0) {
      const ux = mx / raw;
      const uz = mz / raw;
      const stickMag = Math.min(1, raw);
      const t = Math.max(0, (stickMag - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
      const curvedMag = Math.pow(Math.max(0, t), this.inputCurveExp);

      this.camera.getWorldDirection(this._tmpForward);
      this._tmpForward.y = 0;
      this._tmpForward.normalize();
      this._tmpRight.set(-this._tmpForward.z, 0, this._tmpForward.x);

      const speed = this.moveSpeed * curvedMag;
      targetVx = (this._tmpRight.x * ux + this._tmpForward.x * -uz) * speed;
      targetVz = (this._tmpRight.z * ux + this._tmpForward.z * -uz) * speed;
    }

    if (inXR) {
      const kMove = 1 - Math.exp(-dt / Math.max(0.001, this.movementSmoothing));
      this._velX += (targetVx - this._velX) * kMove;
      this._velZ += (targetVz - this._velZ) * kMove;
    } else {
      this._velX = targetVx;
      this._velZ = targetVz;
    }

    let moved = false;
    const dx = this._velX * dt;
    const dz = this._velZ * dt;
    if (dx * dx + dz * dz > 1e-8) {
      const beforeX = this.rig.position.x;
      const beforeZ = this.rig.position.z;
      this._tryMove(dx, dz);
      const blockedX = beforeX === this.rig.position.x;
      const blockedZ = beforeZ === this.rig.position.z;
      if (blockedX) this._velX = 0;
      if (blockedZ) this._velZ = 0;
      moved = !(blockedX && blockedZ);
    }

    let stuck = false;
    if (inXR) stuck = this._enforceHeadCollision();

    const speedFrac = Math.min(1, Math.hypot(this._velX, this._velZ) / Math.max(0.01, this.moveSpeed));
    const vignetteAmount = inXR ? speedFrac : 0;
    this._updateComfort(dt, vignetteAmount, stuck);

    if (moved) {
      const speed = Math.hypot(this._velX, this._velZ);
      this._stepDistance += speed * dt;
      if (this._stepDistance >= 1.4) {
        this._stepDistance = 0;
        this.audio?.playPlayer('step', 0.35, 0.95 + Math.random() * 0.1);
      }
    } else {
      this._stepDistance = Math.min(this._stepDistance, 1.0);
    }
  }

  updateComfortIdle(dt) {
    this._updateComfort(dt, 0, false);
  }

  _updateComfort(dt, vignetteAmount, stuck = false) {
    const targetVig = this.comfortVignette ? vignetteAmount * 0.75 : 0;
    const cur = this._vignetteMesh.material.opacity;
    const k = Math.min(1, dt * 6);
    this._vignetteMesh.material.opacity = cur + (targetVig - cur) * k;

    this._blackoutTarget = stuck ? 1 : 0;
    const kBlack = Math.min(1, dt * (stuck ? 12 : 6));
    this._blackoutCurrent += (this._blackoutTarget - this._blackoutCurrent) * kBlack;
    this._blackoutMesh.material.opacity = this._blackoutCurrent;
  }

  _enforceHeadCollision() {
    const r = PLAYER_RADIUS;
    for (let iter = 0; iter < 8; iter++) {
      this.camera.getWorldPosition(this._headWorld);
      if (!this._collidesAt(this._headWorld.x, this._headWorld.z, r)) return false;

      const cell = this.dungeon.worldToCell(this._headWorld.x, this._headWorld.z);
      let pushX = 0;
      let pushZ = 0;
      const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ];
      for (const [dx, dz] of dirs) {
        if (!this.dungeon.isWallCell(cell.gx + dx, cell.gz + dz)) {
          const w = (dx * dx + dz * dz) === 1 ? 1 : 0.7;
          pushX += dx * w;
          pushZ += dz * w;
        }
      }
      if (pushX === 0 && pushZ === 0) {
        const cw = this.dungeon.cellToWorld(cell.gx, cell.gz);
        pushX = this._headWorld.x - cw.x;
        pushZ = this._headWorld.z - cw.z;
      }
      const len = Math.hypot(pushX, pushZ) || 1;
      this.rig.position.x += (pushX / len) * 0.16;
      this.rig.position.z += (pushZ / len) * 0.16;
    }
    return true;
  }

  _tryMove(dx, dz) {
    const p = this.rig.position;
    const r = PLAYER_RADIUS;
    const inXR = this.renderer.xr.isPresenting;

    let headX = p.x;
    let headZ = p.z;
    let headInWall = false;
    if (inXR) {
      this.camera.getWorldPosition(this._headWorld);
      headX = this._headWorld.x;
      headZ = this._headWorld.z;
      headInWall = this._collidesAt(headX, headZ, r);
    }

    const nx = p.x + dx;
    const headOkX = !inXR || headInWall || !this._collidesAt(headX + dx, headZ, r);
    if (!this._collidesAt(nx, p.z, r) && headOkX) p.x = nx;

    const nz = p.z + dz;
    const headOkZ = !inXR || headInWall || !this._collidesAt(headX, headZ + dz, r);
    if (!this._collidesAt(p.x, nz, r) && headOkZ) p.z = nz;
  }

  _collidesAt(x, z, r) {
    return (
      this.dungeon.isWall(x + r, z + r) ||
      this.dungeon.isWall(x - r, z + r) ||
      this.dungeon.isWall(x + r, z - r) ||
      this.dungeon.isWall(x - r, z - r)
    );
  }

  headPosition(out = new THREE.Vector3()) {
    return this.camera.getWorldPosition(out);
  }

  headForward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  damage(amount, now) {
    if (!this.alive || now < this.invulnUntil) return;
    this.hp -= amount;
    this.invulnUntil = now + 0.6;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.audio?.playPlayer('death', 0.9);
    } else {
      this.audio?.playPlayer('hurt', 0.7);
    }
    this._pulseBoth(0.9, 130);
  }

  _pulseBoth(intensity, durationMs) {
    for (const input of this.controllerInputs) {
      const actuator = input?.gamepad?.hapticActuators?.[0];
      actuator?.pulse?.(intensity, durationMs);
    }
  }

  pulseRight(intensity, durationMs) {
    const actuator = this.handInputs.right?.gamepad?.hapticActuators?.[0];
    actuator?.pulse?.(intensity, durationMs);
  }
}
