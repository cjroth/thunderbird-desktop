#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
set -euo pipefail

cd "$(dirname "$0")/../.."
out="$PWD/.thunderbird-build"
mkdir -p "$out"
stage=$(mktemp -d "$out/package.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT

VITE_THUNDERBIRD_PANEL=true bun run build --outDir "$stage/app"
extension=integrations/thunderbird/extension
cp "$extension/manifest.json" "$stage/app/"
cp -R "$extension/experiments" "$extension/icons" "$stage/app/"
bun build "$extension/background.js" --target browser --format iife --outfile "$stage/app/background.js"
(
  cd "$stage/app"
  zip -q -r "$stage/thunderbolt-panel.xpi" .
)
unzip -tq "$stage/thunderbolt-panel.xpi"
mv "$stage/thunderbolt-panel.xpi" "$out/thunderbolt-panel.xpi"
echo "$out/thunderbolt-panel.xpi"
