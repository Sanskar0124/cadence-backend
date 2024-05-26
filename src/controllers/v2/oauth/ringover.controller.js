// * Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  unauthorizedResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  forbiddenResponseWithDevMsg,
  paymentRequiredResponseWithDevMsg,
} = require('../../../utils/response');
const {
  RINGOVER_OAUTH,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  COMPANY_REGION,
  CRM_INTEGRATIONS,
  COMPANY_STATUS,
  USER_ROLE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  REDIS_RINGOVER_ACCESS_TOKEN,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// * Packages
const axios = require('axios');
var FormData = require('form-data');
const { Op } = require('sequelize');

// * DB
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// * Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// * Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const RingoverHelper = require('../../../../../Cadence-Brain/src/helper/ringover-service');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');

// * Get redirect URL
const redirectToRingover = async (req, res) => {
  try {
    let URI = `https://auth.ringover.com/oauth2/authorize?response_type=code&client_id=${RINGOVER_OAUTH.RINGOVER_CLIENT_ID_EU}&redirect_uri=${RINGOVER_OAUTH.REDIRECT_URL}&scope=cadence.all&code_challenge=${RINGOVER_OAUTH.CODE_CHALLENGE}&code_challenge_method=S256`;
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to ringover auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to ringover auth: ${err.message}`,
    });
  }
};

// * Authorize code
const authorizeRingover = async (req, res) => {
  try {
    const { code } = req.query;

    if (code === null || code === '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Ringover',
        error: 'Code not valid',
      });

    let requestBody = new FormData();
    requestBody.append('code', code);
    requestBody.append('grant_type', 'authorization_code');
    requestBody.append('client_id', RINGOVER_OAUTH.RINGOVER_CLIENT_ID_EU);
    requestBody.append('redirect_uri', RINGOVER_OAUTH.REDIRECT_URL);
    requestBody.append('code_verifier', RINGOVER_OAUTH.CODE_VERIFIER);

    // * Fetch access tokens
    const { data: ringover_tokens } = await axios.post(
      'https://auth.ringover.com/oauth2/access_token',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...requestBody.getHeaders(),
        },
      }
    );

    requestBody = new FormData();
    requestBody.append('token', ringover_tokens.id_token);

    const { data: inspectedToken } = await axios.post(
      'https://auth.ringover.com/oauth2/introspect',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...requestBody.getHeaders(),
        },
      }
    );

    let { region, user_id: ringover_user_id, team_id } = inspectedToken;

    console.log('Values fetched from token ===> ');
    console.log('Region : ' + region);
    console.log('ringover_user_id : ' + ringover_user_id);
    console.log('team_id : ' + team_id);

    // * Encrypting tokens
    const [accessToken, errAccessToken] = CryptoHelper.encrypt(
      ringover_tokens.id_token
    );
    if (errAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login with Ringover',
        error: `Error while encrypting access token: ${errAccessToken}`,
      });
    const [refreshToken, errRefreshToken] = CryptoHelper.encrypt(
      ringover_tokens.refresh_token
    );
    if (errRefreshToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login with Ringover',
        error: `Error while encrypting refresh token: ${errRefreshToken}`,
      });

    // * Fetch user from database
    const [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        ringover_user_id,
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'is_subscription_active',
            'is_trial_active',
            'trial_valid_until',
            'integration_type',
            'integration_id',
            'name',
            'ringover_team_id',
            'status',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: [
              'phone_system',
              'mail_integration_type',
              'email_scope_level',
            ],
          },
          [DB_TABLES.COMPANY_HISTORY]: {
            required: false,
            where: {
              created_at: {
                [Op.gt]: sequelize.col(`User.last_login_at`),
              },
            },
            attributes: [
              'change_type',
              'change_option',
              'previous_value',
              'new_value',
              'created_at',
            ],
          },
        },
      },
      extras: {
        // group by COMPANY_HISTORY.change_type as you want only 1 record per change type
        group: ['change_type'],
        attributes: [
          'user_id',
          'company_id',
          'first_name',
          'last_name',
          'role',
          'email',
          'primary_email',
          'primary_phone_number',
          'timezone',
          'profile_picture',
          'is_call_iframe_fixed',
          'language',
          'created_at',
          'is_onboarding_complete',
          'product_tour_status',
          'product_tour_step',
          'is_onboarding_complete',
          'last_login_at',
        ],
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to login right now. Please try again later',
        error: errFetchingUser,
      });
    if (!user) {
      // * Fetch user from Ringover
      let [ringoverUser, _] = await RingoverHelper.getUser({
        access_token: ringover_tokens.id_token,
        region,
      });
      if (ringoverUser)
        return badRequestResponseWithDevMsg({
          res,
          msg: `We could not find an account associated with ${ringoverUser.email}. Please contact support`,
        });

      return badRequestResponseWithDevMsg({
        res,
        msg: "We couldn't find your Cadence account associated with Ringover user ID. Please contact support",
      });
    }

    // * Calculate expires_in
    let expires_at = new Date();
    const milliseconds = ringover_tokens.expires_in * 1000;
    expires_at = new Date(expires_at.getTime() + milliseconds);

    // * Create token
    let [ringoverTokens, errCreatingRingoverTokens] = await Repository.create({
      tableName: DB_TABLES.RINGOVER_TOKENS,
      createObject: {
        encrypted_access_token: accessToken,
        encrypted_refresh_token: refreshToken,
        region,
        user_id: user.user_id,
        expires_at,
      },
    });
    if (errCreatingRingoverTokens)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to login to Cadence. Contact support',
        error: errCreatingRingoverTokens,
      });

    // * Store Ringover Token in Redis
    const [_, redisError] = await RedisHelper.setWithExpiry(
      `${REDIS_RINGOVER_ACCESS_TOKEN}${accessToken}`,
      `${user.user_id}:${region}`,
      3600
    );
    if (redisError)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to login to Cadence. Contact support',
        error: redisError,
      });

    if (
      user?.Company?.is_subscription_active ||
      (user?.Company?.is_trial_active &&
        new Date(user?.Company?.trial_valid_until) > new Date())
    ) {
      let tokens;
      switch (user.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          tokens = DB_TABLES.SALESFORCE_TOKENS;
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        case CRM_INTEGRATIONS.SELLSY:
          tokens = DB_TABLES.SELLSY_TOKENS;
          break;
        case CRM_INTEGRATIONS.DYNAMICS:
          tokens = DB_TABLES.DYNAMICS_TOKENS;
          break;
      }

      const [instanceUrl, errForInstanceUrl] = await Repository.fetchOne({
        tableName: tokens,
        query: { user_id: user.user_id },
        extras: {
          attributes: ['encrypted_instance_url', 'instance_url'],
        },
      });
      const [numbers, errFetchingNumbers] = await RingoverHelper.getNumbers({
        access_token: ringover_tokens.id_token,
        region,
      });
      if (errFetchingNumbers)
        logger.error(`Error while fetching numbers: ${errFetchingNumbers}`);

      // Check if the primary number the user has and the number that is returned from Ringover are the same or not
      const setPrimaryNumber = numbers?.list.some(
        (number) => number?.format?.e164 === user.primary_phone_number
      );

      if (!setPrimaryNumber && numbers?.list?.length) {
        user.primary_phone_number =
          numbers?.list.find((number) => number.is_sms === true)?.format
            ?.e164 || numbers?.list[0]?.format?.e164;

        const [updateUser, errUpdatingUser] = await Repository.update({
          tableName: DB_TABLES.USER,
          query: { user_id: user.user_id },
          updateObject: { primary_phone_number: user.primary_phone_number },
        });
        if (errUpdatingUser)
          logger.error(
            `Unable to set primary phone number for user: ${user.user_id}`
          );
      }

      // if company status is NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE, then for all users other than super admin they should not be able to login, unless super admin completes configuration after integration change
      if (
        user?.Company?.status ===
          COMPANY_STATUS.NOT_CONFIGURED_AFTER_INTEGRATION_CHANGE &&
        user.role != USER_ROLE.SUPER_ADMIN
      )
        return forbiddenResponseWithDevMsg({
          res,
          msg: `CRM set-up not complete`,
        });

      const [userTracking, errForFetchingUserTracking] =
        await Repository.fetchOne({
          tableName: DB_TABLES.TRACKING,
          query: {
            user_id: user.user_id,
            created_at: {
              [Op.gt]: user.last_login_at,
            },
          },
          extras: {
            order: [['created_at', 'DESC']],
          },
        });
      if (errForFetchingUserTracking)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Unable to login right now. Please try again later',
          error: `Error while fetching tracking: ${errForFetchingUserTracking}`,
        });

      successResponse(res, 'Successfully logged in.', {
        user_id: user.user_id,
        sd_id: user.sd_id,
        company_id: user.company_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email: user.email,
        primary_email: user.primary_email,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        profile_picture: user.profile_picture,
        is_call_iframe_fixed: user.is_call_iframe_fixed,
        is_trial_active: user?.Company?.is_trial_active,
        created_at: user?.created_at,
        language: user.language,
        integration_type: user.Company.integration_type,
        company_integration_id: user.Company.integration_id,
        company_name: user.Company.name,
        ringover_team_id: user.Company.ringover_team_id,
        instance_url: instanceUrl?.instance_url ?? '',
        phone_system: user.Company.Company_Setting.phone_system,
        email_scope_level: user.Company.Company_Setting.email_scope_level,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
        ringover_tokens,
        company_status: user?.Company?.status,
        is_onboarding_complete: user?.is_onboarding_complete,
        showModals: {
          Company_Histories: user?.Company?.Company_Histories || [],
          Tracking: userTracking || {},
        },
      });

      // record login time for user
      return Repository.update({
        tableName: DB_TABLES.USER,
        query: { user_id: user.user_id },
        updateObject: { last_login_at: new Date().toISOString() },
      });
    }

    if (!user?.Company?.is_subscription_active)
      return paymentRequiredResponseWithDevMsg({
        res,
        data: {
          first_name: user.first_name,
          last_name: user.last_name,
          trial_valid_until: user?.Company?.trial_valid_until,
        },
      });
    else if (!user?.Company?.is_trial_active)
      return paymentRequiredResponseWithDevMsg({
        res,
        data: {
          first_name: user.first_name,
          last_name: user.last_name,
          trial_valid_until: user?.Company?.trial_valid_until,
        },
      });
  } catch (err) {
    logger.error(`Error while authorizing with Ringover: `, err);
    console.log(err?.response?.data);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing with Ringover: ${err.message}`,
    });
  }
};

// * Access token
const getAccessToken = async (req, res) => {
  try {
    let { id_token, refresh_token } = req.body;

    if (!id_token || !refresh_token)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Failed to get new session`,
        error: `Invalid request`,
      });

    // * Encrypting tokens
    let [encryptedAccessToken, errAccessToken] = CryptoHelper.encrypt(id_token);
    if (errAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to get new session',
        error: `Error while encrypting access token: ${errAccessToken}`,
      });

    let includeObject = {};
    if (req.query.user)
      includeObject = {
        [DB_TABLES.USER]: {
          attributes: [
            'user_id',
            'company_id',
            'first_name',
            'last_name',
            'role',
            'email',
            'primary_email',
            'linkedin_url',
            'primary_phone_number',
            'timezone',
            'profile_picture',
            'is_call_iframe_fixed',
            'language',
            'created_at',
          ],
          [DB_TABLES.COMPANY]: {
            attributes: [
              'is_subscription_active',
              'is_trial_active',
              'integration_type',
              'integration_id',
              'name',
              'ringover_team_id',
            ],
            [DB_TABLES.COMPANY_SETTINGS]: {
              attributes: ['phone_system', 'mail_integration_type'],
            },
          },
        },
      };

    // * Fetch the id_token
    const [ringoverToken, errFetchingRingoverToken] = await Repository.fetchOne(
      {
        tableName: DB_TABLES.RINGOVER_TOKENS,
        query: {
          encrypted_access_token: encryptedAccessToken,
        },
        include: includeObject,
        extras: {
          attributes: ['ringover_token_id', 'region', 'user_id'],
        },
      }
    );
    if (errFetchingRingoverToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to get new session',
        error: errFetchingRingoverToken,
      });
    if (!ringoverToken) {
      UserHelper.deleteUserSession(id_token);
      return notFoundResponseWithDevMsg({
        res,
        msg: 'User not logged in with cadence',
        error: 'Unable to find tokens',
      });
    }

    let requestBody = new FormData();
    requestBody.append('refresh_token', refresh_token);
    requestBody.append('grant_type', 'refresh_token');
    requestBody.append('client_id', RINGOVER_OAUTH.RINGOVER_CLIENT_ID_EU);

    const { data } = await axios.post(
      'https://auth.ringover.com/oauth2/access_token',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...requestBody.getHeaders(),
        },
      }
    );

    // * Encrypting tokens
    [encryptedAccessToken, errAccessToken] = CryptoHelper.encrypt(
      data.id_token
    );
    if (errAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login with Ringover',
        error: `Error while encrypting access token: ${errAccessToken}`,
      });
    const [encryptedRefreshToken, errRefreshToken] = CryptoHelper.encrypt(
      data.refresh_token
    );
    if (errRefreshToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to login with Ringover',
        error: `Error while encrypting refresh token: ${errRefreshToken}`,
      });

    // * Calculate expires_in
    let expires_at = new Date();
    const milliseconds = data.expires_in * 1000;
    expires_at = new Date(expires_at.getTime() + milliseconds);

    // * Update token
    let [_, errUpdatingRingoverTokens] = await Repository.update({
      tableName: DB_TABLES.RINGOVER_TOKENS,
      query: {
        ringover_token_id: ringoverToken.ringover_token_id,
      },
      updateObject: {
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: encryptedRefreshToken,
        expires_at: expires_at,
      },
    });
    if (errUpdatingRingoverTokens)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to refresh session. Contact support',
        error: errUpdatingRingoverTokens,
      });

    // * Store Ringover Token in Redis
    const [redisStatus, redisError] = await RedisHelper.setWithExpiry(
      `${REDIS_RINGOVER_ACCESS_TOKEN}${encryptedAccessToken}`,
      `${ringoverToken.user_id}:${ringoverToken.region}`,
      3600
    );
    if (redisError)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to refresh session. Contact support',
        error: redisError,
      });

    if (req.query.user) {
      const user = ringoverToken.User;

      let tokens;
      switch (user.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          tokens = DB_TABLES.SALESFORCE_TOKENS;
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        case CRM_INTEGRATIONS.SELLSY:
          tokens = DB_TABLES.SELLSY_TOKENS;
          break;
        case CRM_INTEGRATIONS.DYNAMICS:
          tokens = DB_TABLES.DYNAMICS_TOKENS;
          break;
      }

      const [instanceUrl, errForInstanceUrl] = await Repository.fetchOne({
        tableName: tokens,
        query: { user_id: user.user_id },
        extras: {
          attributes: ['encrypted_instance_url', 'instance_url'],
        },
      });

      return successResponse(res, 'Successfully fetched access token', {
        user_id: user.user_id,
        sd_id: user.sd_id,
        company_id: user.company_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email: user.email,
        primary_email: user.primary_email,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        profile_picture: user.profile_picture,
        is_call_iframe_fixed: user.is_call_iframe_fixed,
        is_trial_active: user?.Company?.is_trial_active,
        created_at: user?.created_at,
        language: user.language,
        integration_type: user.Company.integration_type,
        company_integration_id: user.Company.integration_id,
        company_name: user.Company.name,
        ringover_team_id: user.Company.ringover_team_id,
        instance_url: instanceUrl?.instance_url ?? '',
        phone_system: user.Company.Company_Setting.phone_system,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
        ringover_tokens: data,
      });
    }

    return successResponse(res, 'Successfully fetched access token.', data);
  } catch (err) {
    logger.error(`Error while authorizing with Ringover: `, err);
    console.log('Axios Error from ringover: ');
    console.log(err);

    // * Handle invalid token
    if (err?.response?.status === 401) {
      UserHelper.deleteUserSession(req.body.id_token);
      return unauthorizedResponseWithDevMsg({
        res,
        msg: 'Please login again',
      });
    }

    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing with Ringover: ${err.message}`,
    });
  }
};

// * Sign out
const signOutFromRingover = async (req, res) => {
  try {
    const { access_token } = req.user;
    UserHelper.deleteUserSession(access_token);
    return successResponse(res, 'Signed out from Ringover successfully.');
  } catch (err) {
    logger.error(`Error while signing out from Ringover: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from Ringover: ${err.message}`,
    });
  }
};

const RingoverController = {
  redirectToRingover,
  authorizeRingover,
  getAccessToken,
  signOutFromRingover,
};

module.exports = RingoverController;
