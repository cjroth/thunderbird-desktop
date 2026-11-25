/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, it } from 'bun:test'
import type { Model } from '@/types'
import { assertThunderbirdModel, thunderbirdModel } from './thunderbird-model'

const ready: Model = { ...thunderbirdModel, apiKey: 'test-only', reasoningEffort: null }

it('binds the direct Tinfoil row, with or without a saved key', () => {
  expect(() => assertThunderbirdModel(ready)).not.toThrow()
  expect(() => assertThunderbirdModel({ ...ready, apiKey: null })).not.toThrow()
})

it.each([
  { id: 'old-selection' },
  { model: 'deepseek-v4-flash' },
  { provider: 'openai' as const },
  { isConfidential: 0 },
  { isSystem: 1 },
  { url: 'https://example.invalid' },
  { providerConnectionId: 'other-connection' },
  { oauthProvider: 'tinfoil' as const },
])('rejects an edited provider row before binding a request (%j)', (edit) => {
  expect(() => assertThunderbirdModel({ ...ready, ...edit })).toThrow('DeepSeek V4.1 Flash')
})
