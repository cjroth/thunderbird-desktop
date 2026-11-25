/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { buildSemanticCandidateQuery, getSemanticSearchTerms } =
  ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaSemanticCandidates.sys.mjs"
  );
const { glodaTestHelperInitialize, waitForGlodaIndexer } =
  ChromeUtils.importESModule(
    "resource://testing-common/gloda/GlodaTestHelper.sys.mjs"
  );
const { queryExpect, sqlRun } = ChromeUtils.importESModule(
  "resource://testing-common/gloda/GlodaQueryHelper.sys.mjs"
);
const { MessageGenerator, SyntheticMessageSet } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);
const { MessageInjection } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageInjection.sys.mjs"
);

const { GlodaMsgSearcher, isSemanticSearchRequest } =
  ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
  );

let messageInjection;

add_setup(function () {
  messageInjection = new MessageInjection(
    { mode: "local" },
    new MessageGenerator()
  );
  glodaTestHelperInitialize(messageInjection);
});

add_task(function testContentWords() {
  Assert.deepEqual(
    getSemanticSearchTerms(
      'How did JÚNIPER, Ju\u0301niper and "drainage" OR gates change?'
    ),
    ["júniper", "drainage", "gates", "change"]
  );
  Assert.deepEqual(getSemanticSearchTerms("where is it?"), []);
  Assert.deepEqual(getSemanticSearchTerms("東"), ["東"]);
  Assert.equal(
    getSemanticSearchTerms(
      Array.from({ length: 20 }, (_, i) => "word" + i).join(" ")
    ).length,
    16
  );
});

add_task(async function testSemanticSearchRouting() {
  const question = "Who wrote about the library drainage?";
  Assert.ok(isSemanticSearchRequest(question));
  Assert.ok(isSemanticSearchRequest("Find the library drainage email"));
  for (const exact of [
    "AQ-06-42944",
    "library drainage",
    'Find the "library drainage" email',
    "Find library NEAR/4 drainage",
    "Who emailed mara@example.invalid yesterday?",
    "Find subject:drainage from last year",
  ]) {
    Assert.ok(!isSemanticSearchRequest(exact), exact);
  }
  const pref = "mailnews.database.global.search.semantic.enabled";
  const limitPref = "mailnews.database.global.search.msg.limit";
  const listPref = "gloda.show_as_list_by_default";
  Services.prefs.setBoolPref(pref, true);
  Services.prefs.setBoolPref("browser.ml.enable", true);
  Services.prefs.setBoolPref(listPref, false);
  try {
    Assert.ok(!new GlodaMsgSearcher(null, question).isSemantic);
    const search = () =>
      new GlodaMsgSearcher(null, question, true, { allowSemantic: true });
    Assert.ok(search().isSemantic);
    Services.prefs.setIntPref(limitPref, -1);
    Assert.equal(search().buildFulltextQuery()._limit, 40);
    Services.prefs.setIntPref(limitPref, 0);
    await queryExpect(search().buildFulltextQuery(), []);
    Services.prefs.setBoolPref(listPref, true);
    Assert.ok(!search().isSemantic);
    Services.prefs.setBoolPref(listPref, false);
    Services.prefs.setBoolPref("browser.ml.enable", false);
    Assert.ok(!search().isSemantic);
    Services.prefs.setBoolPref("browser.ml.enable", true);
    Services.prefs.setBoolPref(pref, false);
    Assert.ok(!search().isSemantic);
  } finally {
    Services.prefs.clearUserPref(pref);
    Services.prefs.clearUserPref(limitPref);
    Services.prefs.clearUserPref(listPref);
    Services.prefs.clearUserPref("browser.ml.enable");
  }
});

add_task(async function testRankedContentAndOffsets() {
  const [, inSubject, inBody, both] =
    await messageInjection.makeFoldersWithSets(1, [
      { count: 1, subject: "garden" },
      { count: 1, body: { body: "wagtail" } },
      { count: 1, subject: "garden", body: { body: "wagtail" } },
      { count: 1, from: ["Garden Wagtail", "garden.wagtail@example.invalid"] },
    ]);
  await waitForGlodaIndexer();

  const terms = getSemanticSearchTerms("What was the garden wagtail?");
  const collection = await queryExpect(
    buildSemanticCandidateQuery(terms, 1),
    both
  );
  const item = collection.items[0];
  const [offsets, score] = collection.stashedColumns[item.id];
  Assert.greater(score, 0, "expose the lexical score for reranking");
  Assert.ok(
    offsets.startsWith("0 "),
    "expose real body offsets for the facet view"
  );
  Assert.equal(item.indexedBodyText.trim(), "wagtail");
  Assert.equal(item.subject, "garden");

  await queryExpect(buildSemanticCandidateQuery(terms, 10), [
    ...inSubject.synMessages,
    ...inBody.synMessages,
    ...both.synMessages,
  ]);
  await queryExpect(buildSemanticCandidateQuery([], 10), []);
  await queryExpect(buildSemanticCandidateQuery(["zzzxylophonic"], 10), []);
});

add_task(async function testDateBoostKeepsOtherDatesEligible() {
  const [oldMail, recentMail] = [
    "2006-05-01T08:00:00Z",
    "2024-05-01T08:00:00Z",
  ].map(
    timestamp =>
      new SyntheticMessageSet([
        messageInjection.msgGen.makeMessage({
          subject: "wainscoting",
          date: new Date(timestamp),
        }),
      ])
  );
  await messageInjection.addSetsToFolders(
    [await messageInjection.makeEmptyFolder()],
    [oldMail, recentMail]
  );
  await waitForGlodaIndexer();

  for (const [question, expected] of [
    ["Who mentioned wainscoting in 2006?", oldMail],
    ["Who mentioned wainscoting in May 2024?", recentMail],
  ]) {
    const terms = getSemanticSearchTerms(question);
    const collection = await queryExpect(
      buildSemanticCandidateQuery(terms, 4, question),
      [...oldMail.synMessages, ...recentMail.synMessages]
    );
    Assert.equal(
      collection.items[0].headerMessageID,
      expected.synMessages[0].messageId
    );
    Assert.greater(
      collection.stashedColumns[collection.items[0].id][1],
      collection.stashedColumns[collection.items[1].id][1],
      "the matching calendar interval adds to the search score"
    );
  }
});

add_task(async function testValidityBeforeCandidateLimit() {
  const [, stale, live] = await messageInjection.makeFoldersWithSets(1, [
    { count: 3, subject: "cetacean hydrophone" },
    { count: 1, subject: "hydrophone" },
  ]);
  await waitForGlodaIndexer();

  // An interrupted indexing pass can leave full-text postings for tombstones
  // or messages with no usable location. All three would otherwise outrank
  // the live message for this query.
  const before = await queryExpect(
    buildSemanticCandidateQuery(["cetacean"], 3),
    stale
  );
  const [deleted, missingFolder, missingKey] = before.items;
  await sqlRun("UPDATE messages SET deleted = 1 WHERE id = " + deleted.id);
  await sqlRun(
    "UPDATE messages SET folderID = NULL WHERE id = " + missingFolder.id
  );
  await sqlRun(
    "UPDATE messages SET messageKey = NULL WHERE id = " + missingKey.id
  );
  await queryExpect(
    buildSemanticCandidateQuery(["cetacean", "hydrophone"], 1),
    live
  );
});
