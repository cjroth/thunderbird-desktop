/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { create } from 'zustand'
import type { AppLocale } from '@shared/i18n/locales'

/** The packaged Thunderbird space uses the extension's origin for its UI and local database. */
export const isThunderbirdPanel = import.meta.env.VITE_THUNDERBIRD_PANEL === 'true'

/** Open a fresh chat tab inside the calling window’s Thunderbolt space. */
export const openThunderboltTab = (): Promise<void> =>
  (
    globalThis as typeof globalThis & { messenger: { thunderboltPanel: { openNewTab: () => Promise<void> } } }
  ).messenger.thunderboltPanel.openNewTab()

/** Theme and negotiated catalog selected by the Thunderbird window that owns this tab. */
export const useThunderbirdAppearance = create<{ mode?: 'light' | 'dark'; locale?: AppLocale }>(() => ({}))
