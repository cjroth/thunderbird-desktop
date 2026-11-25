/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Gloda } from "resource:///modules/gloda/GlodaPublic.sys.mjs";
import { GlodaConstants } from "resource:///modules/gloda/GlodaConstants.sys.mjs";

// Bound the number of posting lists a single natural-language search can read.
const MAX_TERMS = 16;
const STOP_WORDS = new Set(
  (
    "a an and are as at be been being but by can could did do does doing for from had " +
    "has have he her hers him his how i if in into is it its me might my nor of on or " +
    "our ours she should so some than that the their theirs them then there these " +
    "they this those to was we were what when where which while who whom why will " +
    "with would you your yours"
  ).split(" ")
);

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const DATE_EXPRESSION = new RegExp(
  `\\b(?:(${MONTHS.join("|")})\\s+|(?:in|during)\\s+)((?:19|20)\\d{2})\\b`,
  "gi"
);

/**
 * Get distinct content words for the English semantic reranker. Strip FTS
 * operators and punctuation. mozporter drops ASCII words shorter than three
 * characters; a lone CJK character has the same prefix behavior as Gloda search.
 *
 * @param {string} searchString - User's original question.
 * @returns {string[]} Search terms in input order.
 */
export function getSemanticSearchTerms(searchString) {
  const terms = new Set();
  const words = searchString
    .normalize("NFC")
    .toLowerCase()
    .matchAll(/[\p{L}\p{M}\p{N}]+/gu);
  for (const [word] of words) {
    if (
      !STOP_WORDS.has(word) &&
      (word.length >= 3 || word.charCodeAt(0) >= 0x2000)
    ) {
      terms.add(word);
      if (terms.size == MAX_TERMS) {
        break;
      }
    }
  }
  return Array.from(terms);
}

/**
 * Give mail dated within an explicit month and year (or "in <year>") one
 * extra matching term. Documents outside the interval remain eligible.
 *
 * @param {string} question - User's original question.
 * @returns {number[]|null} Half-open UTC interval in Gloda's microseconds.
 */
function dateInterval(question) {
  const matches = Array.from(question.matchAll(DATE_EXPRESSION));
  if (matches.length != 1) {
    return null;
  }
  const match = matches[0];
  if (
    /\b(?:before|after|until|since|between|through)\s*$/i.test(
      question.slice(0, match.index)
    )
  ) {
    return null;
  }
  const year = Number(match[2]);
  const month = match[1] ? MONTHS.indexOf(match[1].toLowerCase()) : 0;
  return [
    Date.UTC(year, month, 1) * 1000,
    Date.UTC(year, month + (match[1] ? 1 : 12), 1) * 1000,
  ];
}

/**
 * Build the bounded Gloda collection for semantic reranking. FTS3 supplies
 * per-field term hits, but does not store document lengths. Use BM25 with
 * b=0, k1=1.2 and Gloda's existing term-frequency caps. Compute each term's
 * document frequency across subject and body. All posting-list processing
 * stays on the SQLite thread. Only the selected messages need body text and
 * highlight offsets.
 *
 * @param {string[]} terms - Output of getSemanticSearchTerms.
 * @param {number} limit - Maximum candidates to return.
 * @param {string} [question] - Original question for an optional date boost.
 * @returns {object} Gloda message query; stashed columns are offsets and score.
 */
export function buildSemanticCandidateQuery(terms, limit, question = "") {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError(
      "Semantic candidate limit must be a nonnegative integer"
    );
  }
  // All MATCH values are bound arguments. The only generated SQL fragments
  // are parameter numbers and microsecond dates constructed by Date.UTC.
  const options = {
    noMagic: true,
    limitClauseAlreadyIncluded: true,
    stashColumns: [14, 15],
  };
  if (!terms.length || limit == 0) {
    options.explicitSQL = `
      SELECT messages.*, messagesText.*, '', 0
      FROM messagesText JOIN messages ON messages.id = messagesText.docid
      WHERE 0`;
    return Gloda.newQuery(GlodaConstants.NOUN_MESSAGE, options);
  }
  if (
    terms.length > MAX_TERMS ||
    terms.some(term => !/^[\p{L}\p{M}\p{N}]+$/u.test(term))
  ) {
    throw new TypeError("Invalid semantic search terms");
  }
  const interval = dateInterval(question);
  const dateMatch = interval
    ? `date >= ${interval[0]} AND date < ${interval[1]}`
    : "";
  const dateCounts = interval
    ? `,
    dateFrequency(df) AS (SELECT COUNT(*) FROM messages WHERE ${dateMatch}),
    dateWeight(bonus) AS (
      SELECT ln(1.0 + (n - df + 0.5) / (df + 0.5)) FROM corpus, dateFrequency
    )`
    : "";
  const dateBonus = interval
    ? ` + CASE WHEN ${dateMatch} THEN (SELECT bonus FROM dateWeight) ELSE 0 END`
    : "";
  options.explicitSQL = `
    WITH terms(term) AS (VALUES ${terms.map((_, i) => `(?${i + 1})`).join(", ")}),
    corpus(n) AS (SELECT COUNT(*) FROM messages),
    frequencies(term, df) AS MATERIALIZED (
      SELECT term, (SELECT COUNT(*) FROM messagesText WHERE messagesText MATCH terms.term)
      FROM terms
    ),
    weights(term, idf) AS MATERIALIZED (
      SELECT term, ln(1.0 + (n - df + 0.5) / (df + 0.5)) FROM frequencies, corpus
    ),
    postings(docid, tf, idf) AS MATERIALIZED (
      SELECT messagesText.docid, glodaRank(matchinfo(messagesText), 1, 1, 0, 0, 0), idf
      FROM weights CROSS JOIN messagesText WHERE messagesText MATCH weights.term
    )${dateCounts},
    scores(docid, score) AS (
      SELECT docid, SUM(idf * tf * 2.2 / (tf + 1.2)) FROM postings GROUP BY docid
    ),
    candidates(docid, score) AS MATERIALIZED (
      SELECT scores.docid, scores.score${dateBonus} AS score
      FROM scores JOIN messages ON messages.id = scores.docid
      WHERE messages.deleted = 0 AND messages.folderID IS NOT NULL AND messages.messageKey IS NOT NULL
      ORDER BY score DESC, scores.docid LIMIT ?${terms.length + 2}
    )
    SELECT messages.*, messagesText.*, offsets(messagesText), candidates.score
    FROM messagesText CROSS JOIN candidates ON candidates.docid = messagesText.docid
    JOIN messages ON messages.id = messagesText.docid
    WHERE messagesText MATCH ?${terms.length + 1}
      AND messagesText.docid IN (SELECT docid FROM candidates)
    ORDER BY candidates.score DESC, candidates.docid`;

  const query = Gloda.newQuery(GlodaConstants.NOUN_MESSAGE, options);
  const words = terms.map(term =>
    term.length == 1 && term.charCodeAt(0) >= 0x2000 ? term + "*" : term
  );
  for (const word of words) {
    query.fulltextMatches(`body:${word} OR subject:${word}`);
  }
  query.fulltextMatches(words.join(" OR "));
  query.limit(limit);
  return query;
}
