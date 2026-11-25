#!/bin/sh
set -eu
archive=${1:?expected SDK TGZ}
root=$(pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for kind in vanilla-ts phaser; do
  node scripts/create-game.mjs "$kind" "$work/$kind" "$archive"
  (
    cd "$work/$kind"
    npm ci --ignore-scripts --no-audit --no-fund
    npm test
    npm run build
    npm run pack
    cp game.zip "$root/dist/$kind.zip"
    ./node_modules/.bin/vite build --mode mock
    mkdir -p "$root/dist/templates/$kind"
    cp -R dist-mock/. "$root/dist/templates/$kind/"
  )
done
