/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Executed in the test runner's newly created, synthetic profile.
return (async () => {
  const { MailServices } = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs')
  const { cal } = ChromeUtils.importESModule('resource:///modules/calendar/calUtils.sys.mjs')
  const { CalEvent } = ChromeUtils.importESModule('resource:///modules/CalEvent.sys.mjs')
  const { CalTodo } = ChromeUtils.importESModule('resource:///modules/CalTodo.sys.mjs')
  const account = MailServices.accounts.findAccountForServer(MailServices.accounts.localFoldersServer)
  const identity = MailServices.accounts.createIdentity()
  identity.fullName = 'Fixture user'
  identity.email = 'fixture-user@example.invalid'
  account.addIdentity(identity)
  const root = account.incomingServer.rootFolder
  root.createSubfolder('MCP Fixtures', null)
  const folder = root.getChildNamed('MCP Fixtures').QueryInterface(Ci.nsIMsgLocalMailFolder)
  folder.addMessage(
    [
      'From fixture@example.invalid Tue Nov 24 12:00:00 2026',
      'From: Fixture <fixture@example.invalid>',
      'To: user@example.invalid',
      'Subject: Thunderbolt MCP sample',
      'Date: Tue, 24 Nov 2026 12:00:00 +0000',
      'Message-ID: <thunderbolt-test@example.invalid>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The fixture telescope is ready.',
      '',
    ].join('\r\n'),
  )
  const book = MailServices.ab.getDirectory('jsaddrbook://abook.sqlite')
  const card = Cc['@mozilla.org/addressbook/cardproperty;1'].createInstance(Ci.nsIAbCard)
  card.displayName = 'Coral Fixture'
  card.primaryEmail = 'coral@example.invalid'
  book.addCard(card)
  const calendar = cal.manager.createCalendar('memory', Services.io.newURI('moz-memory-calendar://mcp-test/'))
  calendar.name = 'MCP fixture calendar'
  cal.manager.registerCalendar(calendar)
  const event = new CalEvent()
  event.title = 'Fixture telescope check'
  event.startDate = cal.createDateTime('20261124T130000Z')
  event.endDate = cal.createDateTime('20261124T140000Z')
  await calendar.addItem(event)
  const task = new CalTodo()
  task.title = 'Clean the fixture telescope'
  await calendar.addItem(task)
  return { calendarId: calendar.id, bookId: book.UID, identityId: identity.key, folderURI: folder.URI }
})()
