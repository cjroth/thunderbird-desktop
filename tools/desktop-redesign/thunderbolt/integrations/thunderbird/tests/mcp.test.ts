/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, mock, test } from 'bun:test'
import type { JSONRPCMessage } from '@ai-sdk/mcp'
import { connectThunderbirdMcp } from '../../../src/lib/thunderbird-mcp-client'
import { installThunderbirdMcp } from '../extension/mcp/server.js'

const event = <T>() => {
  const listeners = new Set<(value: T) => void>()
  return {
    addListener: (listener: (value: T) => void) => listeners.add(listener),
    dispatch: (value: T) => listeners.forEach((listener) => listener(value)),
  }
}

const extensionId = 'thunderbolt@tests'
const panelUrl = 'moz-extension://test/index.html'
const portPair = (url: string, id = extensionId) => {
  const serverMessages = event<JSONRPCMessage>()
  const clientMessages = event<JSONRPCMessage>()
  const onDisconnect = event<void>()
  const disconnect = mock(() => onDisconnect.dispatch())
  return {
    server: {
      name: 'thunderbolt-mcp',
      sender: { id, url, tab: { id: 12 } },
      onDisconnect,
      disconnect,
      onMessage: serverMessages,
      postMessage: (message: JSONRPCMessage) => queueMicrotask(() => clientMessages.dispatch(message)),
    },
    client: {
      onDisconnect,
      disconnect,
      onMessage: clientMessages,
      postMessage: (message: JSONRPCMessage) => queueMicrotask(() => serverMessages.dispatch(message)),
    },
  }
}

const setup = () => {
  const onConnect = event<ReturnType<typeof portPair>['server']>()
  const api = {
    runtime: { getURL: () => panelUrl, id: extensionId, getManifest: () => ({ version: '1.0' }), onConnect },
    tabs: {
      get: mock(async (_id: number) => ({ windowId: 5 })),
      onActivated: event<{ tabId: number; previousTabId?: number }>(),
      onRemoved: event<number>(),
    },
    mailTabs: {
      query: mock(async (_query: { windowId: number }) => [{ id: 1 }, { id: 2 }]),
      getSelectedMessages: mock(async (_id: number) => ({ messages: [] })),
    },
    accounts: {
      list: mock(async () => [
        { id: 'account', name: 'Local', type: 'none', identities: [], rootFolder: { id: 'root' } },
      ]),
    },
    messages: {
      get: mock(async () => ({ id: 1, subject: 'Fixture' })),
      query: mock(async () => ({ id: 'cursor', messages: [{ id: 1, subject: 'Fixture' }] })),
      listInlineTextParts: mock(async () => [{ contentType: 'text/html', content: '<p>Body</p>' }]),
      listAttachments: mock(async () => []),
    },
    messengerUtilities: { convertToPlainText: mock(async () => 'Body') },
    compose: { beginNew: mock(async () => ({ id: 3 })) },
    thunderboltCalendar: { listCalendars: mock(async () => [{ id: 'calendar' }]) },
  }
  installThunderbirdMcp(api, 'index.html')
  return {
    api,
    connect: () =>
      connectThunderbirdMcp({
        connect: () => {
          const port = portPair(panelUrl + '#/chats/test')
          onConnect.dispatch(port.server)
          return port.client
        },
      }),
  }
}

test('the normal AI SDK negotiates MCP, discovers tools and dispatches through Thunderbird APIs', async () => {
  const { api, connect } = setup()
  const client = await connect()
  try {
    const definitions = await client.listTools()
    const { tools } = definitions
    const actions = client.toolsFromDefinitions(definitions)
    const invoke = (name: string, args: Record<string, unknown>) =>
      actions[name].execute(args, { messages: [], toolCallId: 'fixture' })
    api.tabs.onActivated.dispatch({ tabId: 12, previousTabId: 2 })
    // More recent activity in a different window must not change this tab's context.
    api.tabs.onActivated.dispatch({ tabId: 30, previousTabId: 29 })
    await invoke('selected_messages', {})
    expect(api.tabs.get).toHaveBeenCalledWith(12)
    expect(api.mailTabs.query).toHaveBeenCalledWith({ windowId: 5 })
    expect(api.mailTabs.getSelectedMessages).toHaveBeenLastCalledWith(2)
    api.tabs.onRemoved.dispatch(2)
    await invoke('selected_messages', {})
    expect(api.mailTabs.getSelectedMessages).toHaveBeenLastCalledWith(1)
    expect(tools.map((tool) => tool.name)).toContain('search_contacts')
    expect(tools.find((tool) => tool.name === 'draft_message')?.annotations?.readOnlyHint).toBe(false)
    expect((await invoke('list_accounts', {})).content).toEqual([
      {
        type: 'text',
        text: JSON.stringify([{ id: 'account', type: 'none', name: 'Local', rootFolderId: 'root', identities: [] }]),
      },
    ])
    const found = await invoke('search_messages', { fromDate: '2026-10-20T00:00:00Z', limit: 12 })
    expect(api.messages.query).toHaveBeenCalledWith({ fromDate: new Date('2026-10-20T00:00:00Z'), messagesPerPage: 12 })
    expect(found.content).toEqual([
      { type: 'text', text: '{"messages":[{"id":1,"subject":"Fixture"}],"nextPage":"cursor"}' },
    ])
    const read = await invoke('read_message', { messageId: 1 })
    expect(read.content).toEqual([
      { type: 'text', text: '{"id":1,"subject":"Fixture","body":"Body","nextOffset":null,"attachments":[]}' },
    ])
    expect(api.messengerUtilities.convertToPlainText).toHaveBeenCalledWith('<p>Body</p>')
    await invoke('list_calendars', {})
    expect(api.thunderboltCalendar.listCalendars).toHaveBeenCalledTimes(1)
    await invoke('draft_message', { subject: 'Example', to: ['test@example.com'], body: 'Review me' })
    expect(api.compose.beginNew).toHaveBeenCalledWith({
      subject: 'Example',
      to: ['test@example.com'],
      plainTextBody: 'Review me',
    })
    const invalid = await invoke('search_messages', { limit: 300 })
    expect(invalid.isError).toBe(true)
    expect(api.messages.query).toHaveBeenCalledTimes(1)
  } finally {
    await client.close()
  }
})

test('other document paths, origins and extension IDs cannot reach the port', () => {
  const { api } = setup()
  for (const [url, id] of [
    [panelUrl, 'different@tests'],
    ['https://example.com/index.html', extensionId],
    ['moz-extension://test/other.html', extensionId],
  ]) {
    const { server } = portPair(url, id)
    api.runtime.onConnect.dispatch(server)
    expect(server.disconnect).toHaveBeenCalledTimes(1)
  }
})
