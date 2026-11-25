/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod/v4'

const messageId = z.number().int().positive().describe('Thunderbird message ID returned in this session')
const timestamp = z.iso.datetime({ offset: true })

const summarize = (message) => ({
  id: message.id,
  date: message.date,
  author: message.author,
  recipients: message.recipients,
  subject: message.subject,
  read: message.read,
  flagged: message.flagged,
  folderId: message.folder?.id,
})

const messagePage = ({ messages, id }) => ({ messages: messages.map(summarize), nextPage: id ?? null })

/** Mail tools operate through Thunderbird's account and message APIs. Composition opens a native review window. */
export const registerMailTools = (register, api, selectedMessages) => {
  register('list_accounts', 'List mail accounts, sender identities and their root folder IDs.', {}, async () =>
    (await api.accounts.list(false)).map(({ id, type, name, identities, rootFolder }) => ({
      id,
      type,
      name,
      rootFolderId: rootFolder.id,
      identities: identities.map(({ id, name, email }) => ({ id, name, email })),
    })),
  )

  register(
    'list_folders',
    'List immediate children of a folder. Start with an account rootFolderId.',
    {
      folderId: z.string().min(1),
    },
    async ({ folderId }) =>
      (await api.folders.getSubFolders(folderId, false)).map(({ id, name, path, specialUse }) => ({
        id,
        name,
        path,
        specialUse,
      })),
  )

  register(
    'selected_messages',
    'Read the messages selected in the most recently used mail tab in this Thunderbolt window.',
    {},
    async () => messagePage(await selectedMessages()),
  )

  register(
    'search_messages',
    'Search mail across accounts or in a folder. Fetch additional pages with next_message_page.',
    {
      fullText: z.string().min(1).optional(),
      subject: z.string().min(1).optional(),
      author: z.string().min(1).optional(),
      recipients: z.string().min(1).optional(),
      folderId: z.string().min(1).optional(),
      unread: z.boolean().optional(),
      fromDate: timestamp.optional(),
      toDate: timestamp.optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    async ({ fromDate, toDate, limit, ...query }) =>
      messagePage(
        await api.messages.query({
          ...query,
          ...(fromDate && { fromDate: new Date(fromDate) }),
          ...(toDate && { toDate: new Date(toDate) }),
          messagesPerPage: limit,
        }),
      ),
  )

  register(
    'next_message_page',
    'Read the next page of message headers using a nextPage value from an earlier result.',
    {
      page: z.string().min(1),
    },
    async ({ page }) => messagePage(await api.messages.continueList(page)),
  )

  register(
    'read_message',
    'Read the message header, plain text and attachment names. Continue a long body using nextOffset.',
    {
      messageId,
      offset: z.number().int().nonnegative().default(0),
    },
    async ({ messageId, offset }) => {
      const [header, parts, attachments] = await Promise.all([
        api.messages.get(messageId),
        api.messages.listInlineTextParts(messageId),
        api.messages.listAttachments(messageId),
      ])
      const plain = parts.filter((part) => part.contentType === 'text/plain')
      const text = plain.length
        ? plain.map((part) => part.content).join('\n')
        : (
            await Promise.all(
              parts
                .filter((part) => part.contentType === 'text/html')
                .map((part) => api.messengerUtilities.convertToPlainText(part.content)),
            )
          ).join('\n')
      const end = offset + 16000
      return {
        ...summarize(header),
        cc: header.ccList,
        body: text.slice(offset, end),
        nextOffset: end < text.length ? end : null,
        attachments: attachments.map(({ name, size, contentType }) => ({ name, size, contentType })),
      }
    },
  )

  register(
    'draft_message',
    'Open a new plain-text message in Thunderbird for the user to review and send.',
    {
      to: z.array(z.email()).min(1),
      subject: z.string(),
      body: z.string(),
      identityId: z.string().optional(),
    },
    async ({ to, subject, body, identityId }) => {
      const tab = await api.compose.beginNew({ to, subject, plainTextBody: body, ...(identityId && { identityId }) })
      return { status: 'opened_for_review', tabId: tab.id }
    },
    false,
  )

  register(
    'draft_reply',
    'Open a Thunderbird reply with proposed text for the user to review and send.',
    {
      messageId,
      body: z.string(),
      replyAll: z.boolean().default(false),
      identityId: z.string().optional(),
    },
    async ({ messageId, body, replyAll, identityId }) => {
      const tab = await api.compose.beginReply(messageId, replyAll ? 'replyToAll' : 'replyToSender', {
        plainTextBody: body,
        ...(identityId && { identityId }),
      })
      return { status: 'opened_for_review', tabId: tab.id }
    },
    false,
  )
}
