// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  accessDeniedResponse,
} = require('../../../utils/response');
const {
  HUBSPOT_REDIRECT_URI,
  HUBSPOT_CLIENT_ID,
  HUBSPOT_CLIENT_SECRET,
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
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');

const redirectToHubspot = async (req, res) => {
  try {
    let URI = `https://app.hubspot.com/oauth/authorize?client_id=${HUBSPOT_CLIENT_ID}&redirect_uri=${HUBSPOT_REDIRECT_URI}&scope=automation%20oauth%20crm.lists.read%20crm.objects.contacts.read%20crm.import%20settings.users.write%20crm.objects.contacts.write%20crm.objects.marketing_events.read%20crm.objects.marketing_events.write%20crm.schemas.custom.read%20crm.objects.custom.read%20crm.objects.custom.write%20crm.objects.companies.write%20settings.users.read%20crm.schemas.contacts.read%20crm.lists.write%20crm.objects.companies.read%20crm.objects.deals.read%20crm.objects.deals.write%20crm.schemas.companies.read%20crm.schemas.companies.write%20crm.schemas.contacts.write%20crm.schemas.deals.read%20crm.schemas.deals.write%20crm.objects.owners.read%20settings.users.teams.write%20settings.users.teams.read%20crm.objects.quotes.write%20crm.objects.quotes.read%20crm.schemas.quotes.read%20crm.objects.line_items.read%20crm.objects.line_items.write%20crm.schemas.line_items.read%20crm.export`;
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to hubspot auth: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to hubspot auth: ${err.message}`,
    });
  }
};

const getAccountDetails = async (req) => {
  try {
    const { data } = await axios.get(
      'https://api.hubapi.com/account-info/v3/details',
      {
        headers: {
          Authorization: `Bearer ${req.access_token}`,
        },
      }
    );
    return [data, null];
  } catch (err) {
    logger.error(`Error while getting hubspot account details: `, err);
    return [null, err.message];
  }
};

const getOwnerID = async (req) => {
  try {
    const { data } = await axios.get(
      `https://api.hubapi.com/crm/v3/owners/${req.user_id}?idProperty=userId&archived=false`,
      {
        headers: {
          Authorization: `Bearer ${req.token}`,
        },
      }
    );
    return [data, null];
  } catch (err) {
    logger.error(`Error while getting hubspot  owner ID: `, err);
    return [null, err.message];
  }
};

const getUserDetails = async (req) => {
  try {
    const { data } = await axios.get(
      `https://api.hubapi.com/oauth/v1/access-tokens/${req.access_token}`,
      {
        headers: {
          Authorization: `Bearer ${req.access_token}`,
        },
      }
    );
    return [data, null];
  } catch (err) {
    logger.error(`Error while getting hubspot USER id: `, err);
    return [null, err.message];
  }
};

const authorizeHubspot = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id, role } = req.user;

    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: 'Code not valid.',
      });
    }

    let body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('client_id', HUBSPOT_CLIENT_ID);
    body.append('client_secret', HUBSPOT_CLIENT_SECRET);
    body.append('redirect_uri', HUBSPOT_REDIRECT_URI);
    body.append('code', code);

    const { data } = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const [pdata, errForPdata] = await getAccountDetails(data);
    if (errForPdata) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: `Error while fetching account details: ${errForPdata}`,
      });
    }

    // To fetch portal id of the company
    if (role === USER_ROLE.SUPER_ADMIN) {
      const [updatedPortalID, errForPortalID] = await Repository.update({
        tableName: DB_TABLES.COMPANY,
        query: {
          company_id: req.user.company_id,
        },
        updateObject: {
          integration_id: pdata.portalId,
        },
        t,
      });
      if (errForPortalID) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Hubspot',
          error: `Error while updating company: ${errForPortalID}`,
        });
      }
    }

    // To fetch owner id of the user
    const [user, errForUser] = await getUserDetails(data);
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: `Error while fetching Hubspot user details: ${errForUser}`,
      });
    }
    const [owner, errForOwner] = await getOwnerID(user);
    if (errForOwner) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: `Error while fetching HUbspot owner ID: ${errForOwner}`,
      });
    }

    // * Check if user already exists with this owner id
    const [userExists, errForUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: owner.id,
        integration_type: USER_INTEGRATION_TYPES.HUBSPOT_OWNER,
        company_id: req.user.company_id,
      },
      extras: ['user_id'],
    });
    if (errForUserExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: `Error while fetching user: ${errForUserExists}`,
      });
    }
    if (userExists?.user_id && userExists?.user_id !== user_id) {
      t.rollback();
      return accessDeniedResponse(
        res,
        'Hubspot account already connected to another user.'
      );
    }

    // * Check if company portal Id is same as the user's portal Id
    const [companyExists, errCompanyExists] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
        integration_id: pdata.portalId,
      },
      t,
    });
    if (errCompanyExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: `Error while fetching company: ${errCompanyExists}`,
      });
    }
    if (!companyExists) {
      t.rollback();
      return accessDeniedResponse(
        res,
        'Hubspot account cannot connect with this company'
      );
    }

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
        msg: 'Failed to connect with Hubspot',
        error: `Error while updating user: ${errForUserIntegrationId}`,
      });
    }

    // Encrypting tokens
    const [accessToken, _] = CryptoHelper.encrypt(data.access_token);
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.HUBSPOT_TOKENS,
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
        msg: 'Failed to connect with Hubspot',
        error: `Error while updating Hubspot tokens: ${errForUserToken}`,
      });
    }

    t.commit();

    return successResponse(res, 'Hubspot authorization successful.');
  } catch (err) {
    t.rollback();
    if (err?.response?.data?.status === 'BAD_AUTH_CODE')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Hubspot',
        error: 'Invalid auth code',
      });
    console.log(err?.response?.data);
    logger.error(`Error while authorizing hubspot user:`, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing Hubspot user: ${err.message}`,
    });
  }
};

const signOutFromHubspot = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default hubspot user
    let [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: { user_id },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to sign out from Hubspot`,
        error: `Error while fetching company settings: ${errFetchingCompanySettings}`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please change default hubspot user before signing out',
      });

    const [fetchedUserToken, errForFetchedUserToken] =
      await Repository.fetchOne({
        tableName: DB_TABLES.HUBSPOT_TOKENS,
        query: { user_id },
      });
    if (errForFetchedUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to sign out from Hubspot`,
        error: `Error while fetching Hubspot tokens: ${errForFetchedUserToken}`,
      });
    if (!fetchedUserToken)
      return notFoundResponseWithDevMsg({
        res,
        msg: `Failed to sign out from Hubspot`,
        error: 'Hubspot token not found',
      });

    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.HUBSPOT_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        is_logged_out: 1,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to sign out from Hubspot`,
        error: `Error while updating Hubspot tokens: ${errForUserToken}`,
      });

    return successResponse(res, 'Signed out from Hubspot successfully.');
  } catch (err) {
    logger.error(`Error while signing out from hubspot: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from hubspot: ${err.message}`,
    });
  }
};

const HubspotController = {
  redirectToHubspot,
  authorizeHubspot,
  signOutFromHubspot,
};

module.exports = HubspotController;
