/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod/v4'

const summarize = ({ id, parentId, properties }) => ({
  id,
  addressBookId: parentId,
  name: properties.DisplayName || [properties.FirstName, properties.LastName].filter(Boolean).join(' '),
  email: properties.PrimaryEmail,
  secondEmail: properties.SecondEmail,
})

/** Return concise search hits, with individual contact details available on demand. */
export const registerContactTools = (register, api) => {
  register('list_address_books', 'List Thunderbird address books.', {}, async () =>
    (await api.addressBooks.list(false)).map(({ id, name, readOnly, remote }) => ({ id, name, readOnly, remote })),
  )
  register(
    'search_contacts',
    'Search contacts by name or address. Optionally limit the search to one address book.',
    {
      query: z.string().min(1),
      addressBookId: z.string().min(1).optional(),
      offset: z.number().int().nonnegative().default(0),
    },
    async ({ query, addressBookId, offset }) => {
      const matches = addressBookId
        ? await api.contacts.quickSearch(addressBookId, query)
        : await api.contacts.quickSearch(query)
      const end = offset + 50
      return { contacts: matches.slice(offset, end).map(summarize), nextOffset: end < matches.length ? end : null }
    },
  )
  register(
    'read_contact',
    'Read the contact name, email, phone numbers, organization and addresses.',
    {
      contactId: z.string().min(1),
    },
    async ({ contactId }) => {
      const contact = await api.contacts.get(contactId)
      const keys = [
        'FirstName',
        'LastName',
        'NickName',
        'Company',
        'JobTitle',
        'Department',
        'WorkPhone',
        'HomePhone',
        'CellularNumber',
        'WorkAddress',
        'WorkCity',
        'WorkState',
        'WorkZipCode',
        'WorkCountry',
        'HomeAddress',
        'HomeCity',
        'HomeState',
        'HomeZipCode',
        'HomeCountry',
        'Notes',
      ]
      return {
        ...summarize(contact),
        ...Object.fromEntries(
          keys.filter((key) => contact.properties[key]).map((key) => [key, contact.properties[key]]),
        ),
      }
    },
  )
}
