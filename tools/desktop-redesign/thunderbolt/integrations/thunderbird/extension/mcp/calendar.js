/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod/v4'

const calendarId = z.string().min(1).describe('Calendar ID returned by list_calendars')
const instant = z.iso.datetime({ offset: true }).describe('Timestamp with an explicit timezone offset')
const limit = z.number().int().min(1).max(100).default(50)

/** Calendar records use native Thunderbird providers, including expanded event occurrences and tasks. */
export const registerCalendarTools = (register, calendar, tabId) => {
  register('list_calendars', 'List Thunderbird calendars and whether they support events or tasks.', {}, () =>
    calendar.listCalendars(),
  )

  register(
    'list_events',
    'List event occurrences in one calendar over a time range. Narrow the range if truncated.',
    {
      calendarId,
      start: instant,
      end: instant,
      limit,
    },
    ({ calendarId, start, end, limit }) => calendar.listItems(calendarId, 'event', limit, start, end),
  )

  register(
    'list_tasks',
    'List tasks in a calendar, including undated tasks when no time range is given.',
    {
      calendarId,
      start: instant.optional(),
      end: instant.optional(),
      limit,
    },
    ({ calendarId, start, end, limit }) => {
      if (!start && !end) return calendar.listItems(calendarId, 'task', limit)
      if (!start || !end) throw new Error('Supply both start and end for a task time range.')
      return calendar.listItems(calendarId, 'task', limit, start, end)
    },
  )

  register(
    'draft_event',
    'Open the native event editor with a proposed event. The user saves the event in Thunderbird.',
    {
      calendarId,
      title: z.string().min(1),
      start: instant,
      end: instant,
    },
    async ({ calendarId, title, start, end }) => {
      await calendar.draftEvent(tabId, calendarId, title, start, end)
      return { status: 'opened_for_review' }
    },
    false,
  )

  register(
    'draft_task',
    'Open the Thunderbird task editor. The user saves the task in Thunderbird.',
    {
      calendarId,
      title: z.string().min(1),
      due: instant.optional(),
    },
    async ({ calendarId, title, due }) => {
      if (due) await calendar.draftTask(tabId, calendarId, title, due)
      else await calendar.draftTask(tabId, calendarId, title)
      return { status: 'opened_for_review' }
    },
    false,
  )
}
