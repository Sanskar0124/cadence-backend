// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SELLSY_CLIENT_ID,
  SELLSY_CODE_VERIFIER,
  SELLSY_CODE_CHALLENGE,
  SELLSY_WEBHOOK,
} = require('../../../utils/config');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  USER_ROLE,
  USER_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const axios = require('axios');

// Models
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const SellsyService = require('../../../../../Cadence-Brain/src/services/Sellsy');

const getOwnerID = async (access_token) => {
  try {
    const { data } = await axios.get(
      `https://api.sellsy.com/v2/staffs/me?embed[]=account`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    return [data, null];
  } catch (err) {
    logger.error(`Error while getting Sellsy owner ID: `, err);
    return [null, err.message];
  }
};

const redirectToSellsy = async (req, res) => {
  try {
    let param = new URLSearchParams();
    param.append('response_type', 'code');
    param.append('client_id', SELLSY_CLIENT_ID);
    param.append('code_challenge', SELLSY_CODE_CHALLENGE);
    param.append('code_challenge_method', 'S256');

    let URI = `https://login.sellsy.com/oauth2/authorization?${param}`;
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to sellsy auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to Sellsy auth: ${err.message}`,
    });
  }
};

const authorizeSellsy = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id, role } = req.user;

    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: 'Code not valid',
      });
    }

    let body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('client_id', SELLSY_CLIENT_ID);
    body.append('code_verifier', SELLSY_CODE_VERIFIER);
    body.append('code', code);

    const { data } = await axios.post(
      'https://login.sellsy.com/oauth2/access-tokens',
      body,
      {
        headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
      }
    );

    // To fetch owner id of the user
    const [owner, errForOwner] = await getOwnerID(data.access_token);
    if (errForOwner) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: `Error while fetching Sellsy owner: ${errForOwner}`,
      });
    }
    const companyIntegrationId = owner?._embed?.account?.id?.toString();

    // * Check if user already exists with this owner id
    const [userExists, errForUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: owner.id,
        integration_type: USER_INTEGRATION_TYPES.SELLSY_OWNER,
        company_id: req.user.company_id,
      },
      extras: ['user_id'],
    });
    if (errForUserExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }
    if (userExists?.user_id && userExists?.user_id !== user_id) {
      t.rollback();

      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: 'Sellsy account already connected to another user',
      });
    }

    //updating integration id
    const [updatedUserIntegrationId, errForUserIntegrationId] =
      await Repository.update({
        tableName: DB_TABLES.USER,
        query: {
          user_id,
        },
        updateObject: {
          integration_id: owner.id,
        },
        t,
      });
    if (errForUserIntegrationId) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: `Error while updating user: ${errForUserIntegrationId}`,
      });
    }

    // * Fetch CRM admin of the company
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
        attributes: ['company_id', 'integration_id'],
      },
    });
    if (errCrmAdmin) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });
    }

    // * deleting webhook for CRM Admin
    if (req.user.user_id === crmAdmin?.Company_Setting?.user_id) {
      const [_, errForDeleteWebhookById] =
        await SellsyService.deleteWebhookById({
          access_token: data.access_token,
        });
      if (errForDeleteWebhookById) {
        t.rollback();
        if (errForDeleteWebhookById) {
          if (errForDeleteWebhookById?.includes('ACLs on the route'))
            return badRequestResponseWithDevMsg({
              res,
              msg: 'Failed to connect with Sellsy',
              error: 'User does not have permission to delete webhook',
            });
        }
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Sellsy',
          error: `Error while deleting webhook by ID: ${errForDeleteWebhookById}`,
        });
      }
    }

    if (role === USER_ROLE.SUPER_ADMIN) {
      const [webhook, errForWebhook] = await SellsyService.createWebhook({
        access_token: data.access_token,
        endpoint: SELLSY_WEBHOOK,
      });
      if (errForWebhook) {
        t.rollback();
        if (errForWebhook?.includes('ACLs on the route'))
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to connect with Sellsy',
            error: 'User does not have permission to create webhook',
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Sellsy',
          error: `Error while creating webhook: ${errForWebhook}`,
        });
      }

      const [updatedCorpID, errForCorpID] = await Repository.update({
        tableName: DB_TABLES.COMPANY,
        query: {
          company_id: req.user.company_id,
        },
        updateObject: {
          integration_id: companyIntegrationId,
        },
        t,
      });
      if (errForCorpID) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Sellsy',
          error: `Error while updating company: ${errForCorpID}`,
        });
      }
    }

    // * Check if company corp Id is same as the user's corp Id

    if (
      crmAdmin?.integration_id !== companyIntegrationId &&
      role !== USER_ROLE.SUPER_ADMIN
    ) {
      t.rollback();
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: 'Sellsy account already connected to another company',
      });
    }

    // Encrypting tokens
    const [accessToken, _] = CryptoHelper.encrypt(data.access_token);
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);

    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.SELLSY_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_access_token: accessToken,
        encrypted_refresh_token: refreshToken,
        is_logged_out: 0,
      },
      t,
    });
    if (errForUserToken) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: `Error while updating Sellsy tokens: ${errForUserToken}`,
      });
    }

    t.commit();
    return successResponse(res, 'Sellsy authorization successful.');
  } catch (err) {
    t.rollback();
    if (err?.response?.data?.status === 'BAD_AUTH_CODE')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Sellsy',
        error: 'Invalid auth code',
      });

    logger.error(`Error while authorizing sellsy user:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing Sellsy user: ${err.message}`,
    });
  }
};

const signOutFromSellsy = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default Sellsy user
    const [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: { user_id },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from Sellsy',
        error: `Error while fetching company settings: ${errFetchingCompanySettings}`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Please change default Sellsy user before signing out`,
      });

    const [updatedUser, errForUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        integration_id: null,
      },
    });

    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.SELLSY_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        encrypted_instance_url: null,
        is_logged_out: 1,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from Sellsy',
        error: `Error while updating Sellsy tokens: ${errForUserToken}`,
      });

    return successResponse(res, 'Signed out from Sellsy successfully.');
  } catch (err) {
    logger.error(`Error while signing out from Sellsy: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from Sellsy: ${err.message}`,
    });
  }
};

const SellsyController = {
  redirectToSellsy,
  authorizeSellsy,
  signOutFromSellsy,
};

module.exports = SellsyController;
