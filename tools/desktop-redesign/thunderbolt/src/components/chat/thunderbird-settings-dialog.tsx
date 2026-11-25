/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans } from '@lingui/react/macro'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ThunderbirdKeyForm, useThunderbirdHasKey } from './thunderbird-api-key'

/** Keep profile credential management available throughout the panel without leaving the current chat. */
export const ThunderbirdSettingsDialog = ({ children }: { children: ReactElement }) => {
  const [open, setOpen] = useState(false)
  const hasKey = useThunderbirdHasKey()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="tb-provider-dialog">
        <DialogHeader>
          <DialogTitle>
            <Trans>Provider settings</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Your key is saved in this Thunderbird profile.</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="tb-provider-model">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>Tinfoil</strong>
            <span>DeepSeek V4.1 Flash</span>
          </div>
        </div>
        {hasKey === undefined ? (
          <p role="status">
            <Trans>Loading…</Trans>
          </p>
        ) : (
          <ThunderbirdKeyForm hasKey={hasKey} onSaved={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Open credential setup without taking the user away from the draft. */
export const ThunderbirdKeySetup = () => {
  const hasKey = useThunderbirdHasKey()
  if (hasKey !== false) {
    return null
  }
  return (
    <div className="tb-connect-note">
      <KeyRound aria-hidden="true" />
      <span>
        <Trans>Add a Tinfoil API key to send messages.</Trans>
      </span>
      <ThunderbirdSettingsDialog>
        <button type="button" data-testid="thunderbird-key-setup">
          <Trans>Connect Tinfoil</Trans>
          <ArrowRight aria-hidden="true" />
        </button>
      </ThunderbirdSettingsDialog>
    </div>
  )
}
