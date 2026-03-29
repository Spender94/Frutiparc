@echo off

:: Always run from the directory containing this script
cd /d "%~dp0"

:: Définir le chemin vers Node.js
set NODEJS_DIR=C:\Users\remi.jallageas\OneDrive - Wavestone\Documents\nodejs\node-v22.16.0-win-x64

:: Ajouter node et npm au PATH
set PATH=%NODEJS_DIR%;%NODEJS_DIR%\node_modules\npm\bin;%PATH%

:: Installer http-server localement
call "%NODEJS_DIR%\npm.cmd" install http-server

:: Lancer le serveur sur le port attendu par le jeu (8888)
call "%NODEJS_DIR%\npm.cmd" run start

pause
