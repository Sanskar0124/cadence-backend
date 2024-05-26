// Utils
const logger = require('../utils/winston');
const {
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../utils/response');
const { DB_TABLES } = require('../../../Cadence-Brain/src/utils/modelEnums');

// * Packages
const { Op } = require('sequelize');

// Repository
const Repository = require('../../../Cadence-Brain/src/repository');

// * Helpers
const UserHelper = require('../../../Cadence-Brain/src/helper/user');
const CryptoHelper = require('../../../Cadence-Brain/src/helper/crypto');

module.exports.supportAuth = async (req, res, next) => {
  try {
    if (req.headers.authorization === undefined)
      return unauthorizedResponseWithDevMsg({ res });

    const accessToken = req.headers.authorization.split(' ')[1];

    //  * Encrypt tokens
    const [encryptedAccessToken, errEncryptingAccessToken] =
      CryptoHelper.encrypt(accessToken);
    if (errEncryptingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid access token',
        error: `Error while encrypting access token: ${errEncryptingAccessToken}`,
      });

    // * Fetch token in db
    const [ringoverToken, errFetchingRingoverToken] = await Repository.fetchOne(
      {
        tableName: DB_TABLES.RINGOVER_TOKENS,
        query: {
          encrypted_access_token: encryptedAccessToken,
          expires_at: {
            [Op.gte]: new Date(),
          },
        },
        include: {
          [DB_TABLES.USER]: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'email',
              'role',
              'support_role',
            ],
          },
        },
        extras: {
          attributes: ['ringover_token_id', 'region', 'user_id'],
        },
      }
    );
    if (errFetchingRingoverToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid access token',
        error: errFetchingRingoverToken,
      });
    if (!ringoverToken) {
      UserHelper.deleteUserSession(accessToken);
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Session expired',
        error: 'Unable to find tokens',
      });
    }

    // * Assign user
    const user = ringoverToken?.User;

    if (!user)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Session expired',
        error: 'Unable to find user',
      });

    if (!user?.support_role)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Unauthorized',
        error: 'User does not have cadence support access',
      });

    req.user = {
      ...user,
      access_token: accessToken,
      region: ringoverToken.region,
    };
    next();
    return;
  } catch (err) {
    logger.error('Error while authenticating user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authenticating user: ${err.message}`,
    });
  }
};
