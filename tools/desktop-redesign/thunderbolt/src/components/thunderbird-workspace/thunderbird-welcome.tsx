/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans, useLingui } from '@lingui/react/macro'
import { ArrowUpRight, CalendarDays, Inbox, PenLine } from 'lucide-react'
import thunderboltLogo from '@/assets/logo.svg'
import { getGreeting } from '@/components/chat/chat-ui-greeting'
import { setPendingPrompt } from '@/chats/pending-prompt-store'

export const ThunderbirdWelcome = () => {
  const { i18n } = useLingui()
  return (
    <div className="tb-welcome">
      <img
        className="tb-welcome-mark"
        src={thunderboltLogo}
        width={72}
        height={72}
        alt="Thunderbolt"
        draggable={false}
      />
      <h1>{i18n._(getGreeting())}</h1>
      <p>
        <Trans>Work with your mail, calendar, and contacts in Thunderbird.</Trans>
      </p>
    </div>
  )
}

export const ThunderbirdPrompts = ({ threadId }: { threadId: string }) => {
  const { t } = useLingui()
  const actions = [
    {
      key: 'mail',
      icon: Inbox,
      label: t`Catch up on mail`,
      prompt: t`Summarize the unread messages in my inbox and highlight anything that needs a reply.`,
    },
    {
      key: 'calendar',
      icon: CalendarDays,
      label: t`Plan my day`,
      prompt: t`Look at my calendar and tasks for today. What should I prepare for?`,
    },
    {
      key: 'draft',
      icon: PenLine,
      label: t`Draft a reply`,
      prompt: t`Help me draft a reply to an email. Ask me which message to use.`,
    },
  ]
  return (
    <div className="tb-prompts" role="group" aria-label={t`Suggested prompts`}>
      {actions.map(({ key, icon: Icon, label, prompt }) => (
        <button
          type="button"
          key={key}
          data-thunderbird-prompt={key}
          onClick={(event) => {
            setPendingPrompt(threadId, prompt)
            event.currentTarget.closest('.tb-composer-column')?.querySelector('textarea')?.focus()
          }}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <ArrowUpRight aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
