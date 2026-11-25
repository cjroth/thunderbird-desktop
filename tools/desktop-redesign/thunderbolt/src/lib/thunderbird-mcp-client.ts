/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMCPClient, type JSONRPCMessage, type MCPTransport } from '@ai-sdk/mcp'

type ExtensionPort = {
  postMessage: (message: JSONRPCMessage) => void
  disconnect: () => void
  onMessage: { addListener: (listener: (message: JSONRPCMessage) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
}
type ExtensionRuntime = { connect: (options: { name: string }) => ExtensionPort }

/** Adapt the panel's internal extension messaging port to Thunderbolt's normal MCP SDK client. */
export const connectThunderbirdMcp = (
  runtime = (globalThis as typeof globalThis & { messenger: { runtime: ExtensionRuntime } }).messenger.runtime,
) => {
  const port = runtime.connect({ name: 'thunderbolt-mcp' })
  const transport: MCPTransport = {
    async start() {
      port.onMessage.addListener((message) => transport.onmessage?.(message))
      port.onDisconnect.addListener(() => transport.onclose?.())
    },
    async send(message) {
      port.postMessage(message)
    },
    async close() {
      port.disconnect()
    },
  }
  return createMCPClient({ transport })
}
