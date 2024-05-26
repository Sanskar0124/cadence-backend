// Utils
const logger = require('../../../utils/winston');
const { Op } = require('sequelize');

const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../../../utils/response');
const {
  BULLHORN_REDIRECT_URI,
  BULLHORN_CLIENT_ID,
  BULLHORN_CLIENT_SECRET,
  NODE_ENV,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const { SERVER_URL } = require('../../../utils/config');
const {
  BULLHORN_ENDPOINTS,
  USER_INTEGRATION_TYPES,
  USER_ROLE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
// Packages
const axios = require('axios');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const OauthHelper = require('../../../../../Cadence-Brain/src/helper/Oauth');
const BullhornService = require('../../../../../Cadence-Brain/src/services/Bullhorn');

const redirectToBullhorn = async (req, res) => {
  try {
    let URI = `https://auth.bullhornstaffing.com/oauth/authorize?client_id=${BULLHORN_CLIENT_ID}&redirect_uri=${BULLHORN_REDIRECT_URI}&response_type=code&state=recommended`;
    return successResponse(res, 'Redirect to this URI.', {
      URI,
    });
  } catch (err) {
    logger.error(`Error while redirecting to bullhorn auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to bullhorn auth: ${err.message}`,
    });
  }
};

const authorizeBullhorn = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id, role } = req.user;

    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Bullhorn',
        error: 'Code not valid',
      });
    }
    const { data } = await axios.post(
      `https://auth.bullhornstaffing.com/oauth/token?client_id=${BULLHORN_CLIENT_ID}&redirect_uri=${BULLHORN_REDIRECT_URI}&grant_type=authorization_code&code=${code}&client_secret=${BULLHORN_CLIENT_SECRET}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    let BH_data = await axios.post(
      `https://rest.bullhornstaffing.com/rest-services/login?version=*&access_token=${data.access_token}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    BH_data = BH_data.data;
    const [user, errForUser] = await OauthHelper.getBullhornUser(BH_data);
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Bullhorn',
        error: `Error while fetching bullhorn user: ${errForUser}`,
      });
    }

    // * Check if user already exists with this owner id
    const [userExists, errForUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: user.userId,
        integration_type: USER_INTEGRATION_TYPES.BULLHORN_USER,
        company_id: req.user.company_id,
      },
      extras: ['user_id'],
    });
    if (errForUserExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Bullhorn',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }
    if (userExists?.user_id && userExists?.user_id !== user_id) {
      t.rollback();
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Bullhorn account already connected to another user',
      });
    }

    const [updatedUserIntegrationId, errForUserIntegrationId] =
      await Repository.update({
        tableName: DB_TABLES.USER,
        query: {
          user_id,
        },
        updateObject: {
          integration_id: user.userId,
        },
        t,
      });
    if (errForUserIntegrationId) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Bullhorn',
        error: `Error while updating user: ${errForUserIntegrationId}`,
      });
    }
    BH_data.restUrl = BH_data.restUrl.substring(0, BH_data.restUrl.length - 1);
    // Encrypting tokens
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);
    const [instanceUrl, ___] = CryptoHelper.encrypt(BH_data.restUrl);
    const [BHToken, ____] = CryptoHelper.encrypt(BH_data.BhRestToken);

    const [companyExists, errForCompanyExists] = await Repository.fetchAll({
      tableName: DB_TABLES.BULLHORN_TOKENS,
      query: {
        encrypted_instance_url: instanceUrl,
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: {
              [Op.ne]: req.user.company_id,
            },
          },
          required: true,
        },
      },
    });
    if (errForCompanyExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({ res, error: errForCompanyExists });
    }
    if (companyExists.length) {
      t.rollback();
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Bullhorn account already connected to another company',
      });
    }

    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.BULLHORN_TOKENS,
      query: {
        user_id,
      },
      updateObject: {
        encrypted_refresh_token: refreshToken,
        encrypted_instance_url: instanceUrl,
        encrypted_access_token: BHToken,
        is_logged_out: 0,
      },
      t,
    });

    if (errForUserToken) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Bullhorn',
        error: `Error while updating bullhorn tokens: ${errForUserToken}`,
      });
    }
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while finding CRM admin',
        error: errCrmAdmin,
      });
    }
    if (
      req.user.user_id === crmAdmin?.Company_Setting?.user_id ||
      (role === USER_ROLE.SUPER_ADMIN &&
        crmAdmin?.Company_Setting?.user_id === null)
    ) {
      let webhookObject = 'cadence';
      if (NODE_ENV === 'development' || NODE_ENV === 'stage')
        webhookObject = webhookObject + NODE_ENV;
      await BullhornService.deleteWebhook({
        access_token: BH_data.BhRestToken,
        instance_url: BH_data.restUrl,
        object: webhookObject,
      });
      await BullhornService.createWebhook({
        access_token: BH_data.BhRestToken,
        instance_url: BH_data.restUrl,
        object: webhookObject,
      });
    }
    t.commit();

    return successResponse(res, 'Bullhorn authorization successful.');
  } catch (err) {
    t.rollback();
    if (err?.response?.data) {
      logger.error(
        `Error while authorizing bullhorn user:`,
        err?.response?.data
      );
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while authorizing bullhorn user: ${err?.response?.data}`,
      });
    }
    logger.error(`Error while authorizing bullhorn user:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing bullhorn user: ${err.message}`,
    });
  }
};

const signOutFromBullhorn = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default bullhorn user
    let [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: {
          user_id,
        },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from bullhorn',
        error: `Error while fetching company settings: ${errFetchingCompanySettings}`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please change default bullhorn user before signing out.',
      });

    const [fetchedUserToken, errForFetchedUserToken] =
      await Repository.fetchOne({
        tableName: DB_TABLES.BULLHORN_TOKENS,
        query: {
          user_id,
        },
      });
    if (errForFetchedUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from bullhorn',
        error: `Error while fetching user tokens: ${errForFetchedUserToken}`,
      });
    if (!fetchedUserToken)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from bullhorn',
        error: 'Bullhorn tokens not found',
      });

    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.BULLHORN_TOKENS,
      query: {
        user_id,
      },
      updateObject: {
        encrypted_refresh_token: null,
        encrypted_instance_url: null,
        encrypted_access_token: null,
        is_logged_out: 1,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from bullhorn',
        error: `Error while updating user tokens: ${errForUserToken}`,
      });

    return successResponse(res, 'Signed out from Bullhorn successfully.');
  } catch (err) {
    logger.error(`Error while signing out from bullhorn: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from bullhorn: ${err.message}`,
    });
  }
};

const BullhornController = {
  redirectToBullhorn,
  authorizeBullhorn,
  signOutFromBullhorn,
};

module.exports = BullhornController;
