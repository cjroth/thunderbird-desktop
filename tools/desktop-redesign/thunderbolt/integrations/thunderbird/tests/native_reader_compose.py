"""Exercise the packaged Thunderbird reader composer with local fixture mail."""
import argparse
from email import policy
from email.parser import BytesParser
from pathlib import Path

from native_chat import until
from native_smoke import execute, launch


def run(binary, gecko, *, plain_text=False):
    with launch(binary, gecko) as request:
        fixture = execute(request, Path(__file__).with_name("native-fixture.js").read_text())

        def chrome(script, *args):
            return execute(request, """
                const win = Services.wm.getMostRecentWindow("mail:3pane");
                const pane = win.document.getElementById("tabmail").currentAbout3Pane;
                const card = pane.document.querySelector(".reader-compose:not([inert])");
                const editor = card?.querySelector("browser").contentWindow;
            """ + script, *args)

        chrome("""
            const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
            MailServices.accounts.getIdentity(arguments[0]).composeHtml = !arguments[1];
            pane.displayFolder(arguments[2]);
        """, fixture["identityId"], plain_text, fixture["folderURI"])
        until(lambda: chrome("return pane.gDBView?.rowCount === 1"), "fixture folder")
        chrome("pane.paneLayout.messagePaneVisible = true; pane.threadTree.selectedIndex = 0")
        until(lambda: chrome("return !!pane.messagePane.messageBrowser.contentWindow.gMessage"), "message")
        until(lambda: chrome('return !!pane.document.querySelector(".reader-reply-launch")?.getBoundingClientRect().width'), "reader reply button")
        chrome('pane.document.querySelector(".reader-reply-launch").click()')
        until(lambda: chrome("return editor?.composeEditorReady"), "inline reply")
        assert chrome('return editor.gMsgCompose.compFields.to.includes("fixture@example.invalid")')
        assert chrome('return editor.document.getElementById("msgSubject").value === "Re: Thunderbolt MCP sample"')
        assert chrome('return !Services.wm.getMostRecentWindow("msgcompose")')
        assert chrome("return editor.gMsgCompose.composeHTML") == (not plain_text)
        quote_state = """
            const button = editor.document.getElementById("readerComposeQuote");
            const body = editor.GetCurrentEditor().document.body;
            const quote = body.querySelector('blockquote[type="cite"],span[_moz_quote]');
            return [!button.hidden, button.ariaExpanded, !!quote?.getBoundingClientRect().height];
        """
        assert chrome(quote_state) == [True, "false", False], chrome(quote_state)
        chrome('editor.document.getElementById("readerComposeQuote").click()')
        assert chrome(quote_state) == [True, "true", True]
        chrome('editor.document.getElementById("readerComposeQuote").click()')
        original_height = chrome("return pane.messagePane.messageBrowser.getBoundingClientRect().height")
        editor_height = chrome('return editor.document.getElementById("messageEditor").getBoundingClientRect().height')
        assert original_height > 0 and editor_height > 0
        chrome('card.querySelector(".reader-compose-expand").click()')
        until(lambda: chrome('return editor.document.getElementById("messageEditor").getBoundingClientRect().height > arguments[0]', editor_height), "expanded editor")
        chrome('card.querySelector(".reader-compose-expand").click()')
        until(lambda: chrome('return pane.messagePane.messageBrowser.getBoundingClientRect().height === arguments[0]', original_height), "restored original message")
        chrome('editor.GetCurrentEditor().insertText("Reader draft fixture"); editor.SaveAsDraft()')
        until(lambda: chrome("return !!editor.gMsgCompose.compFields.draftId && !editor.gSaveOperationInProgress"), "saved draft")
        assert chrome('return editor.gMsgCompose.compFields.references.includes("thunderbolt-test@example.invalid")')
        saved_message = chrome("""
            const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
            const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
            const uri = editor.gMsgCompose.compFields.draftId;
            const hdr = MailServices.messageServiceFromURI(uri).messageURIToMsgHdr(uri);
            const input = hdr.folder.getMsgInputStream(hdr);
            let raw = "";
            while (input.available()) {
              raw += NetUtil.readInputStreamToString(input, input.available());
            }
            input.close();
            return raw;
        """)
        saved_mime = BytesParser(policy=policy.default).parsebytes(saved_message.encode("latin-1"))
        body = saved_mime.get_body().get_content()
        assert "Reader draft fixture" in body, repr(saved_message)
        assert "fixture telescope is ready" in body, body
        chrome("pane.threadTree.selectedIndex = -1")
        until(lambda: chrome("return !card"), "hidden reply")
        chrome("pane.threadTree.selectedIndex = 0")
        until(lambda: chrome("return editor?.composeEditorReady"), "restored reply")
        assert chrome('return editor.GetCurrentEditor().document.body.textContent.includes("Reader draft fixture")')
        chrome('card.querySelector(".reader-compose-close").click()')
        until(lambda: chrome("return !card"), "closed reply")
        chrome("win.MsgNewMessage(null)")
        until(lambda: chrome("return editor?.composeEditorReady"), "inline new message")
        assert chrome("return !editor.gMsgCompose.compFields.to")
        chrome('card.querySelector(".reader-compose-close").click(); Services.prefs.setBoolPref("mail.compose.inReader", false)')
        chrome('pane.commandController.doCommand("cmd_reply")')
        until(lambda: chrome('return !!Services.wm.getMostRecentWindow("msgcompose") && !card'), "window preference")
        print("Verified inline reply, threaded draft, navigation, new message, and separate-window preference.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("gecko", type=Path)
    parser.add_argument("--plain-text", action="store_true")
    options = parser.parse_args()
    run(options.binary.resolve(), options.gecko.resolve(), plain_text=options.plain_text)
