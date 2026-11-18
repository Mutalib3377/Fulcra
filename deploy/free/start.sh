#!/bin/sh
# Free hosting: one container runs the database migrations, then the web app and the worker.
# If either process stops, the other is stopped too, so Render restarts the whole service.
set -u
cd "${APP_DIR:-/app}"

echo "[start] applying database migrations"
apps/worker/node_modules/.bin/tsx packages/db/src/migrate.ts || exit 1

# The free instance has 512 MB of memory: give each process a share.
NODE_OPTIONS="--max-old-space-size=${WEB_MEMORY_MB:-256}" \
  node apps/web/.next/standalone/apps/web/server.js &
WEB=$!
(
  cd apps/worker &&
    NODE_OPTIONS="--max-old-space-size=${WORKER_MEMORY_MB:-160}" exec node --import tsx src/index.ts
) &
WORKER=$!

stop() {
  kill -TERM "$WEB" "$WORKER" 2>/dev/null
  wait
  exit 0
}
trap stop TERM INT

while kill -0 "$WEB" 2>/dev/null && kill -0 "$WORKER" 2>/dev/null; do sleep 5; done
echo "[start] a process stopped; stopping the service so it restarts"
kill -TERM "$WEB" "$WORKER" 2>/dev/null
wait
exit 1
