# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Run MCP against a fresh Thunderbird profile using Gecko's own Marionette client."""
import argparse
import json
import os
from pathlib import Path
import runpy
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager, nullcontext

TESTS = Path(__file__).resolve().parent


@contextmanager
def launch(binary, gecko, *, headless=True, fixture_profile=None):
    transport_file = gecko / "testing/marionette/client/marionette_driver/transport.py"
    transport_type = runpy.run_path(str(transport_file))["TcpTransport"]
    with socket.socket() as lease:
        lease.bind(("127.0.0.1", 0))
        port = lease.getsockname()[1]
    # Storage QA needs to launch two real processes against the same synthetic profile.
    with (nullcontext(fixture_profile) if fixture_profile else tempfile.TemporaryDirectory(prefix="thunderbolt-mcp-qa-")) as tmp:
        profile = Path(tmp)
        prefs = {
            "marionette.port": port, "mail.provider.suppress_dialog_on_startup": True,
            "mailnews.start_page.enabled": False, "mail.shell.checkDefaultClient": False,
            "mail.account.account1.server": "server1", "mail.accountmanager.accounts": "account1",
            "mail.accountmanager.localfoldersserver": "server1", "mail.accountmanager.defaultaccount": "account1",
            "mail.server.server1.hostname": "Local Folders", "mail.server.server1.name": "Local Folders",
            "mail.server.server1.type": "none", "mail.server.server1.userName": "nobody",
            "mail.server.server1.directory-rel": "[ProfD]Mail/Local Folders", "app.update.auto": False,
        }
        (profile / "user.js").write_text("".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items()))
        with (profile / "startup.log").open("w+") as log:
            proc = subprocess.Popen([
                str(binary), *(["--headless"] if headless else []), "--marionette", "--remote-allow-system-access",
                "-no-remote", "-profile", str(profile),
            ], env={**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1", "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}, stdout=log, stderr=subprocess.STDOUT)
            client = transport_type("127.0.0.1", port, socket_timeout=60)
            try:
                deadline = time.monotonic() + 45
                while True:
                    try:
                        client.connect()
                        break
                    except ConnectionRefusedError:
                        if proc.poll() is not None or time.monotonic() >= deadline:
                            log.seek(0)
                            raise RuntimeError(log.read()[-3000:])
                        time.sleep(0.2)

                def request(name, params):
                    response = client.request(name, params)
                    if response.error:
                        raise RuntimeError(f"{name} failed: {response.error['message']}")
                    return response.result

                request("WebDriver:NewSession", {})
                request("Marionette:SetContext", {"value": "chrome"})
                request("WebDriver:SetTimeouts", {"script": 45000})
                yield request
                if fixture_profile:
                    # Flush Gecko preferences (including the extension-origin UUID) and SQLite workers.
                    request("Marionette:Quit", {})
                    proc.wait(timeout=25)
            finally:
                client.close()
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()


def execute(request, script, *args):
    return request("WebDriver:ExecuteScript", {
        "script": script, "args": list(args), "sandbox": "system", "newSandbox": True,
    })["value"]


def run(binary, gecko, xpi):
    with launch(binary, gecko) as request:
        fixture = execute(request, (TESTS / "native-fixture.js").read_text())
        request("Addon:Install", {"path": str(xpi.resolve()), "temporary": True})
        results = execute(request, (TESTS / "native-panel.js").read_text(), fixture,
                          (TESTS / "native-mcp.js").read_text())
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    parser.add_argument("--xpi", required=True, type=Path)
    args = parser.parse_args()
    run(args.binary, args.gecko, args.xpi)
