/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Read Thunderbird's semantic tokens in the chrome document where light-dark(),
// system colors and lightweight theme overrides have their actual window values.
const nativeColors = {
  background: 'sidebar-background-color',
  foreground: 'sidebar-text-color',
  card: 'layout-background-0',
  'card-foreground': 'layout-color-1',
  popover: 'color-surface-subtle',
  'popover-foreground': 'color-text-base',
  secondary: 'button-background-color',
  'secondary-foreground': 'button-text-color',
  muted: 'layout-background-2',
  'muted-foreground': 'layout-color-2',
  accent: 'button-hover-background-color',
  'accent-foreground': 'button-hover-text-color',
  destructive: 'destructive-button-background',
  'destructive-foreground': 'destructive-button-color',
  success: 'color-success-default',
  'success-foreground': 'color-text-base-inverted',
  warning: 'color-warning-default',
  'warning-foreground': 'color-text-base',
  border: 'sidebar-border-color',
  'border-strong': 'layout-border-1',
  input: 'toolbar-field-border-color',
  ring: 'focus-outline-color',
  primary: 'selected-item-color',
  'primary-foreground': 'selected-item-text-color',
  brand: 'selected-item-color',
  'brand-gradient-start': 'selected-item-color',
  'brand-foreground': 'selected-item-text-color',
  sidebar: 'sidebar-background-color',
  'sidebar-foreground': 'sidebar-text-color',
  'sidebar-primary': 'selected-item-color',
  'sidebar-primary-foreground': 'selected-item-text-color',
  'sidebar-accent': 'button-hover-background-color',
  'sidebar-accent-foreground': 'button-hover-text-color',
  'sidebar-border': 'sidebar-border-color',
  'sidebar-ring': 'focus-outline-color',
}

const readAppearance = (win) => {
  const doc = win.document
  const container = doc.getElementById('tabmail-container')
  const probe = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  container.appendChild(probe)
  try {
    const readColor = (value) => {
      probe.style.color = value
      return win.getComputedStyle(probe).color
    }
    const style = win.getComputedStyle(container)
    const colors = Object.fromEntries(
      Object.entries(nativeColors).map(([key, token]) => [key, readColor('var(--' + token + ')')]),
    )
    return {
      mode: readColor('light-dark(white, black)') === 'rgb(0, 0, 0)' ? 'dark' : 'light',
      locale: Services.locale.appLocaleAsBCP47,
      colors,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      buttonRadius: style.getPropertyValue('--button-border-radius').trim(),
      panelRadius: win
        .getComputedStyle(doc.getElementById('appMenu-popup'))
        .getPropertyValue('--panel-border-radius')
        .trim(),
      buttonHeight: style.getPropertyValue('--button-min-height').trim(),
    }
  } finally {
    probe.remove()
  }
}

/** Resolve the calling extension tab even if another space or window is active. */
const hostWindow = (context) => {
  const browser = context.xulBrowser
  const win = browser?.ownerDocument.defaultView
  if (
    win?.document.documentElement.getAttribute('windowtype') !== 'mail:3pane' ||
    !win.document.getElementById('tabmail').getTabForBrowser(browser)
  ) {
    throw new Error('Open Thunderbolt in its Thunderbird space to use this operation')
  }
  return win
}

this.thunderboltPanel = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      thunderboltPanel: {
        openNewTab: () => {
          const win = hostWindow(context)
          const tab = win.document.getElementById('tabmail').getTabForBrowser(context.xulBrowser)
          const space = win.gSpacesToolbar.spaces.find((entry) => entry.isExtensionSpace && entry.tabInSpace(tab))
          if (!space) throw new Error('The calling tab does not belong to the Thunderbolt space')
          space.open('tab')
        },
        getAppearance: () => readAppearance(hostWindow(context)),
        onAppearanceChanged: new ExtensionCommon.EventManager({
          context,
          name: 'thunderboltPanel.onAppearanceChanged',
          register: (fire) => {
            const win = hostWindow(context)
            let frame = 0
            const update = () => {
              if (frame) return
              frame = win.requestAnimationFrame(() => {
                frame = 0
                void fire.async(readAppearance(win))
              })
            }
            const observer = new win.MutationObserver(update)
            observer.observe(win.document.documentElement, { attributes: true })
            const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(forced-colors: active)'].map(
              (q) => win.matchMedia(q),
            )
            queries.forEach((q) => q.addEventListener('change', update))
            Services.obs.addObserver(update, 'intl:app-locales-changed')
            return () => {
              observer.disconnect()
              win.cancelAnimationFrame(frame)
              queries.forEach((q) => q.removeEventListener('change', update))
              Services.obs.removeObserver(update, 'intl:app-locales-changed')
            }
          },
        }).api(),
      },
    }
  }
}
