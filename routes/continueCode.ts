/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import Hashids from 'hashids/cjs'
import { type Request, type Response } from 'express'
import { ChallengeModel } from '../models/challenge'
import { UserChallengeModel } from '../models/userChallenge'
import { requestContextStore } from '../lib/requestContext'
import { challenges } from '../data/datacache'
import { Op } from 'sequelize'

export function continueCode() {
  const hashids = new Hashids('this is my salt', 60, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
  return async (req: Request, res: Response) => {
    const context = requestContextStore.getStore()
    const userId = context?.userId
    const visitorId = context?.visitorId
    const ids = []

    if (userId || visitorId) {
      const whereClause: any = userId ? { UserId: userId, solved: true } : { visitorId, solved: true }
      const userChallenges = await UserChallengeModel.findAll({ where: whereClause })
      const solvedKeys = new Set(userChallenges.map((uc) => uc.challengeKey))
      for (const challenge of Object.values(challenges)) {
        if (solvedKeys.has(challenge.key)) ids.push(challenge.id)
      }
    } else {
      for (const challenge of Object.values(challenges)) {
        if (challenge.solved) ids.push(challenge.id)
      }
    }

    const continueCode = ids.length > 0 ? hashids.encode(ids) : undefined
    res.json({ continueCode })
  }
}

export function continueCodeFindIt() {
  const hashids = new Hashids('this is the salt for findIt challenges', 60, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
  return async (req: Request, res: Response) => {
    const context = requestContextStore.getStore()
    const userId = context?.userId
    const visitorId = context?.visitorId
    const ids = []

    if (userId || visitorId) {
      const whereClause: any = userId
        ? { UserId: userId, codingChallengeStatus: { [Op.gte]: 1 } }
        : { visitorId, codingChallengeStatus: { [Op.gte]: 1 } }
      const userChallenges = await UserChallengeModel.findAll({ where: whereClause })
      const findItKeys = new Set(userChallenges.map((uc) => uc.challengeKey))
      for (const challenge of Object.values(challenges)) {
        if (findItKeys.has(challenge.key)) ids.push(challenge.id)
      }
    } else {
      const dbChallenges = await ChallengeModel.findAll({ where: { codingChallengeStatus: { [Op.gte]: 1 } } })
      for (const challenge of dbChallenges) {
        ids.push(challenge.id)
      }
    }

    const continueCode = ids.length > 0 ? hashids.encode(ids) : undefined
    res.json({ continueCode })
  }
}

export function continueCodeFixIt() {
  const hashids = new Hashids('yet another salt for the fixIt challenges', 60, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
  return async (req: Request, res: Response) => {
    const context = requestContextStore.getStore()
    const userId = context?.userId
    const visitorId = context?.visitorId
    const ids = []

    if (userId || visitorId) {
      const whereClause: any = userId
        ? { UserId: userId, codingChallengeStatus: { [Op.gte]: 2 } }
        : { visitorId, codingChallengeStatus: { [Op.gte]: 2 } }
      const userChallenges = await UserChallengeModel.findAll({ where: whereClause })
      const fixItKeys = new Set(userChallenges.map((uc) => uc.challengeKey))
      for (const challenge of Object.values(challenges)) {
        if (fixItKeys.has(challenge.key)) ids.push(challenge.id)
      }
    } else {
      const dbChallenges = await ChallengeModel.findAll({ where: { codingChallengeStatus: { [Op.gte]: 2 } } })
      for (const challenge of dbChallenges) {
        ids.push(challenge.id)
      }
    }

    const continueCode = ids.length > 0 ? hashids.encode(ids) : undefined
    res.json({ continueCode })
  }
}
