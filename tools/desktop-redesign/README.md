# Build the desktop redesign for macOS

This branch contains the native Thunderbird changes. The adjacent source overlay builds the Thunderbolt MailExtension against a pinned public Thunderbolt revision. Its MPL-2.0 source includes the Spaces integration, chat layout, Thunderbird appearance adapter and MailExtension tools. Upstream sources and dependencies retain their respective licenses.

## Build the Thunderbolt extension

Run these commands from the root of this Thunderbird checkout with Git, Bun and zip installed. Use a new working directory for Thunderbolt.

```sh
design="$PWD/tools/desktop-redesign"
git clone https://github.com/thunderbird/thunderbolt.git ../thunderbolt-addon
git -C ../thunderbolt-addon checkout --detach 1b9000b88d7c88081bee192bc697d834fb581d41
git -C ../thunderbolt-addon apply "$design/thunderbolt.patch"
cp -R "$design/thunderbolt/." ../thunderbolt-addon/
(
  cd ../thunderbolt-addon
  bun install --frozen-lockfile
  integrations/thunderbird/build.sh
  bun test integrations/thunderbird/tests/mcp.test.ts src/providers/thunderbird-model.test.ts src/components/thunderbird-workspace/thunderbird-welcome.test.tsx src/attestation/tinfoil.test.ts --timeout 5000
)
```

The resulting XPI is at `../thunderbolt-addon/.thunderbird-build/thunderbolt-panel.xpi`. The extension opens its own space and chat tabs. Its model requires a Tinfoil key entered by the user in that Thunderbird profile.

## Package the custom Daily

The packager accepts the official macOS Thunderbird Daily 163.0a1 bundle with build ID `20261123091859`. It overlays the branch’s chrome resources on the matching native executable, bundles the compiled extension in `distribution/extensions`, verifies the archive, and ad-hoc signs the result for local use. Provide a new output path. The original application stays available.

The packager also needs the Daily source revision `66c997fa60f21ccfdfff4f7c45c800b4720b09df` and the search stack base `96f00473cd827b2ebbbe7028f288600fcad9f3ba` in the Thunderbird checkout. A shallow clone may require fetching these commits from `thunderbird/thunderbird-desktop`.

```sh
python3 tools/desktop-redesign/package_macos.py "/path/to/Thunderbird Daily.app" \
  --xpi ../thunderbolt-addon/.thunderbird-build/thunderbolt-panel.xpi \
  --output "/path/to/new/Thunderbird.app"
```

To exercise the distribution installation and reader with disposable profiles, use a Gecko checkout corresponding to that Daily (`e247d45ca363cc31111a77163acb0056a4ae5afa`).

```sh
binary="/path/to/new/Thunderbird.app/Contents/MacOS/thunderbird"
tests=tools/desktop-redesign/thunderbolt/integrations/thunderbird/tests
python3 "$tests/native_distribution.py" --binary "$binary" --gecko /path/to/gecko
python3 "$tests/native_reader_compose.py" "$binary" /path/to/gecko
```
