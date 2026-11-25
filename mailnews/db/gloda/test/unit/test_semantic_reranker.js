/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { rerankMessages } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaSemanticReranker.sys.mjs"
);
const { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);
const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);
const { sinon } = ChromeUtils.importESModule(
  "resource://testing-common/Sinon.sys.mjs"
);
const enabledPref = "mailnews.database.global.search.semantic.enabled";
const mlPref = "browser.ml.enable";
const cache = PathUtils.join(PathUtils.localProfileDir, "gloda-semantic");

add_setup(function () {
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(enabledPref);
    Services.prefs.clearUserPref(mlPref);
  });
});

add_task(async function testGuardsBeforeModelAccess() {
  Services.prefs.setBoolPref(mlPref, true);
  Services.prefs.setBoolPref(enabledPref, false);
  await Assert.rejects(rerankMessages("q", ["p"]), /disabled/);
  Services.prefs.setBoolPref(enabledPref, true);
  Services.prefs.setBoolPref(mlPref, false);
  await Assert.rejects(rerankMessages("q", ["p"]), /disabled/);
  Services.prefs.setBoolPref(mlPref, true);
  Assert.deepEqual(await rerankMessages("q", []), []);
  await Assert.rejects(rerankMessages("q", Array(41).fill("p")), /Too many/);
  await Assert.rejects(
    rerankMessages("q", ["p"], { signal: AbortSignal.abort() }),
    /AbortError/
  );
  Assert.ok(
    !(await IOUtils.exists(cache)),
    "No model access for rejected or empty input"
  );
});

add_task(async function testDownloadRedirectAndConcurrentCancellation() {
  const server = new HttpServer();
  const otherOrigin = new HttpServer();
  let redirected = 0;
  otherOrigin.registerPathHandler("/untrusted", () => redirected++);
  otherOrigin.start(-1);
  server.registerPathHandler("/download", (request, response) => {
    response.setStatusLine(request.httpVersion, 302, "Found");
    response.setHeader(
      "Location",
      "http://localhost:" + otherOrigin.identity.primaryPort + "/untrusted"
    );
  });
  server.start(-1);
  const requests = [];
  const open = NetUtil.newChannel.bind(NetUtil);
  const stub = sinon.stub(NetUtil, "newChannel").callsFake(options => {
    const channel = open({
      ...options,
      uri: "http://localhost:" + server.identity.primaryPort + "/download",
    });
    requests.push({ url: options.uri, channel });
    return channel;
  });
  try {
    const cancel = new AbortController();
    const aborted = rerankMessages("private query", ["private message"], {
      signal: cancel.signal,
    });
    const survivor = rerankMessages("other private query", [
      "other private message",
    ]);
    const results = Promise.all([
      Assert.rejects(aborted, /AbortError/),
      Assert.rejects(survivor, /download failed/),
    ]);
    cancel.abort();
    await results;
    Assert.equal(redirected, 0, "The other origin received no requests");
    Assert.equal(
      requests.length,
      3,
      "The concurrent searches shared one download per asset"
    );
    Assert.ok(
      requests.every(
        ({ url, channel }) =>
          url.startsWith("https://") &&
          !url.includes("private") &&
          channel.loadFlags & Ci.nsIRequest.LOAD_ANONYMOUS
      )
    );
    Assert.deepEqual(await IOUtils.getChildren(cache), []);
    await Assert.rejects(rerankMessages("q", ["p"]), /temporarily unavailable/);
    Assert.equal(
      requests.length,
      3,
      "A failed download does not immediately retry"
    );
  } finally {
    stub.restore();
    await Promise.all([server.stop(), otherOrigin.stop()]);
  }
});
