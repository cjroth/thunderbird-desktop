# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Check public model attestation in a disposable profile. --inference also tests a real model tool call."""
import argparse
import json
import os
import time
import uuid
from pathlib import Path

from native_smoke import execute, launch
from native_space import open_space, space_content


def until(check, description, seconds=45):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.3)
    raise AssertionError(f"Timed out waiting for {description}")


def run(binary, gecko, xpi, key=None):
    address = f"fixture-{uuid.uuid4().hex[:12]}@example.invalid"
    with launch(binary, gecko) as request:
        execute(request, """
            const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
            const book = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
            const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
            card.displayName = "Coral Fixture";
            card.primaryEmail = arguments[0];
            book.addCard(card);
        """, address)
        request("Addon:Install", {"temporary": True, "path": str(xpi.resolve())})
        open_space(request)

        def inner(script, *args):
            return space_content(request, script, *args)

        setup = "[data-testid=thunderbird-key-setup]"
        settings = "[data-testid=thunderbird-settings]"
        dialog = "[role=dialog]"
        clear = "button[name=operation][value=clear]"

        def has(selector):
            return inner("return document.querySelector(arguments[0]) !== null", selector)

        def click(selector):
            inner("document.querySelector(arguments[0]).click()", selector)

        def save(selector, value):
            inner("""
                const input = document.querySelector(arguments[0]).querySelector('input[name=key]');
                input.value = arguments[1];
                input.form.requestSubmit(input.form.querySelector('button[type=submit]'));
            """, selector, value)

        until(lambda: has(setup), "first-time key setup")
        click(setup)
        until(lambda: has(f"{dialog} input[name=key]"), "provider setup dialog")
        save(dialog, "qa-placeholder-never-used-for-inference")
        until(lambda: not has(dialog), "setup dialog to close after saving")
        until(lambda: not has(setup), "key setup to disappear after saving")
        assert not has("input[name=key]")
        click(settings)
        until(lambda: has(f"{dialog} {clear}"), "settings for a saved credential")
        assert inner("return document.querySelector('[role=dialog] input[name=key]').value === ''")
        save(dialog, "  ")
        until(lambda: has(f"{dialog} [role=alert]"), "blank replacement to be rejected")
        assert has(f"{dialog} {clear}")
        inner("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        until(lambda: not has(dialog), "settings to close")
        assert not has(setup)

        click(settings)
        until(lambda: has(f"{dialog} {clear}"), "settings to reopen")
        save(dialog, key or "qa-replacement-never-used-for-inference")
        until(lambda: not has(dialog), "settings to close after replacing the key")
        assert not has(setup)
        print("Saved a key, hid inline setup, reopened Settings and replaced the masked credential.", flush=True)
        try:
            if key:
                lookup_contact(inner, address)
            verify_connection(inner)
        finally:
            inner("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            until(lambda: not has(dialog), "attestation dialog to close")
            click(settings)
            until(lambda: has(f"{dialog} {clear}"), "saved credential in settings")
            click(f"{dialog} {clear}")
            until(lambda: not has(dialog) and has(setup), "first-time setup to return on clearing")
            assert not has(clear)
            print("Cleared the temporary key in Settings and restored first-time setup.", flush=True)


def lookup_contact(inner, address):
    inner("""
        const area = document.querySelector('textarea');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
        setter.call(area, "Use Thunderbird's search_contacts tool to find Coral Fixture. " +
            "Reply with only their exact email address.");
        area.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    send = "document.querySelector('button[aria-label=\"Send message\"]')"
    until(lambda: inner("return !!" + send + " && !" + send + ".disabled"), "enabled Send button")
    inner(send + ".click()")
    print("Sent synthetic contact lookup", flush=True)

    def replied():
        return inner("""
            const rows = [...document.querySelectorAll('[data-message-id]')];
            const replies = rows.filter(row => [...row.querySelectorAll('.prose')].some(p =>
                p.innerText.trim() === arguments[0]) &&
                row.querySelector('[aria-label="Copy message"]'));
            return replies.length === 1 && !document.querySelector('[aria-label="Stop generating"]');
        """, address)

    until(replied, "assistant reply containing the random fixture address", 120)
    print("Assistant returned the unique fixture address", flush=True)


def verify_connection(inner):
    inner("document.querySelector('[data-testid=model-selector-trigger]').click()")
    verified = "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connection verified')"
    until(lambda: inner("return !!" + verified), "verified connection")
    inner(verified + ".click()")
    proof = until(lambda: inner("""
        const fields = Object.fromEntries([...document.querySelectorAll('[role=dialog] dt')].map(dt =>
            [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()]));
        return fields['Release digest'] ? fields : null;
    """), "attestation details")
    assert proof["Source repository"] == "tinfoilsh/confidential-deepseek-v4-1-flash"
    assert len(proof["Release digest"]) == 64
    print(json.dumps({"result": "Verified model replica", "repository": proof["Source repository"],
                      "releaseDigest": proof["Release digest"], "enclave": proof["Enclave endpoint"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--gecko", required=True, type=Path)
    parser.add_argument("--xpi", required=True, type=Path)
    parser.add_argument("--inference", action="store_true", help="Run a real synthetic model tool call, using TINFOIL_API_KEY.")
    args = parser.parse_args()
    key = os.environ.pop("TINFOIL_API_KEY", None)
    if args.inference and not key:
        parser.error("--inference requires TINFOIL_API_KEY")
    run(args.binary, args.gecko, args.xpi, key if args.inference else None)
