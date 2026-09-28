#!/bin/sh
set -eu
: "${SCREEN_SIZE:=1440x960x24}"

# TCP so the app containers can reach it; -ac is acceptable because port 6099 is only on the compose network.
Xvfb :99 -screen 0 "$SCREEN_SIZE" -listen tcp -ac &
export DISPLAY=:99
until xdpyinfo >/dev/null 2>&1; do sleep 0.2; done

fluxbox >/dev/null 2>&1 &
x11vnc -display :99 -forever -shared -nopw -localhost -quiet &
exec websockify --web /usr/share/novnc 6080 localhost:5900
