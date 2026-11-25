/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans, useLingui } from '@lingui/react/macro'
import { useActionState, useId } from 'react'
import { useChatStore } from '@/chats/chat-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDatabase } from '@/contexts'
import { updateModel } from '@/dal/models'
import { thunderbirdModel } from '@/providers/thunderbird-model'

/** Distinguish a missing key from the period before PowerSync loads the model on startup. */
export const useThunderbirdHasKey = () =>
  useChatStore((state) => {
    const model = state.models.find((model) => model.id === thunderbirdModel.id)
    return model ? Boolean(model.apiKey) : undefined
  })

/** The saved credential is never filled back into an input, including when it is being replaced. */
export const ThunderbirdKeyForm = ({ hasKey, onSaved }: { hasKey: boolean; onSaved?: () => void }) => {
  const db = useDatabase()
  const { t } = useLingui()
  const inputId = useId()
  const [error, submit, pending] = useActionState(async (_previous: string | null, form: FormData) => {
    const clear = form.get('operation') === 'clear'
    const key = String(form.get('key') ?? '').trim()
    if (!clear && !key) {
      return t`Enter your API key`
    }
    try {
      await updateModel(db, thunderbirdModel.id, { apiKey: clear ? null : key })
    } catch {
      return t`Failed to save the model.`
    }
    onSaved?.()
    return null
  }, null)

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className="w-full text-sm font-medium">
        <Trans>Tinfoil API key</Trans>
      </label>
      <Input
        id={inputId}
        type="password"
        name="key"
        required
        autoComplete="off"
        placeholder={hasKey ? t`Enter a replacement API key` : t`Enter your API key`}
        className="min-w-32 flex-1"
      />
      <Button type="submit" size="sm" disabled={pending}>
        <Trans>Save</Trans>
      </Button>
      {hasKey && (
        <Button
          type="submit"
          name="operation"
          value="clear"
          formNoValidate
          variant="ghost"
          size="sm"
          disabled={pending}
        >
          <Trans>Clear saved API key</Trans>
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
