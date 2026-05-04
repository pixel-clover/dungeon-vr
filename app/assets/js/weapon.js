import * as THREE from 'three';

const FIRE_COOLDOWN = 0.18;
const RAY_LENGTH = 60;
const DAMAGE = 50;
const TRACER_LIFETIME = 0.08;

export class Weapon {
    constructor(scene, dungeon, player, renderer, audio = null) {
        this.scene = scene;
        this.dungeon = dungeon;
        this.player = player;
        this.renderer = renderer;
        this.audio = audio;

        this.lastFireTime = -999;
        this.tracers = [];

        this.muzzleLight = new THREE.PointLight(0xffaa55, 0, 4, 2);
        scene.add(this.muzzleLight);
        this.muzzleFlashUntil = 0;

        this._raycaster = new THREE.Raycaster();
        this._origin = new THREE.Vector3();
        this._dir = new THREE.Vector3();

        this._mouseDown = false;
        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) this._mouseDown = true;
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this._mouseDown = false;
        });

        this.controllerFireFlags = [false, false];
    }

    attachToController(controller) {
        const gun = this._buildGunMesh();
        controller.add(gun);
        this.controllerGun = gun;

        controller.addEventListener('selectstart', () => {
            this.controllerFireFlags[1] = true;
        });
        controller.addEventListener('selectend', () => {
            this.controllerFireFlags[1] = false;
        });
        this._rightController = controller;
    }

    _buildGunMesh() {
        const g = new THREE.Group();

        const matFrame = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.7 });
        const matSlide = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.85 });
        const matBarrel = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.95 });
        const matGrip = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9 });
        const matSight = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.6 });
        const matDot = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.18), matFrame);
        frame.position.set(0, -0.005, -0.07);

        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.20), matSlide);
        slide.position.set(0, 0.03, -0.075);

        const slideCut1 = new THREE.Mesh(new THREE.BoxGeometry(0.041, 0.018, 0.008), matFrame);
        slideCut1.position.set(0, 0.03, -0.005);
        const slideCut2 = slideCut1.clone();
        slideCut2.position.z = -0.018;
        const slideCut3 = slideCut1.clone();
        slideCut3.position.z = -0.031;

        const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.011, 0.011, 0.05, 14),
            matBarrel,
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.025, -0.20);

        const muzzle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14),
            matBarrel,
        );
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(0, 0.025, -0.235);

        const guard = new THREE.Mesh(
            new THREE.TorusGeometry(0.022, 0.005, 6, 14, Math.PI),
            matFrame,
        );
        guard.rotation.set(Math.PI / 2, 0, 0);
        guard.position.set(0, -0.04, -0.05);

        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.01), matFrame);
        trigger.position.set(0, -0.035, -0.05);

        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.105, 0.055), matGrip);
        grip.position.set(0, -0.085, -0.025);
        grip.rotation.x = -0.18;

        for (let i = 0; i < 5; i++) {
            const ridge = new THREE.Mesh(
                new THREE.BoxGeometry(0.044, 0.005, 0.003),
                matSight,
            );
            ridge.position.set(0, -0.04 - i * 0.018, 0.005);
            ridge.rotation.x = -0.18;
            g.add(ridge);
        }

        const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.008), matFrame);
        hammer.position.set(0, 0.052, 0.012);
        hammer.rotation.x = -0.3;

        const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.008, 0.005), matSight);
        frontSight.position.set(0, 0.055, -0.16);

        const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.005), matSight);
        rearSight.position.set(0, 0.055, -0.005);

        const leftRear = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.008, 0.005), matSight);
        leftRear.position.set(-0.0065, 0.055, -0.005);
        const rightRear = leftRear.clone();
        rightRear.position.x = 0.0065;

        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 8), matDot);
        dot.position.set(0, 0.052, 0.018);

        const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.012, 0.052), matFrame);
        magBase.position.set(0, -0.135, -0.018);
        magBase.rotation.x = -0.18;

        g.add(
            frame, slide, slideCut1, slideCut2, slideCut3,
            barrel, muzzle, guard, trigger, grip, hammer,
            frontSight, rearSight, leftRear, rightRear, dot, magBase,
        );
        return g;
    }

    update(dt, enemies, now) {
        const inXR = this.renderer.xr.isPresenting;

        let firing = false;
        let originVec = this._origin;
        let dirVec = this._dir;

        if (inXR && this._rightController) {
            firing = this.controllerFireFlags[1];
            this._rightController.getWorldPosition(originVec);
            this._rightController.getWorldDirection(dirVec).multiplyScalar(-1);
        } else {
            firing = this._mouseDown;
            this.player.headPosition(originVec);
            this.player.headForward(dirVec);
        }

        if (firing && now - this.lastFireTime >= FIRE_COOLDOWN) {
            this._fire(originVec, dirVec, enemies, now);
            this.lastFireTime = now;
        }

        for (let i = this.tracers.length - 1; i >= 0; i--) {
            const t = this.tracers[i];
            t.life -= dt;
            if (t.life <= 0) {
                this.scene.remove(t.line);
                t.line.geometry.dispose();
                t.line.material.dispose();
                this.tracers.splice(i, 1);
            } else {
                t.line.material.opacity = t.life / TRACER_LIFETIME;
            }
        }

        if (now < this.muzzleFlashUntil) {
            const k = (this.muzzleFlashUntil - now) / 0.06;
            this.muzzleLight.intensity = 4 * k;
            this.muzzleLight.position.copy(originVec).addScaledVector(dirVec, 0.3);
        } else {
            this.muzzleLight.intensity = 0;
        }
    }

    _fire(origin, dir, enemies, now) {
        this._raycaster.set(origin, dir);
        this._raycaster.far = RAY_LENGTH;

        let bestT = RAY_LENGTH;
        let bestEnemy = null;
        for (const e of enemies) {
            if (!e.alive) continue;
            const t = e.intersectRay(origin, dir);
            if (t !== null && t < bestT) {
                bestT = t;
                bestEnemy = e;
            }
        }

        const wallT = this._raycastWalls(origin, dir, RAY_LENGTH);
        if (wallT !== null && wallT < bestT) {
            bestT = wallT;
            bestEnemy = null;
        }

        this.audio?.playPlayer('shoot', 0.55, 0.95 + Math.random() * 0.1);
        this.player.pulseRight(0.4, 30);

        if (bestEnemy) {
            bestEnemy.damage(DAMAGE);
            this.audio?.playAt('hit', bestEnemy.group.position, 0.9);
            this.player.pulseRight(0.85, 60);
        }

        const endX = origin.x + dir.x * bestT;
        const endY = origin.y + dir.y * bestT;
        const endZ = origin.z + dir.z * bestT;
        this._spawnTracer(origin.x, origin.y, origin.z, endX, endY, endZ);
        this.muzzleFlashUntil = now + 0.06;
    }

    _raycastWalls(origin, dir, maxDist) {
        const stepSize = 0.25;
        const steps = Math.ceil(maxDist / stepSize);
        for (let i = 1; i <= steps; i++) {
            const t = i * stepSize;
            const x = origin.x + dir.x * t;
            const z = origin.z + dir.z * t;
            if (this.dungeon.isWall(x, z)) return t;
        }
        return null;
    }

    _spawnTracer(x1, y1, z1, x2, y2, z2) {
        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
        ]);
        const mat = new THREE.LineBasicMaterial({
            color: 0xffd070,
            transparent: true,
            opacity: 1,
        });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.tracers.push({ line, life: TRACER_LIFETIME });
    }
}
