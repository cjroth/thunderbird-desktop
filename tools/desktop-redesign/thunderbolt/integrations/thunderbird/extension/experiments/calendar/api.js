/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon } = ChromeUtils.importESModule('resource://gre/modules/ExtensionCommon.sys.mjs')
var { cal } = ChromeUtils.importESModule('resource:///modules/calendar/calUtils.sys.mjs')

/** Thunderbird registers experiment classes by their namespace in this script's global scope. */
var thunderboltCalendar = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    const canAddItems = (calendar) =>
      cal.acl.isCalendarWritable(calendar) && cal.acl.userCanAddItemsToCalendar(calendar)
    const calendarById = (id, kind, forWriting = false) => {
      const calendar = cal.manager.getCalendarById(id)
      if (!calendar || calendar.getProperty('disabled')) throw new Error('Calendar is missing or disabled.')
      const capability = kind === 'event' ? 'capabilities.events.supported' : 'capabilities.tasks.supported'
      if (calendar.getProperty(capability) === false) throw new Error('Calendar does not support this item type.')
      if (forWriting && !canAddItems(calendar)) throw new Error('This calendar cannot accept new items.')
      return calendar
    }
    const nativeDate = (value) => {
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid calendar timestamp.')
      return cal.dtz.fromRFC3339(date.toISOString(), cal.dtz.UTC).getInTimezone(cal.dtz.defaultTimezone)
    }
    const range = (start, end) => {
      if (Date.parse(end) <= Date.parse(start)) throw new Error('Calendar range ends before or at its start.')
      return [nativeDate(start), nativeDate(end)]
    }
    return {
      thunderboltCalendar: {
        async listCalendars() {
          return cal.manager.getCalendars().map((calendar) => ({
            id: calendar.id,
            name: calendar.name,
            type: calendar.type,
            readOnly: calendar.readOnly,
            canAddItems: canAddItems(calendar),
            disabled: Boolean(calendar.getProperty('disabled')),
            events: calendar.getProperty('capabilities.events.supported') !== false,
            tasks: calendar.getProperty('capabilities.tasks.supported') !== false,
          }))
        },
        async listItems(id, kind, limit, start, end) {
          const calendar = calendarById(id, kind)
          const filters = Ci.calICalendar
          const filter =
            kind === 'event'
              ? filters.ITEM_FILTER_TYPE_EVENT | filters.ITEM_FILTER_CLASS_OCCURRENCES
              : filters.ITEM_FILTER_TYPE_TODO | filters.ITEM_FILTER_COMPLETED_ALL
          const [from, until] = start && end ? range(start, end) : [null, null]
          const items = await calendar.getItemsAsArray(filter, limit + 1, from, until)
          return {
            truncated: items.length > limit,
            items: items.slice(0, limit).map((item) => ({
              id: item.id,
              title: item.title,
              location: item.getProperty('LOCATION'),
              start: cal.dtz.toRFC3339(kind === 'event' ? item.startDate : item.entryDate) || null,
              end: cal.dtz.toRFC3339(kind === 'event' ? item.endDate : item.dueDate) || null,
              ...(kind === 'task' && { completed: item.isCompleted }),
            })),
          }
        },
        async draftEvent(tabId, id, title, start, end) {
          const calendar = calendarById(id, 'event', true)
          const [from, until] = range(start, end)
          context.extension.tabManager.get(tabId).window.createEventWithDialog(calendar, from, until, title)
        },
        async draftTask(tabId, id, title, due) {
          const calendar = calendarById(id, 'task', true)
          context.extension.tabManager
            .get(tabId)
            .window.createTodoWithDialog(calendar, due ? nativeDate(due) : null, title)
        },
      },
    }
  }
}
