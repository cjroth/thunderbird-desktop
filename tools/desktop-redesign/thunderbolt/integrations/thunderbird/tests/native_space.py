# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Drive the installed extension through the same space button as a user."""
import time

from native_smoke import execute


def space_chrome(request, script, *args):
    return execute(request, """
        const win = Services.wm.getMostRecentWindow("mail:3pane");
        const doc = win.document;
        const tabmail = doc.getElementById("tabmail");
        const space = win.gSpacesToolbar.spaces?.find(s =>
            s.isExtensionSpace && s.button.title === "Thunderbolt");
        const browser = tabmail.currentTabInfo.browser;
    """ + script, *args)


def open_space(request):
    deadline = time.monotonic() + 30
    while not space_chrome(request, "return !!space"):
        if time.monotonic() >= deadline:
            raise AssertionError("Thunderbolt did not register its space")
        time.sleep(0.1)
    space_chrome(request, "space.button.click()")
    while not space_chrome(request, """
        return space.tabInSpace(tabmail.currentTabInfo) &&
            browser?.currentURI.scheme === "moz-extension";
    """):
        if time.monotonic() >= deadline:
            raise AssertionError("Thunderbolt did not open a native space tab")
        time.sleep(0.1)


def space_content(request, script, *args):
    return space_chrome(request, """
        return browser.browsingContext.currentWindowGlobal.getActor("MarionetteCommands")
            .executeScript(arguments[0], arguments[1], {newSandbox: true, timeout: 20000});
    """, script, list(args))
