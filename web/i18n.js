// Languages: German (source texts in the code) and English.
// The page is written in German; in English every text node and the attributes title /
// placeholder / aria-label are translated when they appear (MutationObserver), so texts
// built by app.js and messages from the Python server are covered too.
// Language: own choice (saved) > system language reported by the server > browser language.
'use strict';
const I18N = (() => {
  const EXACT = {
    // start screen
    'Was möchtest du ansehen?': 'What do you want to view?',
    'Einzelne GMT-Dateien, einen Ordner mit GMT/JSON/DDS, einen ganzen Mod-Ordner oder ein Auto über seine VEH-Datei.':
      'Single GMT files, a folder with GMT/JSON/DDS, a whole mod folder or a car via its VEH file.',
    'Ordner': 'Folder', 'GMT, JSON, DDS – mit Unterordnern': 'GMT, JSON, DDS – including subfolders',
    'VEH-Datei': 'VEH file', 'lädt Spinner-GEN, sonst Graphics-GEN': 'loads the Spinner GEN, otherwise the Graphics GEN',
    'Einzelne GMT': 'Single GMT', 'z. B. ein Reifen oder eine Felge': 'e.g. a tyre or a rim',
    'Pfad einfügen, z. B. E:\\…\\ModDev\\Vehicles\\DLMF1_2027\\teams\\DLM27_F_0.veh':
      'Paste a path, e.g. E:\\…\\ModDev\\Vehicles\\DLMF1_2027\\teams\\DLM27_F_0.veh',
    'Öffnen': 'Open', 'Zuletzt geöffnet': 'Recently opened', 'Pfad': 'Path', 'Lade …': 'Loading …',
    // source panel
    'Andere Quelle öffnen': 'Open another source', 'Liste ein-/ausklappen': 'Expand / collapse list',
    'Teile filtern': 'Filter parts', 'Alle': 'All', 'Keine': 'None', 'Isolieren': 'Isolate', 'Alle zurück': 'Show all',
    'Nur das ausgewählte Teil zeigen': 'Show only the selected part', 'Hinweise': 'Notes',
    'Upgrades': 'Upgrades', 'Menü (Spinner)': 'Menu (Spinner)', 'Ingame (Graphics)': 'In-game (Graphics)',
    'Upgrades …': 'Upgrades …',
    'Ansicht übernehmen': 'Take this view', 'Position und Blickrichtung der freien Ansicht in diese Kamera übernehmen': 'Copy position and direction of the free view into this camera',
    'Ausblenden': 'Hide', 'Einblenden': 'Show', 'Eigenschaften …': 'Properties …', 'Löschen': 'Delete', 'Eigenschaften': 'Properties',
    'GEN speichern': 'Save GEN', 'Neue GEN erstellen': 'Create new GEN', 'Abbrechen': 'Cancel', 'Übernehmen': 'Apply', 'Speichern': 'Save',
    'GMT, DDS oder JSON hier ablegen': 'Drop GMT, DDS or JSON here', 'neu': 'new', 'Nichts zum Rückgängigmachen': 'Nothing to undo',
    'GEN-Eigenschaften (Kästchen = steht in der Zeile)': 'GEN properties (checked = written on the line)',
    'Wird beim Speichern der GEN geschrieben.': 'Written when the GEN is saved.', 'Wird in eine neue GEN geschrieben.': 'Written into a new GEN.',
    'Original überschreiben (Sicherung als .bak)': 'Overwrite the original (backup as .bak)',
    'Gelöschte, geänderte und hineingezogene GMT in die GEN schreiben': 'Write deleted, changed and dropped GMTs into the GEN',
    'Hineingezogen – noch nicht in der GEN': 'Dropped in – not in the GEN yet', 'Datei': 'File', 'Instanz': 'Instance', 'GEN-Zeile': 'GEN line', 'Außenansicht': 'Outside view', 'Cockpit-Kamera': 'Cockpit camera',
    'rF2 blendet je nach Kamera Instanzen ein und aus': 'rF2 shows / hides instances depending on the camera', 'Grafik': 'Graphics', 'keine Grafik': 'no graphics', 'Hat GEN=-Einträge': 'Has GEN= entries',
    'Keine GEN=-Einträge (z. B. Physik/Sound) - ändert im Viewer nichts': 'No GEN= entries (e.g. physics/sound) - changes nothing in the viewer',
    'Fahrzeuge in diesem Ordner': 'Vehicles in this folder', 'Gruppe ein-/ausblenden': 'Show / hide group',
    'ein-/ausblenden': 'show / hide', 'fehlt': 'missing', 'Fehler': 'Error', 'Keine Teile.': 'No parts.',
    'gefunden': 'found', 'Einzelne GMT': 'Single GMT',
    'Keine GMT-Dateien in diesem Ordner.': 'No GMT files in this folder.',
    // toolbar
    'Fokus': 'Focus', 'Orbit': 'Orbit', 'Frei': 'Free', 'Animation': 'Animation', 'Drahtgitter': 'Wireframe',
    'Faces': 'Faces', 'Licht': 'Light', 'Display': 'Display', 'Kamera': 'Camera', 'Screenshot': 'Screenshot',
    'Kamera auf Auswahl (F oder Numpad ,)': 'Camera to selection (F or Numpad ,)',
    'Orbit: links ziehen drehen, rechts verschieben, Rad oder Strg + links ziehen zoomen, Numpad +/− zoomen':
      'Orbit: left drag rotates, right drag pans, wheel or Ctrl + left drag zooms, Numpad +/− zooms',
    'Frei: rechte Maustaste halten + WASD/QE, Shift schnell – Klick öffnet Tempo, Exit-Taste und Vollbild ohne Menüs': 'Free: hold right mouse button + WASD/QE, Shift = fast – click opens speed, exit key and full screen without menus',
    'Textur-Animationen abspielen / pausieren (Leertaste)': 'Play / pause texture animations (Space)',
    'Drahtgitter (Z)': 'Wireframe (Z)',
    'Face Orientation wie in rFactor 2: nur gebaute Faces sichtbar, Rückseiten durchsichtig (außer CUBEMAT_TWOSIDED) – (B)':
      'Face orientation like rFactor 2: only built faces are visible, back faces are see-through (except CUBEMAT_TWOSIDED) – (B)',
    'Face Orientation an: nur gebaute Faces, Rückseiten durchsichtig': 'Face orientation on: only built faces, back faces see-through',
    'Face Orientation aus': 'Face orientation off',
    'Lenkrad-/Cockpit-Displays aus der cockpitinfo': 'Steering wheel / cockpit displays from the cockpitinfo',
    'Kameras aus der .cam-Datei ansehen und anpassen': 'View and edit the cameras of the .cam file',
    'Screenshot als PNG': 'Screenshot as PNG', '3D-Ansicht': '3D view', 'Erst ein Teil auswählen.': 'Select a part first.',
    // light popover
    'Licht & Umgebung': 'Light & environment', 'Ansicht': 'View', 'Studio': 'Studio', 'Himmel': 'Sky', 'Neutral': 'Neutral',
    'Sonne – Richtung': 'Sun – direction', 'Sonne – Höhe': 'Sun – height', 'Belichtung': 'Exposure',
    'Umgebungslicht': 'Ambient light', 'Bodenraster': 'Ground grid', 'Rückseiten ausblenden': 'Hide back faces',
    // rF2 sky
    'Keins': 'None', 'Kein Showroom – Studio-Licht': 'No showroom – studio light',
    'Regen / Nässe': 'Rain / wetness', 'Fahrzeuglichter (GEN)': 'Car lights (GEN)', 'Scheinwerfer': 'Headlights',
    'Bremslicht': 'Brake light', 'Regenlicht': 'Rain light', 'Rückfahrlicht': 'Reverse light', 'Warnlicht': 'Warning light',
    'Livery-JSON': 'Livery JSON', 'IBL Car Body': 'IBL Car Body', 'Car Body': 'Car Body',
    'Regentropfen auf Windschutzscheibe (L2Windscreen*) und Karosserie (L2IBLCarBody) - die Tropfen selbst berechnet das Spiel zur Laufzeit, hier ein festes Tropfenmuster':
      'Rain drops on the windscreen (L2Windscreen*) and the body (L2IBLCarBody) - the game simulates the drops at run time, here a fixed drop pattern',
    'JSON der Lackierung (<Livery>.json neben der DDS) - gewinnt vor allen anderen': 'Livery JSON (<livery>.json next to the DDS) - wins over all others',
    'Schatten': 'Shadows', 'Showroom': 'Showroom', 'Lade Showroom …': 'Loading showroom …',
    'Showroom aus …\\ModDev\\Showroom bzw. …\\Installed\\Showroom': 'Showroom from …\\ModDev\\Showroom or …\\Installed\\Showroom',
    'Wie im Spiel (PLR „Backfire Anim Speed“, Standard 30 Bilder/s)': 'Like in the game (PLR "Backfire Anim Speed", default 30 frames/s)',
    'Himmel, Sonne und Nacht wie in rFactor 2 (Ort, Datum, Uhrzeit, Wetter)': 'Sky, sun and night like in rFactor 2 (location, date, time, weather)',
    'Uhrzeit': 'Time of day', 'Zeitraffer': 'Time-lapse', 'Zeitraffer: 1 Stunde pro Sekunde': 'Time-lapse: 1 hour per second',
    'Datum': 'Date', 'Wetter': 'Weather', 'Breite': 'Lat', 'Länge': 'Lon', 'GMT±': 'GMT±', 'Nordrichtung': 'North direction',
    'Ort aus Strecken-GDB / MAS …': 'Location from track GDB / MAS …', 'Strecken-GDB wählen': 'Choose track GDB',
    'GDB der Strecke anklicken – oder die MAS der Strecke (nur unverschlüsselte).': 'Click the track GDB – or the track MAS (unencrypted only).',
    'Klar': 'Clear', 'Leicht bewölkt': 'Light clouds', 'Teilweise bewölkt': 'Partly cloudy', 'Überwiegend bewölkt': 'Mostly cloudy',
    'Bedeckt': 'Overcast', 'Leichter Regen': 'Light rain', 'Regen': 'Rain', 'Gewitter': 'Thunderstorm',
    // material panel
    'Klick ein Teil im 3D-Fenster oder in der Liste an, um sein Material zu bearbeiten.':
      'Click a part in the 3D view or in the list to edit its material.',
    'Schließen': 'Close', 'Auswahl aufheben': 'Clear selection', 'Parameter': 'Parameters', 'Texturen': 'Textures',
    'Flags': 'Flags', 'JSON': 'JSON', 'Material-JSON': 'Material JSON', 'Speichern': 'Save', 'Auto': 'Auto',
    'Live': 'Live', 'Übernehmen': 'Apply', 'JSON anlegen': 'Create JSON', 'Anlegen': 'Create',
    'Änderungen automatisch in die JSON schreiben': 'Write changes to the JSON automatically',
    'Live – Datei wird überwacht': 'Live – file is watched', 'Live – Änderung sofort sichtbar': 'Live – changes show instantly',
    'Geändert – Vorschau live, noch nicht gespeichert': 'Changed – live preview, not saved yet',
    'Neue JSON – noch nicht gespeichert': 'New JSON – not saved yet',
    'Neue JSON (noch nicht gespeichert)': 'New JSON (not saved yet)',
    'Keine JSON – Werte aus der GMT': 'No JSON – values from the GMT', 'JSON aus den GMT-Daten erzeugen': 'Create a JSON from the GMT data',
    'Andere JSON…': 'Other JSON…', 'IBL Standard': 'IBL Standard', 'Straße': 'Road',
    'Angezeigt werden die Texturen aus der GMT mit Standardwerten.': 'The textures from the GMT are shown with default values.',
    'JSON aus GMT anlegen': 'Create JSON from GMT', 'Vorschau (nur Viewer)': 'Preview (viewer only)',
    '0 = wie rF2 (ohne BLENDMASK ist blendData 0, ALBEDOFUNCTION voll angewendet), 1 = nur Albedo. Wird nicht in die JSON geschrieben.':
      '0 = like rF2 (without BLENDMASK blendData is 0, ALBEDOFUNCTION fully applied), 1 = albedo only. Not written to the JSON.',
    'Standard': 'Default', 'nicht genutzt': 'not used', 'lädt': 'loading', 'Skala': 'Scale', 'aktiv': 'active', 'ok': 'ok',
    'Andere Textur hinzuladen (Datei, Ordner oder unverschlüsselte MAS)': 'Load another texture (file, folder or unencrypted MAS)',
    'Hinzugeladene Textur entfernen': 'Remove the added texture', 'Rate (Bilder pro Sekunde)': 'Rate (frames per second)',
    'Bilder/s': 'frames/s', 'Neustart': 'Restart',
    'Event: wird im Spiel ausgelöst (z. B. Regenlicht). In der Vorschau läuft es durch.':
      'Event: triggered in game (e.g. rain light). The preview plays it continuously.',
    'Werte aus der GMT – Ändern schreibt FrameCount/Rate/Method in die JSON.': 'Values from the GMT – changing them writes FrameCount/Rate/Method to the JSON.',
    'Werte aus der GMT – Änderungen nur als Vorschau.': 'Values from the GMT – changes are preview only.',
    'Event (manuell)': 'Event (manual)', 'Flags gibt es nur mit einer Material-JSON.': 'Flags need a material JSON.',
    'Material-Flags': 'Material flags', 'kein Objekt': 'not an object', 'Neu laden': 'Reload',
    'Ruhepose': 'Rest pose',
    // browse dialog
    'Ordner öffnen': 'Open folder', 'VEH-Datei öffnen': 'Open VEH file', 'GMT-Datei öffnen': 'Open GMT file',
    'Material-JSON zuweisen': 'Assign material JSON', 'Textur hinzuladen': 'Load texture',
    'Ganzen Ordner als Texturquelle': 'Use whole folder as texture source', 'Diesen Ordner öffnen': 'Open this folder',
    'JSON anklicken, um sie diesem Material zuzuweisen.': 'Click a JSON to assign it to this material.',
    'Textur anklicken = für diesen Slot verwenden. MAS anklicken = Texturen daraus laden (nur unverschlüsselte MAS).':
      'Click a texture = use it for this slot. Click a MAS = load its textures (unencrypted MAS only).',
    'Datei anklicken öffnet sie direkt. Ordner werden mit Unterordnern gelesen.': 'Clicking a file opens it. Folders are read with their subfolders.',
    'Datei anklicken öffnet sie direkt.': 'Clicking a file opens it.',
    'Übergeordneter Ordner': 'Parent folder', 'Gehe zu': 'Go to', 'Leer.': 'Empty.',
    // camera panel
    'Kameras': 'Cameras', 'CAM-Datei': 'CAM file', 'Kamera-Panel schließen': 'Close camera panel',
    'Durch diese Kamera sehen': 'Look through this camera', 'Zurück zur freien Ansicht': 'Back to the free view',
    'Durch Kamera sehen': 'Look through', 'Aus (schwarz)': 'Off (black)', 'Im Ordner zeigen': 'Show in folder', 'Kamera': 'Camera', 'Display': 'Display', 'Spiegel links': 'Left mirror', 'Spiegel mitte': 'Center mirror', 'Spiegel rechts': 'Right mirror',
    'Klick auf einen anderen Spiegel wechselt': 'Click another mirror to switch', 'Keine cockpitinfo (MirrorPos) – Live-Bild nicht möglich.': 'No cockpitinfo (MirrorPos) – no live picture.',
    'Live: Bild der Spiegel-Kamera (ohne eigenes Auto). Testbild: Raster mit L / C / R – zeigt genau, welcher Ausschnitt der Textur MIRROR zu sehen ist': 'Live: picture of the mirror camera (without the own car). Test card: grid with L / C / R – shows exactly which part of the MIRROR texture is visible', 'Rückspiegel oben anzeigen': 'Show rear-view mirror on top', 'Rückspiegel oben ausblenden': 'Hide rear-view mirror', 'Rückspiegel': 'Rear-view mirror', 'Bildschirm-Rückspiegel wie im Spiel: das Live-Bild der Spiegel-Kamera oben in der Mitte (ohne das eigene Auto)': 'Screen rear-view mirror like in the game: the live picture of the mirror camera at the top centre (without the own car)', 'Testbild': 'Test card', 'Aus': 'Off', 'Spiegelbild': 'Mirror picture', 'Testbild: Raster mit L / C / R – zeigt am Spiegel genau, welcher Ausschnitt der Textur MIRROR zu sehen ist': 'Test card: grid with L / C / R – shows exactly which part of the MIRROR texture is visible on the mirror', 'Eigenes Auto im Spiegelbild': 'Own car in the mirror picture', 'Im Spiel ist das eigene Auto im Spiegelbild nicht zu sehen – hier zum Prüfen einblendbar': 'In the game the own car is not in the mirror picture – can be shown here for checking', 'all_vehicles.ini anklicken (…\\UserData\\player\\).': 'Click all_vehicles.ini (…\\UserData\\player\\).', 'Spiegel links / mitte / rechts (all_vehicles.ini)': 'Mirror left / center / right (all_vehicles.ini)', 'all_vehicles.ini nicht gefunden': 'all_vehicles.ini not found',
    'horizontal': 'horizontal', 'vertikal': 'vertical', 'Größe': 'size', 'Standard': 'Default', 'Datei …': 'File …', 'Neu laden': 'Reload',
    'Flächen ohne Instanz nach Lage zuordnen': 'Assign surfaces without instance by position', 'all_vehicles.ini wählen': 'Choose all_vehicles.ini',
    'horizontal 0, vertikal 0, Größe 1': 'horizontal 0, vertical 0, size 1',
    'Nur die Spiegel-Zeilen dieses Fahrzeugs in all_vehicles.ini ändern (mit .bak)': 'Only change the mirror lines of this vehicle in all_vehicles.ini (with .bak)',
    'MirrorPhysical = (x, y, z) – verschiebt den Innenspiegel CMIRROR_IN selbst': 'MirrorPhysical = (x, y, z) – moves the center mirror CMIRROR_IN itself',
    'Spiegelflächen ohne Instanz LMIRROR_IN / CMIRROR_IN / RMIRROR_IN nach ihrer Lage zuordnen (x > 0,15 m links, x < −0,15 m rechts, sonst Mitte)': 'Assign mirror surfaces without instance LMIRROR_IN / CMIRROR_IN / RMIRROR_IN by position (x > 0.15 m left, x < −0.15 m right, else center)',
    'Achtung: keine Instanz LMIRROR_IN / CMIRROR_IN / RMIRROR_IN in der GEN – im Spiel verschieben diese Werte das Bild bei diesem Auto nicht. Die Vorschau ordnet nach Lage zu.': 'Note: no instance LMIRROR_IN / CMIRROR_IN / RMIRROR_IN in the GEN – in the game these values do not move the picture for this car. The preview assigns by position.',
    'TGM anklicken – sie wird für die Achse des gewählten Rads gezeigt.': 'Click a TGM – it is shown for the axle of the selected wheel.', 'Live': 'Live', 'Links': 'Left', 'Mitte': 'Center', 'Rechts': 'Right', 'Phys. Mitte': 'Phys. center', 'Zurücksetzen': 'Reset',
    'Spieler-Einstellungen (Vorschau, all_vehicles.ini)': 'Player settings (preview, all_vehicles.ini)',
    'rF2 „Mirror Size“: Blickwinkel der Spiegel-Kamera, Standard 64° × 14°': 'rF2 "Mirror Size": field of view of the mirror camera, default 64° × 14°',
    'Bild der Spiegel-Kamera = Textur MIRROR (u 0 → 1 von links nach rechts)': 'Picture of the mirror camera = texture MIRROR (u 0 → 1 from left to right)',
    'MirrorLeft = (horizontal, vertikal, Größe) – nur für MIRROR-Flächen in Instance LMIRROR_IN': 'MirrorLeft = (horizontal, vertical, size) – only for MIRROR surfaces in instance LMIRROR_IN',
    'MirrorCenter = (horizontal, vertikal, Größe) – Instance CMIRROR_IN': 'MirrorCenter = (horizontal, vertical, size) – instance CMIRROR_IN',
    'MirrorRight = (horizontal, vertikal, Größe) – Instance RMIRROR_IN': 'MirrorRight = (horizontal, vertical, size) – instance RMIRROR_IN',
    'MirrorPhysical = (x, y, z) – verschiebt CMIRROR_IN selbst': 'MirrorPhysical = (x, y, z) – moves CMIRROR_IN itself',
    'Keine Instanz LMIRROR_IN / CMIRROR_IN / RMIRROR_IN in der GEN – die Spieler-Einstellungen Links/Mitte/Rechts wirken bei diesem Auto im Spiel nicht.':
      'No instance LMIRROR_IN / CMIRROR_IN / RMIRROR_IN in the GEN – the player settings left/center/right have no effect on this car in the game.', 'Nicht gespeicherte Änderungen': 'Unsaved changes', 'Diese Änderungen gehen beim Beenden verloren:': 'These changes will be lost when quitting:',
    'Trotzdem beenden': 'Quit anyway', 'Kameras': 'Cameras', 'Durch Spiegel sehen': 'Mirror view', 'Spiegel (MirrorPos, seitenverkehrt)': 'Mirror (MirrorPos, side-inverted)',
    'Von MirrorPos nach hinten sehen, seitenverkehrt wie im Spiegel': 'Look rearwards from MirrorPos, side-inverted like a mirror',
    'Blickwinkel der Spiegel-Vorschau (vertikal) – nur für die Ansicht, wird nicht gespeichert': 'Field of view of the mirror preview (vertical) – view only, not saved',
    'Fov der COCKPIT-Kamera (.cam), vertikal – der erste Wert in der Datei wird vom Spiel nicht benutzt': 'Fov of the COCKPIT camera (.cam), vertical – the first value in the file is not used by the game',
    '° vertikal': '° vertical', 'Spiegel-FOV': 'Mirror FOV', 'Freie Ansicht': 'Free view', 'Sitz · Spiegel · FOV': 'Seat · Mirror · FOV', 'Sitz': 'Seat', 'Spiegel': 'Mirror',
    'cockpitinfo Eyepoint – Nullpunkt der Sitzverstellung im Spiel (links/rechts, hoch/runter, vor/zurück; vorne = −Z)': 'cockpitinfo Eyepoint – zero point of the in-game seat adjustment (left/right, up/down, front/back; forward = −Z)',
    'cockpitinfo MirrorPos – Position der Spiegel-Kamera': 'cockpitinfo MirrorPos – position of the mirror camera',
    'Fov der COCKPIT-Kamera (.cam) – der zweite Wert ist vertikal und wird vom Spiel benutzt': 'Fov of the COCKPIT camera (.cam) – the second value is vertical and used by the game',
    'Kameras auf Eyepoint / CameraTarget beziehen (wie im Spiel)': 'Relate cameras to Eyepoint / CameraTarget (as in game)',
    'nur COCKPIT · Kreuz orange': 'COCKPIT only · orange cross', 'alle anderen Kameras · Kreuz grün': 'all other cameras · green cross',
    'zusätzlich für TVCOCKPIT': 'additionally for TVCOCKPIT', 'X seitl.': 'X side', 'Y Höhe': 'Y height', 'Z vor/zur.': 'Z fwd/back',
    'Keine Kameras in der Datei.': 'No cameras in the file.', 'cockpitinfo neu geladen': 'cockpitinfo reloaded',
    'cockpitinfo wurde außerhalb geändert.': 'cockpitinfo was changed outside.', 'CAM-Datei wurde außerhalb geändert.': 'CAM file was changed outside.',
    // display panel
    'Displays': 'Displays', 'Display-Panel schließen': 'Close display panel', 'Drehzahl': 'RPM', 'Drehzahl für RPMLED': 'RPM for RPMLED',
    'Text': 'Text', 'verdeckt': 'hidden', 'kein Mesh': 'no mesh', 'Zeilen': 'Rows',
    'Geändert – noch nicht in die cockpitinfo geschrieben': 'Changed – not written to the cockpitinfo yet',
    'Live – cockpitinfo wird überwacht': 'Live – cockpitinfo is watched',
    'Text liegt komplett außerhalb des Hintergrunds': 'Text lies completely outside the background',
    'Text ragt über den Hintergrund hinaus': 'Text sticks out of the background',
    'Schrift-Raster (nur ohne rF2-Raster, z. B. JPG)': 'Font grid (only without an rF2 grid, e.g. JPG)',
    'Durch diese Kamera sehen (Doppelklick)': 'Look through this camera (double click)',
    // misc / server
    'WebGL2 wird von diesem Browser nicht unterstützt.': 'This browser does not support WebGL2.',
    'ungültige Mesh-Daten': 'invalid mesh data', 'nicht gefunden': 'not found', 'Format nicht darstellbar': 'format cannot be shown',
    'Größe kein Vielfaches von 4': 'size is not a multiple of 4', 'keine DDS-Datei': 'not a DDS file', 'DDS ohne Daten': 'DDS without data',
    'Textur nicht gefunden': 'Texture not found', 'JSON nicht gefunden': 'JSON not found', 'kein JSON-Objekt': 'not a JSON object',
    'Kein Zielordner': 'No target folder', 'kein Teil': 'no part', 'kein Projekt': 'no project', 'unbekannt': 'unknown',
    'cockpitinfo nicht gefunden': 'cockpitinfo not found', 'CAM nicht gefunden': 'CAM not found',
    'keine Geometrie erkannt': 'no geometry recognised', 'zu kurz': 'too short', 'Dateitabelle unlesbar': 'file table unreadable',
    'Dateitabelle passt nicht zur Dateigröße': 'file table does not match the file size',
    'verschlüsselt oder neues Format (DLC / LMU) - wird nicht entpackt': 'encrypted or new format (DLC / LMU) – not extracted',
    'Pillow fehlt (pip install pillow) - wird für TGA und DDS-Formate gebraucht, die die Grafikkarte im Browser nicht direkt kann.':
      'Pillow is missing (pip install pillow) – needed for TGA and DDS formats the browser GPU cannot take directly.',
    'Sprache': 'Language', 'Hitze': 'Heat',
    'Hitzeflimmern (heat_fx) – wie der rF2-Shader „Heat Effect“: das Bild dahinter wird mit der animierten Normal-Map verzerrt (H)':
      'Heat haze (heat_fx) – like the rF2 shader "Heat Effect": the picture behind is distorted by the animated normal map (H)',
    'Hitzeflimmern an (heat_fx sichtbar)': 'Heat haze on (heat_fx visible)', 'Hitzeflimmern aus': 'Heat haze off',
    'Spiel-Effekt (heat_fx = Hitzeflimmern, backfire = Fehlzündung)': 'Game effect (heat_fx = heat shimmer, backfire = exhaust flame)', 'Fehlende Dateien ausblenden': 'Hide missing files', 'Keine Texturen.': 'No textures.', 'Kanal': 'Channel', 'Kanal anzeigen': 'Show channel',
    'Nacht (EMISSIVEMODE Night an)': 'Night (EMISSIVEMODE Night on)', 'Normalen': 'Normals', 'Nur GMT-Daten': 'GMT data only',
    'UV-Raster': 'UV grid', 'Weitere Werte': 'More values', 'Zuweisen…': 'Assign…',
  };
  // [regex on the German text, English replacement]
  const PATTERNS = [
    [/^(.*) · (\d+) Objekte · (.*?)( · Reflexion (.*))?$/, (m, a, b, c, d, e) => a + ' · ' + b + ' objects · ' + c + (e ? ' · reflection ' + e : '')],
    [/^Keine Showroom-MAS in (.+)$/, 'No showroom MAS in $1'],
    [/^(.*?)Sonne (-?[\d.]+)° hoch, (\d+)° Azimut(.*)$/, (m, a, b, c, d) => a + 'Sun ' + b + '° high, ' + c + '° azimuth' + d.replace('Nacht', 'night').replace('Dämmerung', 'twilight')],
    [/^Ort übernommen: (.+)$/, 'Location applied: $1'],
    [/^(.+): keine Latitude\/Longitude gefunden$/, '$1: no Latitude/Longitude found'],
    [/^Keine GDB in (.+)$/, 'No GDB in $1'],
    [/^Öffne (.+) …$/, 'Opening $1 …'],
    [/^Rückgängig: (.+)$/, 'Undone: $1'], [/^GEN speichern \((\d+)\)$/, 'Save GEN ($1)'], [/^Gespeichert: (.+)$/, 'Saved: $1'],
    [/^Zeile (\d+): (.+)$/, 'Line $1: $2'], [/^GEN-Prüfung · (.+)$/, 'GEN check · $1'], [/^Lade (.+) …$/, 'Loading $1 …'],
    [/^VEH Upgrades="(.+)" nicht gefunden\.$/, 'VEH Upgrades="$1" not found.'],
    [/^(.+): Token <(.+)> ist weder ein Upgrade-Token noch GenString - rF2 meldet (.+) und schreibt (.+)\.$/, '$1: token <$2> is neither an upgrade token nor GenString - rF2 logs $3 and writes $4.'],
    [/^(.+): <(.+)> wird von mehreren Upgrades definiert \((.+)\) - rF2 hängt alle Werte hintereinander\.$/, '$1: <$2> is defined by several upgrades ($3) - rF2 appends all values.'],
    [/^(.+): (\d+)× <STARTUPGRADES>, aber (\d+)× <STOPUPGRADES>\.$/, '$1: $2× <STARTUPGRADES>, but $3× <STOPUPGRADES>.'],
    [/^(.+) \(Spinner\): Upgrade-Token außerhalb von <STARTUPGRADES>…<STOPUPGRADES>: (.+) - dort gilt immer nur ein Level, im Menü ändert sich nichts\.$/, '$1 (Spinner): upgrade token outside <STARTUPGRADES>…<STOPUPGRADES>: $2 - only one level applies there, nothing changes in the menu.'],
    [/^(.+) \(Spinner\): <STOPUPGRADES> ohne <STARTUPGRADES> - rF2 springt an den Dateianfang zurück und wiederholt die ganze GEN\.$/, '$1 (Spinner): <STOPUPGRADES> without <STARTUPGRADES> - rF2 jumps back to the file start and repeats the whole GEN.'],
    [/^Upgrade "(.+)": Token (.+) kommt in (.+) nicht vor - keine sichtbare Wirkung\.$/, 'Upgrade "$1": token $2 does not occur in $3 - no visible effect.'],
    [/^Lade Teile (\d+) \/ (\d+)$/, 'Loading parts $1 / $2'],
    [/^(\d+) Skins$/, '$1 skins'],
    [/^(.*): Dateiliste gelesen \((\d+) Dateien\), aber die Einträge lassen sich nicht entpacken - Texturen daraus fehlen\.$/, '$1: file list read ($2 files), but the entries cannot be unpacked - textures from it are missing.'],
    [/^(\d+) \/ (\d+) Teile · (\d+) Materialien$/, '$1 / $2 parts · $3 materials'],
    [/^WebGL2 · GPU-DDS: keine \(Pillow-Fallback\)$/, 'WebGL2 · GPU-DDS: none (CPU fallback)'],
    [/^ANM-Fehler: (.*)$/s, 'ANM error: $1'],
    [/^Skelett mit (\d+) Bones – keine passende ANM gefunden \(Ruhepose\)\.$/, 'Skeleton with $1 bones – no matching ANM found (rest pose).'],
    [/^(\d+) Bilder · ([\d.]+) fps$/, '$1 frames · $2 fps'],
    [/^Standard \((.*)\)$/, 'Default ($1)'],
    [/^(.*) Wert$/, '$1 value'],
    [/^Für dieses Material wurde keine JSON gefunden \(die Engine sucht "(.*)" in den Suchpfaden\)\. Angezeigt werden die Texturen aus der GMT mit Standardwerten\.$/,
      'No JSON was found for this material (the engine looks for "$1" in the search paths). The textures from the GMT are shown with default values.'],
    [/^Textur für (.*?): (.*) \(JSON geändert – Speichern nicht vergessen\)$/, 'Texture for $1: $2 (JSON changed – remember to save)'],
    [/^Textur für (.*?): (.*) \(nur Vorschau\)$/, 'Texture for $1: $2 (preview only)'],
    [/^Textur für (.*)$/, 'Texture for $1'],
    [/^Textur hinzuladen für (.*)$/, 'Load texture for $1'],
    [/^(\d+) Bilder · aus (.*)$/, '$1 frames · from $2'],
    [/^(.*) – fehlt$/, '$1 – missing'],
    [/^(.*)\.json wurde außerhalb geändert\.$/, '$1.json was changed outside.'],
    [/^JSON neu geladen: (.*)$/, 'JSON reloaded: $1'],
    [/^Textur neu geladen: (.*)$/, 'Texture reloaded: $1'],
    [/^GMT neu geladen: (.*)$/, 'GMT reloaded: $1'],
    [/^CAM neu geladen: (.*)$/, 'CAM reloaded: $1'],
    [/^(\d+) Dateien aus (.*) verfügbar$/, '$1 files from $2 available'],
    [/^(\d+) Texturen aus (.*) hinzugeladen$/, '$1 textures loaded from $2'],
    [/^JSON zugewiesen \(nur in dieser Sitzung\): (.*)$/, 'JSON assigned (this session only): $1'],
    [/^Server nicht erreichbar: (.*)$/, 'Server not reachable: $1'],
    [/^Kamera: (.*)$/, 'Camera: $1'],
    [/^(.*)Position relativ zum Fahrzeug-Ursprung, vorne = −Z$/, '$1Position relative to the vehicle origin, forward = −Z'],
    [/^(.*)Position relativ zum Eyepoint, vorne = −Z$/, '$1Position relative to the Eyepoint, forward = −Z'],
    [/^(.*)Position relativ zu CameraTarget \+ TVOffset, vorne = −Z$/, '$1Position relative to CameraTarget + TVOffset, forward = −Z'],
    [/^(.*)Position relativ zu CameraTarget, vorne = −Z$/, '$1Position relative to CameraTarget, forward = −Z'],
    [/^nicht gefunden: (.*)$/, 'not found: $1'],
    [/^Schrift fehlt: (.*)$/, 'Font missing: $1'],
    [/^auf (.*)$/, 'on $1'],
    [/^Diese Anzeige auf (.*) zeigen$/, 'Show this display on $1'],
    [/^Hintergrund (\S+)( \(fehlt\))? · Schrift (\S+), Zelle (\S+)( \(ohne rF2-Raster\))? · Text x (.*), y (.*)$/,
      (m, a, b, c, d, e, f, g) => `Background ${a}${b ? ' (missing)' : ''} · font ${c}, cell ${d}${e ? ' (no rF2 grid)' : ''} · text x ${f}, y ${g}`],
    [/^Zeilen (.*)$/, 'Rows $1'],
    [/^Screenshot gespeichert: (.*)$/, 'Screenshot saved: $1'],
    [/^Material: (.*)$/, 'Material: $1'], [/^Kamera: (.*)$/, 'Camera: $1'],
    [/^Kamera – Sitz\/Spiegel\/Bezugspunkte: (.*)$/, 'Camera – seat/mirror/reference points: $1'],
    [/^Display: (.*)$/, 'Display: $1'], [/^Teile: GEN (.*)$/, 'Parts: GEN $1'], [/^Spiegel: (.*)$/, 'Mirrors: $1'],
    [/^(Links|Mitte|Rechts) \((Mirror\w+)\)$/, (m, a, b) => ({ Links: 'Left', Mitte: 'Center', Rechts: 'Right' })[a] + ' (' + b + ')'],
    [/^Im Spiel wirksam für: (.*)$/, 'Active in the game for: $1'],
    [/^(.*) – Fahrzeug nicht gefunden$/, '$1 – vehicle not found'],
    [/^Dieses Fahrzeug steht nicht in (.*)$/, 'This vehicle is not in $1'],
    [/^Gespeichert: (.*) \(rF2 vorher beenden – es schreibt die Datei beim Beenden neu\)$/, 'Saved: $1 (quit rF2 first – it rewrites the file when it quits)'],
    [/^Fahrzeug nicht in (.*) - einmal im Spiel fahren, dann legt rF2 den Eintrag an\.$/, 'Vehicle not in $1 - drive it once in the game, then rF2 adds the entry.'],
    [/^all_vehicles\.ini \(Spiegel\)$/, 'all_vehicles.ini (mirrors)'],
    [/^Gefunden: (.*)$/, 'Found: $1'],
    [/^Spiegel-FOV (horizontal|vertikal)$/, (m, a) => 'Mirror FOV ' + (a === 'vertikal' ? 'vertical' : 'horizontal')],
    [/^(Links|Mitte|Rechts|Phys\. Mitte) (horizontal|vertikal|Größe|X|Y|Z)$/, (m, a, b) => ({ Links: 'Left', Mitte: 'Center', Rechts: 'Right', 'Phys. Mitte': 'Phys. center' })[a] + ' ' + ({ vertikal: 'vertical', 'Größe': 'size' })[b] || b],
    [/^Kameras \((.*)\)$/, 'Cameras ($1)'],
    [/^Mausrad über dem Feld = ± (.*) \(Shift ×10\)$/, 'Mouse wheel over the field = ± $1 (Shift ×10)'],
    [/^(Sitz|Spiegel) ([XYZ])$/, (m, a, b) => (a === 'Sitz' ? 'Seat ' : 'Mirror ') + b],
    [/^(.*): GPU-Format im Browser nicht verfügbar$/, '$1: GPU format not available in the browser'],
    [/^(.*) · per CPU dekodiert$/, '$1 · decoded on the CPU'],
    [/^DXGI-Format (\d+) nicht unterstützt$/, 'DXGI format $1 not supported'],
    [/^FourCC (.*) nicht unterstützt$/, 'FourCC $1 not supported'],
    [/^DDS-Pixelformat nicht unterstützt \((.*)\)$/, 'DDS pixel format not supported ($1)'],
    // server / project messages
    [/^(\d+) GMT · Ordner( \+ Unterordner)?$/, (m, n, sub) => `${n} GMT · folder${sub ? ' + subfolders' : ''}`],
    [/^(Spinner|Graphics)-GEN · (.*)$/, '$1 GEN · $2'],
    [/^(\d+) GMT-Dateien gefunden - nur die ersten (\d+) werden automatisch angezeigt\. Weitere in der Liste einblenden\.$/,
      '$1 GMT files found – only the first $2 are shown automatically. Show more in the list.'],
    [/^Spinner-GEN "(.*)" nicht gefunden - nutze Graphics\.$/, 'Spinner GEN "$1" not found – using Graphics.'],
    [/^GEN-Datei aus der VEH nicht gefunden \(kein Graphics= Eintrag\)\.$/, 'GEN file from the VEH not found (no Graphics= entry).'],
    [/^GEN-Datei aus der VEH nicht gefunden \((.*)\)\.$/, 'GEN file from the VEH not found ($1).'],
    [/^VEH MaterialOverride="(.*)" nicht gefunden - Lackierung ohne IBL-Car-Body-Material \(rF2 lädt sie\)\.$/, 'VEH MaterialOverride="$1" not found – paint without the IBL car body material (rF2 loads it).'],
    [/^VEH (.*)="(.*)" nicht gefunden\.$/, 'VEH $1="$2" not found.'],
    [/^(\d+) GMT aus der GEN nicht als Datei gefunden(.*)\.$/, (m, n, rest) => `${n} GMT from the GEN not found as files` +
      rest.replace(/ verschlüsselt\/nicht lesbar/g, ' encrypted/unreadable').replace(/ nicht gefunden/g, ' not found') + '.'],
    [/^(\d+) fehlende GMT anzeigen$/, 'Show $1 missing GMT'],
    [/^(\d+) fehlende GMT ausblenden$/, 'Hide $1 missing GMT'],
    [/^JSON (.*) nicht lesbar: (.*)$/, 'JSON $1 not readable: $2'],
    [/^Nicht unterstützt: (.*) \(Ordner, \.veh, \.gen, \.scn oder \.gmt\)$/, 'Not supported: $1 (folder, .veh, .gen, .scn or .gmt)'],
    [/^Ordner nicht gefunden: (.*)$/, 'Folder not found: $1'],
    [/^Pfad nicht gefunden: (.*)$/, 'Path not found: $1'],
    [/^GMT fehlt: (.*)$/, 'GMT missing: $1'],
    [/^Textur nicht gefunden: (.*)$/, 'Texture not found: $1'],
    [/^Existiert bereits: (.*)$/, 'Already exists: $1'],
    [/^Eintrag verschlüsselt: (.*)$/, 'Entry encrypted: $1'],
    [/^(.*): verschlüsselt oder neues Format \(DLC \/ LMU\) - wird nicht entpackt$/, '$1: encrypted or new format (DLC / LMU) – not extracted'],
    [/^Gespeichert: (.*)$/, 'Saved: $1'],
    [/^(\d+) Teile$/, '$1 parts'],
    [/^(.*) (X seitl\.|Y Höhe|Z vor\/zur\.)$/, (m, a, b) => a + ' ' + EXACT[b]],
  ];

  let lang = 'de';
  const tr = s => {
    if (lang === 'de' || !s) return s;
    const t = s.trim();
    if (!t) return s;
    const hit = EXACT[t];
    if (hit !== undefined) return s.replace(t, hit);
    for (const [re, rep] of PATTERNS) {
      if (re.test(t)) return s.replace(t, t.replace(re, rep));
    }
    return s;
  };
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  let busy = false;
  function translateNode(n) {
    if (n.nodeType === 3) {
      const v = n.nodeValue, t = tr(v);
      if (t !== v) n.nodeValue = t;
      return;
    }
    if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'TEXTAREA') return;
    for (const a of ATTRS) {
      const v = n.getAttribute(a);
      if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); }
    }
    if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) n.value = tr(n.value);
    for (const c of n.childNodes) translateNode(c);
  }
  function start(l) {
    lang = l === 'en' ? 'en' : 'de';
    document.documentElement.lang = lang;
    if (lang === 'de') return;
    document.title = tr(document.title);
    translateNode(document.body);
    new MutationObserver(list => {
      if (busy) return;
      busy = true;
      try {
        for (const m of list) {
          if (m.type === 'characterData') translateNode(m.target);
          else if (m.type === 'attributes') {
            const v = m.target.getAttribute(m.attributeName);
            if (v) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); }
          }
          else m.addedNodes.forEach(translateNode);
        }
      } finally { busy = false; }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // choice: saved in the viewer settings > system language (reported by the server) > browser
  function detect(saved, osLang) {
    if (saved === 'de' || saved === 'en') return saved;
    const sys = String(osLang || '').toLowerCase();
    if (sys) return sys.startsWith('de') ? 'de' : 'en';
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
  }
  // more texts from other scripts (e.g. tgm.js)
  function extend(exact, patterns) { Object.assign(EXACT, exact || {}); for (const p of patterns || []) PATTERNS.push(p); }
  return { start, detect, tr, extend, get lang() { return lang; } };
})();
