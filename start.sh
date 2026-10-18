#!/usr/bin/env bash
echo "Starting Smart Car Parking System at http://localhost:8000 ..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:8000" &
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:8000" &
fi
python3 -m http.server 8000 || python -m http.server 8000
