# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Check the native space, responsive composer and optional Japanese language pack in Thunderbird."""
import argparse
import base64
from pathlib import Path
import time

from native_smoke import launch
from native_space import open_space, space_chrome, space_content


def wait_for(check, description):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(f"Timed out waiting for {description}")


def relative_luminance(rgb):
    channels = [c / 255 for c in rgb]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(weight * value for weight, value in zip((0.2126, 0.7152, 0.0722), linear))


def run(args):
    with launch(args.binary, args.gecko, headless=not args.show_window) as request:
        def chrome(script, *params):
            return space_chrome(request, script, *params)

        def content(script):
            return space_content(request, script)

        request("WebDriver:SetWindowRect", {"width": 1320, "height": 860})
        request("Addon:Install", {"temporary": True, "path": str(args.xpi.resolve())})
        open_space(request)
        wait_for(lambda: content("return !!document.querySelector('textarea')"), "chat composer")
        route = content("return location.hash")
        assert route == "#/chats/new", route
        tab_id = chrome("return tabmail.currentTabInfo.tabId")
        chrome("doc.getElementById('mailButton').click()")
        wait_for(lambda: chrome("return win.gSpacesToolbar.currentSpace?.name === 'mail'"), "mail space")
        open_space(request)
        assert chrome("return tabmail.currentTabInfo.tabId") == tab_id
        assert content("return location.hash") == route
        print("Returned from Mail to the same Thunderbolt tab.", flush=True)
        # Exercise the native redesign when the host exposes space labels.
        if chrome("return !!space.button.querySelector('.space-label')"):
            assert chrome("return space.button.querySelector('.space-label').textContent") == "Thunderbolt"
            chrome("""return new Promise(resolve => {
                const menu = doc.getElementById('spacesContextMenu');
                menu.addEventListener('popupshown', () => resolve(true), {once: true});
                space.button.dispatchEvent(new win.MouseEvent('contextmenu', {bubbles: true, button: 2}));
            })""")
            assert chrome("return !doc.getElementById('spacesContextNewTabItem').hidden")
            assert chrome("return doc.querySelectorAll('#spacesContextMenu .switch-to-tab').length") == 1
            chrome("doc.getElementById('spacesContextMenu').activateItem(doc.getElementById('spacesContextNewTabItem'))")
            wait_for(lambda: chrome("return tabmail.currentTabInfo.tabId !== arguments[0] && space.tabInSpace(tabmail.currentTabInfo)", tab_id),
                     "new native space tab")
            wait_for(lambda: chrome("return browser.currentURI.scheme === 'moz-extension' && tabmail.currentTabInfo.root.getAttribute('tabtoolbar') === 'false'"),
                     "the space document to use the native toolbar")
            chrome("""const { MailE10SUtils } = ChromeUtils.importESModule('resource:///modules/MailE10SUtils.sys.mjs');
                MailE10SUtils.loadURI(browser, 'data:text/html,<title>Ordinary content</title>');
            """)
            wait_for(lambda: chrome("return browser.currentURI.scheme === 'data' && tabmail.currentTabInfo.root.getAttribute('tabtoolbar') === 'true'"),
                     "location controls to return for ordinary content")
            chrome("tabmail.closeTab(tabmail.currentTabInfo)")
            open_space(request)
            assert chrome("return tabmail.currentTabInfo.tabId") == tab_id

        for mode in ("light", "dark"):
            chrome("""
              const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs')
              return AddonManager.getAddonByID('thunderbird-compact-' + arguments[0] + '@mozilla.org')
                .then(addon => addon.enable())
            """, mode)
            wait_for(lambda: content("return getComputedStyle(document.documentElement).colorScheme") == mode, mode)
            appearance = content("return window.messenger.thunderboltPanel.getAppearance()")
            content("document.activeElement.blur()")
            rendered = content("""
              const root = getComputedStyle(document.documentElement)
              const composer = document.querySelector('.composer-surface')
              const textarea = composer.querySelector('textarea')
              return {
                scheme: root.colorScheme,
                font: getComputedStyle(document.body).fontSize,
                editorWidth: textarea.clientWidth,
                editorHeight: textarea.clientHeight,
                hasOverflow: document.documentElement.scrollWidth > innerWidth,
              }
            """)
            assert rendered["scheme"] == mode and rendered["font"] == appearance["fontSize"], rendered
            assert rendered["editorWidth"] >= 200 and rendered["editorHeight"] >= 20, rendered
            assert not rendered["hasOverflow"], rendered
            text, background = content("""
              const ctx = document.createElement('canvas').getContext('2d')
              const textarea = document.querySelector('textarea')
              const ancestry = []
              for (let el = textarea; el; el = el.parentElement) ancestry.unshift(el)
              // Composite ancestor fills, including transparency, behind the text.
              ctx.fillStyle = getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'black' : 'white'
              ctx.fillRect(0, 0, 1, 1)
              for (const el of ancestry) {
                ctx.fillStyle = getComputedStyle(el).backgroundColor
                ctx.fillRect(0, 0, 1, 1)
              }
              const bg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
              ctx.fillStyle = getComputedStyle(textarea).color
              ctx.fillRect(0, 0, 1, 1)
              return [[...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3), bg]
            """)
            low, high = sorted((relative_luminance(text), relative_luminance(background)))
            contrast = (high + 0.05) / (low + 0.05)
            assert contrast >= 4.5, (mode, text, background, contrast)
            content("document.querySelector('[data-testid=thunderbird-settings]').click()")
            wait_for(lambda: content("return !!document.querySelector('[role=dialog] input[name=key]')"),
                     "provider settings in the active tab")
            content("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            wait_for(lambda: content("return !document.querySelector('[role=dialog]')"), "dialog dismissal")
            print(f"Thunderbird {mode} theme: composer text contrast {contrast:.2f}:1.", flush=True)
            if args.screenshots:
                args.screenshots.mkdir(parents=True, exist_ok=True)
                image = request("WebDriver:TakeScreenshot", {"full": False})["value"]
                (args.screenshots / f"space-{mode}.png").write_bytes(base64.b64decode(image))

        request("WebDriver:SetWindowRect", {"width": 690, "height": 720})
        wait_for(lambda: content("return innerWidth <= 690"), "narrow window")
        assert content("""
            const r = document.querySelector('textarea').getBoundingClientRect()
            return r.width > 200 && r.left >= 0 && r.right <= innerWidth &&
                document.documentElement.scrollWidth <= innerWidth
        """), "The narrow composer must fit the tab"
        if args.screenshots:
            image = request("WebDriver:TakeScreenshot", {"full": False})["value"]
            (args.screenshots / "space-narrow.png").write_bytes(base64.b64decode(image))

        if args.japanese_langpack:
            request("Addon:Install", {"temporary": True, "path": str(args.japanese_langpack.resolve())})
            chrome("Services.locale.requestedLocales = ['ja-JP-mac', 'en-US']")
            wait_for(lambda: chrome("return Services.locale.appLocaleAsBCP47.startsWith('ja')"), "Japanese host")
            wait_for(lambda: content("return document.documentElement.lang") == "ja", "Japanese space")
            placeholder = content("return document.querySelector('textarea').placeholder")
            assert any(ord(c) > 127 for c in placeholder), placeholder
            print(f"Thunderbird switched to Japanese and the composer now reads {placeholder!r}.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    parser.add_argument("--xpi", required=True, type=Path)
    parser.add_argument("--japanese-langpack", type=Path)
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--show-window", action="store_true")
    run(parser.parse_args())
