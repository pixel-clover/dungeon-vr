import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Dungeon } from './dungeon.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { spawnEnemiesInDungeon } from './enemies.js';
import { AudioSystem } from './audio.js';
import { Minimap } from './minimap.js';
import { VRMenu, VRPointer } from './vrmenu.js';
import { Settings } from './settings.js';
import { populateDungeon, disposeProps } from './props.js';
import { Explosion, applyExplosionDamage } from './effects.js';
import { preloadEnemyModels } from './models.js';
import { getTheme } from './themes.js';

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

const hemiLight = new THREE.HemisphereLight(0xffd9a0, 0x202028, 0.55);
scene.add(hemiLight);
const playerLight = new THREE.PointLight(0xffd9a0, 5.5, 22, 1);
playerLight.position.set(0, 1.8, 0);
scene.add(playerLight);

function applySceneTheme(theme) {
    scene.background.setHex(theme.bgColor);
    scene.fog.color.setHex(theme.fogColor);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;
    hemiLight.color.setHex(theme.ambientSky);
    hemiLight.groundColor.setHex(theme.ambientGround);
    hemiLight.intensity = theme.ambientIntensity;
    playerLight.color.setHex(theme.playerLightColor);
    playerLight.intensity = theme.playerLightIntensity;
    playerLight.distance = theme.playerLightDistance;
}

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

const vrMenu = new VRMenu(scene);
let vrPointer = null;

let gunAttached = false;
let wristAttached = false;
function bindByHandedness(controller, idx) {
    controller.addEventListener('connected', (e) => {
        const hand = e.data?.handedness;
        if (hand === 'right' && !gunAttached) {
            weapon.attachToController(controller);
            vrPointer = new VRPointer(controller, vrMenu);
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

let pendingMenuReposition = false;
renderer.xr.addEventListener('sessionstart', () => {
    audio.resume();
    pendingMenuReposition = true;
});

const hpFillEl = document.getElementById('hp-fill');
const hpValueEl = document.getElementById('hp-value');
const killsFillEl = document.getElementById('kills-fill');
const killsValueEl = document.getElementById('kills-value');
const damageVignette = document.getElementById('damage-vignette');
const lowHpVignette = document.getElementById('low-hp-vignette');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const overlayButtons = document.getElementById('overlay-buttons');

let lastHp = 100;
let damageFlashClearTimer = null;

const settings = new Settings(audio, player);
settings.bindUI();

const state = {
    enemies: [],
    props: [],
    explosions: [],
    totalEnemies: 0,
    kills: 0,
    finished: true,
    started: false,
    modelsReady: false,
};

function syncOverlayButtons(buttons) {
    overlayButtons.innerHTML = '';
    for (const b of buttons) {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.className = b.secondary ? 'btn-themed btn-secondary' : 'btn-themed';
        btn.addEventListener('click', b.onClick);
        overlayButtons.appendChild(btn);
    }
}

function setOverlay({ title, msg, buttons }) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    syncOverlayButtons(buttons);
    overlay.classList.remove('hidden');

    const vrButtons = buttons.filter((b) => !b.desktopOnly);
    vrMenu.setContent({ title, msg, buttons: vrButtons });
    vrMenu.show(camera);
}

function hideOverlay() {
    overlay.classList.add('hidden');
    vrMenu.hide();
}

function showTitleMenu() {
    state.finished = true;
    state.started = false;
    setOverlay({
        title: 'Dungeon VR',
        msg: 'A random dungeon awaits. Find and clear every enemy.',
        buttons: [
            { label: 'Start', onClick: startNewRun },
            { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
        ],
    });
}

function startNewRun() {
    audio.resume();
    if (!state.modelsReady) return;
    for (const e of state.enemies) {
        e.alive = false;
        e.cleanup();
    }
    state.enemies = [];
    for (const ex of state.explosions) ex.dispose();
    state.explosions = [];
    if (state.props.length) {
        disposeProps(scene, state.props);
        state.props = [];
    }

    const theme = getTheme(settings.values.theme);
    applySceneTheme(theme);

    dungeon.generate({ width: 32, height: 32, roomCount: 10, theme });
    const spawn = dungeon.spawnPoint();
    player.spawn(spawn);

    state.props = populateDungeon(scene, dungeon, Math.random, { theme });
    state.enemies = spawnEnemiesInDungeon(scene, dungeon, audio);
    state.totalEnemies = state.enemies.length;
    state.kills = 0;
    state.finished = false;
    state.started = true;

    dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);

    lastHp = player.hp;
    lowHpVignette.classList.remove('active');
    damageVignette.classList.remove('flash');

    updateHud();
    hideOverlay();
}

function updateHud() {
    const hp = Math.max(0, Math.round(player.hp));
    const hpFrac = Math.max(0, player.hp / player.maxHp);
    hpFillEl.style.width = `${hpFrac * 100}%`;
    hpValueEl.textContent = `${hp}`;

    const killsFrac = state.totalEnemies > 0 ? state.kills / state.totalEnemies : 0;
    killsFillEl.style.width = `${killsFrac * 100}%`;
    killsValueEl.textContent = `${state.kills} / ${state.totalEnemies}`;

    if (player.hp < lastHp - 0.5) {
        damageVignette.classList.add('flash');
        if (damageFlashClearTimer) clearTimeout(damageFlashClearTimer);
        damageFlashClearTimer = setTimeout(() => damageVignette.classList.remove('flash'), 90);
    }
    lastHp = player.hp;

    lowHpVignette.classList.toggle('active', player.alive && player.hp > 0 && player.hp < 30);
}

function checkWinLose() {
    if (state.finished) return;
    if (!player.alive) {
        state.finished = true;
        setOverlay({
            title: 'You Died',
            msg: `Made it to ${state.kills} of ${state.totalEnemies} kills.`,
            buttons: [
                { label: 'Restart', onClick: startNewRun },
                { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
            ],
        });
        return;
    }
    if (state.kills >= state.totalEnemies) {
        state.finished = true;
        setOverlay({
            title: 'Dungeon Cleared',
            msg: `All ${state.totalEnemies} enemies down. HP left: ${Math.round(player.hp)}.`,
            buttons: [
                { label: 'New Dungeon', onClick: startNewRun },
                { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
            ],
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

function onControllerSelect() {
    if (vrMenu.isVisible()) {
        if (vrMenu.clickHovered()) return;
        if (state.finished && state.modelsReady) startNewRun();
    }
}
ctrl0.addEventListener('selectstart', onControllerSelect);
ctrl1.addEventListener('selectstart', onControllerSelect);

setOverlay({
    title: 'Dungeon VR',
    msg: 'Loading models...',
    buttons: [],
});

await preloadEnemyModels();
state.modelsReady = true;

const initialTheme = getTheme(settings.values.theme);
applySceneTheme(initialTheme);
dungeon.generate({ width: 32, height: 32, roomCount: 10, theme: initialTheme });
player.spawn(dungeon.spawnPoint());
state.props = populateDungeon(scene, dungeon, Math.random, { theme: initialTheme });
dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);
showTitleMenu();
updateHud();

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;

    for (const p of state.props) p.update(dt);

    if (!state.finished) {
        player.update(dt);

        dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);

        for (const e of state.enemies) {
            e.update(dt, player, dungeon, now);
        }

        weapon.update(dt, state.enemies, now);

        let foundUnexploded = true;
        while (foundUnexploded) {
            foundUnexploded = false;
            for (const e of state.enemies) {
                if (!e.alive && !e._exploded) {
                    e._exploded = true;
                    state.kills++;
                    const pos = new THREE.Vector3(
                        e.group.position.x,
                        e.group.position.y + 0.7,
                        e.group.position.z,
                    );
                    state.explosions.push(new Explosion(scene, pos, audio));
                    applyExplosionDamage(state.enemies, pos, 2.2, 35, e);
                    foundUnexploded = true;
                    break;
                }
            }
        }

        const nowMs = performance.now();
        for (let i = state.enemies.length - 1; i >= 0; i--) {
            const e = state.enemies[i];
            if (!e.alive && e._removeAt != null && nowMs >= e._removeAt) {
                e.cleanup();
                state.enemies.splice(i, 1);
            }
        }

        for (let i = state.explosions.length - 1; i >= 0; i--) {
            if (!state.explosions[i].update(dt)) {
                state.explosions.splice(i, 1);
            }
        }

        playerLight.position.set(
            player.rig.position.x,
            player.rig.position.y + 1.6,
            player.rig.position.z,
        );

        if (dungeon.grid) minimap.draw(dungeon, player, state.enemies);
        updateHud();
        checkWinLose();
    } else {
        player.updateComfortIdle(dt);
        for (const e of state.enemies) {
            if (e.mixer) e.mixer.update(dt);
        }
        playerLight.position.set(
            player.rig.position.x,
            player.rig.position.y + 1.6,
            player.rig.position.z,
        );
        if (dungeon.grid) minimap.draw(dungeon, player, state.enemies);
    }

    if (pendingMenuReposition && renderer.xr.isPresenting) {
        pendingMenuReposition = false;
        if (vrMenu.isVisible()) vrMenu.show(camera);
    }
    if (vrPointer && renderer.xr.isPresenting) vrPointer.update();

    renderer.render(scene, camera);
});
