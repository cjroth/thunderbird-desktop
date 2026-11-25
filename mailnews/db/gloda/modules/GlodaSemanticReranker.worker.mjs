/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  env,
  InferenceSession,
  Tensor,
} from "chrome://global/content/ml/ort.webgpu.mjs";
import { BertTokenizer } from "chrome://global/content/ml/transformers.js";
import { PromiseWorker } from "resource://gre/modules/workers/PromiseWorker.mjs";

const MAX_TOKENS = 256;
const QUERY_TOKENS = 64;
let tokenizer;
let session;

/**
 * Initializes a single-threaded CPU session with verified model files.
 *
 * @param {ArrayBuffer} runtime - The WASM binary for Gecko's ONNX loader.
 * @param {ArrayBuffer} graph - The quantized BERT sequence classifier.
 * @param {ArrayBuffer} vocabulary - The publisher's WordPiece tokenizer JSON.
 * @returns {Promise<void>}
 */
async function initialize(runtime, graph, vocabulary) {
  env.wasm.numThreads = 1;
  env.wasm.wasmBinary = runtime;
  env.wasm.wasmPaths = {
    mjs: "chrome://global/content/ml/ort-wasm-simd-threaded.jsep.mjs",
  };
  tokenizer = new BertTokenizer(
    JSON.parse(new TextDecoder().decode(vocabulary)),
    {
      pad_token: "[PAD]",
      cls_token: "[CLS]",
      sep_token: "[SEP]",
      unk_token: "[UNK]",
      mask_token: "[MASK]",
      model_max_length: 512,
    }
  );
  session = await InferenceSession.create(new Uint8Array(graph), {
    executionProviders: ["wasm"],
  });
}

/**
 * Builds padded BERT pairs and returns the classifier's single logit per pair.
 *
 * @param {string} query - The search terms.
 * @param {string[]} passages - The message excerpts in candidate order.
 * @returns {Promise<number[]>} The scores in input order.
 */
async function score(query, passages) {
  const withoutSpecials = { add_special_tokens: false };
  const queryIds = tokenizer
    .encode(query, withoutSpecials)
    .slice(0, QUERY_TOKENS);
  // Truncate each segment before adding [CLS] query [SEP] passage [SEP].
  // The trailing separator and a token budget for the passage survive long queries.
  const prefix = [tokenizer.encode("")[0], ...queryIds, tokenizer.sep_token_id];
  const rows = passages.map(passage => {
    const ids = tokenizer.encode(passage, withoutSpecials);
    return [
      ...prefix,
      ...ids.slice(0, MAX_TOKENS - prefix.length - 1),
      tokenizer.sep_token_id,
    ];
  });
  const width = Math.max(...rows.map(row => row.length));
  const shape = [rows.length, width];
  const inputIds = new BigInt64Array(rows.length * width);
  const attentionMask = new BigInt64Array(inputIds.length);
  const tokenTypes = new BigInt64Array(inputIds.length);
  for (const [i, row] of rows.entries()) {
    const start = i * width;
    inputIds.set(BigInt64Array.from(row, BigInt), start);
    attentionMask.fill(1n, start, start + row.length);
    tokenTypes.fill(1n, start + prefix.length, start + row.length);
  }
  const inputs = {
    input_ids: new Tensor("int64", inputIds, shape),
    attention_mask: new Tensor("int64", attentionMask, shape),
    token_type_ids: new Tensor("int64", tokenTypes, shape),
  };
  let output;
  try {
    output = await session.run(inputs);
    const logits = Array.from(output.logits.data);
    if (logits.length != rows.length || !logits.every(Number.isFinite)) {
      throw new RangeError("Semantic search model returned invalid logits");
    }
    return logits;
  } finally {
    for (const tensor of Object.values(inputs)) {
      tensor.dispose();
    }
    if (output) {
      for (const tensor of Object.values(output)) {
        tensor.dispose();
      }
    }
  }
}

const methods = { initialize, score };
const worker = new PromiseWorker.AbstractWorker();
worker.dispatch = (method, args) => methods[method](...args);
worker.postMessage = (...args) => self.postMessage(...args);
worker.close = () => self.close();
self.addEventListener("message", event => worker.handleMessage(event));
self.addEventListener("unhandledrejection", event => {
  throw event.reason;
});
