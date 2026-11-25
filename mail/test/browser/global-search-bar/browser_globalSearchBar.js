/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

add_task(async function testRefineSearchFromResults() {
  const field = document.querySelector(
    "#unifiedToolbarContent global-search-bar"
  );
  field.focus();
  EventUtils.sendString("Bugzilla", window);
  EventUtils.synthesizeKey("KEY_Enter", {}, window);

  const tabmail = document.querySelector("tabmail");
  const tab = tabmail.currentTabInfo;
  Assert.equal(tab.mode.name, "glodaFacet", "Search should open a results tab");
  await TestUtils.waitForCondition(
    () => tab.browser?.contentDocument.activeElement.id === "query-explanation",
    "The results heading should receive focus"
  );
  const doc = tab.browser.contentDocument;
  Assert.ok(
    BrowserTestUtils.isHidden(tab.panel.querySelector(".remote-gloda-search")),
    "Only the global toolbar search field should be visible"
  );

  const edit = doc.getElementById("edit-search");
  edit.focus();
  EventUtils.synthesizeKey("KEY_Enter", {}, doc.defaultView);
  Assert.equal(
    document.activeElement,
    field,
    "Edit should focus the search field"
  );
  const input = field.shadowRoot.querySelector("input");
  Assert.equal(
    input.value,
    "Bugzilla",
    "Edit should restore the current query"
  );
  Assert.equal(
    input.selectionStart,
    0,
    "Selection should start at the first character"
  );
  Assert.equal(
    input.selectionEnd,
    input.value.length,
    "The whole query should be selected"
  );

  EventUtils.sendString("calendar", window);
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  Assert.equal(
    tabmail.currentTabInfo.searchString,
    "calendar",
    "Refining should run the edited search"
  );
  Assert.equal(
    tab.searchString,
    "Bugzilla",
    "The original results tab should retain its query"
  );
});

registerCleanupFunction(function tearDown() {
  const tabmail = document.querySelector("tabmail");
  while (tabmail.tabInfo.length > 1) {
    tabmail.closeTab(1);
  }
});
