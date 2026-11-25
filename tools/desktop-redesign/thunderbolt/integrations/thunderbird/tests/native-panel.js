/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const [fixture, script] = arguments
return (async () => {
  const win = Services.wm.getMostRecentWindow('mail:3pane')
  const until = async (read) => {
    const end = Date.now() + 15000
    while (Date.now() < end) {
      const value = read()
      if (value) return value
      await new Promise((resolve) => win.setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for native Thunderbolt space state: ' + read.toString())
  }
  const spaceIn = (window) => window.gSpacesToolbar?.spaces?.find((entry) => entry.button.title === 'Thunderbolt')
  const readyBrowser = (tabmail) => {
    const browser = tabmail.currentTabInfo.browser
    return browser?.currentURI?.scheme === 'moz-extension' && browser.browsingContext.currentWindowGlobal && browser
  }
  const tabmail = win.document.getElementById('tabmail')
  const area = await until(() => spaceIn(win))
  if (win.document.getElementById('thunderbolt-panel-menuitem')) throw new Error('Unexpected duplicate menu launcher')
  const mail = tabmail.currentAbout3Pane
  mail.displayFolder(fixture.folderURI)
  await until(() => mail.gDBView?.rowCount === 1)
  mail.threadTree.selectedIndex = 0
  await until(() => mail.gDBView.getSelectedMsgHdrs().length === 1)
  area.button.click()
  const browser = await until(() => readyBrowser(tabmail))
  const actor = browser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands')
  const original = tabmail.currentTabInfo
  const count = tabmail.tabInfo.length
  tabmail.switchToTab(0)
  area.button.click()
  if (tabmail.currentTabInfo !== original || tabmail.tabInfo.length !== count)
    throw new Error('Space lost its first tab')
  const content = (source) => actor.executeScript(source, [], { newSandbox: true })
  await content('return window.messenger.thunderboltPanel.openNewTab()')
  const second = await until(
    () => area.tabInSpace(tabmail.currentTabInfo) && tabmail.currentTabInfo !== original && readyBrowser(tabmail),
  )
  if (second === browser || tabmail.tabInfo.length !== count + 1) throw new Error('New space tab failed')
  area.button.click()
  if (tabmail.currentTabInfo.browser !== second) throw new Error('Reselecting the current space switched tabs')
  tabmail.closeTab(tabmail.currentTabInfo)
  // Keep the second window active during the MCP request and appearance read.
  const other = win.openDialog('chrome://messenger/content/messenger.xhtml', '_blank', 'chrome,dialog=no,all')
  await until(() => spaceIn(other) && other.document.getElementById('tabmail')?.currentAbout3Pane)
  const color = 'rgb(15, 21, 35)'
  win.document.documentElement.style.setProperty('--sidebar-text-color', color)
  const appearance = await content('return window.messenger.thunderboltPanel.getAppearance()')
  if (appearance.colors.foreground !== color) throw new Error('Appearance came from the wrong window')
  const result = await actor.executeScript(script, [fixture], { async: false, timeout: 20000, newSandbox: true })
  other.close()
  const compose = await until(() => {
    const subjects = [...Services.wm.getEnumerator('msgcompose')].map(
      (win) => win.document.getElementById('msgSubject')?.value,
    )
    return subjects.includes('Review fixture email') && subjects.includes('Re: Thunderbolt MCP sample') && subjects
  })
  const calendarDrafts = await until(() => {
    const titles = [...Services.wm.getEnumerator(null)]
      .map((win) => win.arguments?.[0]?.calendarEvent?.title)
      .filter(Boolean)
    return titles.includes('Review fixture meeting') && titles.includes('Review fixture task') && titles
  })
  return {
    ...result,
    compose,
    calendarDrafts,
    launcher: 'Native Thunderbolt space reselected the existing tab and opened an independent second tab',
  }
})()
