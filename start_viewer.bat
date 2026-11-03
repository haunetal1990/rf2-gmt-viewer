@echo off
rem rF2 GMT Viewer - Doppelklick startet, oder eine .veh/.gen/.gmt bzw. einen Ordner auf diese Datei ziehen.
cd /d "%~dp0"
python rf2_gmt_viewer.py %*
if errorlevel 1 pause
