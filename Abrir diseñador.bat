@echo off
rem Abre el disenador (version de escritorio) en el navegador. Cerra la ventana "Servidor" para apagarlo.
cd /d "%~dp0"
start "Servidor - Disenador de sellos" /min python servidor.py
timeout /t 2 /nobreak >nul
start "" http://localhost:8642/escritorio/
