# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Variables:
#   $m - the number M in "M of N" items
#   $n - the number N in "M of N" items
item-count-m-of-n = { $m } of { $n }

gloda-semantic-ranking = Ranking matches on this device…
gloda-semantic-ranked = Ranked by meaning on this device.
gloda-semantic-fallback = Showing keyword matches. Local ranking is unavailable.

# Variables:
#   $count - the number items
facets-mode-to-list-all-label = {
    $count ->
        [one] List all { $count }
        *[other] List all { $count }
    }

# Last item in a a list like A, B, C and "3 others".
# Variables:
#   $count - the number items
facet-view-and-others = {
    $count ->
        [one] { $count } other
        *[other] { $count } others
    }

## Global search results tab

search-results-title = Search results
search-edit =
    .aria-label = Edit search
    .title = Edit search
# Variables:
#   $count (Number) - Number of matching messages in the search result set.
search-results-count =
    { $count ->
        [one] { $count } message
       *[other] { $count } messages
    }
# Variables:
#   $shown (Number) - Number of matching messages currently displayed.
#   $count (Number) - Total number of matching messages in the result set.
search-result-range = Showing { $shown } of { $count } messages
search-filters = Filters
# Variables:
#   $count (Number) - Number of active filters.
search-filters-active = Filters ({ $count })
search-clear-filters = Clear filters
search-sort =
    .aria-label = Sort messages by
search-sort-relevance = Relevance
search-sort-date = Newest first
search-open-list = Open as list
    .title = Open these messages in a new message list tab
search-date-label = Date
search-date-range =
    .aria-label = Filter by date
search-date-any = Any date
search-date-custom = Custom range…
search-date-start = From
search-date-end = Through
search-date-apply = Apply
search-timeline = Timeline
search-date-zoom-out =
    .aria-label = Zoom out of the timeline
    .title = Zoom out of the timeline
search-attachment-type =
    .aria-label = Attachment type
search-loading = Searching…
search-empty = No matching messages
search-empty-hint = Try a different word or a sender’s name.
search-empty-filter-hint = Clear your filters to see the original matches.
search-show-more = Show more messages
# Variables:
#   $subject (String) - Subject of the message whose details can be expanded.
search-message-details =
    .aria-label = Message details for { $subject }
    .title = Message details
search-message-starred =
    .aria-label = Starred
search-message-attachments = Attachments
search-message-tags = Tags
search-message-unread = Unread
search-message-to = To
search-message-from = From
# A message sent by the current user is identified by its first recipient.
# Variables:
#   $recipient (String) - Name or address of the first recipient.
#   $others (Number) - Number of additional recipients.
search-message-correspondent = To { $recipient }
search-message-correspondents = To { $recipient } +{ $others }
# Variables:
#   $subject (String) - Subject of the message that has attachments.
search-message-attachment-details =
    .aria-label = Attachments and message details for { $subject }
    .title = Attachments and message details

# When the full-text index reaches its result limit, the total beyond that
# limit is unknown. Filtering and pagination operate on the returned matches.
# Variables:
#   $matches (Number) - Number of messages in the initial result set.
#   $count (Number) - Number of messages remaining after filtering.
#   $shown (Number) - Number of messages currently displayed on screen.
search-results-top =
    { $matches ->
        [one] Top match
       *[other] Top { $matches } matches
    }
search-results-filtered-top =
    { $matches ->
        [one] { $count } of { $matches } top match
       *[other] { $count } of the top { $matches } matches
    }
search-results-page-top = Showing { $shown } of the top { $matches } matches
search-results-page-filtered-top = Showing { $shown } of { $count } in the top { $matches } matches
search-timeline-graphic =
    .aria-label = Message frequency over time
search-timeline-counts = Messages by date
search-timeline-period = Period
search-timeline-messages = Messages
