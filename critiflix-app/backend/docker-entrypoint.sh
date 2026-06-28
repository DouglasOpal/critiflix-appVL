#!/bin/sh
set -e
# Optionally seed demo data on first boot (only if the DB is empty).
if [ "${SEED_ON_START}" = "true" ]; then
  node src/scripts/seed-if-empty.js || echo "[entrypoint] seed step skipped"
fi
exec node src/index.js
