import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Dungeon } from './dungeon.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { spawnEnemiesInDungeon } from './enemies.js';
import { AudioSystem } from './audio.js';
import { Minimap } from './minimap.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = false;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141218);
scene.fog = new THREE.Fog(0x141218, 14, 45);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);

scene.add(new THREE.HemisphereLight(0xffd9a0, 0x202028, 0.55));
const playerLight = new THREE.PointLight(0xffd9a0, 5.5, 22, 1);
playerLight.position.set(0, 1.8, 0);
scene.add(playerLight);

const audio = new AudioSystem(camera);

const dungeon = new Dungeon();
scene.add(dungeon.group);

const player = new Player(camera, dungeon, renderer, renderer.domElement, audio);
scene.add(player.rig);

const weapon = new Weapon(scene, dungeon, player, renderer, audio);

const ctrl0 = renderer.xr.getController(0);
const ctrl1 = renderer.xr.getController(1);
player.rig.add(ctrl0);
player.rig.add(ctrl1);
player.registerController(0, ctrl0);
player.registerController(1, ctrl1);

const minimap = new Minimap({ size: 256, viewRadius: 9 });
const minimapContainer = document.getElementById('minimap-container');
minimapContainer.appendChild(minimap.canvas);

const wristTexture = new THREE.CanvasTexture(minimap.canvas);
wristTexture.colorSpace = THREE.SRGBColorSpace;
minimap.bindTexture(wristTexture);
const wristPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.13),
    new THREE.MeshBasicMaterial({ map: wristTexture }),
);
wristPlane.position.set(0, 0.02, 0.05);
wristPlane.rotation.set(-Math.PI / 3, 0, 0);

let gunAttached = false;
let wristAttached = false;
function bindByHandedness(controller, idx) {
    controller.addEventListener('connected', (e) => {
        const hand = e.data?.handedness;
        if (hand === 'right' && !gunAttached) {
            weapon.attachToController(controller);
            gunAttached = true;
        } else if (hand === 'left' && !wristAttached) {
            controller.add(wristPlane);
            wristAttached = true;
        }
    });
}
bindByHandedness(ctrl0, 0);
bindByHandedness(ctrl1, 1);

const vrButton = VRButton.createButton(renderer);
vrButton.style.zIndex = '30';
document.body.appendChild(vrButton);

renderer.xr.addEventListener('sessionstart', () => audio.resume());

const hpEl = document.getElementById('hp');
const killsEl = document.getElementById('kills');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const overlayButtons = document.getElementById('overlay-buttons');

const state = {
    enemies: [],
    totalEnemies: 0,
    kills: 0,
    finished: false,
};

function setOverlay({ title, msg, buttons }) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlayButtons.innerHTML = '';
    for (const b of buttons) {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.secondary) btn.className = 'secondary';
        btn.addEventListener('click', b.onClick);
        overlayButtons.appendChild(btn);
    }
    overlay.classList.remove('hidden');
}

function hideOverlay() {
    overlay.classList.add('hidden');
}

function startNewRun() {
    audio.resume();
    for (const e of state.enemies) e.kill();
    state.enemies = [];

    dungeon.generate({ width: 32, height: 32, roomCount: 10 });
    const spawn = dungeon.spawnPoint();
    player.spawn(spawn);

    state.enemies = spawnEnemiesInDungeon(scene, dungeon, audio);
    state.totalEnemies = state.enemies.length;
    state.kills = 0;
    state.finished = false;

    dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);

    updateHud();
    hideOverlay();
}

function updateHud() {
    hpEl.textContent = `HP: ${Math.max(0, Math.round(player.hp))}`;
    killsEl.textContent = `Kills: ${state.kills} / ${state.totalEnemies}`;
}

function checkWinLose() {
    if (state.finished) return;
    if (!player.alive) {
        state.finished = true;
        setOverlay({
            title: 'You Died',
            msg: `Made it to ${state.kills} / ${state.totalEnemies} kills.`,
            buttons: [{ label: 'Restart', onClick: startNewRun }],
        });
        return;
    }
    if (state.kills >= state.totalEnemies) {
        state.finished = true;
        setOverlay({
            title: 'Dungeon Cleared',
            msg: `All ${state.totalEnemies} enemies down. HP left: ${Math.round(player.hp)}.`,
            buttons: [{ label: 'New Dungeon', onClick: startNewRun }],
        });
    }
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') startNewRun();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const onControllerSelect = () => {
    if (state.finished) startNewRun();
};
ctrl0.addEventListener('selectstart', onControllerSelect);
ctrl1.addEventListener('selectstart', onControllerSelect);

startNewRun();

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;

    if (!state.finished) {
        player.update(dt);

        dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);

        for (const e of state.enemies) {
            const wasAlive = e.alive;
            e.update(dt, player, dungeon, now);
            if (wasAlive && !e.alive) state.kills++;
        }

        weapon.update(dt, state.enemies, now);

        for (let i = state.enemies.length - 1; i >= 0; i--) {
            if (!state.enemies[i].alive) state.enemies.splice(i, 1);
        }

        playerLight.position.set(
            player.rig.position.x,
            player.rig.position.y + 1.6,
            player.rig.position.z,
        );

        if (dungeon.grid) minimap.draw(dungeon, player, state.enemies);
        updateHud();
        checkWinLose();
    }

    renderer.render(scene, camera);
});
