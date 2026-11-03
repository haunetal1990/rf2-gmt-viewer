# rF2 GMT Viewer

A viewer and editor for rFactor 2 car mods. Open a VEH, a GEN, a folder or a single GMT and look at the car the way
the game puts it together – then change materials, tyres, cameras or the steering lock and see the result straight away.

Made by a modder, for modders. German and English UI.

## What it does

* Loads a whole car from its VEH (Spinner or Graphics GEN), a GEN/SCN, a folder full of GMTs or just one GMT
* Reads simple MAS archives referenced in the GEN
* Material JSONs: edit parameters, textures and flags with a live preview, save back in rF2 format
* Picks up changes made in other programs (JSON, DDS, GMT) and reloads them
* Upgrades from the VEH `Upgrades=` file – switch levels like in the menu or on track
* Liveries, head/brake/rain lights, mirrors and cockpit displays from the cockpitinfo
* Cameras from the `.cam` file: look through them and adjust them
* TGM tyre physics: shows the tyre model on the wheels, cross-section editor with snapping to tyre and rim
* Clearance check: turn the front wheels and move the suspension, see where tyre and rim hit the car
* Steering lock and suspension travel can be edited there and written back to the HDV
* Mod check: missing files and textures across VEH, HDV, GEN, TBC and TGM
* GEN check with the warnings rF2 would give you
* Undo / redo for (almost) everything
* Free camera with adjustable speed and a full screen mode without any menus – handy for recording videos with OBS
* Screenshots straight to `Pictures\rF2 GMT Viewer`

The shading follows the rF2 shaders closely, but it is not the gMotor engine – lighting, reflections and shadows
are simplified.

## Getting started

You need Windows 10/11 and Python 3.9 or newer.

```
pip install numpy pillow
```

Pillow is only needed for TGA textures.

Then double-click `start_viewer.bat`, or drag a `.veh`, `.gen`, `.gmt` or a folder onto it. From the command line:

```
python rf2_gmt_viewer.py "E:\...\ModDev\Vehicles\MyCar\teams\MyCar_01.veh"
```

The viewer opens in its own window (it uses the WebView2 runtime that comes with Windows). If that does not work it
falls back to an Edge or Chrome app window.

Options: `--app` (Edge/Chrome window), `--browser` (normal browser tab), `--port 8765`.

## Controls

**Mouse**

* **Orbit**: left drag = rotate, right drag or Shift + left drag = pan, wheel = zoom, Ctrl + left drag = zoom
* **Free**: hold the right (or left) mouse button and look around, wheel = move forward / back
* Click a part to edit its material, double-click to focus it, right-click for more options

**Keyboard**

| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save (material JSON, or the TGM in the tyre editor) |
| `F11` | Full screen on / off |
| `F` / `Numpad ,` | Focus on the selected part (or the whole car) |
| `+` / `-` (also Numpad) | Zoom in / out |
| `1` / `2` | Orbit / Free camera |
| `W A S D` / arrow keys | Free camera: move |
| `Q` / `E` (or `Page Down` / `Page Up`) | Free camera: down / up |
| `Shift` / `Ctrl` (held) | Free camera: fast / slow |
| `Z` | Wire frame |
| `B` | Faces (face orientation like in rF2) |
| `Space` | Play / pause texture animations |
| `Esc` | Clear the selection, close the open dialog or panel |

**Tyre cross-section (TGM editor)**

| Key / mouse | Action |
|---|---|
| Double-click the section | Open it full screen |
| Click / Shift + click | Select a point / add to or remove from the selection |
| Drag on empty space | Select points with a frame |
| `Ctrl+A` | Select all points |
| `Alt` (held while dragging) | Snapping on / off for the moment |
| Ctrl + left drag | Zoom (full screen) |
| Right or middle drag | Pan (full screen) |
| `Esc` | Leave full screen |

**Full screen without menus** (Free camera): leave with `Esc` or the key you picked in the Free camera settings.

## Good to know

* JSON and HDV files get a `.bak` copy the first time they are saved
* Encrypted archives (DLC, LMU) can't be opened
* Clearance results are a geometric check of your suspension and car meshes – always confirm in the game

## Credits

Idea and testing: haunetal1990. The GMT reader is based on the rFactor 2 importer add-on for Blender by haunetal1990.

Released under the MIT License, see [LICENSE](LICENSE).

rFactor 2 is a trademark of its respective owners. This project is not affiliated with or endorsed by them.
