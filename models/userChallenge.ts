/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import {
  Model,
  type InferAttributes,
  type InferCreationAttributes,
  DataTypes,
  type CreationOptional,
  type Sequelize
} from 'sequelize'

class UserChallenge extends Model<
  InferAttributes<UserChallenge>,
  InferCreationAttributes<UserChallenge>
> {
  declare id: CreationOptional<number>
  declare UserId: number | null
  declare visitorId: string | null
  declare challengeKey: string
  declare solved: CreationOptional<boolean>
  declare codingChallengeStatus: CreationOptional<number>
}

const UserChallengeModelInit = (sequelize: Sequelize) => {
  UserChallenge.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      visitorId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      challengeKey: {
        type: DataTypes.STRING,
        allowNull: false
      },
      solved: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      codingChallengeStatus: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      }
    },
    {
      tableName: 'UserChallenges',
      sequelize
    }
  )
}

export { UserChallenge as UserChallengeModel, UserChallengeModelInit }
