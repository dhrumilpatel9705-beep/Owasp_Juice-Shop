/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  userId?: number
  visitorId?: string
  solvedChallenges?: Set<string>
  codingChallengeStatuses?: Map<string, number>
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>()
