/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { installThunderbirdMcp } from './mcp/server.js'

installThunderbirdMcp(messenger, 'index.html')

void messenger.spaces.create('thunderbolt', 'index.html#/chats/new', {
  title: messenger.runtime.getManifest().name,
  defaultIcons: 'icons/bolt.svg',
})
