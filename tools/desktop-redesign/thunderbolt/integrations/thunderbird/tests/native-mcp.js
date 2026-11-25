/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const [fixture] = arguments
return (async () => {
  const port = window.messenger.runtime.connect({ name: 'thunderbolt-mcp' })
  const rpc = (id, method, params) =>
    new Promise((resolve, reject) => {
      const receive = (reply) => {
        if (reply.id !== id) return
        port.onMessage.removeListener(receive)
        port.onDisconnect.removeListener(disconnected)
        if (reply.error) reject(new Error(reply.error.message))
        else resolve(reply.result)
      }
      const disconnected = () => reject(new Error('Thunderbird MCP disconnected during ' + method))
      port.onMessage.addListener(receive)
      port.onDisconnect.addListener(disconnected)
      port.postMessage({ jsonrpc: '2.0', id, method, params })
    })
  const call = async (id, name, args = {}) => {
    const result = await rpc(id, 'tools/call', { name, arguments: args })
    if (result.isError) throw new Error(name + ': ' + result.content[0].text)
    return JSON.parse(result.content[0].text)
  }
  try {
    await rpc(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'Thunderbird smoke', version: '1' },
    })
    port.postMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const tools = await rpc(2, 'tools/list', {})
    const selection = await call(17, 'selected_messages')
    if (selection.messages.length !== 1 || selection.messages[0].subject !== 'Thunderbolt MCP sample') {
      throw new Error('Wrong selected mail from the calling Thunderbolt window: ' + JSON.stringify(selection))
    }
    const [account] = await call(3, 'list_accounts')
    const folders = await call(4, 'list_folders', { folderId: account.rootFolderId })
    const folder = folders.find((folder) => folder.name === 'MCP Fixtures')
    const found = await call(5, 'search_messages', { folderId: folder.id, subject: 'Thunderbolt MCP sample' })
    const mail = await call(6, 'read_message', { messageId: found.messages[0].id })
    if (!mail.body.includes('The fixture telescope is ready.')) throw new Error('Fixture email body mismatch')
    const books = await call(7, 'list_address_books')
    if (!books.some((book) => book.id === fixture.bookId)) throw new Error('Fixture address book is missing')
    const contacts = await call(8, 'search_contacts', { addressBookId: fixture.bookId, query: 'Coral' })
    const contact = await call(9, 'read_contact', { contactId: contacts.contacts[0].id })
    if (contact.email !== 'coral@example.invalid') throw new Error('Fixture contact email mismatch')
    const calendars = await call(10, 'list_calendars')
    if (!calendars.some((calendar) => calendar.id === fixture.calendarId))
      throw new Error('Fixture calendar is missing')
    const events = await call(11, 'list_events', {
      calendarId: fixture.calendarId,
      start: '2026-11-24T00:00:00Z',
      end: '2026-11-25T00:00:00Z',
    })
    if (events.items[0]?.title !== 'Fixture telescope check') throw new Error('Fixture event missing')
    const tasks = await call(12, 'list_tasks', { calendarId: fixture.calendarId })
    if (tasks.items[0]?.title !== 'Clean the fixture telescope') throw new Error('Fixture task missing')
    await call(13, 'draft_message', {
      to: ['recipient@example.invalid'],
      subject: 'Review fixture email',
      body: 'Review only',
      identityId: fixture.identityId,
    })
    await call(14, 'draft_reply', {
      messageId: found.messages[0].id,
      body: 'Fixture reply text',
      identityId: fixture.identityId,
    })
    await call(15, 'draft_event', {
      calendarId: fixture.calendarId,
      title: 'Review fixture meeting',
      start: '2026-11-25T10:00:00-05:00',
      end: '2026-11-25T10:30:00-05:00',
    })
    await call(16, 'draft_task', {
      calendarId: fixture.calendarId,
      title: 'Review fixture task',
      due: '2026-11-25T16:00:00Z',
    })
    return {
      advertisedTools: tools.tools.length,
      mail: mail.subject,
      contact: contact.name,
      event: events.items[0].title,
      task: tasks.items[0].title,
    }
  } finally {
    port.disconnect()
  }
})()
