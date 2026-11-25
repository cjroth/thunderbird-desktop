# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Verify a real Thunderbolt SQLite write across two Thunderbird processes sharing one disposable profile."""
import argparse
import json
from pathlib import Path
import tempfile
import time

from native_smoke import launch
from native_space import open_space, space_chrome, space_content


def run(binary, gecko, xpi):
    script = Path(__file__).with_name("native-storage.js").read_text()
    with tempfile.TemporaryDirectory(prefix="thunderbolt-storage-qa-") as folder:
        profile = Path(folder)
        with launch(binary, gecko, fixture_profile=profile) as request:
            request("Addon:Install", {"path": str(xpi.resolve()), "temporary": False})
            open_space(request)
            write = space_content(request, script, "write")
            print(json.dumps(write), flush=True)
            space_content(request, "document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))")
            space_content(request, "document.querySelector('[data-testid=thunderbird-new-chat]').click()")
            wait_for_two_tabs(request)
        with launch(binary, gecko, fixture_profile=profile) as request:
            wait_for_two_tabs(request)
            open_space(request)
            reopen = space_content(request, script, "reopen")
        assert write["origin"] == reopen["origin"]
        print(json.dumps(reopen), flush=True)


def wait_for_two_tabs(request):
    deadline = time.monotonic() + 25
    while not space_chrome(request, """
        return space && tabmail.tabInfo.filter(tab =>
            space.tabInSpace(tab) && tab.browser.currentURI.scheme === 'moz-extension'
        ).length === 2;
    """):
        if time.monotonic() >= deadline:
            raise AssertionError("Expected two independent native Thunderbolt tabs")
        time.sleep(0.1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    parser.add_argument("--xpi", required=True, type=Path)
    args = parser.parse_args()
    run(args.binary, args.gecko, args.xpi)
