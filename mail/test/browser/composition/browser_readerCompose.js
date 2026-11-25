/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { be_in_folder, create_folder, get_about_3pane, select_click_row } =
  ChromeUtils.importESModule(
    "resource://testing-common/mail/FolderDisplayHelpers.sys.mjs"
  );
const { add_message_to_folder, create_message } = ChromeUtils.importESModule(
  "resource://testing-common/mail/MessageInjectionHelpers.sys.mjs"
);

add_task(async function testReaderDraftsAcrossReplyModesAndFolders() {
  await SpecialPowers.pushPrefEnv({ set: [["mail.compose.inReader", true]] });
  const folder = create_folder("Reader compose");
  const empty = create_folder("Reader compose empty");
  registerCleanupFunction(() => {
    folder.deleteSelf(false);
    empty.deleteSelf(false);
  });
  await add_message_to_folder(
    [folder],
    create_message({
      from: "Sender <sender@example.invalid>",
      to: "tinderbox@foo.invalid, colleague@example.invalid",
    })
  );
  await be_in_folder(folder);
  await select_click_row(0, AccessibilityUtils);
  const pane = get_about_3pane();
  const visibleEditor = () =>
    pane.document.querySelector(".reader-compose:not([inert]) browser")
      ?.contentWindow;
  registerCleanupFunction(() => {
    for (const frame of pane.document.querySelectorAll(
      ".reader-compose browser"
    )) {
      frame.closest(".reader-compose").remove();
    }
  });
  pane.commandController.doCommand("cmd_reply");
  await TestUtils.waitForCondition(() => visibleEditor()?.composeEditorReady);
  const reply = visibleEditor();
  reply.GetCurrentEditor().insertText("Only for the sender");
  pane.commandController.doCommand("cmd_replyall");
  await TestUtils.waitForCondition(
    () => visibleEditor() !== reply && visibleEditor()?.composeEditorReady
  );
  const replyAll = visibleEditor();
  const { to, cc } = replyAll.gMsgCompose.compFields;
  Assert.ok(
    (to + cc).includes("colleague@example.invalid"),
    "Reply All includes the other addressee"
  );
  Assert.ok(
    !replyAll
      .GetCurrentEditor()
      .document.body.textContent.includes("Only for the sender")
  );
  pane.commandController.doCommand("cmd_reply");
  await TestUtils.waitForCondition(() => visibleEditor() === reply);

  await be_in_folder(empty);
  await TestUtils.waitForCondition(
    () => getComputedStyle(pane.messagePane).visibility === "hidden"
  );
  await be_in_folder(folder);
  await select_click_row(0, AccessibilityUtils);
  await TestUtils.waitForCondition(() => visibleEditor() === reply);
  const editor = reply.GetCurrentEditor();
  Assert.ok(editor, "The editor survives a visit to an empty folder");
  Assert.ok(editor.document.body.textContent.includes("Only for the sender"));
  editor.insertText(" after returning");
  Assert.ok(
    editor.document.body.textContent.includes(
      "Only for the sender after returning"
    )
  );
});
