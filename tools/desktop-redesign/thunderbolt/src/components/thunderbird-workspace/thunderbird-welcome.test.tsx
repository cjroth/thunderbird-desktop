/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, expect, mock, test } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import thunderboltLogo from '@/assets/logo.svg'
import { usePendingPromptStore } from '@/chats/pending-prompt-store'
import { ThunderbirdPrompts, ThunderbirdWelcome } from './thunderbird-welcome'

afterEach(() => usePendingPromptStore.setState({ promptsByThread: {} }))

test('greets the user with the original Thunderbolt artwork', () => {
  render(<ThunderbirdWelcome />)
  expect(screen.getByRole('img', { name: 'Thunderbolt' })).toHaveAttribute('src', thunderboltLogo)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
    /^(Up late\?|Good (morning|afternoon|evening))$/,
  )
})

test('a starter focuses this conversation’s composer and queues an editable prompt without submitting', () => {
  const submit = mock()
  render(
    <form className="tb-composer-column" onSubmit={submit}>
      <textarea aria-label="Draft" defaultValue="Please help" />
      <ThunderbirdPrompts threadId="current-tab" />
    </form>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
  expect(usePendingPromptStore.getState().promptsByThread).toEqual({
    'current-tab': 'Look at my calendar and tasks for today. What should I prepare for?',
  })
  expect(screen.getByRole('textbox')).toHaveFocus()
  expect(submit).not.toHaveBeenCalled()
})
