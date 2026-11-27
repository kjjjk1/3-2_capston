@echo off

cd /d "%~dp0"

echo Open http://127.0.0.1:8765/ in your browser.

py -m http.server 8765 --bind 127.0.0.1

pause

