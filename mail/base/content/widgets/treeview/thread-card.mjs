/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

import { TreeViewTableRow } from "chrome://messenger/content/tree-view.mjs";
// eslint-disable-next-line import-x/no-unassigned-import
import "chrome://messenger/content/thread-card-tags.mjs";

/**
 * The tr element row of the TreeView table for the cards view layout.
 * NOTE: The main child is a clone of the `#threadPaneCardTemplate` template.
 *
 * @tagname thread-row
 * @augments {TreeViewTableRow}
 */
class ThreadCard extends TreeViewTableRow {
  static ROW_HEIGHT = 46;

  #previewCallback;
  #lastPreviewHeader;

  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    super.connectedCallback();

    this.setAttribute("draggable", "true");
    this.classList.add("card-layout");

    this.appendChild(
      document.getElementById("threadPaneCardTemplate").content.cloneNode(true)
    );

    this.cardCell = this.querySelector("td");
    this.accountIndicator = this.querySelector(".account-indicator");
    this.senderLine = this.querySelector(".sender");
    this.monogram = this.querySelector(".sender-monogram");
    this.excerpt = this.querySelector(".message-excerpt");
    this.subjectLine = this.querySelector(".subject");
    this.dateLine = this.querySelector(".date");
    this.starButton = this.querySelector(".button-star");
    this.threadCardTags = this.querySelector("thread-card-tags");
    this.replies = this.querySelector(".thread-replies");
    this.twistyButton = this.querySelector("button.twisty");
    this.sortHeaderDetails = this.querySelector(".sort-header-details");
    this.statusIndicator = this.querySelector(".read-status");
  }

  fillRow() {
    super.fillRow();
    cancelIdleCallback(this.#previewCallback);
    this.excerpt.textContent = "";
    this.removeAttribute("aria-describedby");

    if (this.getAttribute("role") == "row") {
      this.cardCell.setAttribute("role", "gridcell");
    }

    // XPCOM calls here must be keep to a minimum. Collect all of the
    // required data in one go.
    const properties = {};
    const threadLevel = {};

    const cellTexts = this.view.cellDataForColumns(
      this._index,
      window.threadPane.cardColumns,
      properties,
      threadLevel
    );

    // Collect the various strings and fluent IDs to build the full string for
    // the message row aria-label.
    const ariaLabelPromises = [];
    // Use static mapping instead of threadPane.cardColumns since the name of
    // the sender column changes. (see getProperSenderForCardsView)
    const KEYS = [
      "subject",
      "sender",
      "date",
      "tagKeys",
      "total",
      "unread",
      "account",
      "serverKey",
    ];
    const data = Object.fromEntries(KEYS.map((key, i) => [key, cellTexts[i]]));

    this.accountIndicator.style.setProperty(
      "--account-color",
      `var(--server-${CSS.escape(data.serverKey)}-color)`
    );
    this.accountIndicator.title = data.account;

    if (threadLevel.value) {
      properties.value += " thread-children";
    }
    const propertiesSet = new Set(properties.value.split(" "));
    this.dataset.properties = properties.value.trim();
    this.#updateTwistyButton();

    this.subjectLine.textContent = data.subject;
    this.subjectLine.title = data.subject;

    // Handle a different style and data if this is a dummy row.
    if (propertiesSet.has("dummy")) {
      const unread = Number(data.unread);
      const total = Number(data.total);

      if (unread) {
        document.l10n.setAttributes(
          this.sortHeaderDetails,
          "threadpane-sort-header-unread-count",
          {
            unread,
            total,
          }
        );
        return;
      }

      document.l10n.setAttributes(
        this.sortHeaderDetails,
        "threadpane-sort-header-count",
        {
          total,
        }
      );
      return;
    }

    this.senderLine.textContent = data.sender;
    this.senderLine.title = data.sender;
    this.#updateMonogram(data.sender);
    if (window.threadPane.rowCount === 3) {
      this.#showPreview(this.view.getMsgHdrAt(this._index));
    }
    this.dateLine.textContent = data.date;
    this.dateLine.title = data.date;

    this.threadCardTags.setAttribute("tags", data.tagKeys);

    // Follow the layout order.
    ariaLabelPromises.push(data.sender);
    ariaLabelPromises.push(data.date);
    ariaLabelPromises.push(data.subject);
    ariaLabelPromises.push(data.tags);

    if (propertiesSet.has("flagged")) {
      document.l10n.setAttributes(
        this.starButton,
        "tree-list-view-row-flagged"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-flagged-cell-label")
      );
    } else {
      document.l10n.setAttributes(this.starButton, "tree-list-view-row-flag");
    }

    if (propertiesSet.has("junk")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-spam-cell-label")
      );
    }

    if (propertiesSet.has("new")) {
      document.l10n.setAttributes(
        this.statusIndicator,
        "tree-list-view-row-new-status"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-new-cell-label")
      );
    } else if (propertiesSet.has("read")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-read-cell-label")
      );
    } else if (propertiesSet.has("unread")) {
      document.l10n.setAttributes(
        this.statusIndicator,
        "tree-list-view-row-not-read-status"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-unread-cell-label")
      );
    }

    if (propertiesSet.has("attach")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-attachments-cell-label")
      );
    }

    // Display number of replies in the twisty button.
    const repliesCount = parseInt(data.total) - 1;
    if (repliesCount > 0) {
      document.l10n.setAttributes(this.replies, "threadpane-replies", {
        count: repliesCount,
      });
    }

    Promise.allSettled(ariaLabelPromises).then(results => {
      this.setAttribute(
        "aria-label",
        results
          .map(settledPromise => settledPromise.value ?? "")
          .filter(value => value.trim() != "")
          .join(", ")
      );
    });
  }

  disconnectedCallback() {
    cancelIdleCallback(this.#previewCallback);
  }

  /**
   * Render a cached excerpt immediately. Extract missing ones from the local
   * message store at idle, one virtualized row per callback.
   *
   * @param {nsIMsgDBHdr} header - The message occupying this row.
   */
  #showPreview(header) {
    this.excerpt.id = `${this.id}-excerpt`;
    this.setAttribute("aria-describedby", this.excerpt.id);
    this.excerpt.textContent = header.getStringProperty("preview");
    if (this.excerpt.textContent || header === this.#lastPreviewHeader) {
      return;
    }

    const index = this.index;
    this.#previewCallback = requestIdleCallback(() => {
      if (!this.isConnected || this.index !== index) {
        return;
      }
      const folder = header.folder;
      const type = folder.server.type;
      // An IMAP header without its Offline flag would issue a network request.
      if (
        !(folder instanceof Ci.nsIMsgLocalMailFolder) &&
        !(
          ["imap", "ews", "graph"].includes(type) &&
          header.flags & Ci.nsMsgMessageFlags.Offline
        )
      ) {
        return;
      }
      this.#lastPreviewHeader = header;
      try {
        folder.fetchMsgPreviewText([header.messageKey], null);
        this.excerpt.textContent = header.getStringProperty("preview");
      } catch (error) {
        // Mail can move or leave the offline store while the row is queued.
        console.debug("Local message excerpt unavailable", error);
      }
    });
  }

  /**
   * Identify a correspondent using their displayed name, including when a
   * Sent folder shows the recipient instead of the author.
   *
   * @param {string} correspondent - The localized correspondent column value.
   */
  #updateMonogram(correspondent) {
    const name = correspondent.split(/[<@,]/u, 1)[0].normalize();
    const words = name.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) || [];
    const first = words[0]?.match(/^.\p{M}*/u)[0] || "";
    const last = words.length > 1 ? words.at(-1).match(/^.\p{M}*/u)[0] : "";
    this.monogram.textContent = (first + last).toLocaleUpperCase();
    const tone = Array.from(name).reduce(
      (hash, char) => (hash * 31 + char.codePointAt(0)) % 6,
      0
    );
    this.monogram.dataset.tone = String(tone);
  }

  #updateTwistyButton() {
    if (!this.classList.contains("children")) {
      this.twistyButton.removeAttribute("data-l10n-id");
      this.twistyButton.removeAttribute("aria-expanded");
      this.twistyButton.removeAttribute("aria-label");
      return;
    }

    const isCollapsed = this.classList.contains("collapsed");
    document.l10n.setAttributes(
      this.twistyButton,
      isCollapsed
        ? "tree-list-view-row-expand-thread-button"
        : "tree-list-view-row-collapse-thread-button"
    );
    this.twistyButton.ariaExpanded = String(!isCollapsed);
  }
}
customElements.define("thread-card", ThreadCard, {
  extends: "tr",
});
