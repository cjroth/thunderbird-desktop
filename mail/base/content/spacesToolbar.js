/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* import-globals-from mailCore.js */
/* import-globals-from utilityOverlay.js */

/**
 * Navigation between the application's spaces.
 */
var gSpacesToolbar = {
  SUPPORTED_BADGE_STYLES: ["--spaces-button-badge-bg-color"],
  SUPPORTED_ICON_STYLES: [
    "--webextension-toolbar-image",
    "--webextension-toolbar-image-dark",
    "--webextension-toolbar-image-light",
  ],
  docURL: "chrome://messenger/content/messenger.xhtml",
  /**
   * The spaces toolbar DOM element.
   *
   * @type {?HTMLElement}
   */
  element: null,
  /**
   * If the spaces toolbar has already been loaded.
   *
   * @type {boolean}
   */
  isLoaded: false,
  /**
   * If the spaces toolbar is hidden or visible.
   *
   * @type {boolean}
   */
  isHidden: false,
  placement: "top",
  lastVisiblePlacement: "top",
  placementPref: "mail.spacesToolbar.placement",
  /**
   * If the spaces toolbar is currently being customized.
   *
   * @type {boolean}
   */
  isCustomizing: false,
  /**
   * The DOM element panel collecting all customization options.
   */
  customizePanel: null,
  /**
   * The object storing all saved customization options:
   * - background: The toolbar background color.
   * - color: The default icon color of the buttons.
   * - accentColor: The background color of an active/current button.
   * - accentBackground: The icon color of an active/current button.
   */
  customizeData: {},

  /**
   * @callback TabInSpace
   * @param {object} tabInfo - The tabInfo object (a member of tabmail.tabInfo)
   *   for the tab.
   * @returns {0|1|2} - The relation between the tab and the space. 0 means it
   *   does not belong to the space. 1 means it is a primary tab of the space.
   *   2 means it is a secondary tab of the space.
   */
  /**
   * @callback OpenSpace
   * @param {"tab"|"window"} where - Where to open the space: in a new tab or in
   *   a new window.
   * @returns {?object | Window} - The tabInfo for the newly opened tab, or the
   *   newly opened messenger window, or null if neither was created.
   */
  /**
   * Data and methods for a space.
   *
   * @typedef {object} SpaceInfo
   * @property {string} name - The name for this space.
   * @property {boolean} allowMultipleTabs - Whether to allow the user to open
   *   multiple tabs in this space.
   * @property {HTMLButtonElement} button - The toolbar button for this space.
   * @property {?XULMenuItem} menuitem - The menuitem for this space, if
   *   available.
   * @property {TabInSpace} tabInSpace - A callback that determines whether an
   *   existing tab is considered outside this space, a primary tab of this
   *   space (a tab that is similar to the tab created by the open method) or
   *   a secondary tab of this space (a related tab that still belongs to this
   *   space).
   * @property {OpenSpace} open - A callback to open this space.
   */
  /**
   * The main spaces in this toolbar. This will be constructed on load.
   *
   * @type {?SpaceInfo[]}
   */
  spaces: null,
  /**
   * The current space the window is in, or undefined if it is not in any of the
   * known spaces.
   *
   * @type {SpaceInfo|undefined}
   */
  currentSpace: undefined,
  /**
   * The number of buttons created by add-ons.
   *
   * @returns {integer}
   */
  get addonButtonCount() {
    return document.querySelectorAll(".spaces-addon-button").length;
  },
  /**
   * The button that can receive focus. Used for managing focus with a roving
   * tabindex.
   *
   * @type {?HTMLElement}
   */
  focusButton: null,

  tabMonitor: {
    monitorName: "spacesToolbarMonitor",

    onTabTitleChanged() {},
    onTabOpened() {},
    onTabPersist() {},
    onTabRestored() {},
    onTabClosing() {},

    onTabSwitched(newTabInfo) {
      // Bail out if for whatever reason something went wrong.
      if (!newTabInfo) {
        console.error(
          "Spaces Toolbar: Missing new tab on monitored tab switching"
        );
        return;
      }

      const tabSpace = gSpacesToolbar.spaces.find(space =>
        space.tabInSpace(newTabInfo)
      );
      if (gSpacesToolbar.currentSpace != tabSpace) {
        gSpacesToolbar.currentSpace?.button.removeAttribute("aria-current");
        gSpacesToolbar.currentSpace?.button.classList.remove("current");
        gSpacesToolbar.currentSpace?.menuitem?.classList.remove("current");
        gSpacesToolbar.currentSpace = tabSpace;
        if (gSpacesToolbar.currentSpace) {
          gSpacesToolbar.currentSpace.button.setAttribute("aria-current", "page");
          gSpacesToolbar.currentSpace.button.classList.add("current");
          gSpacesToolbar.currentSpace.menuitem?.classList.add("current");
          const activeButton = gSpacesToolbar.currentSpace.button;
          gSpacesToolbar.setFocusButton(
            activeButton.hidden
              ? document.getElementById("spacesToolbarAddonsOverflowButton")
              : activeButton
          );
        }

        const spaceChangeEvent = new CustomEvent("spacechange", {
          detail: tabSpace,
        });
        gSpacesToolbar.element.dispatchEvent(spaceChangeEvent);
      }
    },
  },

  /**
   * Convert an rgb() string to an hexadecimal color string.
   *
   * @param {string} color - The RGBA color string that needs conversion.
   * @returns {string} - The converted hexadecimal color.
   */
  _rgbToHex(color) {
    const { r, g, b } = InspectorUtils.colorToRGBA(color);
    const channels = [r, g, b].map(value => value.toString(16).padStart(2, "0"));
    return "#" + channels.join("");
  },

  onLoad() {
    if (this.isLoaded) {
      return;
    }

    this.element = document.getElementById("spacesToolbar");
    this.focusButton = document.getElementById("mailButton");
    const tabmail = document.getElementById("tabmail");

    this.spaces = [
      {
        name: "mail",
        button: document.getElementById("mailButton"),
        menuitem: document.getElementById("spacesPopupButtonMail"),
        tabInSpace(tabInfo) {
          switch (tabInfo.mode.name) {
            case "folder":
            case "mail3PaneTab":
            case "mailMessageTab":
              return 1;
            default:
              return 0;
          }
        },
        open(where) {
          // Prefer the current tab, else the earliest tab.
          const existingTab = [tabmail.currentTabInfo, ...tabmail.tabInfo].find(
            tabInfo => this.tabInSpace(tabInfo) == 1
          );
          let folderURI = null;
          switch (existingTab?.mode.name) {
            case "folder":
              folderURI =
                existingTab.folderDisplay.displayedFolder?.URI || null;
              break;
            case "mail3PaneTab":
              folderURI = existingTab.folder.URI || null;
              break;
          }
          if (where == "window") {
            return window.openDialog(
              "chrome://messenger/content/messenger.xhtml",
              "_blank",
              "chrome,dialog=no,all",
              folderURI,
              -1
            );
          }
          return openTab("mail3PaneTab", { folderURI }, "tab");
        },
        allowMultipleTabs: true,
      },
      {
        name: "addressbook",
        button: document.getElementById("addressBookButton"),
        menuitem: document.getElementById("spacesPopupButtonAddressBook"),
        tabInSpace(tabInfo) {
          if (tabInfo.mode.name == "addressBookTab") {
            return 1;
          }
          return 0;
        },
        open(where) {
          return openTab("addressBookTab", {}, where);
        },
      },
      {
        name: "calendar",
        button: document.getElementById("calendarButton"),
        menuitem: document.getElementById("spacesPopupButtonCalendar"),
        tabInSpace(tabInfo) {
          return tabInfo.mode.name == "calendar" ? 1 : 0;
        },
        open(where) {
          return openTab("calendar", {}, where);
        },
      },
      {
        name: "tasks",
        button: document.getElementById("tasksButton"),
        menuitem: document.getElementById("spacesPopupButtonTasks"),
        tabInSpace(tabInfo) {
          return tabInfo.mode.name == "tasks" ? 1 : 0;
        },
        open(where) {
          return openTab("tasks", {}, where);
        },
      },
      {
        name: "chat",
        button: document.getElementById("chatButton"),
        menuitem: document.getElementById("spacesPopupButtonChat"),
        tabInSpace(tabInfo) {
          return tabInfo.mode.name == "chat" ? 1 : 0;
        },
        open(where) {
          return openTab("chat", {}, where);
        },
      },
      {
        name: "settings",
        button: document.getElementById("settingsButton"),
        menuitem: document.getElementById("spacesPopupButtonSettings"),
        tabInSpace(tabInfo) {
          switch (tabInfo.mode.name) {
            case "preferencesTab":
              // A primary tab that the open method creates.
              return 1;
            case "contentTab": {
              const url = tabInfo.urlbar?.value;
              if (url == "about:accountsettings" || url == "about:addons") {
                // A secondary tab, that is related to this space.
                return 2;
              }
            }
          }
          return 0;
        },
        open(where) {
          return openTab("preferencesTab", {}, where);
        },
      },
    ];

    this.setupEventListeners();
    if (
      !Services.prefs.prefHasUserValue(this.placementPref) &&
      Services.xulStore.getValue(this.docURL, "spacesToolbar", "hidden") == "true"
    ) {
      this.setPlacement("dropdown");
    }
    Services.xulStore.removeValue(this.docURL, "spacesToolbar", "hidden");
    Services.prefs.addObserver(this.placementPref, this._onPlacementChanged);
    this._onPlacementChanged();

    // The tab monitor will inform us when a different tab is selected.
    tabmail.registerTabMonitor(this.tabMonitor);

    this.customizePanel = document.getElementById(
      "spacesToolbarCustomizationPanel"
    );
    this.loadCustomization();

    this.isLoaded = true;
    window.dispatchEvent(new CustomEvent("spaces-toolbar-ready"));
    // Update the window UI after the spaces toolbar has been loaded.
    this.updateUI();
  },

  setupEventListeners() {
    const updateButtonCapacity = () => this.updateAddonButtonsUI();
    window.addEventListener("uidensitychange", updateButtonCapacity);
    window.addEventListener("uifontsizechange", updateButtonCapacity);

    this.element.addEventListener("keydown", event => {
      this._onSpacesToolbarKeyDown(event);
    });

    // Prevent buttons from stealing the focus on click since the focus is
    // handled when a specific tab is opened or switched to.
    for (const button of document.querySelectorAll(".spaces-toolbar-button")) {
      button.onmousedown = event => event.preventDefault();
    }

    const tabmail = document.getElementById("tabmail");
    const contextMenu = document.getElementById("spacesContextMenu");
    const newTabItem = document.getElementById("spacesContextNewTabItem");
    const newWindowItem = document.getElementById("spacesContextNewWindowItem");
    const separator = document.getElementById("spacesContextMenuSeparator");

    // The space that we (last) opened the context menu for, which we share
    // between methods.
    let contextSpace;
    newTabItem.addEventListener("command", () => contextSpace.open("tab"));
    newWindowItem.addEventListener("command", () =>
      contextSpace.open("window")
    );

    const settingsContextMenu = document.getElementById("settingsContextMenu");
    document
      .getElementById("settingsContextOpenSettingsItem")
      .addEventListener("command", () => openTab("preferencesTab", {}));
    document
      .getElementById("settingsContextOpenAccountSettingsItem")
      .addEventListener("command", () =>
        openTab("contentTab", { url: "about:accountsettings" })
      );
    document
      .getElementById("settingsContextOpenAddonsItem")
      .addEventListener("command", () =>
        openTab("contentTab", { url: "about:addons" })
      );
    document
      .getElementById("settingsContextOpenCustomizeItem")
      .addEventListener("command", () => this.showCustomize());

    for (const space of this.spaces) {
      this._addButtonClickListener(space.button, () => {
        this.openSpace(tabmail, space);
      });
      space.menuitem?.addEventListener("command", () => {
        this.openSpace(tabmail, space);
      });
    }

    // Extension buttons can arrive after the window opens.
    this.element.addEventListener("contextmenu", event => {
      const button = event.target.closest(".spaces-toolbar-button");
      const space = this.spaces.find(candidate => candidate.button == button);
      if (!space) {
        this._showContextMenu(event);
        return;
      }

      event.stopPropagation();
      if (space.name == "settings") {
        settingsContextMenu.openPopupAtScreen(
          event.screenX,
          event.screenY,
          true,
          event
        );
        return;
      }

      contextSpace = space;
      for (const menuitem of contextMenu.querySelectorAll(".switch-to-tab")) {
        menuitem.remove();
      }

      const existingTabs = tabmail.tabInfo.filter(tab => space.tabInSpace(tab));
      newTabItem.hidden = !!existingTabs.length && !space.allowMultipleTabs;
      newWindowItem.hidden = !space.allowMultipleTabs || space.isExtensionSpace;
      for (const tab of existingTabs) {
        const menuitem = document.createXULElement("menuitem");
        document.l10n.setAttributes(menuitem, "spaces-context-switch-tab-item", {
          tabName: tab.title,
        });
        menuitem.classList.add("switch-to-tab", "menuitem-iconic");
        menuitem.addEventListener("command", () => tabmail.switchToTab(tab));
        contextMenu.appendChild(menuitem);
      }
      separator.hidden =
        !existingTabs.length || (newTabItem.hidden && newWindowItem.hidden);
      contextMenu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });

    const placementButton = document.getElementById("spacesPlacementButton");
    const placementPopup = document.getElementById("spacesToolbarContextMenu");
    this._addButtonClickListener(placementButton, () => {
      placementPopup.openPopup(placementButton, "after_start");
    });
    placementPopup.addEventListener("popupshown", () => {
      placementButton.setAttribute("aria-expanded", "true");
    });
    placementPopup.addEventListener("popuphidden", () => {
      placementButton.setAttribute("aria-expanded", "false");
    });
    for (const menu of document.querySelectorAll(".spaces-placement-menu")) {
      const items = ["top", "left", "dropdown"].map(placement => {
        const item = document.createXULElement("menuitem");
        item.setAttribute("type", "radio");
        item.setAttribute("name", "spaces-placement");
        item.setAttribute("data-placement", placement);
        document.l10n.setAttributes(item, `spaces-placement-${placement}`);
        item.addEventListener("command", () => this.setPlacement(placement));
        return item;
      });
      menu.prepend(...items);
      menu.addEventListener("popupshowing", () => {
        for (const item of items) {
          if (item.dataset.placement == this.placement) {
            item.setAttribute("checked", "true");
          } else {
            item.removeAttribute("checked");
          }
          item.disabled = Services.prefs.prefIsLocked(this.placementPref);
        }
      });
    }

    document
      .getElementById("spacesPopupButtonReveal")
      .addEventListener("command", () => {
        this.toggleToolbar(false);
      });
    this._addButtonClickListener(
      document.getElementById("spacesToolbarAddonsOverflowButton"),
      event => this.openSpacesToolbarAddonsPopup(event)
    );

    // Allow opening the pinned menu with Space or Enter keypress.
    document
      .getElementById("spacesPinnedButton")
      .addEventListener("keypress", event => {
        // Don't show the panel if the window is in customization mode.
        if (
          document.getElementById("toolbar-menubar").hasAttribute("customizing")
        ) {
          return;
        }

        if (event.key == " " || event.key == "Enter") {
          const panel = document.getElementById("spacesButtonMenuPopup");
          if (panel.state == "open") {
            panel.hidePopup();
          } else if (panel.state == "closed") {
            panel.openPopup(event.target, "after_start");
          }
        }
      });
  },

  /**
   * Handle the keypress event on the spaces toolbar.
   *
   * @param {Event} event - The keypress DOMEvent.
   */
  _onSpacesToolbarKeyDown(event) {
    if (
      ![
        "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
        "Home", "End", " ", "Enter",
      ].includes(event.key)
    ) {
      return;
    }

    // NOTE: Normally a button click handler would cover Enter and Space key
    // events, however we need to prevent the default behavior and explicitly
    // trigger the button click because in some tabs XUL keys or Window event
    // listeners are attached to this keys triggering specific actions.
    // TODO: Remove once we have a properly mapped global shortcut object not
    // relying on XUL keys.
    if (event.key == " " || event.key == "Enter") {
      event.preventDefault();
      event.target.click();
      return;
    }

    // Collect all currently visible buttons of the spaces toolbar.
    const buttons = [
      ...document.querySelectorAll(".spaces-toolbar-button:not([hidden])"),
    ];
    let elementIndex = buttons.indexOf(this.focusButton);

    // Find the adjacent focusable element based on the pressed key.
    event.preventDefault();
    const rtl = this.element.matches(":dir(rtl)");
    switch (event.key) {
      case rtl ? "ArrowRight" : "ArrowLeft":
      case "ArrowUp":
        elementIndex--;
        if (elementIndex == -1) {
          elementIndex = buttons.length - 1;
        }
        break;

      case rtl ? "ArrowLeft" : "ArrowRight":
      case "ArrowDown":
        elementIndex++;
        if (elementIndex > buttons.length - 1) {
          elementIndex = 0;
        }
        break;

      case "Home":
        elementIndex = 0;
        break;

      case "End":
        elementIndex = buttons.length - 1;
        break;
    }

    this.setFocusButton(buttons[elementIndex], true);
  },

  /**
   * Move the focus to a new toolbar button and update the tabindex attribute.
   *
   * @param {HTMLElement} buttonToFocus - The new button to receive focus.
   * @param {boolean} [forceFocus=false] - Whether to force the focus to move
   *   onto the new button, otherwise focus will only move if the previous
   *   focusButton had focus.
   */
  setFocusButton(buttonToFocus, forceFocus = false) {
    let prevHadFocus = false;
    if (buttonToFocus != this.focusButton) {
      prevHadFocus = document.activeElement == this.focusButton;
      this.focusButton.tabIndex = -1;
      this.focusButton = buttonToFocus;
      buttonToFocus.tabIndex = 0;
    }
    // Only move the focus if the currently focused button was the active
    // element.
    if (forceFocus || prevHadFocus) {
      buttonToFocus.focus();
    }
  },

  /**
   * Add a click event listener to a spaces toolbar button.
   *
   * This method will insert focus controls for when the button is clicked.
   *
   * @param {HTMLButtonElement} button - A button that belongs to the spaces
   *   toolbar.
   * @param {Function} listener - An event listener to call when the button's
   *   click event is fired.
   */
  _addButtonClickListener(button, listener) {
    button.addEventListener("click", event => {
      // Since the button may have tabIndex = -1, we must manually move the
      // focus into the button and set it as the focusButton.
      // NOTE: We do *not* force the focus to move onto the button if it is not
      // currently already within the spaces toolbar. This is mainly to avoid
      // changing the document.activeElement before the tab's lastActiveElement
      // is set in tabmail.js.
      // NOTE: We do this before activating the button, which may move the focus
      // elsewhere, such as into a space.
      this.setFocusButton(
        button.hidden && button.classList.contains("spaces-addon-button")
          ? document.getElementById("spacesToolbarAddonsOverflowButton")
          : button
      );
      listener(event);
    });
  },

  /**
   * Open a space by creating a new tab or switching to an existing tab.
   *
   * @param {XULElement} tabmail - The tabmail element.
   * @param {SpaceInfo} space - The space to open.
   */
  openSpace(tabmail, space) {
    // Find the earliest primary tab that belongs to this space.
    const existing = tabmail.tabInfo.find(
      tabInfo => space.tabInSpace(tabInfo) == 1
    );
    if (!existing) {
      return space.open("tab");
    } else if (this.currentSpace != space) {
      // Only switch to the tab if it is in a different space to the
      // current one. In particular, if we are in a later tab we won't
      // switch to the earliest tab.
      tabmail.switchToTab(existing);
      return existing;
    }
    return tabmail.currentTabInfo;
  },

  /**
   * Open a popup context menu at the location of the right on the toolbar.
   *
   * @param {DOMEvent} event - The click event.
   */
  _showContextMenu(event) {
    document
      .getElementById("spacesToolbarContextMenu")
      .openPopupAtScreen(event.screenX, event.screenY, true);
  },

  /**
   * Load the saved customization from the xulStore, if we have any.
   */
  async loadCustomization() {
    const xulStore = Services.xulStore;
    if (xulStore.hasValue(this.docURL, "spacesToolbar", "colors")) {
      this.customizeData = JSON.parse(
        xulStore.getValue(this.docURL, "spacesToolbar", "colors")
      );
      this.updateCustomization();
    }
  },

  /**
   * Reset the colors shown on the button colors to the default state to remove
   * any previously applied custom color.
   */
  _resetColorInputs() {
    // Update colors with the current values. If we don't have any customization
    // data, we fetch the current colors from the DOM elements.
    // IMPORTANT! Always clear the onchange method before setting a new value
    // since this method might be called after the popup is already opened.
    const bgButton = document.getElementById("spacesBackgroundColor");
    bgButton.onchange = null;
    bgButton.value =
      this.customizeData.background ||
      this._rgbToHex(getComputedStyle(this.element).backgroundColor);
    bgButton.onchange = event => {
      this.customizeData.background = event.target.value;
      this.updateCustomization();
    };

    const iconButton = document.getElementById("spacesIconsColor");
    iconButton.onchange = null;
    iconButton.value =
      this.customizeData.color ||
      this._rgbToHex(
        getComputedStyle(
          document.querySelector(".spaces-toolbar-button:not(.current)")
        ).color
      );
    iconButton.onchange = event => {
      this.customizeData.color = event.target.value;
      this.updateCustomization();
    };

    const accentStyle = getComputedStyle(
      document.getElementById("spacesAccentPlaceholder")
    );
    const accentBgButton = document.getElementById("spacesAccentBgColor");
    accentBgButton.onchange = null;
    accentBgButton.value =
      this.customizeData.accentBackground ||
      this._rgbToHex(accentStyle.backgroundColor);
    accentBgButton.onchange = event => {
      this.customizeData.accentBackground = event.target.value;
      this.updateCustomization();
    };

    const accentFgButton = document.getElementById("spacesAccentTextColor");
    accentFgButton.onchange = null;
    accentFgButton.value =
      this.customizeData.accentColor || this._rgbToHex(accentStyle.color);
    accentFgButton.onchange = event => {
      this.customizeData.accentColor = event.target.value;
      this.updateCustomization();
    };
  },

  /**
   * Update the color buttons to reflect the current state of the toolbar UI,
   * then open the customization panel.
   */
  showCustomize() {
    this.isCustomizing = true;
    // Reset the color inputs to be sure we're showing the correct colors.
    this._resetColorInputs();

    // Since we're forcing the panel to stay open with noautohide, we need to
    // listen for the Escape keypress to maintain that usability exit point.
    window.addEventListener("keypress", this.onWindowKeypress);
    this.customizePanel.openPopup(
      document.getElementById("spacesPlacementButton"),
      "after_start",
      0,
      0,
      false
    );
  },

  /**
   * Listen for the keypress event on the window after the customize panel was
   * opened to enable the closing on Escape.
   *
   * @param {Event} event - The DOM Event.
   */
  onWindowKeypress(event) {
    if (event.key == "Escape") {
      gSpacesToolbar.customizePanel.hidePopup();
    }
  },

  /**
   * Close the customization panel.
   */
  closeCustomize() {
    this.customizePanel.hidePopup();
  },

  /**
   * Reset all event listeners and store the custom colors.
   */
  onCustomizePopupHidden() {
    this.isCustomizing = false;
    // Always remove the keypress event listener set on opening.
    window.removeEventListener("keypress", this.onWindowKeypress);

    // Save the custom colors, or delete it if we don't have any.
    if (!Object.keys(this.customizeData).length) {
      Services.xulStore.removeValue(this.docURL, "spacesToolbar", "colors");
      return;
    }

    Services.xulStore.setValue(
      this.docURL,
      "spacesToolbar",
      "colors",
      JSON.stringify(this.customizeData)
    );
  },

  /**
   * Apply the customization to the CSS file.
   */
  updateCustomization() {
    const data = this.customizeData;
    const style = document.documentElement.style;

    // Toolbar background color.
    style.setProperty("--spaces-bg-color", data.background ?? null);
    // Icons color.
    style.setProperty("--spaces-button-text-color", data.color ?? null);
    // Icons color for current/active buttons.
    style.setProperty(
      "--spaces-button-active-text-color",
      data.accentColor ?? null
    );
    // Background color for current/active buttons.
    style.setProperty(
      "--spaces-button-active-bg-color",
      data.accentBackground ?? null
    );
  },

  /**
   * Reset all color customizations to show the user the default UI.
   */
  resetColorCustomization() {
    if (!matchMedia("(prefers-reduced-motion)").matches) {
      // We set an event listener for the transition of any element inside the
      // toolbar so we can reset the color for the buttons only after the
      // toolbar and its elements reverted to their original colors.
      this.element.addEventListener(
        "transitionend",
        () => {
          this._resetColorInputs();
        },
        {
          once: true,
        }
      );
    }

    this.customizeData = {};
    this.updateCustomization();

    // If the user required reduced motion, the transitionend listener will not
    // work.
    if (matchMedia("(prefers-reduced-motion)").matches) {
      this._resetColorInputs();
    }
  },

  /**
   * A space switcher can stand in for a tab strip only if every open tab has
   * its own visible destination. Documents and duplicate workspaces need tabs.
   *
   * @param {TabInfo[]} tabs - The open tabs in this window.
   * @returns {boolean}
   */
  canNavigateAllTabs(tabs) {
    if (this.isHidden || !this.spaces) {
      return false;
    }
    const destinations = new Set();
    for (const tab of tabs) {
      if (tab.mode.name == "contentTab" || tab.mode.name == "mailMessageTab") {
        return false;
      }
      const space = this.spaces.find(item => item.tabInSpace(tab) == 1);
      if (!space || space.button.hidden || destinations.has(space)) {
        return false;
      }
      destinations.add(space);
    }
    return true;
  },

  /**
   * Toggle the spaces toolbar and toolbar buttons visibility.
   *
   * @param {boolean} isHidden - The visibility state to update the elements.
   */
  toggleToolbar(isHidden) {
    this.setPlacement(isHidden ? "dropdown" : this.lastVisiblePlacement);
  },

  /** Switch all mail windows to the selected Spaces presentation. */
  setPlacement(placement) {
    if (!this.isCustomizing && !Services.prefs.prefIsLocked(this.placementPref)) {
      Services.prefs.setStringPref(this.placementPref, placement);
    }
  },

  _onPlacementChanged() {
    gSpacesToolbar._applyPlacement(
      Services.prefs.getStringPref(gSpacesToolbar.placementPref, "top")
    );
  },

  _applyPlacement(value) {
    const placement = ["top", "left", "dropdown"].includes(value) ? value : "top";
    const activeElement = document.activeElement;
    const hadFocus = this.element.contains(activeElement);
    const isHidden = placement == "dropdown";
    this.placement = placement;
    this.isHidden = isHidden;
    if (!isHidden) {
      this.lastVisiblePlacement = placement;
    }
    document.documentElement.setAttribute("spaces-placement", placement);
    this.element.setAttribute(
      "aria-orientation",
      placement == "left" ? "vertical" : "horizontal"
    );
    const anchor = document.getElementById(
      placement == "left" ? "messengerBody" : "unifiedToolbar"
    );
    if (anchor && this.element.nextElementSibling != anchor) {
      anchor.before(this.element);
    }

    const pinnedButton = document.getElementById("spacesPinnedButton");
    pinnedButton.hidden = !isHidden;
    const revealButton = document.getElementById("spacesToolbarReveal");
    revealButton.hidden = !isHidden;
    this.element.hidden = isHidden;
    const tabs = document.getElementById("tabmail-tabs");
    if (tabs.mCollapseToolbar) {
      tabs.updateToolbarVisibility();
    }

    if (isHidden && hadFocus) {
      // If the toolbar is being hidden and one of its child element was
      // focused, move the focus to the pinned button without changing the
      // focusButton attribute of this object.
      pinnedButton.focus();
    } else if (
      !isHidden &&
      (activeElement == pinnedButton || activeElement == revealButton || hadFocus)
    ) {
      // If the the toolbar is being shown and the focus is on the pinned or
      // reveal button, move the focus to the previously focused button.
      this.focusButton?.focus();
    }

    // Update the window UI after the visibility state of the spaces toolbar
    // has changed.
    this.updateUI();
  },

  /**
   * Toggle the spaces toolbar from a menuitem.
   */
  toggleToolbarFromMenu() {
    this.toggleToolbar(!this.isHidden);
  },

  /**
   * Update the addons buttons and propagate toolbar visibility to a global
   * attribute.
   */
  updateUI() {
    // Interrupt if the spaces toolbar isn't loaded yet.
    if (!this.isLoaded) {
      return;
    }

    // Toggle the window attribute for those CSS selectors that need it.
    if (this.isHidden) {
      document.documentElement.removeAttribute("spacestoolbar");
    } else {
      document.documentElement.setAttribute("spacestoolbar", "true");
      this.updateAddonButtonsUI();
    }
  },

  /**
   * Update the UI based on the window sizing.
   */
  onWindowResize() {
    if (!this.isLoaded) {
      return;
    }

    this.updateAddonButtonsUI();
  },

  /**
   * Update the location of buttons added by addons based on the space available
   * in the horizontal header. Additional spaces remain available in the popup.
   */
  updateAddonButtonsUI() {
    if (this.isHidden) {
      return;
    }

    const overflowButton = document.getElementById(
      "spacesToolbarAddonsOverflowButton"
    );
    const separator = document.getElementById("spacesPopupAddonsSeparator");
    const popup = document.getElementById("spacesToolbarAddonsPopup");
    // Bail out if we don't have any add-ons button.
    if (!this.addonButtonCount) {
      if (this.focusButton == overflowButton) {
        this.setFocusButton(
          this.element.querySelector(".spaces-toolbar-button:not([hidden])")
        );
      }
      overflowButton.hidden = true;
      separator.collapsed = true;
      popup.hidePopup();
      return;
    }

    separator.collapsed = false;
    const container = document.getElementById("spacesToolbarAddonsContainer");
    const buttons = [...container.querySelectorAll(".spaces-addon-button")];
    let slots;
    if (this.placement == "left") {
      const styles = getComputedStyle(this.element);
      const top = this.element.querySelector(".spaces-toolbar-top-container");
      const bottom = this.element.querySelector(".spaces-toolbar-bottom-container");
      const height = top.querySelector("button").getBoundingClientRect().height;
      const buttonGap = parseFloat(getComputedStyle(container).rowGap);
      const groupGap = parseFloat(styles.rowGap);
      const available =
        this.element.clientHeight - top.clientHeight - bottom.clientHeight -
        parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom) -
        2 * groupGap;
      const capacity = room => Math.max(0, Math.floor((room + buttonGap) / (height + buttonGap)));
      slots = capacity(available);
      if (buttons.length > slots) {
        // The overflow button is a sibling of the add-on button group.
        slots = capacity(available - height - groupGap);
      }
    } else {
      // A single extension icon takes the same space as an overflow button.
      slots = buttons.length == 1 ? 1 : parseInt(
        getComputedStyle(container).getPropertyValue("--spaces-addon-slots"), 10
      );
    }
    const overflowing = buttons.length > slots;
    overflowButton.hidden = !overflowing;
    if (!overflowing) {
      popup.hidePopup();
    }
    for (const [index, button] of buttons.entries()) {
      button.hidden = index >= slots;
      if (button.hidden && this.focusButton == button) {
        this.setFocusButton(overflowButton);
      }
    }
    if (!overflowing && this.focusButton == overflowButton) {
      this.setFocusButton(buttons[0]);
    }
  },

  /**
   * Properties for a new tab to be passed into TabMail.openTab().
   *
   * @typedef NativeTabProperties
   * @property {string} url
   * @property {?string} initialBrowsingContextGroupId
   * @property {?string} linkHandler
   * @property {?nsIPrincipal} triggeringPrincipal
   * @property {?integer} userContextId
   */

  /**
   * @typedef NativeButtonProperties
   * @property {string} title - The text of the button tooltip and menuitem value.
   * @property {Map} iconStyles - The icon styles Map.
   * @property {?string} badgeText - The optional badge text.
   * @property {?Map} badgeStyles - The optional badge styles Map.
   */

  /**
   * Whether this tab shows a page belonging to the extension that owns its space.
   *
   * @param {object} tab - The content tab.
   * @param {nsIURI} uri - Its current top-level location.
   * @returns {boolean} Whether the space itself provides the page.
   */
  isExtensionSpacePage(tab, uri) {
    if (!uri.schemeIs("moz-extension")) {
      return false;
    }
    const id = this.getSpaceButtonIdForTab(tab);
    const owner = this.spaces?.find(
      space => space.isExtensionSpace && space.name == id
    );
    return owner?.tabProperties.triggeringPrincipal?.originNoSuffix == uri.prePath;
  },

  /**
   * Helper function for extensions in order to add buttons to the spaces
   * toolbar.
   *
   * @param {string} id - The ID of the newly created button.
   * @param {NativeTabProperties} tabProperties - The properties of the default
   *   space tab.
   * @param {NativeButtonProperties} nativeButtonProperties - The properties of
   *   the new button.
   *
   * @returns {Promise} - A Promise that resolves when the button is created.
   */
  async createToolbarButton(
    id,
    tabProperties = {},
    nativeButtonProperties = {}
  ) {
    return new Promise((resolve, reject) => {
      if (!this.isLoaded) {
        return reject("Unable to add spaces toolbar button! Toolbar not ready");
      }
      if (
        !id ||
        !tabProperties.url ||
        !nativeButtonProperties.title ||
        !nativeButtonProperties.iconStyles
      ) {
        return reject(
          "Unable to add spaces toolbar button! Missing ID, Title, IconStyles, or space URL"
        );
      }

      if (document.getElementById(id)) {
        // Button exists already, bail out.
        return resolve();
      }

      // Create the button.
      const button = document.createElement("button");
      button.classList.add("spaces-toolbar-button", "spaces-addon-button");
      button.id = id;
      button.title = nativeButtonProperties.title;
      button.tabIndex = -1;

      const badge = document.createElement("span");
      badge.classList.add("spaces-badge-container");
      button.appendChild(badge);

      const img = document.createElement("img");
      img.setAttribute("alt", "");
      button.appendChild(img);

      const label = document.createElement("span");
      label.classList.add("space-label");
      label.textContent = nativeButtonProperties.title;
      button.appendChild(label);
      document
        .getElementById("spacesToolbarAddonsContainer")
        .appendChild(button);

      // Create the menuitem.
      const menuitem = document.createXULElement("menuitem");
      menuitem.classList.add(
        "spaces-addon-menuitem",
        "menuitem-iconic",
        "spaces-popup-menuitem"
      );
      menuitem.id = `${id}-menuitem`;
      menuitem.label = nativeButtonProperties.title;
      document
        .getElementById("spacesButtonMenuPopup")
        .insertBefore(
          menuitem,
          document.getElementById("spacesPopupRevealSeparator")
        );

      // Set icons. The unified toolbar customization also relies on the CSS
      // variables of the img.
      for (const style of this.SUPPORTED_ICON_STYLES) {
        if (nativeButtonProperties.iconStyles.has(style)) {
          img.style.setProperty(
            style,
            nativeButtonProperties.iconStyles.get(style)
          );
          menuitem.style.setProperty(
            style,
            nativeButtonProperties.iconStyles.get(style)
          );
        }
      }

      // Add space.
      gSpacesToolbar.spaces.push({
        name: id,
        button,
        menuitem,
        tabProperties,
        isExtensionSpace: true,
        allowMultipleTabs: true,
        tabInSpace(tabInfo) {
          return gSpacesToolbar.getSpaceButtonIdForTab(tabInfo) == this.name
            ? 1
            : 0;
        },
        open(where) {
          // The check if we should switch to an existing tab in this space was
          // done in openSpace() and this function here should always open a new
          // tab and not switch to a tab which might have loaded the same url,
          // but belongs to a different space.
          const tab = openTab(
            "contentTab",
            { ...this.tabProperties, duplicate: true },
            where
          );
          gSpacesToolbar.setSpaceButtonIdForTab(tab, this.name);
          // TabSelect fires before the new content tab has its space ID.
          tab.progressListener.updateNavigationToolbar(tab.browser.currentURI);
          gSpacesToolbar.tabMonitor.onTabSwitched(tab);
          return tab;
        },
      });

      // Set click actions.
      const tabmail = document.getElementById("tabmail");
      this._addButtonClickListener(button, () => {
        const space = gSpacesToolbar.spaces.find(s => s.name == id);
        this.openSpace(tabmail, space);
      });
      menuitem.addEventListener("command", () => {
        const space = gSpacesToolbar.spaces.find(s => s.name == id);
        this.openSpace(tabmail, space);
      });

      // Set badge.
      if (nativeButtonProperties.badgeText) {
        button.classList.add("has-badge");
        badge.textContent = nativeButtonProperties.badgeText;
      }

      if (nativeButtonProperties.badgeStyles) {
        for (const style of this.SUPPORTED_BADGE_STYLES) {
          if (nativeButtonProperties.badgeStyles.has(style)) {
            badge.style.setProperty(
              style,
              nativeButtonProperties.badgeStyles.get(style)
            );
          }
        }
      }

      this.updateAddonButtonsUI();
      // Registration can follow session restore, including background tabs.
      for (const tab of tabmail.tabInfo) {
        if (this.getSpaceButtonIdForTab(tab) == id) {
          tab.progressListener.updateNavigationToolbar(tab.browser.currentURI);
        }
      }
      if (
        tabmail.currentTabInfo &&
        this.getSpaceButtonIdForTab(tabmail.currentTabInfo) == id
      ) {
        this.tabMonitor.onTabSwitched(tabmail.currentTabInfo);
      }
      return resolve();
    });
  },

  /**
   * Helper function for extensions in order to update buttons previously added
   * to the spaces toolbar.
   *
   * @param {string} id - The ID of the button that needs to be updated.
   * @param {NativeTabProperties} tabProperties - The new properties of the default
   *   space tab.
   * @param {NativeButtonProperties} nativeButtonProperties - The new properties
   *   of the button. Not specifying the optional badgeText or badgeStyles will
   *   remove them.
   *
   * @returns {Promise} - A promise that resolves when the button is updated.
   */
  async updateToolbarButton(
    id,
    tabProperties = {},
    nativeButtonProperties = {}
  ) {
    return new Promise((resolve, reject) => {
      if (
        !id ||
        !tabProperties.url ||
        !nativeButtonProperties.title ||
        !nativeButtonProperties.iconStyles
      ) {
        return reject(
          "Unable to update spaces toolbar button! Missing ID, Title, IconsStyles, or space URL"
        );
      }

      const button = document.getElementById(`${id}`);
      const menuitem = document.getElementById(`${id}-menuitem`);
      if (!button || !menuitem) {
        return reject(
          "Unable to update spaces toolbar button! Button or menuitem don't exist"
        );
      }

      button.title = nativeButtonProperties.title;
      button.querySelector(".space-label").textContent =
        nativeButtonProperties.title;
      menuitem.label = nativeButtonProperties.title;

      // Update icons.
      const img = button.querySelector("img");
      for (const style of this.SUPPORTED_ICON_STYLES) {
        const value = nativeButtonProperties.iconStyles.get(style);
        img.style.setProperty(style, value ?? null);
        menuitem.style.setProperty(style, value ?? null);
      }

      // Update url.
      const space = gSpacesToolbar.spaces.find(s => s.name == id);
      if (space.tabProperties.url != tabProperties.url) {
        // TODO: Reload the space, when the url is changed (or close and re-open
        // the tab).
        space.tabProperties.url = tabProperties.url;
      }

      // Update badge.
      const badge = button.querySelector(".spaces-badge-container");
      if (nativeButtonProperties.badgeText) {
        button.classList.add("has-badge");
        badge.textContent = nativeButtonProperties.badgeText;
      } else {
        button.classList.remove("has-badge");
        badge.textContent = "";
      }

      for (const style of this.SUPPORTED_BADGE_STYLES) {
        badge.style.setProperty(
          style,
          nativeButtonProperties.badgeStyles?.get(style) ?? null
        );
      }

      return resolve();
    });
  },

  /**
   * Helper function for extensions allowing the removal of previously created
   * buttons.
   *
   * @param {string} id - The ID of the button that needs to be removed.
   * @returns {Promise} - A promise that resolves when the button is removed.
   */
  async removeToolbarButton(id) {
    return new Promise((resolve, reject) => {
      if (!this.isLoaded) {
        return reject(
          "Unable to remove spaces toolbar button! Toolbar not ready"
        );
      }
      if (!id) {
        return reject("Unable to remove spaces toolbar button! Missing ID");
      }

      const button = document.getElementById(`${id}`);
      // If the button being removed is the currently focused one, move the
      // focus on an arbitrary first available spaces button.
      if (this.focusButton == button) {
        this.setFocusButton(
          this.element.querySelector(".spaces-toolbar-button:not([hidden])")
        );
      }

      button?.remove();
      document.getElementById(`${id}-menuitem`)?.remove();

      const space = gSpacesToolbar.spaces.find(s => s.name == id);
      const tabmail = document.getElementById("tabmail");
      for (const tab of tabmail.tabInfo.filter(tabInfo =>
        space.tabInSpace(tabInfo)
      )) {
        tabmail.closeTab(tab);
      }

      gSpacesToolbar.spaces = gSpacesToolbar.spaces.filter(e => e.name != id);
      this.updateAddonButtonsUI();

      return resolve();
    });
  },

  /**
   * Populate the overflow container with a copy of all the currently hidden
   * buttons generated by add-ons.
   *
   * @param {DOMEvent} event - The DOM click event.
   */
  openSpacesToolbarAddonsPopup(event) {
    const popup = document.getElementById("spacesToolbarAddonsPopup");

    for (const button of document.querySelectorAll(
      ".spaces-addon-button[hidden]"
    )) {
      const menuitem = document.createXULElement("menuitem");
      menuitem.classList.add("menuitem-iconic", "spaces-popup-menuitem");
      menuitem.label = button.title;
      menuitem.classList.toggle("current", button.classList.contains("current"));
      menuitem.classList.toggle("has-badge", button.classList.contains("has-badge"));

      const img = button.querySelector("img");
      for (const style of this.SUPPORTED_ICON_STYLES) {
        menuitem.style.setProperty(
          style,
          img.style.getPropertyValue(style) ?? null
        );
      }

      menuitem.addEventListener("command", () => button.click());
      popup.appendChild(menuitem);
    }

    popup.openPopup(event.currentTarget, "after_start", 0, 0);
  },

  /**
   * Empty the overflow container.
   */
  spacesToolbarAddonsPopupClosed() {
    document.getElementById("spacesToolbarAddonsPopup").replaceChildren();
  },

  /**
   * Copy the badges from the contained menu items to the pinned button.
   * Should be called whenever one of the menu item's badge state changes.
   */
  updatePinnedBadgeState() {
    const hasBadge = Boolean(
      document.querySelector("#spacesButtonMenuPopup .has-badge")
    );
    const spacesPinnedButton = document.getElementById("spacesPinnedButton");
    spacesPinnedButton.classList.toggle("has-badge", hasBadge);
  },

  onUnload() {
    if (this.isLoaded) {
      Services.prefs.removeObserver(this.placementPref, this._onPlacementChanged);
    }
  },
};

ChromeUtils.defineESModuleGetters(gSpacesToolbar, {
  getSpaceButtonIdForTab: "resource:///modules/ExtensionSpaces.sys.mjs",
  setSpaceButtonIdForTab: "resource:///modules/ExtensionSpaces.sys.mjs",
});
