import * as THREE from 'three';

const EYE_HEIGHT = 1.6;
const MOVE_SPEED = 3.5;
const SNAP_TURN_RAD = Math.PI / 6;
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
        this.handInputs = { left: null, right: null };
        this.snapTurnArmed = true;

        this._tmpForward = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._headWorld = new THREE.Vector3();
        this._stepAccum = 0;
        this._wasMoving = false;

        this._bindDesktop();
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
            const sens = 0.0022;
            this.yaw -= e.movementX * sens;
            this.pitch -= e.movementY * sens;
            this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
            this.rig.rotation.y = this.yaw;
            this.camera.rotation.x = this.pitch;
        });
    }

    update(dt) {
        if (!this.alive) return;

        let mx = 0;
        let mz = 0;
        let snapDir = 0;

        if (this.renderer.xr.isPresenting) {
            const left = this.handInputs.left;
            const right = this.handInputs.right;
            if (left?.gamepad) {
                const ax = left.gamepad.axes;
                const lx = ax[2] ?? ax[0] ?? 0;
                const ly = ax[3] ?? ax[1] ?? 0;
                if (Math.abs(lx) > STICK_DEADZONE) mx = lx;
                if (Math.abs(ly) > STICK_DEADZONE) mz = ly;
            }
            if (right?.gamepad) {
                const ax = right.gamepad.axes;
                const rx = ax[2] ?? ax[0] ?? 0;
                if (Math.abs(rx) > 0.7) {
                    if (this.snapTurnArmed) {
                        snapDir = Math.sign(rx);
                        this.snapTurnArmed = false;
                    }
                } else if (Math.abs(rx) < 0.3) {
                    this.snapTurnArmed = true;
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
            this.rig.rotation.y -= snapDir * SNAP_TURN_RAD;
            this.yaw = this.rig.rotation.y;
        }

        let moved = false;
        if (mx !== 0 || mz !== 0) {
            this.camera.getWorldDirection(this._tmpForward);
            this._tmpForward.y = 0;
            this._tmpForward.normalize();
            this._tmpRight.set(this._tmpForward.z, 0, -this._tmpForward.x);

            const step = MOVE_SPEED * dt;
            const dx = (this._tmpRight.x * mx + this._tmpForward.x * -mz) * step;
            const dz = (this._tmpRight.z * mx + this._tmpForward.z * -mz) * step;
            const before = { x: this.rig.position.x, z: this.rig.position.z };
            this._tryMove(dx, dz);
            moved = before.x !== this.rig.position.x || before.z !== this.rig.position.z;
        }

        if (this.renderer.xr.isPresenting) {
            this._enforceHeadCollision();
        }

        if (moved) {
            this._stepAccum += dt;
            if (this._stepAccum >= 0.42) {
                this._stepAccum = 0;
                this.audio?.playPlayer('step', 0.35, 0.95 + Math.random() * 0.1);
            }
        } else {
            this._stepAccum = 0.3;
        }
    }

    _enforceHeadCollision() {
        const r = PLAYER_RADIUS;
        for (let iter = 0; iter < 6; iter++) {
            this.camera.getWorldPosition(this._headWorld);
            if (!this._collidesAt(this._headWorld.x, this._headWorld.z, r)) return;
            const cell = this.dungeon.worldToCell(this._headWorld.x, this._headWorld.z);
            const cw = this.dungeon.cellToWorld(cell.gx, cell.gz);
            const ax = this._headWorld.x - cw.x;
            const az = this._headWorld.z - cw.z;
            const len = Math.hypot(ax, az) || 1;
            this.rig.position.x += (ax / len) * 0.12;
            this.rig.position.z += (az / len) * 0.12;
        }
    }

    _tryMove(dx, dz) {
        const p = this.rig.position;
        const r = PLAYER_RADIUS;

        const nx = p.x + dx;
        if (!this._collidesAt(nx, p.z, r)) p.x = nx;

        const nz = p.z + dz;
        if (!this._collidesAt(p.x, nz, r)) p.z = nz;
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
