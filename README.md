## Dungeon VR

A small browser-based first-person shooter dungeon crawler for VR headsets (built and tested against Meta Quest 3).
Each run generates a random grid-based dungeon; clear all enemies to win.
Plays in any WebXR-capable browser; falls back to mouse plus WASD on desktop.

> [!NOTE]
> Report bugs and feature requests on the [issues page](https://github.com/pixel-clover/dungeon-vr/issues).

### Play

Open https://pixel-clover.github.io/dungeon-vr/ in:

- **Quest 3** (or any WebXR headset): use the built-in browser, then click `Enter VR`.
- **Desktop**: any modern browser. Click the canvas to lock the pointer and play.

#### Controls

| Action              | VR                           | Desktop           |
|---------------------|------------------------------|-------------------|
| Move                | Left thumbstick              | `W` `A` `S` `D`   |
| Look / aim          | Head                         | Mouse             |
| Turn                | Right thumbstick (snap-turn) | Mouse             |
| Shoot               | Trigger (right hand)         | Left mouse button |
| Restart after a run | Trigger                      | `R`               |

The minimap is on your **left wrist** in VR and the top-right of the screen on desktop.

### Run Locally

```bash
git clone https://github.com/pixel-clover/dungeon-vr.git
cd dungeon-vr
bash scripts/start_server.sh
```

Then open http://localhost:8085/index.html.

To test on a Quest while developing, you can use ADB reverse so the headset can reach your laptop's localhost:

```bash
adb reverse tcp:8085 tcp:8085
```

Then load `http://localhost:8085/index.html` in the Quest browser.

---

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to make a contribution.

### License

This project is licensed under the MIT License (see [LICENSE](LICENSE)).
