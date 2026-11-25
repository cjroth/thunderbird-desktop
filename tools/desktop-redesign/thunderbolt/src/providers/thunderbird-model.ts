/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultModelDeepSeekV41Flash } from '@shared/defaults/models'
import type { Model } from '@/types'

// Reuse the shipped model/profile identity. The panel has its own local database
// and supplies its own key, so this row uses the direct Tinfoil client.
export const thunderbirdModel = { ...defaultModelDeepSeekV41Flash, isSystem: 0 }
export const thunderbirdModelPin = { model: thunderbirdModel.model, repo: 'tinfoilsh/confidential-deepseek-v4-1-flash' }

/** Reject a stale or edited row before a provider is bound to mail or calendar data. */
export const assertThunderbirdModel = (model: Model): void => {
  if (
    model.id !== thunderbirdModel.id ||
    model.provider !== thunderbirdModel.provider ||
    model.model !== thunderbirdModel.model ||
    model.isConfidential !== 1 ||
    model.isSystem !== 0 ||
    model.url != null ||
    model.providerConnectionId != null ||
    model.oauthProvider != null
  ) {
    throw new Error('Thunderbird requires the attested Tinfoil connection for DeepSeek V4.1 Flash.')
  }
}
