/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import * as challengeUtils from '../lib/challengeUtils'
import { requestContextStore } from '../lib/requestContext'
import { type Request, type Response } from 'express'

export function repeatNotification() {
  return ({ query }: Request, res: Response) => {
    const challengeName: string = decodeURIComponent(query.challenge as string)
    const challenge = challengeUtils.findChallengeByName(challengeName)
    const context = requestContextStore.getStore()
    const isSolved = context?.solvedChallenges
      ? context.solvedChallenges.has(challenge?.key ?? '')
      : (challenge?.solved ?? false)

    if (challenge && isSolved) {
      challengeUtils.sendNotification(challenge, true)
    }

    res.sendStatus(200)
  }
}
