import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Dungeon } from './dungeon.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { spawnEnemiesInDungeon, spawnWaveEnemy } from './enemies.js';
import { AudioSystem } from './audio.js';
import { Minimap } from './minimap.js';
import { VRMenu, VRPointer } from './vrmenu.js';
import { Settings } from './settings.js';
import { populateDungeon, disposeProps } from './props.js';
import { spawnPickups, disposePickups, checkPickups } from './pickups.js';
import { Explosion, applyExplosionDamage } from './effects.js';
import { preloadEnemyModels } from './models.js';
import { getTheme } from './themes.js';
import { updateFloatingTexts, clearFloatingTexts, spawnFloatingText } from './floatingtext.js';

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
const timeValueEl = document.getElementById('time-value');
const ammoValueEl = document.getElementById('ammo-value');
const countdownEl = document.getElementById('countdown');
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
    pickups: [],
    explosions: [],
    totalEnemies: 0,
    kills: 0,
    headshots: 0,
    score: 0,
    runStartTime: 0,
    runEndTime: 0,
    countdownEndMs: 0,
    finished: true,
    started: false,
    paused: false,
    modelsReady: false,
    mode: 'mission',
    waveSpawnAccum: 0,
    waveCount: 0,
    nextWaveRoomIdx: 0,
    roomCleared: [],
};

const DIFFICULTY_PRESETS = {
    easy: { hpMult: 0.7, dmgMult: 0.7, countMult: 0.7 },
    normal: { hpMult: 1.0, dmgMult: 1.0, countMult: 1.0 },
    hard: { hpMult: 1.4, dmgMult: 1.5, countMult: 1.3 },
};

const BEST_TIME_KEY = 'dungeon-vr-best-time';
const BEST_SCORE_KEY = 'dungeon-vr-best-score';

function readNumber(key) {
    try {
        const v = localStorage.getItem(key);
        if (!v) return null;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}
function writeNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
}

function fmtTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

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
    state.paused = false;
    setOverlay({
        title: 'Dungeon VR',
        msg: 'A random dungeon awaits. Find and clear every enemy — or survive the waves.',
        buttons: [
            { label: 'Mission', onClick: () => startNewRun('mission') },
            { label: 'Wave Mode', onClick: () => startNewRun('wave') },
            { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
        ],
    });
}

function pauseRun() {
    if (state.paused || state.finished) return;
    state.paused = true;
    state._pauseStartMs = performance.now();
    setOverlay({
        title: 'Paused',
        msg: '',
        buttons: [
            { label: 'Resume', onClick: resumeRun },
            { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
        ],
    });
}

function resumeRun() {
    if (!state.paused) return;
    const elapsed = performance.now() - state._pauseStartMs;
    state.runStartTime += elapsed;
    state.countdownEndMs += elapsed;
    state.paused = false;
    hideOverlay();
}

function togglePause() {
    if (state.finished) return;
    if (state.paused) resumeRun();
    else pauseRun();
}

function startNewRun(mode = 'mission') {
    audio.resume();
    if (!state.modelsReady) return;
    state.mode = mode;
    state.paused = false;
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
    if (state.pickups.length) {
        disposePickups(scene, state.pickups);
        state.pickups = [];
    }

    const theme = getTheme(settings.values.theme);
    applySceneTheme(theme);

    dungeon.generate({ width: 32, height: 32, roomCount: 10, theme });
    const spawn = dungeon.spawnPoint();
    player.spawn(spawn);

    state.props = populateDungeon(scene, dungeon, Math.random, { theme });
    state.pickups = spawnPickups(scene, dungeon);
    weapon.refillFully();

    const diff = DIFFICULTY_PRESETS[settings.values.difficulty] || DIFFICULTY_PRESETS.normal;
    if (mode === 'mission') {
        state.enemies = spawnEnemiesInDungeon(scene, dungeon, audio, Math.random, {
            difficulty: diff.hpMult,
            damageMult: diff.dmgMult,
            countMult: diff.countMult,
        });
    } else {
        state.enemies = [];
    }
    state.roomEnemyCount = new Array(dungeon.rooms.length).fill(0);
    for (const e of state.enemies) {
        if (e.roomIdx >= 0) state.roomEnemyCount[e.roomIdx]++;
    }
    state.waveSpawnAccum = 0;
    state.waveCount = 0;
    state.nextWaveRoomIdx = 1;
    state.totalEnemies = mode === 'mission' ? state.enemies.length : 0;
    state.kills = 0;
    state.headshots = 0;
    state.score = 0;
    state.countdownEndMs = performance.now() + 3000;
    state.runStartTime = state.countdownEndMs;
    state.runEndTime = 0;
    state.finished = false;
    state.started = true;
    state.roomCleared = new Array(dungeon.rooms.length).fill(false);
    clearFloatingTexts();

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

    if (state.mode === 'wave') {
        const stage = state.kills % 10;
        killsFillEl.style.width = `${stage * 10}%`;
        killsValueEl.textContent = `${state.kills}`;
    } else {
        const killsFrac = state.totalEnemies > 0 ? state.kills / state.totalEnemies : 0;
        killsFillEl.style.width = `${killsFrac * 100}%`;
        killsValueEl.textContent = `${state.kills} / ${state.totalEnemies}`;
    }

    if (state.runStartTime > 0) {
        const elapsed = (state.runEndTime || performance.now()) - state.runStartTime;
        if (timeValueEl) timeValueEl.textContent = fmtTime(elapsed);
    }

    if (ammoValueEl) {
        const ammoText = weapon.reloading
            ? `... / ${weapon.reserveAmmo}`
            : `${weapon.mag} / ${weapon.reserveAmmo}`;
        ammoValueEl.textContent = ammoText;
    }

    if (player.hp < lastHp - 0.5) {
        damageVignette.classList.add('flash');
        if (damageFlashClearTimer) clearTimeout(damageFlashClearTimer);
        damageFlashClearTimer = setTimeout(() => damageVignette.classList.remove('flash'), 90);
    }
    lastHp = player.hp;

    lowHpVignette.classList.toggle('active', player.alive && player.hp > 0 && player.hp < 30);
}

function finalizeRun({ won }) {
    state.finished = true;
    state.runEndTime = performance.now();
    countdownEl.classList.add('hidden');
    const elapsed = state.runEndTime - state.runStartTime;

    if (state.mode === 'wave') {
        const prevBestScore = readNumber('dungeon-vr-best-wave-score');
        const prevBestTime = readNumber('dungeon-vr-best-wave-time');
        const newBestScore = !prevBestScore || state.score > prevBestScore;
        const newBestTime = !prevBestTime || elapsed > prevBestTime;
        if (newBestScore) writeNumber('dungeon-vr-best-wave-score', state.score);
        if (newBestTime) writeNumber('dungeon-vr-best-wave-time', elapsed);
        const lines = [
            `Survived ${fmtTime(elapsed)} · ${state.kills} kills · ${state.headshots} headshots`,
            `Score: ${state.score}${newBestScore ? '  ★ NEW BEST' : (prevBestScore ? `  (best: ${prevBestScore})` : '')}`,
        ];
        if (newBestTime) lines.push('★ LONGEST RUN');
        return lines.join('\n');
    }

    if (won) {
        const timeBonus = Math.max(0, Math.floor((60000 - elapsed) / 100));
        state.score += timeBonus;
        const prevBestScore = readNumber(BEST_SCORE_KEY);
        const prevBestTime = readNumber(BEST_TIME_KEY);
        const newBestScore = !prevBestScore || state.score > prevBestScore;
        const newBestTime = !prevBestTime || elapsed < prevBestTime;
        if (newBestScore) writeNumber(BEST_SCORE_KEY, state.score);
        if (newBestTime) writeNumber(BEST_TIME_KEY, elapsed);
        const lines = [
            `${state.totalEnemies} kills · ${state.headshots} headshots · ${fmtTime(elapsed)}`,
            `Score: ${state.score}${newBestScore ? '  ★ NEW BEST' : (prevBestScore ? `  (best: ${prevBestScore})` : '')}`,
        ];
        if (newBestTime) lines.push('★ NEW BEST TIME');
        return lines.join('\n');
    } else {
        return `Score ${state.score} · ${state.kills} kills · ${fmtTime(elapsed)}`;
    }
}

function checkWinLose() {
    if (state.finished) return;
    if (!player.alive) {
        const msg = finalizeRun({ won: false });
        setOverlay({
            title: 'You Died',
            msg,
            buttons: [
                { label: 'Restart', onClick: () => startNewRun(state.mode) },
                { label: 'Main Menu', onClick: showTitleMenu, secondary: true },
                { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
            ],
        });
        return;
    }
    if (state.mode === 'mission' && state.kills >= state.totalEnemies && state.totalEnemies > 0) {
        const msg = finalizeRun({ won: true });
        setOverlay({
            title: 'Dungeon Cleared',
            msg,
            buttons: [
                { label: 'New Dungeon', onClick: () => startNewRun(state.mode) },
                { label: 'Main Menu', onClick: showTitleMenu, secondary: true },
                { label: 'Settings', onClick: () => settings.open(), secondary: true, desktopOnly: true },
            ],
        });
    }
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
        if (state.finished) {
            if (state.modelsReady) startNewRun(state.mode);
        } else {
            weapon.startReload(weapon._lastNow);
        }
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
        if (e.code === 'Escape') document.exitPointerLock?.();
        togglePause();
    }
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
    for (const p of state.pickups) p.update(dt);
    updateFloatingTexts(dt);

    if (!state.finished && !state.paused) {
        player.update(dt);

        dungeon.updateFog(player.rig.position.x, player.rig.position.z, 6);

        const nowMs0 = performance.now();
        const timeUntilGo = state.countdownEndMs - nowMs0;
        const inCountdown = timeUntilGo > 0;
        if (inCountdown) {
            const sec = Math.max(1, Math.ceil(timeUntilGo / 1000));
            countdownEl.textContent = String(sec);
            countdownEl.classList.remove('hidden');
        } else if (timeUntilGo > -500) {
            countdownEl.textContent = 'GO!';
            countdownEl.classList.remove('hidden');
        } else {
            countdownEl.classList.add('hidden');
        }

        if (inCountdown) {
            for (const e of state.enemies) e.mixer?.update(dt);
        } else {
            for (const e of state.enemies) {
                e.update(dt, player, dungeon, now);
            }

            if (state.mode === 'wave') {
                state.waveSpawnAccum += dt;
                const elapsedRunSec = (nowMs0 - state.runStartTime) / 1000;
                const interval = Math.max(0.7, 4 - elapsedRunSec / 25);
                if (state.waveSpawnAccum >= interval) {
                    state.waveSpawnAccum = 0;
                    const room = dungeon.rooms.length > 1
                        ? state.nextWaveRoomIdx
                        : 0;
                    state.nextWaveRoomIdx++;
                    if (state.nextWaveRoomIdx >= dungeon.rooms.length) {
                        state.nextWaveRoomIdx = 1;
                    }
                    const diff = DIFFICULTY_PRESETS[settings.values.difficulty] || DIFFICULTY_PRESETS.normal;
                    const intensity = 1 + elapsedRunSec / 60;
                    const enemy = spawnWaveEnemy(scene, dungeon, audio, Math.random, room, {
                        hpMult: diff.hpMult * intensity,
                        dmgMult: diff.dmgMult,
                    });
                    if (enemy) {
                        state.enemies.push(enemy);
                        state.waveCount++;
                        state.totalEnemies = state.kills + state.enemies.filter((e) => e.alive).length;
                    }
                }
            }
        }

        weapon.update(dt, state.enemies, now);

        checkPickups(state.pickups, player.rig.position, scene, audio, player, weapon);

        let foundUnexploded = true;
        let chainDepth = 0;
        while (foundUnexploded) {
            foundUnexploded = false;
            for (const e of state.enemies) {
                if (!e.alive && !e._exploded) {
                    e._exploded = true;
                    state.kills++;
                    let killScore = 100;
                    if (e._lastHitWasHeadshot) {
                        state.headshots++;
                        killScore += 100;
                    }
                    if (chainDepth > 0) killScore += 50;
                    state.score += killScore;
                    const pos = new THREE.Vector3(
                        e.group.position.x,
                        e.group.position.y + 0.7,
                        e.group.position.z,
                    );
                    if (e.isBoss) {
                        state.score += 1500;
                        state.explosions.push(new Explosion(scene, pos, audio, {
                            duration: 1.3,
                            shardCount: 32,
                            lightIntensity: 70,
                            lightRange: 14,
                        }));
                        applyExplosionDamage(state.enemies, pos, 4.0, 80, e);
                    } else {
                        state.explosions.push(new Explosion(scene, pos, audio));
                        applyExplosionDamage(state.enemies, pos, 2.2, 35, e);
                    }
                    foundUnexploded = true;
                    chainDepth++;
                    break;
                }
            }
        }

        for (let i = 1; i < dungeon.rooms.length; i++) {
            if (state.roomCleared[i]) continue;
            if (!state.roomEnemyCount || state.roomEnemyCount[i] === 0) continue;
            let hasAlive = false;
            for (const e of state.enemies) {
                if (e.roomIdx === i && e.alive) { hasAlive = true; break; }
            }
            if (!hasAlive) {
                state.roomCleared[i] = true;
                const heal = Math.min(20, player.maxHp - player.hp);
                if (heal > 0) {
                    player.hp += heal;
                    audio?.playPlayer('pickup', 0.55, 0.85);
                }
                const room = dungeon.rooms[i];
                const wp = dungeon.cellToWorld(room.cx, room.cy);
                wp.y = 1.6;
                spawnFloatingText(scene, wp,
                    heal > 0 ? `ROOM CLEAR  +${heal} HP` : 'ROOM CLEAR',
                    { color: '#80ff80', scale: 0.6, lifetime: 1.5 });
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
