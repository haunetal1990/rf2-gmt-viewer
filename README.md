# rF2 GMT Viewer

A viewer and editor for rFactor 2 cars and tracks. Open a VEH, GEN, SCN, a folder or a single GMT and see it the way
the game puts it together. Then edit materials, paint liveries, adjust cameras or the steering lock, and see the result
straight away.

Made by a modder, for modders. A single Windows EXE with a German and an English UI.

## Features

* **Cars**: whole car from a VEH (Spinner or Graphics GEN), including `GenString` tokens (`<1>`, `<12>` …), upgrades,
  liveries, lights, mirrors and cockpit displays
* **Tracks**: SCN with LOD variants, billboards, animations, AIW lines (driving lines, grid, pits) and a night light
  editor; sun and sky follow the time, date and location from the GDB
* **Materials**: edit the JSON parameters, textures and flags with a live preview and save them in rF2 format
* **Paint**: paint directly on the model with layers, a brush, paths, fill, gradients and effects (mirror, patterns, outline,
  wear …), then export as PNG, DDS (BC7) or PSD
* **Tools**: TGM tyre editor, clearance check (steering lock and suspension travel, written back to the HDV), camera editor,
  mod check and GEN check
* Simple MAS archives, live reload when files change in other programs, undo/redo, screenshots to
  `Pictures\rF2 GMT Viewer`, full screen without menus (handy for OBS)

The shading closely follows the rF2 shaders, but this is not the gMotor engine.

## Controls

**Mouse**

* **Orbit**: left drag = rotate, right drag or Shift + left drag = pan, wheel or Ctrl + left drag = zoom
* **Free**: right drag = look around, left drag = look around and move forward, wheel = forward / back
* Click a part to edit its material, double-click to focus it, right-click for more options

**Keyboard**

| Key | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save (material JSON, the TGM in the tyre editor) |
| `F11` | Full screen |
| `F` / `Numpad ,` | Focus the selected part (or everything) |
| `+` / `-` | Zoom |
| `1` / `2` | Orbit / Free camera |
| `W A S D` / arrow keys | Move (Free camera) |
| `Q` / `E` | Down / up (Free camera) |
| `Shift` / `Ctrl` (held) | Fast / slow (Free camera) |
| `Z` / `B` | Wire frame / face orientation |
| `Space` | Play / pause animations |
| `Esc` | Clear the selection, close the dialog |

**Paint**

| Key / mouse | Action |
|---|---|
| `B` `E` `L` `G` `V` `P` | Brush, eraser, path, fill, gradient, colour picker |
| Left drag | Paint |
| Shift + click | Straight line from the last point |
| Alt + left drag | Rotate the camera |
| Ctrl + left drag / wheel | Zoom |
| Right drag | Pan |
| Ctrl + wheel, `,` / `.` (or `[` / `]`) | Brush size |
| `X` | Swap colour 1 and 2 |
| Picker: click / Shift + click | Take the colour as colour 1 / colour 2 |
| `Del` | Delete the active layer |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save the texture as PNG |
| `Esc` | Cancel the current stroke |

**Paint – paths**

| Key / mouse | Action |
|---|---|
| Click / click + drag | Corner point / round point |
| Click on the curve / on a point | Insert a point / remove it |
| Ctrl + click, Ctrl + drag on empty space | Select points, selection frame |
| `Ctrl+A` | Select all points |
| Drag a handle (Alt: split the handles) | Shape the curve |
| Shift + drag on a point | Pull out handles |
| Ctrl + double-click | Corner ↔ round |
| `C` | Close or open the path |
| `Del` | Delete the selected points |
| `Enter` | Finish the path |

**Tyre cross-section (TGM editor)**

| Key / mouse | Action |
|---|---|
| Double-click | Full screen |
| Click / Shift + click / drag | Select / add to the selection / selection frame |
| `Ctrl+A` | Select all points |
| `Alt` (held) | Snapping on / off |
| `Esc` | Leave full screen |

## Good to know

* JSON, HDV and SCN files get a `.bak` copy the first time they are saved
* Your own Photoshop patterns (`.pat`) for Paint go into the `Patterns` folder next to the EXE
* Encrypted archives (DLC, LMU) can't be opened
* Clearance results are a geometric check – always confirm them in the game

##

Released under the MIT License, see [LICENSE](LICENSE).

## Topics
[Overtake Forum](https://www.overtake.gg/downloads/rf2-gmt-viewer.88391/)<br />
[Studio397 Forum](https://forum.studio-397.com/index.php?threads/blender-plugins-from-me.73647/)

rFactor 2 is a trademark of its respective owners. This project is not affiliated with or endorsed by them.
