/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans, useLingui } from '@lingui/react/macro'
import { History, Settings2, SquarePen } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useMatch } from 'react-router'
import { toCompilableQuery } from '@powersync/drizzle-driver'
import { useQuery } from '@powersync/tanstack-react-query'
import { useDatabase } from '@/contexts'
import { getAllChatThreads } from '@/dal'
import { ThunderbirdSettingsDialog } from '@/components/chat/thunderbird-settings-dialog'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useCreateNewChat } from '@/hooks/use-create-new-chat'
import Sidebar from '@/layout/sidebar'
import { chatTitleLabel } from '@/lib/title-generator'
import './thunderbird-workspace.css'

const historyMedia = () => window.matchMedia('(max-width: 720px)')
const subscribeToWidth = (notify: () => void) => {
  const media = historyMedia()
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
const isCompact = () => historyMedia().matches

const ProviderSettings = () => (
  <ThunderbirdSettingsDialog>
    <button className="tb-provider-button" type="button" data-testid="thunderbird-settings">
      <Settings2 aria-hidden="true" />
      <span>
        <Trans>Provider settings</Trans>
      </span>
    </button>
  </ThunderbirdSettingsDialog>
)

export const ThunderbirdWorkspace = ({ children }: { children: ReactNode }) => {
  const { i18n, t } = useLingui()
  const compact = useSyncExternalStore(subscribeToWidth, isCompact, () => false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const newChat = useCreateNewChat()
  const match = useMatch('/chats/:id')
  const id = match?.params.id
  const db = useDatabase()
  const { data: chats } = useQuery({ queryKey: ['chatThreads'], query: toCompilableQuery(getAllChatThreads(db)) })
  const title = chats?.find((chat) => chat.id === id)?.title
  const conversation = id && id !== 'new' ? chatTitleLabel(i18n, title ?? null) : t`New chat`
  const tabTitle = t`${conversation} — Thunderbolt`
  // The native tab strip reads the title of this extension document.
  useEffect(() => {
    document.title = tabTitle
  }, [tabTitle])
  const newButton = (
    <button className="tb-new-chat" type="button" data-testid="thunderbird-new-chat" onClick={() => newChat()}>
      <SquarePen aria-hidden="true" />
      <span>
        <Trans>New chat</Trans>
      </span>
    </button>
  )

  return (
    <div className="tb-workspace">
      {!compact && (
        <aside className="tb-navigation" aria-label={t`Chat navigation`}>
          <div className="tb-nav-wordmark">
            <span className="tb-bolt" aria-hidden="true" />
            Thunderbolt
          </div>
          {newButton}
          <nav className="tb-history" data-testid="thunderbird-history" aria-label={t`Chat history`}>
            <Sidebar />
          </nav>
          <ProviderSettings />
        </aside>
      )}
      <div className="tb-workspace-main">
        <header className="tb-conversation-bar">
          {compact && (
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
              <DialogTrigger asChild>
                <button
                  className="tb-icon-button"
                  data-testid="thunderbird-history"
                  aria-label={t`Chat history`}
                  title={t`Chat history`}
                >
                  <History />
                </button>
              </DialogTrigger>
              <DialogContent className="tb-history-dialog" aria-describedby={undefined}>
                <DialogTitle>
                  <Trans>Chat history</Trans>
                </DialogTitle>
                <Sidebar onThreadSelected={() => setHistoryOpen(false)} />
              </DialogContent>
            </Dialog>
          )}
          <div className="tb-conversation-title" title={conversation}>
            {conversation}
          </div>
          {compact && (
            <>
              {newButton}
              <ProviderSettings />
            </>
          )}
        </header>
        <div className="tb-chat-page">{children}</div>
      </div>
    </div>
  )
}
