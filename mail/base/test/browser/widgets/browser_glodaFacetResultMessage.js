/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const tabmail = document.getElementById("tabmail");
let win, doc;

add_setup(async function () {
  const tab = tabmail.openTab("contentTab", {
    url: "chrome://mochitests/content/browser/comm/mail/base/test/browser/widgets/files/glodaFacetResultMessage.xhtml",
  });

  info("Loading tab...");
  await BrowserTestUtils.browserLoaded(tab.browser);
  tab.browser.focus();

  win = tab.browser.contentWindow;
  doc = win.document;
  await win.customElements.whenDefined("facet-result-message");

  registerCleanupFunction(() => {
    tabmail.closeOtherTabs(tabmail.tabInfo[0]);
  });
});

/**
 * Append a result row in the same document as its custom element definition.
 *
 * @param {object} overrides - Gloda message fields for this case.
 * @returns {HTMLElement} The rendered result.
 */
function renderMessage(overrides) {
  const row = doc.createElement("facet-result-message");
  row.message = {
    subject: "Test subject",
    from: { value: "author@example.com", contact: { name: "Author" } },
    date: new Date(),
    read: true,
    recipients: [],
    ...overrides,
  };
  doc.body.appendChild(row);
  return row;
}

add_task(function testScanMessage() {
  const row = renderMessage({ subject: "Field notes", starred: true });

  const subject = row.querySelector("button.message-subject");
  Assert.equal(
    subject.textContent,
    "Field notes",
    "The subject should name the open action"
  );
  Assert.equal(
    row.querySelector(".message-author").textContent,
    "Author",
    "The sender should be visible"
  );
  Assert.equal(
    row.querySelector("time").dateTime,
    row.message.date.toISOString(),
    "The date should be available in machine-readable form"
  );
  Assert.equal(
    row.querySelector(".message-star").dataset.l10nId,
    "search-message-starred",
    "A star should expose a localized name"
  );
  Assert.ok(
    !row.querySelector("details").open,
    "Sender details should initially be collapsed"
  );
  Assert.ok(
    row
      .querySelector(".message-sender-details")
      .textContent.includes("author@example.com"),
    "The expanded details should contain the full sender address"
  );
  row.remove();
});

add_task(function testDetailsKeepEveryRecipientAndAttachment() {
  const addresses = ["alice", "bob", "carol", "dave", "erin"].map(name => ({
    contact: { name },
    value: name + "@example.com",
  }));
  const attachment = "Receipt for the winter ridge inspection, revision 3.pdf";
  const row = renderMessage({
    recipients: addresses,
    attachmentNames: [attachment],
    tags: [{ tag: "Fieldwork" }],
  });
  const details = row.querySelector("details");
  Assert.ok(!details.open, "Message details should initially be collapsed");
  details.querySelector("summary").click();
  Assert.ok(details.open, "The detail disclosure should expand");
  const recipients = details.querySelector(".message-recipients").textContent;
  for (const { contact, value } of addresses) {
    Assert.ok(
      recipients.includes(contact.name + " <" + value + ">"),
      "Each recipient name and address should be available in details"
    );
  }
  Assert.ok(
    details
      .querySelector(".message-attachments")
      .textContent.includes(attachment),
    "The complete filename should be available"
  );
  Assert.ok(
    details.querySelector(".message-tags").textContent.includes("Fieldwork"),
    "The message tag should be available"
  );
  row.remove();
});

add_task(function testIncompleteRecipientIdentities() {
  const row = renderMessage({
    recipients: [
      { contact: { name: "Chat room" } },
      { value: "unlisted@example.com" },
      { contact: {} },
    ],
  });
  const recipients = row.querySelector(".message-recipients").textContent;
  Assert.ok(
    recipients.includes("Chat room"),
    "A chat recipient can have a name only"
  );
  Assert.ok(
    recipients.includes("unlisted@example.com"),
    "An unknown contact should display its address"
  );
  Assert.ok(
    !recipients.includes("undefined"),
    "Missing identity fields should be omitted"
  );
  row.remove();
});
