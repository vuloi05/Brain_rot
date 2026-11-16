@echo off
title BOKUSEKI - Anti-Brain-Rot Kanji Studio
cd /d "%~dp0"
echo ===================================================
echo   BOKUSEKI (墨跡) - Xuong Giai Phau Kanji N5-N1
echo ===================================================
echo Dang khoi dong may chu noi bo tai http://localhost:3456 ...
start "" http://localhost:3456
node server.js
pause
