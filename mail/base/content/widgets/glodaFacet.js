/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global DateFacetVis, FacetContext */

// Wrap in a block to prevent leaking to window scope.
{
  const { FacetUtils } = ChromeUtils.importESModule(
    "resource:///modules/gloda/Facet.sys.mjs"
  );
  const { Gloda } = ChromeUtils.importESModule(
    "resource:///modules/gloda/Gloda.sys.mjs"
  );

  var glodaFacetStrings = Services.strings.createBundle(
    "chrome://messenger/locale/glodaFacetView.properties"
  );

  const lazy = {};
  ChromeUtils.defineESModuleGetters(lazy, {
    makeFriendlyDateAgo: "resource:///modules/TemplateUtils.sys.mjs",
  });
  ChromeUtils.defineLazyGetter(
    lazy,
    "listFormatter",
    () =>
      new Intl.ListFormat(Services.locale.appLocaleAsBCP47, {
        type: "conjunction",
      })
  );

  /**
   * Format the Gloda identity shared by mail and chat search results.
   * Chat identities may supply a display name without an email address.
   *
   * @param {GlodaIdentity} identity
   * @returns {string} Display name and address, or the available field.
   */
  function formatIdentity(identity) {
    const name = identity.contact?.name;
    const address = identity.value;
    return name && address && name != address
      ? `${name} <${address}>`
      : name || address || "";
  }

  class MozFacetDate extends HTMLElement {
    get build() {
      return this.buildFunc;
    }

    get brushItems() {
      return items => this.vis?.hoverItems(items);
    }

    get clearBrushedItems() {
      return () => this.vis?.clearHover();
    }

    connectedCallback() {
      const wrapper = document.createElement("div");
      wrapper.classList.add("facet", "date-wrapper");

      const canvas = document.createElement("div");
      canvas.classList.add("date-vis-frame");
      canvas.setAttribute("role", "img");
      document.l10n.setAttributes(canvas, "search-timeline-graphic");

      const table = document.createElement("table");
      table.classList.add("timeline-counts");
      document.l10n.setAttributes(
        table.createCaption(),
        "search-timeline-counts"
      );
      const header = table.createTHead().insertRow();
      for (const id of ["search-timeline-period", "search-timeline-messages"]) {
        const column = document.createElement("th");
        column.scope = "col";
        document.l10n.setAttributes(column, id);
        header.appendChild(column);
      }
      this.periodRows = table.createTBody();

      this.zoomOut = document.createElement("button");
      this.zoomOut.classList.add(
        "button",
        "icon-button",
        "facet-date-zoom-out"
      );
      document.l10n.setAttributes(this.zoomOut, "search-date-zoom-out");
      this.zoomOut.addEventListener("click", () => FacetContext.zoomOut());
      wrapper.append(canvas, table, this.zoomOut);
      this.appendChild(wrapper);

      this.canUpdate = true;
      this.canvasNode = canvas;
      this.vis = null;
      if ("faceter" in this) {
        this.buildFunc(true);
      }
    }

    buildFunc() {
      const width = this.canvasNode.clientWidth;
      if (!this.faceter?.validItems.length || !width || this.hidden) {
        return;
      }

      this.vis ??= new DateFacetVis(this, this.canvasNode);
      this.canvasNode.replaceChildren();
      this.vis.build();
      this.zoomOut.hidden = !this.faceter.constraint;
    }
    /**
     * Expose the interval represented by each histogram bar and its count.
     *
     * @param {{startDate: Date, endDate: Date, items: GlodaMessage[]}[]} bins
     *   Calendar intervals, each ending at the start of the next interval.
     */
    describeBins(bins) {
      const locale = Services.locale.appLocaleAsBCP47;
      const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
      const numbers = new Intl.NumberFormat(locale);
      const rows = document.createDocumentFragment();
      for (const bin of bins) {
        const row = document.createElement("tr");
        const period = document.createElement("th");
        period.scope = "row";
        const through = new Date(bin.endDate.getTime() - 1);
        period.textContent = dates.formatRange(bin.startDate, through);
        const count = document.createElement("td");
        count.textContent = numbers.format(bin.items.length);
        row.append(period, count);
        rows.appendChild(row);
      }
      this.periodRows.replaceChildren(rows);
    }
  }

  customElements.define("facet-date", MozFacetDate);

  /**
   * MozFacetResultsMessage shows the search results for the string entered in gloda-searchbox.
   *
   * @augments {HTMLElement}
   */
  class MozFacetResultsMessage extends HTMLElement {
    connectedCallback() {
      if (this.messagesNode) {
        return;
      }
      this.messagesNode = document.createElement("div");
      this.messagesNode.classList.add("messages");
      this.messagesNode.setAttribute("role", "list");
      this.appendChild(this.messagesNode);
    }

    setMessages(messages, appendFrom = 0) {
      if (!appendFrom) {
        this.messagesNode.replaceChildren();
      }
      const rows = document.createDocumentFragment();
      for (let index = appendFrom; index < messages.length; index++) {
        const row = document.createElement("facet-result-message");
        row.id = "message-result-" + index;
        row.message = messages[index];
        row.classList.add("message");
        row.setAttribute("role", "listitem");
        rows.appendChild(row);
      }
      this.messagesNode.appendChild(rows);
    }
  }

  customElements.define("facet-results-message", MozFacetResultsMessage);

  class MozFacetBoolean extends HTMLElement {
    constructor() {
      super();

      this.addEventListener("mouseover", () => {
        FacetContext.hoverFacet(
          this.faceter,
          this.faceter.attrDef,
          true,
          this.trueValues
        );
      });

      this.addEventListener("mouseout", () => {
        FacetContext.unhoverFacet(
          this.faceter,
          this.faceter.attrDef,
          true,
          this.trueValues
        );
      });
    }

    connectedCallback() {
      this.addChildren();

      this.canUpdate = true;
      this.checkbox.addEventListener("change", () => {
        this.checked = this.checkbox.checked;
      });

      if ("faceter" in this) {
        this.build(true);
      }
    }

    addChildren() {
      this.bubble = document.createElement("label");
      this.bubble.classList.add("facet-checkbox-bubble");

      this.checkbox = document.createElement("input");
      this.checkbox.setAttribute("type", "checkbox");

      this.labelNode = document.createElement("span");
      this.labelNode.classList.add("facet-checkbox-label");

      this.countNode = document.createElement("span");
      this.countNode.classList.add("facet-checkbox-count");

      this.bubble.appendChild(this.checkbox);
      this.bubble.appendChild(this.labelNode);
      this.bubble.appendChild(this.countNode);

      this.appendChild(this.bubble);
    }

    set disabled(val) {
      this.toggleAttribute("disabled", val);
      this.checkbox.toggleAttribute("disabled", val);
    }

    get disabled() {
      return this.hasAttribute("disabled");
    }

    set checked(val) {
      if (this.checked == val) {
        return;
      }
      this.checkbox.checked = val;
      this.toggleAttribute("checked", val);
      this.checkStateChanged();
      if (val) {
        if (!this.disabled) {
          FacetContext.addFacetConstraint(this.faceter, true, this.trueGroups);
        }
      } else {
        this.checkbox.removeAttribute("checked");
        if (!this.disabled) {
          FacetContext.clearFacet(this.faceter);
        }
      }
    }

    get checked() {
      return this.hasAttribute("checked");
    }

    extraSetup() {}

    checkStateChanged() {}

    brushItems() {}

    clearBrushedItems() {}

    build(firstTime) {
      if (firstTime) {
        this.labelNode.textContent = this.facetDef.strings.facetNameLabel;
        this.checkbox.setAttribute(
          "aria-label",
          this.facetDef.strings.facetNameLabel
        );
        this.trueValues = [];
      }

      // If we do not currently have a constraint applied and there is only
      //  one (or no) group, then: disable us, but reflect the underlying
      //  state of the data (checked or non-checked)
      if (!this.faceter.constraint && this.orderedGroups.length <= 1) {
        this.disabled = true;
        let count = 0;
        if (this.orderedGroups.length) {
          // true case?
          if (this.orderedGroups[0][0]) {
            count = this.orderedGroups[0][1].length;
            this.checked = true;
          } else {
            this.checked = false;
          }
        } else {
          this.checked = false;
        }
        this.countNode.textContent = count.toLocaleString();
        return;
      }
      // if we were disabled checked before, clear ourselves out
      if (this.disabled && this.checked) {
        this.checked = false;
      }
      this.disabled = false;

      // if we are here, we have our 2 groups, find true...
      // (note: it is possible to get jerked around by null values
      //  currently, so leave a reasonable failure case)
      this.trueValues = [];
      this.trueGroups = [true];
      for (const groupPair of this.orderedGroups) {
        if (groupPair[0]) {
          this.trueValues = groupPair[1];
        }
      }

      this.countNode.textContent = this.trueValues.length.toLocaleString();
    }

    reset() {
      this.removeAttribute("checked");
      this.checkbox.checked = false;
      this.checkStateChanged();
    }
  }

  customElements.define("facet-boolean", MozFacetBoolean);

  class MozFacetBooleanFiltered extends MozFacetBoolean {
    static get observedAttributes() {
      return ["checked", "disabled"];
    }

    connectedCallback() {
      super.addChildren();

      this.filterNode = document.createElement("select");
      this.filterNode.classList.add("select", "facet-filter-list");
      document.l10n.setAttributes(this.filterNode, "search-attachment-type");
      this.appendChild(this.filterNode);

      this.canUpdate = true;
      this.checkbox.addEventListener("change", () => {
        this.checked = this.checkbox.checked;
      });

      this.extraSetup();

      if ("faceter" in this) {
        this.build(true);
      }

      this._updateAttributes();
    }

    attributeChangedCallback() {
      this._updateAttributes();
    }

    _updateAttributes() {
      if (!this.checkbox) {
        return;
      }

      this.checkbox.toggleAttribute("checked", this.hasAttribute("checked"));
      this.checkbox.toggleAttribute("disabled", this.hasAttribute("disabled"));
    }

    extraSetup() {
      this.groupDisplayProperty = this.getAttribute("groupDisplayProperty");

      this.filterNode.addEventListener("change", event =>
        this.filterChanged(event)
      );

      this.selectedValue = "all";
    }

    build(firstTime) {
      if (firstTime) {
        this.labelNode.textContent = this.facetDef.strings.facetNameLabel;
        this.checkbox.setAttribute(
          "aria-label",
          this.facetDef.strings.facetNameLabel
        );
        this.trueValues = [];
      }

      // Only update count if anything other than "all" is selected.
      // Otherwise we lose the set of attachment types in our select box,
      // and that makes us sad.  We do want to update on "all" though
      // because other facets may further reduce the number of attachments
      // we see.  (Or if this is not just being used for attachments, it
      // still holds.)
      if (this.selectedValue != "all") {
        let count = 0;
        for (const groupPair of this.orderedGroups) {
          if (groupPair[0] != null) {
            count += groupPair[1].length;
          }
        }
        this.countNode.textContent = count.toLocaleString();
        return;
      }

      this.filterNode.replaceChildren();

      const allNode = document.createElement("option");
      allNode.textContent = glodaFacetStrings.GetStringFromName(
        "glodaFacetView.facets.filter." +
          this.attrDef.attributeName +
          ".allLabel"
      );
      allNode.setAttribute("value", "all");
      if (this.selectedValue == "all") {
        allNode.setAttribute("selected", "selected");
      }
      this.filterNode.appendChild(allNode);

      // if we are here, we have our 2 groups, find true...
      // (note: it is possible to get jerked around by null values
      // currently, so leave a reasonable failure case)
      // empty true groups is for the checkbox
      this.trueGroups = [];
      // the real true groups is the actual true values for our explicit
      // filtering
      this.realTrueGroups = [];
      this.trueValues = [];
      this.falseValues = [];
      const selectNodes = [];
      for (const groupPair of this.orderedGroups) {
        if (groupPair[0] === null) {
          this.falseValues.push.apply(this.falseValues, groupPair[1]);
        } else {
          this.trueValues.push.apply(this.trueValues, groupPair[1]);

          const groupValue = groupPair[0];
          const selNode = document.createElement("option");
          selNode.textContent = groupValue[this.groupDisplayProperty];
          selNode.setAttribute("value", this.realTrueGroups.length);
          if (this.selectedValue == groupValue.category) {
            selNode.setAttribute("selected", "selected");
          }
          selectNodes.push(selNode);

          this.realTrueGroups.push(groupValue);
        }
      }
      selectNodes.sort((a, b) => {
        return a.textContent.localeCompare(b.textContent);
      });
      selectNodes.forEach(selNode => {
        this.filterNode.appendChild(selNode);
      });

      this.disabled = !this.trueValues.length;

      this.countNode.textContent = this.trueValues.length.toLocaleString();
    }

    checkStateChanged() {
      // if they un-check us, revert our value to all.
      if (!this.checked) {
        this.filterNode.selectedIndex = 0;
        this.filterNode.value = "all";
        this.selectedValue = "all";
      }
    }

    filterChanged() {
      if (!this.checked) {
        return;
      }
      if (this.filterNode.value == "all") {
        this.selectedValue = "all";
        this.#triggerFacet(this.trueGroups);
        return;
      }

      const groupValue = this.realTrueGroups[parseInt(this.filterNode.value)];
      this.selectedValue = groupValue.category;
      this.#triggerFacet([groupValue]);
    }

    /**
     * Trigger the refresh of the Gloda facet view with updated filters.
     *
     * @param {Array} groupValue - Array of boolean explicit filtering.
     */
    #triggerFacet(groupValue) {
      FacetContext.addFacetConstraint(
        this.faceter,
        true,
        groupValue,
        false,
        true
      );
    }
  }

  customElements.define("facet-boolean-filtered", MozFacetBooleanFiltered);

  class MozFacetDiscrete extends HTMLElement {
    constructor() {
      super();

      this.addEventListener("click", event => {
        this.showPopup(event);
      });

      this.addEventListener("mouseover", event => {
        // we dispatch based on the class of the thing we clicked on.
        // there are other ways we could accomplish this, but they all sorta suck.
        if (
          event.target.hasAttribute("class") &&
          event.target.classList.contains("bar-link")
        ) {
          this.barHovered(event.target.closest(".bar"));
        }
      });

      this.addEventListener("mouseout", event => {
        // we dispatch based on the class of the thing we clicked on.
        // there are other ways we could accomplish this, but they all sorta suck.
        if (
          event.target.hasAttribute("class") &&
          event.target.classList.contains("bar-link")
        ) {
          this.barHoverGone(event.target.closest(".bar"));
        }
      });
    }

    connectedCallback() {
      const facet = document.createElement("details");
      facet.classList.add("facet");

      this.nameNode = document.createElement("summary");
      this.nameNode.classList.add("facet-name");

      this.contentBox = document.createElement("div");
      this.contentBox.classList.add("facet-content");

      this.includeLabel = document.createElement("h3");
      this.includeLabel.classList.add("facet-included-header");

      this.includeList = document.createElement("ul");
      this.includeList.classList.add("facet-included", "barry");

      this.remainderLabel = document.createElement("h3");
      this.remainderLabel.classList.add("facet-remaindered-header");

      this.remainderList = document.createElement("ul");
      this.remainderList.classList.add("facet-remaindered", "barry");

      this.excludeLabel = document.createElement("h3");
      this.excludeLabel.classList.add("facet-excluded-header");

      this.excludeList = document.createElement("ul");
      this.excludeList.classList.add("facet-excluded", "barry");

      this.moreButton = document.createElement("button");
      this.moreButton.classList.add("facet-more");
      this.moreButton.setAttribute("needed", "false");
      this.moreButton.setAttribute("tabindex", "0");

      this.contentBox.appendChild(this.includeLabel);
      this.contentBox.appendChild(this.includeList);
      this.contentBox.appendChild(this.remainderLabel);
      this.contentBox.appendChild(this.remainderList);
      this.contentBox.appendChild(this.excludeLabel);
      this.contentBox.appendChild(this.excludeList);
      this.contentBox.appendChild(this.moreButton);

      facet.appendChild(this.nameNode);
      facet.appendChild(this.contentBox);

      this.appendChild(facet);

      this.canUpdate = false;

      if ("faceter" in this) {
        this.build(true);
      }
    }

    build() {
      // -- Header Building
      this.nameNode.textContent = this.facetDef.strings.facetNameLabel;

      // - include
      // setup the include label
      if ("includeLabel" in this.facetDef.strings) {
        this.includeLabel.textContent = this.facetDef.strings.includeLabel;
      } else {
        this.includeLabel.textContent = glodaFacetStrings.GetStringFromName(
          "glodaFacetView.facets.included.fallbackLabel"
        );
      }
      this.includeLabel.setAttribute("state", "empty");

      // - exclude
      // setup the exclude label
      if ("excludeLabel" in this.facetDef.strings) {
        this.excludeLabel.textContent = this.facetDef.strings.excludeLabel;
      } else {
        this.excludeLabel.textContent = glodaFacetStrings.GetStringFromName(
          "glodaFacetView.facets.excluded.fallbackLabel"
        );
      }
      this.excludeLabel.setAttribute("state", "empty");

      // - remainder
      // setup the remainder label
      if ("remainderLabel" in this.facetDef.strings) {
        this.remainderLabel.textContent = this.facetDef.strings.remainderLabel;
      } else {
        this.remainderLabel.textContent = glodaFacetStrings.GetStringFromName(
          "glodaFacetView.facets.remainder.fallbackLabel"
        );
      }

      // -- House-cleaning
      // -- All/Top mode decision
      this.modes = ["all"];
      if (this.maxDisplayRows >= this.orderedGroups.length) {
        this.mode = "all";
      } else {
        // top mode must be used
        this.modes.push("top");
        this.mode = "top";
        this.topGroups = FacetUtils.makeTopGroups(
          this.attrDef,
          this.orderedGroups,
          this.maxDisplayRows
        );
        // setup the more button string
        const groupCount = this.orderedGroups.length;
        document.l10n.setAttributes(
          this.moreButton,
          "facets-mode-to-list-all-label",
          { count: groupCount }
        );
      }

      // -- Row Building
      this.buildRows();
    }

    changeMode(newMode) {
      this.mode = newMode;
      this.setAttribute("mode", newMode);
      this.buildRows();
    }

    buildRows() {
      const nounDef = this.nounDef;
      const useGroups =
        this.mode == "all" ? this.orderedGroups : this.topGroups;

      // should we just rely on automatic string coercion?
      this.moreButton.setAttribute(
        "needed",
        this.mode == "top" ? "true" : "false"
      );

      const constraint = this.faceter.constraint;

      // -- empty all of our display buckets...
      const remainderList = this.remainderList;
      while (remainderList.hasChildNodes()) {
        remainderList.lastChild.remove();
      }
      const includeList = this.includeList;
      const excludeList = this.excludeList;
      while (includeList.hasChildNodes()) {
        includeList.lastChild.remove();
      }
      while (excludeList.hasChildNodes()) {
        excludeList.lastChild.remove();
      }

      // -- first pass, check for ambiguous labels
      // It's possible that multiple groups are identified by the same short
      //  string, in which case we want to use the longer string to
      //  disambiguate.  For example, un-merged contacts can result in
      //  multiple identities having contacts with the same name.  In that
      //  case we want to display both the contact name and the identity
      //  name.
      // This is generically addressed by using the userVisibleString function
      //  defined on the noun type if it is defined.  It takes an argument
      //  indicating whether it should be a short string or a long string.
      // Our algorithm is somewhat dumb.  We get the short strings, put them
      //  in a dictionary that maps to whether they are ambiguous or not.  We
      //  do not attempt to map based on their id, so then when it comes time
      //  to actually build the labels, we must build the short string and
      //  then re-call for the long name.  We could be smarter by building
      //  a list of the input values that resulted in the output string and
      //  then using that to back-update the id map, but it's more complex and
      //  the performance difference is unlikely to be meaningful.
      let ambiguousKeyValues;
      if ("userVisibleString" in nounDef) {
        ambiguousKeyValues = {};
        for (const groupPair of useGroups) {
          const [groupValue] = groupPair;

          // skip null values, they are handled by the none special-case
          if (groupValue == null) {
            continue;
          }

          const groupStr = nounDef.userVisibleString(groupValue, false);
          // We use hasOwnProperty because it is possible that groupStr could
          //  be the same as the name of one of the attributes on
          //  Object.prototype.
          if (ambiguousKeyValues.hasOwnProperty(groupStr)) {
            ambiguousKeyValues[groupStr] = true;
          } else {
            ambiguousKeyValues[groupStr] = false;
          }
        }
      }

      // -- create the items, assigning them to the right list based on
      //  existing constraint values
      for (const groupPair of useGroups) {
        const [groupValue, groupItems] = groupPair;
        const li = document.createElement("li");
        li.classList.add("bar");
        const button = document.createElement("button");
        button.classList.add("bar-button");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "facet-actions");
        li.appendChild(button);
        li.groupValue = groupValue;
        li.setAttribute("groupValue", groupValue);
        li.groupItems = groupItems;

        const countSpan = document.createElement("span");
        countSpan.setAttribute("class", "bar-count");
        countSpan.textContent = groupItems.length.toLocaleString();

        const label = document.createElement("span");
        label.setAttribute("class", "bar-link");

        // The null value is a special indicator for 'none'
        if (groupValue == null) {
          if ("noneLabel" in this.facetDef.strings) {
            label.textContent = this.facetDef.strings.noneLabel;
          } else {
            label.textContent = glodaFacetStrings.GetStringFromName(
              "glodaFacetView.facets.noneLabel"
            );
          }
        } else {
          // Otherwise stringify the group object
          let labelStr;
          if (ambiguousKeyValues) {
            labelStr = nounDef.userVisibleString(groupValue, false);
            if (ambiguousKeyValues[labelStr]) {
              labelStr = nounDef.userVisibleString(groupValue, true);
            }
          } else if ("labelFunc" in this.facetDef) {
            labelStr = this.facetDef.labelFunc(groupValue);
          } else {
            labelStr = groupValue.toLocaleString().substring(0, 80);
          }
          label.textContent = labelStr;
          label.setAttribute("title", labelStr);
        }
        button.append(label, countSpan);

        // root it under the appropriate list
        if (constraint) {
          if (constraint.isIncludedGroup(groupValue)) {
            li.setAttribute("variety", "include");
            includeList.appendChild(li);
          } else if (constraint.isExcludedGroup(groupValue)) {
            li.setAttribute("variety", "exclude");
            excludeList.appendChild(li);
          } else {
            li.setAttribute("variety", "remainder");
            remainderList.appendChild(li);
          }
        } else {
          li.setAttribute("variety", "remainder");
          remainderList.appendChild(li);
        }
      }

      this.updateHeaderStates();
    }

    /**
     * - Mark the include/exclude headers as "some" if there is anything in their
     * - lists, mark the remainder header as "needed" if either of include /
     * - exclude exist so we need that label.
     */
    updateHeaderStates() {
      this.includeLabel.setAttribute(
        "state",
        this.includeList.childElementCount ? "some" : "empty"
      );
      this.excludeLabel.setAttribute(
        "state",
        this.excludeList.childElementCount ? "some" : "empty"
      );
      this.remainderLabel.setAttribute(
        "needed",
        (this.includeList.childElementCount ||
          this.excludeList.childElementCount) &&
          this.remainderList.childElementCount
          ? "true"
          : "false"
      );

      // nuke the style attributes.
      this.includeLabel.removeAttribute("style");
      this.excludeLabel.removeAttribute("style");
      this.remainderLabel.removeAttribute("style");
    }

    brushItems() {}

    clearBrushedItems() {}

    barClicked(barNode, variety) {
      const groupValue = barNode.groupValue;
      const updateRows = () => {
        this.buildRows();
        const row = Array.from(this.querySelectorAll(".bar")).find(
          candidate => candidate.groupValue == groupValue
        );
        (
          row?.firstElementChild || document.getElementById("filter-toggle")
        ).focus();
      };

      if (variety == "remainder") {
        FacetContext.removeFacetConstraint(
          this.faceter,
          barNode.getAttribute("variety") == "include",
          [groupValue],
          updateRows
        );
      } else {
        FacetContext.addFacetConstraint(
          this.faceter,
          variety == "include",
          [groupValue],
          false,
          false,
          updateRows
        );
      }
    }

    barHovered(barNode) {
      const groupValue = barNode.groupValue;
      const groupItems = barNode.groupItems;

      FacetContext.hoverFacet(
        this.faceter,
        this.attrDef,
        groupValue,
        groupItems
      );
    }

    /**
     * HoverGone! HoverGone!
     * We know it's gone, but where has it gone?
     */
    barHoverGone(barNode) {
      const groupValue = barNode.groupValue;
      const groupItems = barNode.groupItems;

      FacetContext.unhoverFacet(
        this.faceter,
        this.attrDef,
        groupValue,
        groupItems
      );
    }

    includeFacet(node) {
      this.barClicked(
        node,
        node.getAttribute("variety") == "remainder" ? "include" : "remainder"
      );
    }

    undoFacet(node) {
      this.barClicked(
        node,
        node.getAttribute("variety") == "remainder" ? "include" : "remainder"
      );
    }

    excludeFacet(node) {
      this.barClicked(node, "exclude");
    }

    showPopup(event) {
      const barNode = event.target.closest(".bar");
      if (barNode) {
        document.querySelector("facet-popup-menu").show(this, barNode);
      } else if (event.target.closest(".facet-more")) {
        const firstNew = this.orderedGroups.find(
          ([value]) => !this.topGroups.some(([top]) => top == value)
        );
        this.changeMode("all");
        const firstRow = Array.from(this.querySelectorAll(".bar")).find(
          row => row.groupValue == firstNew?.[0]
        );
        firstRow?.firstElementChild.focus();
      }
    }
  }

  customElements.define("facet-discrete", MozFacetDiscrete);

  class MozFacetPopupMenu extends HTMLElement {
    connectedCallback() {
      this.id = "facet-actions";
      const parent = document.createElement("div");
      parent.classList.add("parent");

      this.includeNode = document.createElement("button");
      this.includeNode.classList.add("popup-menuitem", "top");
      this.excludeNode = document.createElement("button");
      this.excludeNode.classList.add("popup-menuitem", "bottom");
      this.undoNode = document.createElement("button");
      this.undoNode.classList.add("popup-menuitem", "undo");
      this.includeNode.addEventListener("click", () =>
        this.choose("includeFacet")
      );
      this.excludeNode.addEventListener("click", () =>
        this.choose("excludeFacet")
      );
      this.undoNode.addEventListener("click", () => this.choose("undoFacet"));

      parent.append(this.includeNode, this.excludeNode, this.undoNode);
      this.appendChild(parent);
      this.addEventListener("keydown", event => {
        if (event.key == "Escape") {
          this.hide(true);
        } else if (event.key == "Tab") {
          // Resume tabbing at the facet that opened the popup.
          this.hide(true);
          return;
        } else if (event.key == "ArrowDown" || event.key == "ArrowUp") {
          (document.activeElement == this.includeNode
            ? this.excludeNode
            : this.includeNode
          ).focus();
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      });
    }

    _getLabel(facetDef, facetValue, groupValue, stringName) {
      let labelFormat;
      if (stringName in facetDef.strings) {
        labelFormat = facetDef.strings[stringName];
      } else {
        labelFormat = glodaFacetStrings.GetStringFromName(
          `glodaFacetView.facets.${stringName}.fallbackLabel`
        );
      }

      if (!labelFormat.includes("#1")) {
        return labelFormat;
      }

      return labelFormat.replace("#1", facetValue);
    }

    build(facetDef, facetValue, groupValue) {
      try {
        if (groupValue) {
          this.includeNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "mustMatchLabel"
          );
          this.excludeNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "cantMatchLabel"
          );
          this.undoNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "mayMatchLabel"
          );
        } else {
          this.includeNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "mustMatchNoneLabel"
          );
          this.excludeNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "mustMatchSomeLabel"
          );
          this.undoNode.textContent = this._getLabel(
            facetDef,
            facetValue,
            groupValue,
            "mayMatchAnyLabel"
          );
        }
      } catch (e) {
        console.error(e);
      }
    }

    show(facetNode, barNode) {
      if (this.node == barNode) {
        this.hide(true);
        return;
      }
      this.hide();
      this.node = barNode;
      this.facetNode = facetNode;
      const variety = barNode.getAttribute("variety");
      const label = barNode.querySelector(".bar-link").textContent;
      this.build(facetNode.facetDef, label, barNode.groupValue);
      barNode.firstElementChild.setAttribute("aria-expanded", "true");
      this.setAttribute("variety", variety);

      const rect = barNode.getBoundingClientRect();
      const rtl = window.getComputedStyle(this).direction == "rtl";
      const left = rtl ? rect.right - this.offsetWidth : rect.left;
      this.style.left =
        Math.max(
          0,
          Math.min(
            left,
            document.documentElement.clientWidth - this.offsetWidth
          )
        ) + "px";
      this.style.top =
        (rect.bottom + this.offsetHeight <= window.innerHeight
          ? rect.bottom
          : Math.max(0, rect.top - this.offsetHeight)) + "px";
      (variety == "remainder" ? this.includeNode : this.undoNode).focus();
    }

    hide(restoreFocus = false) {
      if (!this.node) {
        return;
      }
      this.setAttribute("variety", "invisible");
      this.node.firstElementChild.setAttribute("aria-expanded", "false");
      if (restoreFocus) {
        this.node.firstElementChild.focus();
      }
      this.node = null;
    }

    choose(method) {
      const node = this.node;
      this.hide();
      this.facetNode[method](node);
    }
  }

  customElements.define("facet-popup-menu", MozFacetPopupMenu);

  /**
   * MozResultMessage displays an excerpt of a message. Typically these are used in the gloda
   * results listing, showing the messages that matched.
   */
  class MozFacetResultMessage extends HTMLElement {
    constructor() {
      super();

      this.addEventListener("mouseover", () => {
        FacetContext.hoverFacet(
          FacetContext.fakeResultFaceter,
          FacetContext.fakeResultAttr,
          this.message,
          [this.message]
        );
      });

      this.addEventListener("mouseout", () => {
        FacetContext.unhoverFacet(
          FacetContext.fakeResultFaceter,
          FacetContext.fakeResultAttr,
          this.message,
          [this.message]
        );
      });
    }

    connectedCallback() {
      if (this.subject) {
        return;
      }
      const message = this.message;
      const subjectText =
        message.subject.trim() ||
        glodaFacetStrings.GetStringFromName(
          "glodaFacetView.result.message.noSubject"
        );

      const heading = document.createElement("div");
      heading.classList.add("message-subject-group");
      this.subject = document.createElement("button");
      this.subject.classList.add("message-subject");
      this.subject.dir = "auto";
      this.subject.textContent = subjectText;
      heading.appendChild(this.subject);
      if (message.starred) {
        const star = document.createElement("span");
        star.classList.add("message-star");
        star.setAttribute("role", "img");
        document.l10n.setAttributes(star, "search-message-starred");
        heading.appendChild(star);
      }

      const date = document.createElement("time");
      date.classList.add("message-date");
      date.id = this.id + "-date";
      date.dateTime = message.date.toISOString();
      date.title = message.date.toLocaleString();
      date.textContent = lazy.makeFriendlyDateAgo(message.date);
      const author = document.createElement("div");
      author.classList.add("message-author");
      author.dir = "auto";
      author.id = this.id + "-sender";
      const recipients =
        message.recipients?.filter(
          identity => identity.contact?.name || identity.value
        ) ?? [];
      if (message.fromMe?.length && recipients.length) {
        const first = recipients[0];
        const others = recipients.length - 1;
        const label = others
          ? "search-message-correspondents"
          : "search-message-correspondent";
        document.l10n.setAttributes(author, label, {
          recipient: first.contact?.name || first.value,
          others,
        });
        author.title = formatIdentity(first);
      } else {
        author.textContent = message.from.contact?.name || message.from.value;
        author.title = formatIdentity(message.from);
      }

      this.snippet = document.createElement("p");
      this.snippet.classList.add("message-body");
      this.snippet.dir = "auto";
      const describedBy = [author.id, date.id];
      if (!message.read) {
        const unread = document.createElement("span");
        unread.hidden = true;
        unread.id = this.id + "-unread";
        document.l10n.setAttributes(unread, "search-message-unread");
        heading.appendChild(unread);
        describedBy.push(unread.id);
      }
      this.subject.setAttribute("aria-describedby", describedBy.join(" "));
      this.append(heading, date, author, this.snippet);
      this.toggleAttribute("unread", !message.read);
      this.buildSnippet();
      this.buildDetails(subjectText, recipients);

      this.addEventListener("click", event => {
        if (event.target.closest("details")) {
          return;
        }
        if (event.target == this.subject || window.getSelection().isCollapsed) {
          FacetContext.showConversationInTab(
            this,
            event.ctrlKey || event.metaKey || event.shiftKey
          );
        }
      });
      this.addEventListener("auxclick", event => {
        if (event.button == 1 && !event.target.closest("details")) {
          event.preventDefault();
          FacetContext.showConversationInTab(this, true);
        }
      });
    }

    buildDetails(subjectText, recipients) {
      const message = this.message;
      const content = document.createElement("div");
      content.classList.add("message-details-content");
      const fields = [
        [
          "message-sender-details",
          "search-message-from",
          [formatIdentity(message.from)].filter(Boolean),
        ],
        [
          "message-recipients",
          "search-message-to",
          recipients.map(formatIdentity),
        ],
        [
          "message-attachments",
          "search-message-attachments",
          message.attachmentNames,
        ],
        [
          "message-tags",
          "search-message-tags",
          message.tags?.map(tag => tag.tag),
        ],
      ];
      for (const [className, labelId, values] of fields) {
        if (!values?.length) {
          continue;
        }
        const group = document.createElement("div");
        group.classList.add(className);
        const label = document.createElement("strong");
        document.l10n.setAttributes(label, labelId);
        group.append(label, " ", lazy.listFormatter.format(values));
        content.appendChild(group);
      }

      if (content.childElementCount) {
        const details = document.createElement("details");
        details.classList.add("message-details");
        const hasAttachments = Boolean(message.attachmentNames?.length);
        if (hasAttachments) {
          details.dataset.hasAttachments = "";
        }
        const summary = document.createElement("summary");
        summary.classList.add("message-details-toggle");
        const label = hasAttachments
          ? "search-message-attachment-details"
          : "search-message-details";
        document.l10n.setAttributes(summary, label, {
          subject: subjectText,
        });
        details.append(summary, content);
        this.appendChild(details);
      }
    }

    buildSnippet() {
      const body = this.message.indexedBodyText;
      if (!body) {
        return;
      }
      const isChat =
        "IMCollection" in FacetContext &&
        this.message instanceof Gloda.lookupNounDef("im-conversation").clazz;
      const collection = isChat
        ? FacetContext.IMCollection
        : FacetContext.collection;
      const offsets = collection.stashedColumns?.[this.message.id]?.[0];
      const values = offsets ? offsets.split(" ").map(Number) : [];
      const matches = [];
      for (let index = 0; index + 3 < values.length; index += 4) {
        if (values[index] == 0 && values[index + 3] > 0) {
          matches.push([values[index + 2], values[index + 3]]);
        }
      }
      if (!matches.length) {
        this.snippet.textContent =
          body.slice(0, 240).trim() + (body.length > 240 ? "…" : "");
        return;
      }

      // SQLite offsets count UTF-8 bytes. Keep the first body match in view
      // even if it occurs halfway through a long, unbroken line.
      matches.sort((a, b) => a[0] - b[0]);
      const bytes = new TextEncoder().encode(body);
      let start = Math.max(0, matches[0][0] - 40);
      while ((bytes[start] & 0xc0) == 0x80) {
        start++;
      }
      let end = Math.min(
        bytes.length,
        Math.max(start + 260, matches[0][0] + matches[0][1])
      );
      while ((bytes[end] & 0xc0) == 0x80) {
        end++;
      }

      const decoder = new TextDecoder();
      if (start) {
        this.snippet.append("…");
      }
      let cursor = start;
      for (const [offset, length] of matches) {
        if (offset >= end) {
          break;
        }
        if (offset < cursor) {
          continue;
        }
        this.snippet.append(decoder.decode(bytes.subarray(cursor, offset)));
        const mark = document.createElement("mark");
        mark.classList.add("message-body-fulltext-match");
        mark.textContent = decoder.decode(
          bytes.subarray(offset, Math.min(offset + length, end))
        );
        this.snippet.appendChild(mark);
        this.firstMatchText ??= mark.textContent;
        cursor = offset + length;
      }
      this.snippet.append(decoder.decode(bytes.subarray(cursor, end)));
      if (end < bytes.length) {
        this.snippet.append("…");
      }
    }
  }

  customElements.define("facet-result-message", MozFacetResultMessage);
}
