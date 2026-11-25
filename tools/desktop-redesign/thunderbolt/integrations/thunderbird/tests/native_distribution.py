# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Check a distribution-packaged Thunderbolt install across two native starts."""

import argparse
from pathlib import Path
import tempfile

from native_smoke import execute, launch
from native_space import open_space, space_chrome


def run(binary, gecko):
    with tempfile.TemporaryDirectory(prefix="thunderbolt-distribution-") as directory:
        profile = Path(directory)
        origins = []
        for _ in range(2):
            with launch(binary, gecko, fixture_profile=profile) as request:
                open_space(request)
                state = execute(request, """
                    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
                    return AddonManager.getAddonByID("thunderbolt-panel@thunderbird.net").then(addon => ({
                      active: addon.isActive,
                      temporary: addon.temporarilyInstalled,
                      source: addon.installTelemetryInfo.source,
                      signatureOverride: Services.prefs.prefHasUserValue("xpinstall.signatures.required"),
                    }));
                """)
                assert state == {
                    "active": True, "temporary": False, "source": "distribution", "signatureOverride": False,
                }, state
                origins.append(space_chrome(request, "return browser.currentURI.prePath;"))
        assert origins[0] == origins[1], origins
        print("Thunderbolt persisted and opened its native space after restart.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    options = parser.parse_args()
    run(options.binary, options.gecko)
