/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import config from 'config'
import * as utils from '../utils'
import { Server } from 'socket.io'
import { challenges } from '../../data/datacache'
import * as challengeUtils from '../challengeUtils'
import * as security from '../insecurity'
import { requestContextStore } from '../requestContext'
import { UserChallengeModel } from '../../models/userChallenge'
import jwt from 'jsonwebtoken'

let firstConnectedSocket: any = null

const globalWithSocketIO = global as typeof globalThis & {
  io: Server
}

const parseCookies = (cookieString: string) => {
  const cookies: Record<string, string> = {}
  if (!cookieString) return cookies
  cookieString.split(';').forEach((cookie) => {
    const parts = cookie.split('=')
    cookies[parts[0].trim()] = (parts[1] || '').trim()
  })
  return cookies
}

const registerWebsocketEvents = (server: any) => {
  const io = new Server(server, { cors: { origin: 'http://localhost:4200' } })
  globalWithSocketIO.io = io

  io.on('connection', (socket: any) => {
    if (firstConnectedSocket === null) {
      socket.emit('server started')
      firstConnectedSocket = socket.id
    }

    const cookies = parseCookies(socket.handshake.headers.cookie)
    const token = cookies.token
    const visitorId = cookies.visitorId

    let userId: number | undefined
    if (token) {
      try {
        jwt.verify(token, security.publicKey, (err: any, decoded: any) => {
          if (!err && decoded?.data) {
            userId = decoded.data.id
          }
        })
      } catch (err) {
        // Ignore JWT verification errors
      }
    }

    socket.userId = userId
    socket.visitorId = visitorId

    const userKey = challengeUtils.getUserKey(userId, visitorId)
    const userNotifications = challengeUtils.activeNotifications.get(userKey) || []
    userNotifications.forEach((notification: any) => {
      socket.emit('challenge solved', notification)
    })

    socket.on('notification received', (data: any) => {
      const userNotifications = challengeUtils.activeNotifications.get(userKey) || []
      const i = userNotifications.findIndex(({ flag }: any) => flag === data)
      if (i > -1) {
        userNotifications.splice(i, 1)
        challengeUtils.activeNotifications.set(userKey, userNotifications)
      }
    })

    const runInSocketContext = async (handler: () => void | Promise<void>) => {
      const solvedChallenges = new Set<string>()
      const codingChallengeStatuses = new Map<string, number>()
      if (socket.userId || socket.visitorId) {
        const whereClause: any = socket.userId ? { UserId: socket.userId } : { visitorId: socket.visitorId }
        const userSolved = await UserChallengeModel.findAll({ where: whereClause })
        userSolved.forEach((uc) => {
          if (uc.solved) {
            solvedChallenges.add(uc.challengeKey)
          }
          codingChallengeStatuses.set(uc.challengeKey, uc.codingChallengeStatus)
        })
      }

      await requestContextStore.run({ userId: socket.userId, visitorId: socket.visitorId, solvedChallenges, codingChallengeStatuses }, async () => {
        await handler()
      })
    }

    socket.on('verifyLocalXssChallenge', (data: any) => {
      void runInSocketContext(() => {
        challengeUtils.solveIf(challenges.localXssChallenge, () => { return utils.contains(data, '<iframe src="javascript:alert(`xss`)">') })
        challengeUtils.solveIf(challenges.xssBonusChallenge, () => { return utils.contains(data, config.get('challenges.xssBonusPayload')) })
      })
    })

    socket.on('verifySvgInjectionChallenge', (data: any) => {
      void runInSocketContext(() => {
        challengeUtils.solveIf(challenges.svgInjectionChallenge, () => { return data?.match(/.*\.\.\/\.\.\/\.\.[\w/-]*?\/redirect\?to=https?:\/\/cataas.com\/cat.*/) && security.isRedirectAllowed(data) })
      })
    })

    socket.on('verifyCloseNotificationsChallenge', (data: any) => {
      void runInSocketContext(() => {
        challengeUtils.solveIf(challenges.closeNotificationsChallenge, () => { return Array.isArray(data) && data.length > 1 })
      })
    })
  })
}

export default registerWebsocketEvents
