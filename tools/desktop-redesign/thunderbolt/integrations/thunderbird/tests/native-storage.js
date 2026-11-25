/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const [phase] = arguments
return (async () => {
  const waitFor = async (selector, visible = true) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      const result = document.querySelector(selector)
      if (Boolean(result) === visible) return result
      await new Promise(resolve => window.setTimeout(resolve, 75))
    }
    throw new Error('Missing Thunderbolt control: ' + selector)
  }
  await waitFor('textarea')
  const setup = '[data-testid=thunderbird-key-setup]'
  const settings = '[data-testid=thunderbird-settings]'
  const saved = '[role="dialog"] button[name="operation"][value="clear"]'
  if (phase === 'write') {
    const connect = await waitFor(setup)
    connect.click()
    const input = await waitFor('[role="dialog"] input[name="key"]')
    // A dummy value exercises the local models_secrets row. No model request is issued.
    input.value = 'fixture-only-storage-marker'
    input.form.requestSubmit()
    await waitFor('[role="dialog"]', false)
  }
  const trigger = await waitFor(settings)
  trigger.click()
  await waitFor(saved)
  if (document.querySelector(setup)) throw new Error('Setup still appears with a saved key')
  if (document.querySelector('[role="dialog"] input[name="key"]').value) throw new Error('Settings revealed a key')
  const root = await navigator.storage.getDirectory()
  const database = await root.getFileHandle('thunderbolt-sync.db')
  const file = await database.getFile()
  const header = await file.slice(0, 16).text()
  if (header !== 'SQLite format 3\x00') throw new Error('Expected a SQLite database in OPFS')
  return { phase, origin: location.origin, database: database.name, sqliteBytes: file.size, hasSavedCredential: true, route: location.hash }
})()
