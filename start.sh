#!/usr/bin/env bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "==================================================="
echo "    🎤 Duet Karaoke Maker (Ultra-Lite Edition)    "
echo "==================================================="
echo ""

# 1. Try launching with Node.js
if command -v node >/dev/null 2>&1; then
    echo "[*] Node.js detected! Starting local lite server..."
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open http://localhost:3000 &
    elif command -v open >/dev/null 2>&1; then
        open http://localhost:3000 &
    fi
    node server.js
    exit 0
fi

# 2. Try launching with Python 3
if command -v python3 >/dev/null 2>&1; then
    echo "[*] Python 3 detected! Starting standard library server..."
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open http://localhost:3000 &
    elif command -v open >/dev/null 2>&1; then
        open http://localhost:3000 &
    fi
    python3 server.py
    exit 0
fi

# 3. Universal Fallback: Open index.html directly
echo "[*] Opening standalone browser studio directly..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DIR/public/index.html" &
elif command -v open >/dev/null 2>&1; then
    open "$DIR/public/index.html" &
fi
