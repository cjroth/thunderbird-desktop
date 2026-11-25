/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { BasePromiseWorker } from "resource://gre/modules/PromiseWorker.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const MODEL_ROOT =
  "https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2/resolve/233902d25c440f23af6f7d6e94d2946bac0bee0a/";

// The WASM attachment accompanies Gecko's ONNX Runtime Web loader (ABI 5).
// The publisher's arm64 ONNX file contains quantized operators executed by WASM.
const ASSETS = [
  {
    url: "https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/ml-onnx-runtime/59f907fd-66c7-4a3e-beaa-3518bd95659b.wasm",
    hash: "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
    size: 21596019,
    extension: "wasm",
  },
  {
    url: MODEL_ROOT + "onnx/model_qint8_arm64.onnx",
    hash: "3573b6b9593cb2f75987a31815d409ca3dd8808629118fd20451bb1a5d90cec7",
    size: 23200716,
    extension: "onnx",
  },
  {
    url: MODEL_ROOT + "tokenizer.json",
    hash: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
    size: 711396,
    extension: "json",
  },
];

const OPT_IN_PREF = "mailnews.database.global.search.semantic.enabled";
const ML_PREF = "browser.ml.enable";
const IDLE_MS = 60_000;
const INFERENCE_MS = 10_000;
const MAX_PASSAGES = 40;
const BATCH_SIZE = 8;
let engine;
let retryAfter = 0;

/** @typedef {{url: string, hash: string, size: number, extension: string}} ModelAsset */

/**
 * Downloads a pinned file. Checks each redirect before sending its request.
 *
 * @param {ModelAsset} asset - The pinned URL and maximum response size.
 * @param {AbortSignal} signal - Cancels the network channel.
 * @returns {Promise<Uint8Array>} The bytes from the publisher.
 */
function downloadAsset(asset, signal) {
  signal.throwIfAborted();
  const channel = NetUtil.newChannel({
    uri: asset.url,
    loadUsingSystemPrincipal: true,
  });
  channel.loadFlags |=
    Ci.nsIRequest.LOAD_ANONYMOUS | Ci.nsIRequest.INHIBIT_CACHING;
  let current = channel;
  channel.notificationCallbacks = {
    QueryInterface: ChromeUtils.generateQI([
      "nsIInterfaceRequestor",
      "nsIChannelEventSink",
    ]),
    getInterface(iid) {
      return this.QueryInterface(iid);
    },
    asyncOnChannelRedirect(oldChannel, newChannel, flags, callback) {
      const origin = newChannel.URI.prePath;
      const allowed =
        origin == channel.URI.prePath ||
        (asset.extension == "onnx" && origin == "https://us.aws.cdn.hf.co");
      if (allowed) {
        current = newChannel;
      }
      callback.onRedirectVerifyCallback(
        allowed ? Cr.NS_OK : Cr.NS_ERROR_DOM_BAD_URI
      );
    },
  };
  const bytes = new Uint8Array(asset.size);
  let offset = 0;
  return new Promise((resolve, reject) => {
    const abort = () => current.cancel(Cr.NS_BINDING_ABORTED);
    signal.addEventListener("abort", abort, { once: true });
    try {
      channel.asyncOpen({
        onStartRequest(request) {
          const http = request.QueryInterface(Ci.nsIHttpChannel);
          if (!http.requestSucceeded || http.contentLength > asset.size) {
            request.cancel(Cr.NS_ERROR_FAILURE);
          }
        },
        onDataAvailable(request, stream, _streamOffset, count) {
          if (offset + count > asset.size) {
            request.cancel(Cr.NS_ERROR_FILE_TOO_BIG);
            return;
          }
          bytes.set(
            new Uint8Array(NetUtil.readInputStream(stream, count)),
            offset
          );
          offset += count;
        },
        onStopRequest(_request, status) {
          signal.removeEventListener("abort", abort);
          if (
            signal.aborted ||
            !Components.isSuccessCode(status) ||
            offset != asset.size
          ) {
            reject(
              signal.reason ??
                new Error("Semantic search asset download failed")
            );
          } else {
            resolve(bytes);
          }
        },
      });
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error);
    }
  });
}

/**
 * Checks the length and SHA-256 digest of cached or downloaded bytes.
 *
 * @param {Uint8Array} bytes - The bytes from the file.
 * @param {ModelAsset} asset - The pinned file metadata.
 * @returns {Promise<boolean>} Whether the bytes match the metadata.
 */
async function matchesAsset(bytes, asset) {
  if (bytes.length != asset.size) {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest).toHex() == asset.hash;
}

/**
 * Loads a verified asset from the profile cache or its publisher.
 *
 * @param {string} directory - The profile cache directory.
 * @param {ModelAsset} asset - The pinned file metadata.
 * @param {AbortSignal} signal - Cancels the download.
 * @returns {Promise<ArrayBuffer>} Verified file contents.
 */
async function loadAsset(directory, asset, signal) {
  const path = PathUtils.join(directory, asset.hash + "." + asset.extension);
  if (await IOUtils.exists(path)) {
    const cached = await IOUtils.read(path, { maxBytes: asset.size + 1 });
    if (await matchesAsset(cached, asset)) {
      return cached.buffer;
    }
  }
  const bytes = await downloadAsset(asset, signal);
  if (!(await matchesAsset(bytes, asset))) {
    throw new Error("Semantic search asset failed integrity verification");
  }
  signal.throwIfAborted();
  await IOUtils.write(path, bytes, {
    tmpPath: path + "." + crypto.randomUUID(),
  });
  return bytes.buffer;
}

/**
 * Loads verified model files into one worker shared by active searches.
 */
class Reranker {
  users = 0;
  idleTimer;
  controller = new AbortController();
  worker = new BasePromiseWorker(
    "resource:///modules/gloda/GlodaSemanticReranker.worker.mjs",
    { type: "module" }
  );
  ready = this.initialize();
  tail = Promise.resolve();

  /**
   * Starts inference after all files pass integrity verification.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    const directory = PathUtils.join(
      PathUtils.localProfileDir,
      "gloda-semantic"
    );
    const signal = this.controller.signal;
    const timer = setTimeout(() => {
      retryAfter = Date.now() + IDLE_MS;
      this.stop(new Error("Semantic search model initialization timed out"));
    }, 120_000);
    try {
      await IOUtils.makeDirectory(directory);
      const files = await Promise.all(
        ASSETS.map(asset => loadAsset(directory, asset, signal))
      );
      signal.throwIfAborted();
      await this.worker.post("initialize", files, undefined, files);
    } catch (error) {
      if (!this.controller.signal.aborted) {
        // Repeated searches while offline should not each start a download.
        retryAfter = Date.now() + IDLE_MS;
        this.stop(error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Runs one batch at a time across searches sharing the ONNX session.
   *
   * @param {string} query - The search terms.
   * @param {string[]} passages - The batch of message excerpts.
   * @param {AbortSignal} signal - Skips the batch if the search has ended.
   * @returns {Promise<number[]>} The logit for each passage in input order.
   */
  score(query, passages, signal) {
    const result = this.tail.then(() => {
      signal.throwIfAborted();
      return this.worker.post("score", [query, passages]);
    });
    this.tail = result.catch(() => {});
    return result;
  }

  stop(reason) {
    clearTimeout(this.idleTimer);
    this.controller.abort(reason);
    this.worker.terminate();
    if (this == engine) {
      engine = null;
    }
  }
}

function enabled() {
  return (
    Services.prefs.getBoolPref(OPT_IN_PREF, false) &&
    Services.prefs.getBoolPref(ML_PREF, false)
  );
}

const prefObserver = () => {
  if (!enabled()) {
    engine?.stop();
  }
};
Services.prefs.addObserver(OPT_IN_PREF, prefObserver);
Services.prefs.addObserver(ML_PREF, prefObserver);
AsyncShutdown.webWorkersShutdown.addBlocker(
  "Stop Gloda semantic search",
  () => {
    Services.prefs.removeObserver(OPT_IN_PREF, prefObserver);
    Services.prefs.removeObserver(ML_PREF, prefObserver);
    engine?.stop();
  }
);

/**
 * Scores up to 40 message excerpts against a query on the device. The first
 * search downloads the pinned model files if the profile has no verified copy.
 * Scoring has a ten-second budget after the model is ready.
 *
 * @param {string} query - The query text.
 * @param {string[]} passages - The message excerpts in candidate order.
 * @param {object} [options] - Options for this search.
 * @param {AbortSignal} [options.signal] - Cancels this search.
 * @returns {Promise<number[]>} One logit per passage in input order. A larger
 *   logit indicates a closer match.
 * @throws {Error} If ML or semantic search is disabled, the input exceeds the
 *   candidate limit, or the model cannot load or run.
 */
export async function rerankMessages(query, passages, { signal } = {}) {
  signal?.throwIfAborted();
  if (!enabled()) {
    throw new Error("Semantic search is disabled");
  }
  if (passages.length > MAX_PASSAGES) {
    throw new RangeError("Too many semantic search passages");
  }
  if (!passages.length) {
    return [];
  }
  if (Date.now() < retryAfter) {
    throw new Error("Semantic search model is temporarily unavailable");
  }
  const active = (engine ??= new Reranker());
  active.users++;
  clearTimeout(active.idleTimer);
  const deadline = new AbortController();
  const signals = [active.controller.signal, deadline.signal];
  if (signal) {
    signals.push(signal);
  }
  const searchSignal = AbortSignal.any(signals);
  const aborted = Promise.withResolvers();
  const onAbort = () => aborted.reject(searchSignal.reason);
  searchSignal.addEventListener("abort", onAbort, { once: true });
  let timer;
  try {
    await Promise.race([active.ready, aborted.promise]);
    timer = setTimeout(() => {
      deadline.abort(new Error("Semantic search inference timed out"));
    }, INFERENCE_MS);
    const scores = [];
    for (let i = 0; i < passages.length; i += BATCH_SIZE) {
      const batch = passages
        .slice(i, i + BATCH_SIZE)
        .map(p => p.slice(0, 8192));
      const result = await Promise.race([
        active.score(query.slice(0, 2048), batch, searchSignal),
        aborted.promise,
      ]);
      scores.push(...result);
    }
    return scores;
  } finally {
    clearTimeout(timer);
    searchSignal.removeEventListener("abort", onAbort);
    if (--active.users == 0 && active == engine) {
      if (searchSignal.aborted) {
        active.stop();
      } else {
        active.idleTimer = setTimeout(() => active.stop(), IDLE_MS);
      }
    }
  }
}
