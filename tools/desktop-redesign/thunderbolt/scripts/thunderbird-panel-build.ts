/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Plugin } from 'vite'

/** Keep the pre-paint script synchronous under the extension's external-script-only CSP. */
export const thunderbirdPanelScripts = (): Plugin => ({
  name: 'thunderbird-panel-scripts',
  enforce: 'pre',
  transform: {
    filter: { id: /\/src\/index\.css$/ },
    handler(css) {
      // The preview workspace can also contain full Gecko checkouts, profiles and native bundles.
      return css.replace(
        "@import 'tailwindcss';",
        "@import 'tailwindcss' source('.');\n@source '../shared';\n@source '../index.html';",
      )
    },
  },
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      // codeSplitting: false can hoist an external import from an otherwise cold
      // path (such as the Bun test driver). Gecko would reject the whole entry.
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry && output.imports.length) {
          throw new Error(`Thunderbird panel entry still imports: ${output.imports.join(', ')}`)
        }
      }
      const page = bundle['index.html']
      if (page?.type !== 'asset' || typeof page.source !== 'string') {
        throw new Error('Thunderbird panel build is missing index.html')
      }
      // The tab strip uses the same glyph as Spaces. The welcome page carries the full-color logo.
      page.source = page.source
        .replace(/<link\b[^>]*\brel="icon"[^>]*>/g, '')
        .replace('</head>', '<link rel="icon" type="image/svg+xml" href="/icons/bolt.svg"></head>')
      page.source = page.source.replace(/<script>([\s\S]*?)<\/script>/g, (_tag, source: string) => {
        const file = this.emitFile({ type: 'asset', name: 'panel-bootstrap.js', source })
        return `<script src="/${this.getFileName(file)}"></script>`
      })
    },
  },
})
