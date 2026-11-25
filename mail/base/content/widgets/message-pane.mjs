/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// mailCommon.js
/* globals nsMsgViewIndex_None, gDBView: true, gViewWrapper: true */

const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);
const { MailE10SUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailE10SUtils.sys.mjs"
);
const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { ShortcutUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ShortcutUtils.sys.mjs"
);
// eslint-disable-next-line import-x/no-unassigned-import
import "chrome://messenger/content/lazy-findbar.mjs";

/**
 * Message pane.
 * Template ID: #messagePaneTemplate
 */
class MessagePane extends HTMLElement {
  constructor() {
    super();
    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "isConversationView",
      "mail.thread.conversation.enabled",
      false
    );
  }

  /**
   * The xul:browser responsible for rendering web pages.
   *
   * @type {?XULBrowser}
   */
  #webBrowser = null;
  get webBrowser() {
    return this.#webBrowser;
  }
  set webBrowser(val) {
    this.#webBrowser = val;
  }

  /**
   * If the web browser is not null and not hidden.
   *
   * @returns {boolean}
   */
  isWebBrowserVisible() {
    return this.webBrowser && !this.webBrowser.hidden;
  }

  /**
   * The findbar element for the web browser.
   *
   * @type {?MozFindbar}
   */
  get webFindbar() {
    return this.querySelector("#webBrowserFindToolbar");
  }

  /**
   * The xul:browser responsible for rendering single messages. This browser
   * always has about:message loaded.
   *
   * @type {?XULBrowser}
   */
  #messageBrowser = null;
  get messageBrowser() {
    return this.#messageBrowser;
  }
  set messageBrowser(val) {
    this.#messageBrowser = val;
    this.#messageBrowser.docShell.allowDNSPrefetch = false;
  }

  /**
   * If the message browser is not null and not hidden.
   *
   * @returns {boolean}
   */
  isMessageBrowserVisible() {
    return this.messageBrowser && !this.messageBrowser.hidden;
  }

  /**
   * The findbar element for the message browser.
   *
   * @type {?MozFindbar}
   */
  get messageFindbar() {
    return this.messageBrowser?.contentDocument.querySelector("#findToolbar");
  }

  /**
   * The xul:browser responsible for rendering multiple messages.
   *
   * @type {?XULBrowser}
   */
  #multiMessageBrowser = null;
  get multiMessageBrowser() {
    return this.#multiMessageBrowser;
  }
  set multiMessageBrowser(val) {
    this.#multiMessageBrowser = val;
    this.#multiMessageBrowser.docShell.allowDNSPrefetch = false;
  }

  /**
   * If the multimessage browser is not null and not hidden.
   *
   * @returns {boolean}
   */
  isMultiMessageBrowserVisible() {
    return this.multiMessageBrowser && !this.multiMessageBrowser.hidden;
  }

  /**
   * The findbar element for the multi message browser.
   *
   * @type {?MozFindbar}
   */
  get multiMessageFindbar() {
    return this.querySelector("#multiMessageViewFindToolbar");
  }

  /**
   * Simple helper boolean to allow clearing the message pane without hiding the
   * start page if not needed.
   *
   * @type {boolean}
   */
  #keepStartPageOpen = false;

  /** Show the draft selected in the folder, or the last reply opened for this message. */
  #showComposer(uri, target) {
    const cards = this.querySelectorAll(".reader-compose");
    if (target === undefined) {
      target = Array.from(cards).find(
        card =>
          (uri &&
            card.querySelector("browser").contentWindow.gMsgCompose?.compFields
              .draftId === uri) ||
          (card.dataset.uri === uri && card.hasAttribute("data-current"))
      );
    }
    for (const card of cards) {
      card.inert = card !== target;
      if (card === target) {
        card.classList.toggle(
          "compose-solo",
          !card.dataset.uri || card.dataset.uri !== uri
        );
      }
    }
  }

  focusOpenDraft(uri) {
    const card = Array.from(this.querySelectorAll(".reader-compose")).find(
      item =>
        item.querySelector("browser").contentWindow.gMsgCompose?.compFields
          .draftId === uri
    );
    if (!card) {
      return false;
    }
    const hdr = MailServices.messageServiceFromURI(uri).messageURIToMsgHdr(uri);
    window.selectMessage(hdr);
    this.#showComposer(uri, card);
    card.querySelector("browser").focus();
    return true;
  }

  canCloseEditors() {
    return Array.from(this.querySelectorAll(".reader-compose browser")).every(
      frame => frame.contentWindow.ComposeCanClose?.() !== false
    );
  }

  openComposer(params) {
    const uri = params.originalMsgURI || "";
    // A sender-only reply and a reply-all can have very different recipients.
    // Each mode/format keeps its own draft and editing history.
    const mode = `${params.type}/${params.format}`;
    const siblings = Array.from(
      this.querySelectorAll(".reader-compose")
    ).filter(card => card.dataset.uri === uri);
    const existing = siblings.find(card => card.dataset.mode === mode);
    for (const card of siblings) {
      card.toggleAttribute("data-current", card === existing);
    }
    this.#showComposer(uri, existing || null);
    if (existing) {
      existing.querySelector("browser").focus();
      return;
    }

    const card = document.createElement("section");
    card.className = "reader-compose";
    card.dataset.uri = uri;
    card.dataset.mode = mode;
    card.toggleAttribute("data-current", true);
    card.classList.toggle("compose-solo", !uri);
    const header = document.createElement("header");
    const title = document.createElement("strong");
    document.l10n.setAttributes(
      title,
      uri ? "reader-compose-reply" : "reader-compose-new"
    );
    const close = document.createElement("button");
    close.className = "icon-button icon-only reader-compose-close";
    document.l10n.setAttributes(close, "reader-compose-close");
    header.append(title);
    if (uri) {
      const expand = document.createElement("button");
      expand.className = "icon-button icon-only reader-compose-expand";
      document.l10n.setAttributes(expand, "reader-compose-expand");
      expand.addEventListener("click", () => {
        const expanded = card.classList.toggle("compose-expanded");
        document.l10n.setAttributes(
          expand,
          expanded ? "reader-compose-restore" : "reader-compose-expand"
        );
      });
      header.append(expand);
    }
    header.append(close);
    const frame = document.createXULElement("browser");
    frame.setAttribute("type", "content");
    const source =
      "chrome://messenger/content/messengercompose/messengercompose.xhtml";
    const initialize = event => {
      if (
        event.target !== frame.contentDocument ||
        event.target.documentURI !== source
      ) {
        return;
      }
      frame.removeEventListener("DOMDocElementInserted", initialize, true);
      const editor = frame.contentWindow;
      editor.arguments = [params];
      editor.document.documentElement.setAttribute(
        "data-reader-compose",
        uri ? "reply" : "new"
      );
      editor.addEventListener("reader-compose-finished", event => {
        if (event.target === editor) {
          const wasVisible = !card.inert;
          card.remove();
          if (card.hasAttribute("data-current")) {
            const previous = Array.from(
              this.querySelectorAll(".reader-compose")
            ).findLast(item => item.dataset.uri === uri);
            if (previous) {
              previous.toggleAttribute("data-current", true);
              if (wasVisible) {
                this.#showComposer(uri, previous);
                previous.querySelector("browser").focus();
                return;
              }
            }
          }
          if (wasVisible) {
            const entry = this.querySelector(
              ".reader-reply-entry:not([hidden]) button"
            );
            (entry || window.threadTree)?.focus();
          }
        }
      });
    };
    frame.addEventListener("DOMDocElementInserted", initialize, true);
    close.addEventListener("click", () =>
      frame.contentWindow.goDoCommand("cmd_close")
    );
    frame.setAttribute("src", source);
    card.append(header, frame);
    this.append(card);
  }

  connectedCallback() {
    if (this.hasConnected) {
      return;
    }
    this.hasConnected = true;

    const template = document
      .getElementById("messagePaneTemplate")
      .content.cloneNode(true);
    this.append(template);
    this.querySelector(".reader-open-first").addEventListener("click", () =>
      window.threadPane.openFirstMessage()
    );

    this.webBrowser = this.querySelector("#webBrowser");
    this.messageBrowser = this.querySelector("#messageBrowser");
    this.multiMessageBrowser = this.querySelector("#multiMessageBrowser");
    const entry = this.querySelector(".reader-reply-entry");
    const key = window.top.document.getElementById("key_reply");
    if (key) {
      entry.querySelector("kbd").textContent =
        ShortcutUtils.prettifyShortcut(key);
    }
    entry.querySelector("button").addEventListener("click", event => {
      window.commandController.doCommand("cmd_reply", event);
    });
    this.messageBrowser.addEventListener("MsgLoaded", () => {
      const message = this.messageBrowser.contentWindow.gMessage;
      const excluded =
        Ci.nsMsgFolderFlags.Drafts |
        Ci.nsMsgFolderFlags.Templates |
        Ci.nsMsgFolderFlags.Queue;
      entry.hidden =
        !message ||
        message.folder?.isSpecialFolder(excluded, true) ||
        ["rss", "nntp"].includes(message.folder?.server.type) ||
        !window.commandController.isCommandEnabled("cmd_reply");
      if (entry.hidden) {
        return;
      }
      const address = MailServices.headerParser.parseEncodedHeader(
        message.getStringProperty("replyTo") || message.author
      )[0];
      const ownMessage = MailServices.accounts.allIdentities.some(
        identity =>
          identity.email?.toLowerCase() === address?.email?.toLowerCase()
      );
      const label = entry.querySelector(".reader-reply-label");
      if (address?.name && !ownMessage) {
        document.l10n.setAttributes(label, "reader-reply-to-sender", {
          sender: address.name,
        });
      } else {
        document.l10n.setAttributes(label, "reader-write-reply");
      }
    });
  }

  /**
   * Wait for all the child browsers to load and be ready for consumption.
   *
   * @returns {Promise}
   */
  async isReady() {
    if (
      this.messageBrowser.contentDocument.readyState != "complete" ||
      this.messageBrowser.contentWindow.location.href == "about:blank"
    ) {
      await new Promise(resolve => {
        this.messageBrowser.addEventListener("load", resolve, {
          capture: true,
          once: true,
        });
      });
    }

    if (
      this.multiMessageBrowser.contentDocument.readyState != "complete" ||
      this.multiMessageBrowser.contentWindow.location.href == "about:blank"
    ) {
      await new Promise(resolve => {
        this.multiMessageBrowser.addEventListener("load", resolve, {
          capture: true,
          once: true,
        });
      });
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "request-message-clear":
        this.clearAll();
        break;
    }
  }

  /**
   * Dispatch a bubbling "request-messages-selection" event to request message
   * selection.
   * Expand threads as needed and include matching row indices in
   * `detail.indices`.
   * Focus the visible message pane browser after selection.
   *
   * @param {nsIMsgDBHdr[]} messages - The messages represented by the clicked
   *   summary item.
   */
  #requestMessagesSelection(messages) {
    this.dispatchEvent(
      new CustomEvent("request-messages-selection", {
        bubbles: true,
        detail: {
          indices: messages
            .map(m => gDBView.findIndexOfMsgHdr(m, true))
            .filter(i => i != nsMsgViewIndex_None),
        },
      })
    );
    this.visibleMessagePaneBrowser()?.focus();
  }

  /**
   * Simple method to dispatch an event requesting the update of the selection
   * count wherever we display it.
   */
  #requestSelectedCountUpdate() {
    this.dispatchEvent(
      new CustomEvent("request-count-update", {
        bubbles: true,
      })
    );
  }

  /**
   * If the message pane is currently being collapsed by the splitter.
   *
   * @returns {boolean}
   */
  #isCollapsed() {
    return this.classList.contains("collapsed-by-splitter");
  }

  /**
   * Ensure all message pane browsers are blank. Default behavior is to not clear
   * the web browser, if the start page is still being displayed.
   *
   * @param {object} [options]
   * @param {boolean} [options.alwaysClearWebBrowser] - Clear the web browser,
   *    even if it is still displaying the start page.
   */
  clearAll(options) {
    this.#hideCurrentFindBar();
    if (options?.alwaysClearWebBrowser) {
      this.#keepStartPageOpen = false;
    }
    if (!this.#keepStartPageOpen) {
      this.clearWebPage();
    }
    this.#clearMessage();
    this.#clearMessages();
  }

  /**
   * Ensure the web page browser is blank.
   */
  clearWebPage() {
    this.#keepStartPageOpen = false;
    this.webBrowser.hidden = true;
    this.webBrowser.docShellIsActive = false;
    MailE10SUtils.loadAboutBlank(this.webBrowser);
  }

  /**
   * Display a web page in the web page browser. If `url` is not given, or is
   * "about:blank", the web page browser is cleared and hidden.
   *
   * @param {string} url - The URL to load.
   * @param {object} [params] - Any params to pass to MailE10SUtils.loadURI.
   */
  displayWebPage(url, params) {
    if (this.#isCollapsed()) {
      return;
    }

    if (!url || url == "about:blank") {
      this.clearWebPage();
      return;
    }

    this.#clearMessage();
    this.#clearMessages();

    MailE10SUtils.loadURI(this.webBrowser, url, params);
    this.webBrowser.docShellIsActive = window.tabOrWindow.selected;
    this.webBrowser.hidden = false;
  }

  /**
   * Ensure the message browser is not displaying a message.
   */
  #clearMessage() {
    this.querySelector(".reader-reply-entry").hidden = true;
    this.#showComposer(null);
    if (this.conversationView) {
      this.conversationView.hidden = true;
      this.conversationView.clear();
    }

    this.messageBrowser.hidden = true;
    this.messageBrowser.contentWindow.displayMessage?.();
  }

  /**
   * Display a single message in the message browser. If `messageURI` is not
   * given, the message browser is cleared and hidden.
   *
   * @param {?string} messageURI - The URI representing the selected message, or
   *   null if nothing is selected.
   */
  displayMessage(messageURI) {
    this.#requestSelectedCountUpdate();

    // Hide the findbar of webview pane or multimessage pane if opened.
    const switchingMessages = !this.messageBrowser.hidden;
    if (!switchingMessages) {
      this.#hideCurrentFindBar();
    }

    if (this.#isCollapsed()) {
      return;
    }

    if (!messageURI) {
      // Clear both single and multimessage in case we come from either of those
      // states.
      this.#clearMessage();
      this.#clearMessages();
      return;
    }

    this.clearWebPage();
    this.#clearMessages();

    this.querySelector(".reader-reply-entry").hidden = true;
    this.#showComposer(messageURI);
    this.messageBrowser.contentWindow.displayMessage(messageURI, gViewWrapper);
    this.messageBrowser.hidden = false;
  }

  /**
   * Ensure the multi-message browser is not displaying messages.
   */
  #clearMessages() {
    if (this.conversationView) {
      this.conversationView.hidden = true;
      this.conversationView.clear();
    }

    this.multiMessageBrowser.hidden = true;
    this.multiMessageBrowser.contentWindow.gMessageSummary?.clear();
  }

  /**
   * Display messages in the multi-message browser. For a single message, use
   * `displayMessage` instead. If `messages` is not given, or an empty array,
   * the multi-message browser is cleared and hidden.
   *
   * @param {nsIMsgDBHdr[]} messages - The array of selected message headers, if
   *   available.
   */
  displayMessages(messages = []) {
    this.#requestSelectedCountUpdate();

    const viewingMultiMessage = this.isMultiMessageBrowserVisible();
    if (!viewingMultiMessage) {
      // Ensure we hide the findbar if we're not jumping between
      // multi message views.
      this.#hideCurrentFindBar();
    }

    if (this.#isCollapsed()) {
      return;
    }

    if (messages.length == 0) {
      // Clear both single and multimessage in case we come from either of those
      // states.
      this.#clearMessage();
      this.#clearMessages();
      return;
    }

    this.clearWebPage();
    this.#clearMessage();

    // Show the new conversation view UI if the user requests it and if
    // gDBView.selection.count is 1, which means that a thread has been
    // selected and not multiple single messages.
    if (this.isConversationView && gDBView?.selection.count == 1) {
      this.conversationView = document.querySelector("conversation-view");
      // Set up the conversation view element if we don't have one.
      if (!this.conversationView) {
        ChromeUtils.importESModule(
          "chrome://messenger/content/conversation-view.mjs",
          { global: "current" }
        );
        this.conversationView = document.createElement("conversation-view");
        this.append(this.conversationView);
      }
      this.conversationView.show(gDBView.hdrForFirstSelectedMessage);
      // TODO: Trigger findbar search continuation if needed.
      return;
    }

    const getThreadId = message =>
      gDBView.getThreadContainingMsgHdr(message).getRootHdr().messageKey;
    const firstThreadId = getThreadId(messages.at(0));
    const isSingleThread = messages.every(m => getThreadId(m) == firstThreadId);

    this.multiMessageBrowser.contentWindow.gMessageSummary.summarize(
      isSingleThread ? "thread" : "multipleselection",
      messages,
      gDBView,
      msgs => this.#requestMessagesSelection(msgs)
    );

    this.multiMessageBrowser.hidden = false;
    this.dispatchEvent(new CustomEvent("MsgsLoaded", { bubbles: true }));

    if (!viewingMultiMessage) {
      return;
    }

    // Check if we can continue the search.
    if (this.multiMessageFindbar && !this.multiMessageFindbar.hidden) {
      this.multiMessageFindbar.onFindAgainCommand(false);
    }
  }

  /**
   * Hide the findbar, in all of messageBrowser, multimessageBrowser,
   * or webBrowser.
   */
  #hideCurrentFindBar() {
    // Multi message view.
    this.multiMessageFindbar?.clear();
    this.multiMessageFindbar?.close();

    // Single message view.
    this.messageFindbar?.clear();
    this.messageFindbar?.close();

    // Web Browser view.
    this.webFindbar?.clear();
    this.webFindbar?.close();
  }

  /**
   * Show the start page in the web page browser. The start page will remain
   * shown until a message is displayed.
   */
  showStartPage() {
    this.#keepStartPageOpen = true;
    let url = Services.urlFormatter.formatURLPref("mailnews.start_page.url");
    if (/^mailbox:|^imap:|^pop:|^s?news:|^nntp:/i.test(url)) {
      console.warn(`Can't use ${url} as mailnews.start_page.url`);
      Services.prefs.clearUserPref("mailnews.start_page.url");
      url = Services.urlFormatter.formatURLPref("mailnews.start_page.url");
    }
    this.displayWebPage(url);
  }

  /**
   * Helper function for the zoom commands, which returns the browser that is
   * currently visible in the message pane or null if no browser is visible.
   *
   * @returns {?XULElement} - A XUL browser or null.
   */
  visibleMessagePaneBrowser() {
    if (this.isWebBrowserVisible()) {
      return this.webBrowser;
    }

    if (this.isMessageBrowserVisible()) {
      // If the message browser is the one visible, actually return the
      // element showing the message's content, since that's the one zoom
      // commands should apply to.
      return this.messageBrowser.contentWindow.getMessagePaneBrowser();
    }

    if (this.isMultiMessageBrowserVisible()) {
      return this.multiMessageBrowser;
    }

    return null;
  }

  /**
   * Helper function that returns true if one of the three browser panes are
   * visible, and false otherwise.
   *
   * @returns {boolean} - Whether a browser pane is visible or not.
   */
  browserPaneVisible() {
    return (
      this.isWebBrowserVisible() ||
      this.isMessageBrowserVisible() ||
      this.isMultiMessageBrowserVisible()
    );
  }

  /**
   * Helper function to trigger a command from within the message browser
   * command controller.
   *
   * @param {string} command - The XUL command that needs to be triggered.
   */
  doMessageBrowserCommand(command) {
    this.messageBrowser?.contentWindow.commandController.doCommand(command);
  }

  /**
   * Helper function to check if a XUL command is enabled for the message
   * browser command controller.
   *
   * @param {string} command - The XUL command that needs to be checked.
   * @returns {boolean}
   */
  isMessageBrowserCommandEnabled(command) {
    return this.messageBrowser?.contentWindow.commandController.isCommandEnabled(
      command
    );
  }

  /**
   * Helper method to dispatch the cmd_find to the currently visible findbar.
   */
  onFindCommand() {
    // TODO: Handle find command in conversation view.
    if (this.isMessageBrowserVisible()) {
      this.doMessageBrowserCommand("cmd_find");
      return;
    }

    if (this.isMultiMessageBrowserVisible()) {
      this.multiMessageFindbar.onFindCommand();
      return;
    }

    if (this.isWebBrowserVisible()) {
      this.webFindbar.onFindCommand();
    }
  }

  /**
   * Helper method to dispatch the cmd_findAgain to the currently visible
   * findbar.
   */
  onFindAgainCommand() {
    if (this.isMessageBrowserVisible()) {
      this.doMessageBrowserCommand("cmd_findAgain");
      return;
    }

    if (this.isMultiMessageBrowserVisible()) {
      this.multiMessageFindbar.onFindAgainCommand(false);
      return;
    }

    if (this.isWebBrowserVisible()) {
      this.webFindbar.onFindAgainCommand(false);
    }
  }

  /**
   * Helper method to dispatch the cmd_findPrevious to the currently visible
   * findbar.
   */
  onFindPreviousCommand() {
    if (this.isMessageBrowserVisible()) {
      this.doMessageBrowserCommand("cmd_findPrevious");
      return;
    }

    if (this.isMultiMessageBrowserVisible()) {
      this.multiMessageFindbar.onFindAgainCommand(true);
      return;
    }

    if (this.isWebBrowserVisible()) {
      this.webFindbar.onFindAgainCommand(true);
    }
  }
}
customElements.define("message-pane", MessagePane);
