# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Exercise native Thunderbolt space tabs and chat history with real mouse and keyboard input in a disposable Thunderbird profile."""
import argparse
import base64
from pathlib import Path

from native_chat import until
from native_smoke import launch
from native_space import open_space, space_chrome, space_content


def run(binary, gecko, xpi, screenshot=None):
    with launch(binary, gecko) as request:
        def chrome(script, *args):
            return space_chrome(request, script, *args)

        def content(script, *args):
            return space_content(request, script, *args)

        def click(selector, label=None):
            x, y = content("""
                const el = [...document.querySelectorAll(arguments[0])].find(node =>
                    arguments[1] === null || node.textContent.trim() === arguments[1])
                const r = el.getBoundingClientRect()
                return [r.x + r.width / 2, r.y + r.height / 2]
            """, selector, label)
            left, top = chrome("const r = browser.getBoundingClientRect(); return [r.x, r.y]")
            request("WebDriver:PerformActions", {"actions": [{
                "type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"},
                "actions": [
                    {"type": "pointerMove", "duration": 150, "x": round(left + x), "y": round(top + y)},
                    {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0},
                ],
            }]})

        request("Addon:Install", {"path": str(xpi.resolve()), "temporary": True})
        chrome("win.resizeTo(1300, 840)")
        open_space(request)
        until(lambda: content("return !!document.querySelector('textarea')"), "first chat composer")
        history = '[data-testid=thunderbird-history]'
        assert content("return document.querySelector(arguments[0]).localName === 'nav'", history)
        click('[data-thunderbird-prompt=mail]')
        assert content("return !!document.querySelector('textarea').value"), "Starter should fill the composer"

        # Saving the first user message creates a real thread before inference. Stay offline so this
        # navigation regression exercises PowerSync with a dummy key and sends no request to a provider.
        chrome("Services.io.offline = true")
        click('[data-testid=thunderbird-key-setup]')
        until(lambda: content("return !!document.querySelector('[role=dialog] input[name=key]')"), "provider key field")
        content("""
            const input = document.querySelector('input[name=key]')
            input.value = 'local-navigation-fixture'
            input.form.requestSubmit()
        """)
        until(lambda: content("return !document.querySelector('input[name=key]')"), "key setup to finish")
        message = "Thunderbird navigation fixture"
        content("""
            const textarea = document.querySelector('textarea')
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, arguments[0])
            textarea.dispatchEvent(new Event('input', {bubbles: true}))
        """, message)
        send = 'button[aria-label="Send message"]'
        until(lambda: content("return document.querySelector(arguments[0])?.disabled === false", send), "Send")
        click(send)
        route = until(lambda: content("return location.hash.startsWith('#/chats/') && location.hash !== '#/chats/new' && location.hash"),
                      "persisted chat route")
        until(lambda: content("""
            return !document.querySelector('[aria-label="Stop generating"]') &&
                [...document.querySelectorAll('[data-message-id]')].some(e => e.textContent.includes(arguments[0]))
        """, message), "settled offline fixture chat")
        # TanStack pauses query invalidations while the browser reports offline. Restore
        # the normal connected workspace once the fixture turn has finished.
        chrome("Services.io.offline = false")
        print("Offline fixture chat was persisted.", flush=True)
        until(lambda: content("return document.querySelector('[data-slot=chat-list]')?.textContent.includes(arguments[0])", message),
              "persisted conversation in history")
        until(lambda: chrome("return tabmail.currentTabInfo.title.includes(arguments[0])", message), "native saved-chat title")
        original = chrome("return tabmail.currentTabInfo.tabId")
        before = chrome("return tabmail.tabInfo.length")
        click('[data-testid=thunderbird-new-chat]')
        until(lambda: chrome("return tabmail.tabInfo.length === arguments[0] + 1 && !!space.tabInSpace(tabmail.currentTabInfo)", before),
              "new native Thunderbolt tab")
        until(lambda: content("return location.hash === '#/chats/new' && !!document.querySelector('textarea')"),
              "fresh chat composer")
        assert not content("return !!document.querySelector('textarea').value || !!document.querySelector('[data-message-id]')")
        until(lambda: content("return document.querySelector('[data-slot=chat-list]')?.textContent.includes(arguments[0])", message),
              "shared chat history in the second tab")
        second = chrome("return tabmail.currentTabInfo.tabId")
        click('[data-slot=chat-list] button', message)
        until(lambda: content("return location.hash === arguments[0]", route), "opening shared history")
        assert chrome("return tabmail.currentTabInfo.tabId") == second
        chrome("tabmail.switchToTab(0); space.button.click()")
        assert chrome("return tabmail.currentTabInfo.tabId") == original
        until(lambda: content("return location.hash === arguments[0]", route), "first saved chat restored")
        assert content("return [...document.querySelectorAll('[data-message-id]')].some(e => e.textContent.includes(arguments[0]))", message)
        assert chrome("return tabmail.tabInfo.length") == before + 1
        if screenshot:
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            image = request("WebDriver:TakeScreenshot", {"full": False})["value"]
            screenshot.write_bytes(base64.b64decode(image))
        print("PASS: Native New chat opened an independent tab. History, the original conversation, and native tab title were preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    parser.add_argument("--xpi", required=True, type=Path)
    parser.add_argument("--screenshot", type=Path, help="Capture the restored synthetic conversation")
    args = parser.parse_args()
    run(args.binary, args.gecko, args.xpi, args.screenshot)
