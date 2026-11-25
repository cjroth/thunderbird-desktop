/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

async function sub_test_toolbar_alignment(drawInTitlebar, hideMenu) {
  const menubar = document.getElementById("toolbar-menubar");
  const customtitlebar =
    document.documentElement.getAttribute("customtitlebar") == "true";
  Assert.equal(customtitlebar, drawInTitlebar);

  if (hideMenu) {
    menubar.setAttribute("autohide", true);
    menubar.setAttribute("inactive", true);
  } else {
    menubar.removeAttribute("autohide");
    menubar.removeAttribute("inactive");
  }
  await new Promise(resolve => requestAnimationFrame(resolve));

  const header = document.getElementById("unifiedToolbarContainer");
  const navigation = document.getElementById("spacesToolbar");
  Assert.equal(
    navigation.parentElement,
    header,
    "Spaces shares the window header"
  );
  Assert.equal(navigation.getAttribute("aria-orientation"), "horizontal");
  Assert.equal(
    document.getElementById("titlebar").getBoundingClientRect().left,
    document.getElementById("messengerBody").getBoundingClientRect().left,
    "The tab strip lines up with the full workspace"
  );
  const navigationRect = navigation.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  Assert.ok(
    navigationRect.top >= headerRect.top &&
      navigationRect.bottom <= headerRect.bottom,
    "The window header contains the navigation"
  );
}
