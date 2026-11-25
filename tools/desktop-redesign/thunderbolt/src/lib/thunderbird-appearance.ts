/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { brandingColorTokens } from '@shared/branding'
import { activateLocale } from '@/i18n'
import { resolveLocale } from '@/i18n/resolve-locale'
import { applyBranding } from './branding'
import { useThunderbirdAppearance } from './thunderbird'

type ThunderbirdAppearance = {
  mode: 'light' | 'dark'
  locale: string
  colors: Record<string, string>
  fontFamily: string
  fontSize: string
  buttonRadius: string
  panelRadius: string
  buttonHeight: string
}

type ThunderbirdAppearanceApi = {
  getAppearance: () => Promise<ThunderbirdAppearance>
  onAppearanceChanged: { addListener: (callback: (appearance: ThunderbirdAppearance) => void) => void }
}

/** Apply the computed chrome values from the owning window, including its current density and language. */
const applyAppearance = async (appearance: ThunderbirdAppearance): Promise<void> => {
  const { mode, fontFamily, fontSize, buttonHeight, buttonRadius, panelRadius } = appearance
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
  root.style.colorScheme = mode
  root.style.setProperty('--font-sans', fontFamily)
  root.style.setProperty('--font-heading', fontFamily)
  // Thunderbolt's desktop body style is 0.875rem. Scale the root so rem-based labels,
  // icons and spacing follow Thunderbird's UI font-size preference together.
  root.style.fontSize = `calc(${fontSize} / 0.875)`
  document.body.style.fontSize = fontSize
  root.style.setProperty('--radius-lg', buttonRadius)
  root.style.setProperty('--radius-xl', panelRadius)
  root.style.setProperty('--touch-height-default', buttonHeight)
  root.style.setProperty('--touch-height-sm', buttonHeight)
  root.style.setProperty('--touch-height-control', buttonHeight)

  const colors = Object.fromEntries(
    brandingColorTokens
      .filter((token) => appearance.colors[token] && CSS.supports('color', appearance.colors[token]))
      .map((token) => [token, appearance.colors[token]]),
  )
  applyBranding({ cssVars: { [mode]: colors } }, { updateTitle: false })
  const locale = resolveLocale(null, [appearance.locale])
  root.lang = locale
  useThunderbirdAppearance.setState({ mode, locale })
  await activateLocale(locale)
}

/** Subscribe before reading so a theme change during startup wins over the initial snapshot. */
export const installThunderbirdAppearance = async (): Promise<void> => {
  document.documentElement.classList.add('thunderbird-panel')
  const { thunderboltPanel } = (
    globalThis as typeof globalThis & { messenger: { thunderboltPanel: ThunderbirdAppearanceApi } }
  ).messenger
  let current: Promise<void> | undefined
  thunderboltPanel.onAppearanceChanged.addListener((appearance) => {
    current = applyAppearance(appearance)
  })
  const initial = await thunderboltPanel.getAppearance()
  await (current ?? applyAppearance(initial))
}
