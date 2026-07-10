import config from 'config'
import { Op } from 'sequelize'
import colors from 'colors/safe'
import { type Server } from 'socket.io'
import sanitizeHtml from 'sanitize-html'
import { AllHtmlEntities as Entities } from 'html-entities'

import { type ChallengeKey, ChallengeModel } from '../models/challenge'
import { UserChallengeModel } from '../models/userChallenge'
import { requestContextStore } from './requestContext'
import { challenges, notifications } from '../data/datacache'
import { HintModel } from '../models/hint'
import * as accuracy from './accuracy'
import * as webhook from './webhook'
import * as antiCheat from './antiCheat'
import * as utils from './utils'
import logger from './logger'

const entities = new Entities()

const globalWithSocketIO = global as typeof globalThis & {
  io: Server
}

export const activeNotifications = new Map<string, any[]>()

export const getUserKey = (userId?: number, visitorId?: string) => {
  if (userId) return `user:${userId}`
  if (visitorId) return `visitor:${visitorId}`
  return 'global'
}

export const mergeProgress = async (visitorId: string | undefined, userId: number) => {
  if (!visitorId) return

  const visitorChallenges = await UserChallengeModel.findAll({
    where: { visitorId }
  })

  for (const vc of visitorChallenges) {
    const existing = await UserChallengeModel.findOne({
      where: { UserId: userId, challengeKey: vc.challengeKey }
    })

    if (existing) {
      existing.solved = existing.solved || vc.solved
      existing.codingChallengeStatus = Math.max(existing.codingChallengeStatus, vc.codingChallengeStatus)
      await existing.save()
    } else {
      await UserChallengeModel.create({
        UserId: userId,
        challengeKey: vc.challengeKey,
        solved: vc.solved,
        codingChallengeStatus: vc.codingChallengeStatus
      })
    }
  }

  await UserChallengeModel.destroy({
    where: { visitorId }
  })

  // Merge active notifications too
  const visitorKey = `visitor:${visitorId}`
  const userKey = `user:${userId}`
  const visitorNotifs = activeNotifications.get(visitorKey)
  if (visitorNotifs) {
    const userNotifs = activeNotifications.get(userKey) || []
    visitorNotifs.forEach(vn => {
      if (!userNotifs.some(un => un.key === vn.key)) {
        userNotifs.push(vn)
      }
    })
    activeNotifications.set(userKey, userNotifs)
    activeNotifications.delete(visitorKey)
  }
}

export const solveIf = function (challenge: any, criteria: () => any, isRestore: boolean = false, isCheating = false) {
  if (notSolved(challenge) && criteria()) {
    solve(challenge, isRestore, isCheating)
  }
}

export const solve = async function (challenge: ChallengeModel, isRestore = false, isCheating = false) {
  const context = requestContextStore.getStore()
  const userId = context?.userId
  const visitorId = context?.visitorId

  if (context?.solvedChallenges) {
    context.solvedChallenges.add(challenge.key)
  }

  if (userId || visitorId) {
    const whereClause: any = userId ? { UserId: userId } : { visitorId }
    whereClause.challengeKey = challenge.key
    await UserChallengeModel.upsert({
      ...whereClause,
      solved: true
    })
  }

  if (!context) {
    challenge.solved = true
    await challenge.save()
  }

  logger.info(`${isRestore ? colors.grey('Restored') : colors.green('Solved')} ${challenge.difficulty}-star ${colors.cyan(challenge.key)} (${challenge.name})`)
  sendNotification(challenge, isRestore)
  if (!isRestore) {
    const cheatScore = antiCheat.calculateCheatScore(challenge, isCheating)
    const hintsAvailable = await HintModel.count({ where: { ChallengeId: challenge.id } })
    const hintsUnlocked = await HintModel.count({ where: { ChallengeId: challenge.id, unlocked: true } })
    if (process.env.SOLUTIONS_WEBHOOK) {
      webhook.notify(challenge, cheatScore, hintsAvailable, hintsUnlocked).catch((error: unknown) => {
        logger.error('Webhook notification failed: ' + colors.red(utils.getErrorMessage(error)))
      })
    }
  }
}

export const sendNotification = function (challenge: ChallengeModel, isRestore: boolean) {
  if (notSolved(challenge)) {
    return
  }

  const flag = utils.ctfFlag(challenge.name)

  const challengeKey = challenge.key as ChallengeKey
  const fullChallenge = challenges[challengeKey]

  let hasCodingChallenge = false
  if (fullChallenge) {
    hasCodingChallenge = Boolean(fullChallenge.hasCodingChallenge) ?? false
  }

  const notification = {
    key: challenge.key,
    name: challenge.name,
    challenge: challenge.name + ' (' + entities.decode(sanitizeHtml(challenge.description, { allowedTags: [], allowedAttributes: {} })) + ')',
    flag,
    hidden: !config.get('challenges.showSolvedNotifications'),
    isRestore,
    codingChallenge: config.get('challenges.codingChallengesEnabled') !== 'never' && hasCodingChallenge
  }

  const context = requestContextStore.getStore()
  const userId = context?.userId
  const visitorId = context?.visitorId
  const userKey = getUserKey(userId, visitorId)

  const userNotifications = activeNotifications.get(userKey) || []
  const wasPreviouslyShown = userNotifications.some(({ key }) => key === challenge.key)
  if (!wasPreviouslyShown) {
    userNotifications.push(notification)
    activeNotifications.set(userKey, userNotifications)
  }

  if (globalWithSocketIO.io && (isRestore || !wasPreviouslyShown)) {
    const sockets = Array.from(globalWithSocketIO.io.sockets.sockets.values()) as any[]
    const targetSockets = sockets.filter((s) => {
      if (userId && s.userId === userId) return true
      if (visitorId && s.visitorId === visitorId) return true
      return false
    })

    if (targetSockets.length > 0) {
      targetSockets.forEach((s) => {
        s.emit('challenge solved', notification)
      })
    } else {
      globalWithSocketIO.io.emit('challenge solved', notification)
    }
  }
}

export const sendCodingChallengeNotification = function (challenge: { key: string, codingChallengeStatus: 0 | 1 | 2 }) {
  if (challenge.codingChallengeStatus > 0) {
    const notification = {
      key: challenge.key,
      codingChallengeStatus: challenge.codingChallengeStatus
    }
    const context = requestContextStore.getStore()
    const userId = context?.userId
    const visitorId = context?.visitorId

    if (globalWithSocketIO.io) {
      const sockets = Array.from(globalWithSocketIO.io.sockets.sockets.values()) as any[]
      const targetSockets = sockets.filter((s) => {
        if (userId && s.userId === userId) return true
        if (visitorId && s.visitorId === visitorId) return true
        return false
      })

      if (targetSockets.length > 0) {
        targetSockets.forEach((s) => {
          s.emit('code challenge solved', notification)
        })
      } else {
        globalWithSocketIO.io.emit('code challenge solved', notification)
      }
    }
  }
}

export const notSolved = (challenge: ChallengeModel) => {
  if (!challenge) return false
  const context = requestContextStore.getStore()
  if (context?.solvedChallenges) {
    return !context.solvedChallenges.has(challenge.key)
  }
  return !challenge.solved
}

export const findChallengeByName = (challengeName: string) => {
  for (const challenge of Object.values(challenges)) {
    if (challenge.name === challengeName) {
      return challenge
    }
  }
  logger.warn('Missing challenge with name: ' + challengeName)
}

export const findChallengeById = (challengeId: number) => {
  for (const challenge of Object.values(challenges)) {
    if (challenge.id === challengeId) {
      return challenge
    }
  }
  logger.warn('Missing challenge with id: ' + challengeId)
}

export const solveFindIt = async function (key: ChallengeKey, isRestore: boolean = false) {
  const solvedChallenge = challenges[key]
  const context = requestContextStore.getStore()
  const userId = context?.userId
  const visitorId = context?.visitorId

  if (context?.codingChallengeStatuses) {
    context.codingChallengeStatuses.set(key, 1)
  }

  if (userId || visitorId) {
    const whereClause: any = userId ? { UserId: userId } : { visitorId }
    whereClause.challengeKey = key
    await UserChallengeModel.upsert({
      ...whereClause,
      codingChallengeStatus: 1
    })
  }

  if (!context) {
    await ChallengeModel.update({ codingChallengeStatus: 1 }, { where: { key, codingChallengeStatus: { [Op.lt]: 2 } } })
  }

  logger.info(`${isRestore ? colors.grey('Restored') : colors.green('Solved')} 'Find It' phase of coding challenge ${colors.cyan(solvedChallenge.key)} (${solvedChallenge.name})`)
  if (!isRestore) {
    accuracy.storeFindItVerdict(solvedChallenge.key, true)
    accuracy.calculateFindItAccuracy(solvedChallenge.key)
    await antiCheat.calculateFindItCheatScore(solvedChallenge)
    sendCodingChallengeNotification({ key, codingChallengeStatus: 1 })
  }
}

export const solveFixIt = async function (key: ChallengeKey, isRestore: boolean = false) {
  const solvedChallenge = challenges[key]
  const context = requestContextStore.getStore()
  const userId = context?.userId
  const visitorId = context?.visitorId

  if (context?.codingChallengeStatuses) {
    context.codingChallengeStatuses.set(key, 2)
  }

  if (userId || visitorId) {
    const whereClause: any = userId ? { UserId: userId } : { visitorId }
    whereClause.challengeKey = key
    await UserChallengeModel.upsert({
      ...whereClause,
      codingChallengeStatus: 2
    })
  }

  if (!context) {
    await ChallengeModel.update({ codingChallengeStatus: 2 }, { where: { key } })
  }

  logger.info(`${isRestore ? colors.grey('Restored') : colors.green('Solved')} 'Fix It' phase of coding challenge ${colors.cyan(solvedChallenge.key)} (${solvedChallenge.name})`)
  if (!isRestore) {
    accuracy.storeFixItVerdict(solvedChallenge.key, true)
    accuracy.calculateFixItAccuracy(solvedChallenge.key)
    await antiCheat.calculateFixItCheatScore(solvedChallenge)
    sendCodingChallengeNotification({ key, codingChallengeStatus: 2 })
  }
}
