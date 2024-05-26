// Utils
const logger = require('../../../utils/winston');
const { Op } = require('sequelize');

const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../../../utils/response');
const {
  DYNAMICS_REDIRECT_URI,
  DYNAMICS_CLIENT_ID,
  DYNAMICS_CLIENT_SECRET,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

const {
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

const redirectToDynamics = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const [tokens, errForTokens] = await Repository.fetchOne({
      tableName: DB_TABLES.DYNAMICS_TOKENS,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: [
          'instance_url',
          'dynamics_token_id',
          'encrypted_instance_url',
        ],
      },
    });
    if (errForTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Dynamics',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }

    const OAuthScope = `${tokens.instance_url}/user_impersonation offline_access openid profile User.Read`;

    let URI = new URL(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize'
    );

    URI.searchParams.set('client_id', DYNAMICS_CLIENT_ID);
    URI.searchParams.set('redirect_uri', DYNAMICS_REDIRECT_URI);
    URI.searchParams.set('state', req.user.user_id);
    URI.searchParams.set('response_type', 'code');
    URI.searchParams.set('response_mode', 'query');
    URI.searchParams.set('scope', OAuthScope);
    // URI.searchParams.set('prompt', 'consent');

    t.commit();
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    t.rollback();
    logger.error(`Error while redirecting to dynamics auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to dynamics auth: ${err.message}`,
    });
  }
};

const getOwnerID = async (instance_url, access_token) => {
  try {
    const { data } = await axios.get(`${instance_url}/api/data/v9.2/WhoAmI`, {
      headers: {
        'If-None-Match': 'null',
        'OData-Version': '4.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        Authorization: `Bearer ${access_token}`,
      },
    });
    return [data, null];
  } catch (err) {
    logger.error(`Error while getting dynamics owner ID: `, err);
    return [null, err.message];
  }
};

const authorizeDynamics = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id, company_id, role } = req.user;

    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: 'code not valid',
        msg: 'Failed to connect with Dynamics',
      });
    }

    const [tokens, errForTokens] = await Repository.fetchOne({
      tableName: DB_TABLES.DYNAMICS_TOKENS,
      query: { user_id },
      extras: {
        attributes: [
          'instance_url',
          'dynamics_token_id',
          'encrypted_instance_url',
        ],
      },
    });
    if (errForTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Dynamics',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }

    const [companyExists, errForCompanyExists] = await Repository.fetchAll({
      tableName: DB_TABLES.DYNAMICS_TOKENS,
      query: {
        encrypted_instance_url: tokens.encrypted_instance_url,
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: {
              [Op.ne]: company_id,
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
        msg: 'Dynamics account already connected to another company',
      });
    }

    const OAuthScope = `${tokens.instance_url}/user_impersonation offline_access openid profile User.Read`;

    const params = new URLSearchParams();
    params.append('client_id', DYNAMICS_CLIENT_ID);
    params.append('client_secret', DYNAMICS_CLIENT_SECRET);
    params.append('redirect_uri', DYNAMICS_REDIRECT_URI);
    params.append('grant_type', 'authorization_code');
    params.append('scope', OAuthScope);
    params.append('code', code);

    const { data } = await axios.post(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    // To fetch owner id of the user
    const [owner, errForOwner] = await getOwnerID(
      tokens.instance_url,
      data.access_token
    );
    if (errForOwner) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Dynamics',
        error: `Error while fetching Dynamics owner: ${errForOwner}`,
      });
    }

    // To fetch organization id of the company
    if (role === USER_ROLE.SUPER_ADMIN) {
      const [updatedOrganizationID, errForOrganizationID] =
        await Repository.update({
          tableName: DB_TABLES.COMPANY,
          query: {
            company_id: req.user.company_id,
          },
          updateObject: {
            integration_id: owner.OrganizationId,
          },
          t,
        });
      if (errForOrganizationID) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Dynamics',
          error: `Error while updating company: ${errForOrganizationID}`,
        });
      }
    }

    // * Check if user already exists with this owner id
    const [userExists, errForUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: owner.UserId,
        integration_type: USER_INTEGRATION_TYPES.DYNAMICS_OWNER,
        company_id: company_id,
      },
      extras: {
        attributes: ['user_id'],
      },
    });
    if (errForUserExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Dynamics',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }
    if (userExists?.user_id && userExists?.user_id !== user_id) {
      t.rollback();
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Dynamics account already connected to another user.',
      });
    }

    const [updatedUserIntegrationId, errForUserIntegrationId] =
      await Repository.update({
        tableName: DB_TABLES.USER,
        query: { user_id },
        updateObject: {
          integration_id: owner.UserId,
        },
        t,
      });
    if (errForUserIntegrationId) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Dynamics',
        error: `Error while updating user: ${errForUserIntegrationId}`,
      });
    }

    // Encrypting tokens
    const [accessToken, _] = CryptoHelper.encrypt(data.access_token);
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.DYNAMICS_TOKENS,
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
        msg: 'Failed to connect with Dynamics',
        error: `Error while updating dynamics tokens: ${errForUserToken}`,
      });
    }
    t.commit();

    return successResponse(res, 'Dynamics authorization successful.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while authorizing dynamics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing dynamics: ${err.message}`,
    });
  }
};

const signOutFromDynamics = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default dynamics user
    let [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: { user_id },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from dynamics',
        error: `Error while fetching company settings: ${errFetchingCompanySettings}`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please change default dynamics user before signing out.',
      });

    const [fetchedUserToken, errForFetchedUserToken] =
      await Repository.fetchOne({
        tableName: DB_TABLES.DYNAMICS_TOKENS,
        query: { user_id },
      });
    if (errForFetchedUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from dynamics',
        error: `Error while fetching user tokens: ${errForFetchedUserToken}`,
      });
    if (!fetchedUserToken) return notFoundResponse(res);

    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.DYNAMICS_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_refresh_token: null,
        encrypted_access_token: null,
        is_logged_out: 1,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from dynamics',
        error: `Error while updating user tokens: ${errForUserToken}`,
      });

    return successResponse(res, 'Signed out from Dynamics successfully.');
  } catch (err) {
    logger.error(`Error while signing out from dynamics: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from dynamics: ${err.message}`,
    });
  }
};

const DynamicsController = {
  redirectToDynamics,
  authorizeDynamics,
  signOutFromDynamics,
};

module.exports = DynamicsController;
