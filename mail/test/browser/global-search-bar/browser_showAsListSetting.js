/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The preference that controls whether a global search opens the faceted
 * search view or the thread-list view. Defined here once so that both the
 * UI test and the functional tests always reference the same name.
 */
const PREF_SHOW_AS_LIST = "gloda.show_as_list_by_default";

/**
 * Tests that PREF_SHOW_AS_LIST controls whether a global search opens the
 * faceted search view or a mail3PaneTab list view.
 */

/**
 * Simulates a global search by typing the given term into the search bar.
 *
 * @param {string} term - The search string to enter.
 */
function performGlobalSearch(term) {
  const searchInput = document.querySelector(
    "#unifiedToolbarContent .search-bar global-search-bar"
  );
  searchInput.reset();
  searchInput.focus();
  EventUtils.sendString(term, searchInput.documentGlobal);
  EventUtils.synthesizeKey("KEY_Enter", {}, searchInput.documentGlobal);
}

add_task(async function testShowAsListSettingFalse() {
  await SpecialPowers.pushPrefEnv({
    set: [[PREF_SHOW_AS_LIST, false]],
  });
  const tabmail = document.getElementById("tabmail");
  performGlobalSearch("testfacet");
  await TestUtils.waitForCondition(
    () =>
      tabmail.tabInfo.length === 2 &&
      tabmail.tabInfo[1].mode.name === "glodaFacet",
    "glodaFacet tab should open when " + PREF_SHOW_AS_LIST + " is false"
  );
  tabmail.closeTab(1);
  await SpecialPowers.popPrefEnv();
});

add_task(async function testSemanticSearchFromToolbar() {
  const question = "Which zephyrcairn fjordkite flintwren?";
  const optIn = "mailnews.database.global.search.semantic.enabled";
  const tabmail = document.getElementById("tabmail");
  for (const [input, enabled, mlEnabled, expectedSemantic] of [
    [question, true, true, true],
    [question, false, true, false],
    [question, true, false, false],
    ['Which "zephyrcairn fjordkite" flintwren?', true, true, false],
    ["zephyrcairn fjordkite", true, true, false],
  ]) {
    await SpecialPowers.pushPrefEnv({
      set: [
        [PREF_SHOW_AS_LIST, false],
        [optIn, enabled],
        ["browser.ml.enable", mlEnabled],
      ],
    });
    try {
      performGlobalSearch(input);
      await TestUtils.waitForCondition(
        () => tabmail.currentTabInfo.searcher?.searchString === input,
        "The toolbar should open a faceted search"
      );
      const tab = tabmail.currentTabInfo;
      Assert.equal(tab.mode.name, "glodaFacet");
      Assert.equal(
        tab.searcher.isSemantic,
        expectedSemantic,
        `Toolbar routing for ${input} with semantic=${enabled}, ML=${mlEnabled}`
      );
      await TestUtils.waitForCondition(
        () =>
          tab.browser?.contentDocument?.getElementById("showEmpty")?.style
            .display === "block",
        "The empty result set should render"
      );
      Assert.ok(
        tab.browser.contentDocument.getElementById("semantic-search-status")
          .hidden,
        "An empty result set should skip inference"
      );
      tabmail.closeTab(tab);
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  }
});

add_task(async function testSemanticOrderingAfterChangingSort() {
  const { create_folder } = ChromeUtils.importESModule(
    "resource://testing-common/mail/FolderDisplayHelpers.sys.mjs"
  );
  const { make_message_sets_in_folders } = ChromeUtils.importESModule(
    "resource://testing-common/mail/MessageInjectionHelpers.sys.mjs"
  );
  const { GlodaMsgIndexer } = ChromeUtils.importESModule(
    "resource:///modules/gloda/IndexMsg.sys.mjs"
  );
  const folder = await create_folder("SemanticRanking");
  const tabmail = document.getElementById("tabmail");
  await SpecialPowers.pushPrefEnv({
    set: [
      [PREF_SHOW_AS_LIST, false],
      ["mailnews.database.global.search.semantic.enabled", true],
      ["browser.ml.enable", true],
      ["gloda.facetview.sortby", 1],
    ],
  });
  try {
    await make_message_sets_in_folders(
      [folder],
      ["North", "East", "South"].map(direction => ({
        count: 1,
        subject: `Auburnkeel ${direction}`,
      }))
    );
    const { promise: indexed, resolve: finishIndexing } =
      Promise.withResolvers();
    Assert.ok(
      GlodaMsgIndexer.indexFolder(folder, {
        force: true,
        callback: finishIndexing,
      }),
      "The fixture folder should be eligible for indexing"
    );
    await indexed;
    performGlobalSearch("What was the auburnkeel?");
    await TestUtils.waitForCondition(
      () =>
        tabmail.currentTabInfo.browser?.contentDocument?.querySelectorAll(
          "#results .message"
        ).length === 3,
      "The faceted tab should display the three dated messages"
    );
    const tab = tabmail.currentTabInfo;
    const view = tab.browser.contentWindow;
    const status = view.document.getElementById("semantic-search-status");
    const sort = view.document.getElementById("sortby");
    const sortBy = value => {
      sort.value = value;
      sort.dispatchEvent(new view.Event("change"));
    };
    const subjects = () =>
      Array.from(
        view.document.querySelectorAll("#results .message"),
        card => card.message.subject
      );
    const byDate = subjects();
    Assert.ok(status.hidden, "Date order should skip inference");

    // Intercept the local scorer in this tab so the test controls when an
    // in-flight ranking finishes and never needs model downloads.
    const { promise, resolve } = Promise.withResolvers();
    let passages;
    Object.defineProperty(view, "rerankMessages", {
      configurable: true,
      value: (query, input) => {
        passages = input.map(passage => passage.split("\n")[0]);
        return promise;
      },
    });
    sortBy("-dascore");
    Assert.equal(status.dataset.state, "ranking");
    Assert.equal(passages.length, 3);
    sortBy("-date");
    resolve([0, 1, 1]);
    await TestUtils.waitForCondition(() => status.dataset.state === "ranked");
    Assert.deepEqual(
      subjects(),
      byDate,
      "Keep the date order chosen by the user"
    );

    sortBy("-dascore");
    const expected = [passages[1], passages[2], passages[0]];
    await TestUtils.waitForCondition(() => subjects()[0] === expected[0]);
    Assert.deepEqual(
      subjects(),
      expected,
      "Relevance should apply the scores, preserving the previous order of ties"
    );
    tabmail.closeTab(tab);
  } finally {
    folder.deleteSelf(false);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function testShowAsListSettingTrue() {
  await SpecialPowers.pushPrefEnv({
    set: [[PREF_SHOW_AS_LIST, true]],
  });
  const tabmail = document.getElementById("tabmail");
  performGlobalSearch("testlistview");
  await TestUtils.waitForCondition(
    () =>
      tabmail.tabInfo.length === 2 &&
      tabmail.tabInfo[1].mode.name === "mail3PaneTab",
    "mail3PaneTab should open when " + PREF_SHOW_AS_LIST + " is true"
  );
  await TestUtils.waitForCondition(
    () =>
      tabmail.tabInfo[1]?.chromeBrowser?.contentWindow?.gViewWrapper
        ?.isSynthetic,
    "tab should contain a synthetic Gloda view"
  );
  tabmail.closeTab(1);
  await SpecialPowers.popPrefEnv();
});

/**
 * Tests that the "Show results as list" checkbox in General preferences
 * actually sets PREF_SHOW_AS_LIST.
 */
add_task(async function testShowAsListPrefCheckbox() {
  const tabmail = document.getElementById("tabmail");

  await SpecialPowers.pushPrefEnv({
    set: [[PREF_SHOW_AS_LIST, false]],
  });

  const prefsWindow = await window.openPreferencesTab(
    "paneGeneral",
    "glodaFacetShowAsList"
  );
  const prefsDocument =
    tabmail.tabModes.preferencesTab.tabs[0].browser.contentDocument;
  const checkbox = prefsDocument.getElementById("glodaFacetShowAsList");
  checkbox.scrollIntoView({ block: "end", behavior: "instant" });

  Assert.equal(checkbox.checked, false, "checkbox reflects pref value (false)");

  EventUtils.synthesizeMouseAtCenter(checkbox, {}, prefsWindow);
  Assert.equal(
    Services.prefs.getBoolPref(PREF_SHOW_AS_LIST),
    true,
    `${PREF_SHOW_AS_LIST} set to true after click`
  );

  tabmail.closeTab(tabmail.tabModes.preferencesTab.tabs[0]);
  await SpecialPowers.popPrefEnv();
});

registerCleanupFunction(function () {
  const tabmail = document.getElementById("tabmail");
  while (tabmail.tabInfo.length > 1) {
    tabmail.closeTab(1);
  }
});
