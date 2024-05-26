// * Utils
const logger = require('../utils/winston');
const {
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  paymentRequiredResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  forbiddenResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../utils/response');
const { DB_TABLES } = require('../../../Cadence-Brain/src/utils/modelEnums');
const {
  COMPANY_STATUS,
  USER_ROLE,
} = require('../../../Cadence-Brain/src/utils/enums');
const token = require('../controllers/v1/user/authentication/token');
const {
  REDIS_RINGOVER_ACCESS_TOKEN,
} = require('../../../Cadence-Brain/src/utils/constants');

// * Packages
const { Op } = require('sequelize');

// * Repository
const Repository = require('../../../Cadence-Brain/src/repository');

// * Packages
const { v4: uuidv4 } = require('uuid');

// * Helpers
const UserHelper = require('../../../Cadence-Brain/src/helper/user');
const CryptoHelper = require('../../../Cadence-Brain/src/helper/crypto');
const RedisHelper = require('../../../Cadence-Brain/src/helper/redis');

module.exports.auth = async (req, res, next) => {
  try {
    if (req.headers.authorization === undefined)
      return unauthorizedResponseWithDevMsg({ res });

    // * Generate correlation Id
    res.correlationId = uuidv4();

    const accessToken = req.headers.authorization.split(' ')[1];

    // * Encrypting tokens
    let [encryptedAccessToken, errEncryptingAccessToken] =
      CryptoHelper.encrypt(accessToken);
    if (errEncryptingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid access token',
        error: errEncryptingAccessToken,
      });

    // * Fetch token in Redis
    const [userFromRedis, errFetchingValueFromRedis] =
      await RedisHelper.getValue(
        `${REDIS_RINGOVER_ACCESS_TOKEN}${encryptedAccessToken}`
      );
    if (errFetchingValueFromRedis)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid access token',
        error: errFetchingValueFromRedis,
      });
    if (!userFromRedis)
      return unauthorizedResponseWithDevMsg({
        res,
        msg: `Session expired`,
      });

    let userId = userFromRedis.split(':')[0];
    let region = userFromRedis.split(':')[1];

    // * Fetch token in db
    const [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: userId,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'company_id',
            'integration_type',
            'is_subscription_active',
            'is_trial_active',
            'trial_valid_until',
            'integration_id',
            'status',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['mail_integration_type', 'email_scope_level'],
          },
        },
      },
      extras: {
        attributes: [
          'user_id',
          'first_name',
          'last_name',
          'role',
          'sd_id',
          'is_profile_picture_present',
          'email',
          'is_onboarding_complete',
          'product_tour_status',
        ],
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid access token',
        error: errFetchingRingoverToken,
      });
    if (!user) {
      UserHelper.deleteUserSession(accessToken);
      return unauthorizedResponseWithDevMsg({
        res,
        msg: `Your access has been revoked, Please contact your admin`,
        error: 'Unable to find tokens',
      });
    }

    /*
     * if user is not super admin, only then check for status of company. If company status is other than NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE then pass
     * then check for active subscription or is trail active
     * */
    if (
      (user?.role === USER_ROLE.SUPER_ADMIN ||
        user?.Company?.status !==
          COMPANY_STATUS.NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE) &&
      (user?.Company?.is_subscription_active ||
        (user?.Company?.is_trial_active &&
          new Date(user?.Company?.trial_valid_until) > new Date()))
    ) {
      req.user = {
        access_token: accessToken,
        region,
        user_id: user.user_id,
        email: user.email,
        company_id: user.Company.company_id,
        integration_type: user?.Company?.integration_type,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
        email_scope_level: user.Company.Company_Setting.email_scope_level,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        sd_id: user.sd_id,
        is_profile_picture_present: user.is_profile_picture_present,
        is_onboarding_complete: user.is_onboarding_complete,
        product_tour_status: user.product_tour_status,
      };
      next();
      return;
    }

    /*
     * first check for active subscription
     * then check for company status of NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE
     * then check for trail active and trial expired
     * */
    if (!user?.Company?.is_subscription_active)
      return paymentRequiredResponseWithDevMsg({
        res,
        data: {
          first_name: user.first_name,
          last_name: user.last_name,
          trial_valid_until: user?.Company?.trial_valid_until,
        },
      });
    else if (
      user?.Company?.status ===
      COMPANY_STATUS.NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE
    )
      return forbiddenResponseWithDevMsg({
        res,
        msg: 'Integration setup not complete after integration change',
      });
    else if (!user?.Company?.is_trial_active)
      return paymentRequiredResponseWithDevMsg({
        res,
        msg: 'Your trial period has ended',
        data: {
          first_name: user.first_name,
          last_name: user.last_name,
          trial_valid_until: user?.Company?.trial_valid_until,
        },
      });
    else if (is_trial_active && trial_valid_until < new Date())
      return paymentRequiredResponseWithDevMsg({
        res,
        msg: 'Your trial period has expired',
        data: {
          first_name: user.first_name,
          last_name: user.last_name,
          trial_valid_until: user?.Company?.trial_valid_until,
        },
      });
  } catch (err) {
    logger.error('Error while authenticating user: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authenticating user: ${err.message}`,
    });
  }
};
