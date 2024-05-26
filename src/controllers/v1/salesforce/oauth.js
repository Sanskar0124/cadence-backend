// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../../../utils/response');
const {
  INTEGRATION_TYPE,
  USER_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Repositories
const UserTokenRepository = require('../../../../../Cadence-Brain/src/repository/user-token.repository');
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const Salesforce = require('../../../../../Cadence-Brain/src/services/Salesforce');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');

const redirectToSalesforce = async (req, res) => {
  try {
    let [URI, errForRedirectUri] = Salesforce.getRedirectToUri();
    if (errForRedirectUri)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to redirect to salesforce',
        error: `Error while fetching saleforce redirect url: ${errForRedirectUri}`,
      });
    if (URI === null)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to redirect to salesforce',
        error: `Error while generating URI`,
      });
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to salesforce auth: ${err.message}.`);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to salesforce auth: ${err.message}`,
    });
  }
};

const authorizeSalesforce = async (req, res) => {
  try {
    const { code } = req.query;
    const { user_id } = req.user;
    if (code === null || code === '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: 'Code not valid',
      });

    const [data, errForGetARToken] = await Salesforce.getARTokenUsingCode(code);
    if (errForGetARToken) {
      if (errForGetARToken === 'Expired access/refresh token')
        return accessDeniedResponseWithDevMsg({
          res,
          msg: 'Salesforce access denied',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: `Error while fetching AR token using code: ${errForGetARToken}`,
      });
    }

    let id = data?.id?.split('/')[5];
    if (id === null || id === '')
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: 'Unable to extract salesforce owner Id',
      });

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: id,
        integration_type: USER_INTEGRATION_TYPES.SALESFORCE_OWNER,
      },
      extras: ['user_id'],
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: `Error while fetching user: ${errForUser}`,
      });

    if (user?.user_id && user?.user_id !== user_id)
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Salesforce account already connected to another account',
      });

    // Encrypting tokens
    const [accessToken, _] = CryptoHelper.encrypt(data.access_token);
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);
    const [instanceUrl, ___] = CryptoHelper.encrypt(data.instance_url);

    // Updating tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id },
      updateObject: {
        encrypted_salesforce_access_token: accessToken,
        encrypted_salesforce_refresh_token: refreshToken,
        encrypted_salesforce_instance_url: instanceUrl,
        is_salesforce_logged_out: 0,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: `Error while updating user token: ${errForUserToken}`,
      });

    // updating salesforce owner id and integration id in user model
    const [updateUser, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        salesforce_owner_id: id,
        integration_id: id,
      },
    });
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: `Error while updating user: ${errForUpdateUser}`,
      });

    const [sfTokens, errForFetch] = await Repository.fetchOne({
      tableName: DB_TABLES.SALESFORCE_TOKENS,
      query: { user_id },
    });
    if (errForFetch)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with salesforce',
        error: `Error while fetching salesforce tokens: ${errForFetch}`,
      });

    // If salesforce token row already exists
    if (sfTokens) {
      const [salesforceTokens, errForSalesforceTokens] =
        await Repository.update({
          tableName: DB_TABLES.SALESFORCE_TOKENS,
          query: { user_id },
          updateObject: {
            encrypted_access_token: accessToken,
            encrypted_refresh_token: refreshToken,
            encrypted_instance_url: instanceUrl,
            is_logged_out: 0,
          },
        });
      if (errForSalesforceTokens)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with salesforce',
          error: `Error while updating salesforce tokens: ${errForSalesforceTokens}`,
        });
    } else {
      const [salesforceTokens, errForSalesforceTokens] =
        await Repository.create({
          tableName: DB_TABLES.SALESFORCE_TOKENS,
          createObject: {
            encrypted_access_token: accessToken,
            encrypted_refresh_token: refreshToken,
            encrypted_instance_url: instanceUrl,
            is_logged_out: 0,
            user_id,
          },
        });
      if (errForSalesforceTokens)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with salesforce',
          error: `Error while creating salesforce tokens: ${errForSalesforceTokens}`,
        });
    }

    return successResponse(res, 'Authorization successful.');
  } catch (err) {
    console.log(err);
    logger.error(`Error while authorizing salesforce user: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing salesforce user: ${err.message}`,
    });
  }
};

const signOutFromSalesforce = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default salesforce user
    let [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: { user_id },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from salesforce',
        error: `Error while fetching company: ${errFetchingCompanySettings}`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please change default salesforce user before signing out',
      });

    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] =
      await UserTokenRepository.updateUserTokenByQuery(
        { user_id },
        {
          encrypted_salesforce_access_token: null,
          encrypted_salesforce_refresh_token: null,
          encrypted_salesforce_instance_url: null,
          is_salesforce_logged_out: 1,
        }
      );
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from salesforce',
        error: `Error while updating user token by query: ${errForUserToken}`,
      });

    const [salesforceTokens, errForSalesforceTokens] = await Repository.update({
      tableName: DB_TABLES.SALESFORCE_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        encrypted_instance_url: null,
        is_logged_out: 1,
      },
    });
    if (errForSalesforceTokens)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from salesforce',
        error: `Error while updating salesforce tokens: ${errForSalesforceTokens}`,
      });

    const [updateUser, errForUpdateUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        integration_id: null,
        salesforce_owner_id: null,
      },
    });
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from salesforce',
        error: `Error while updating user: ${errForUpdateUser}`,
      });

    return successResponse(res, 'Signed out successfully.');
  } catch (err) {
    logger.error(`Error while signing out from salesforce: `, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from salesforce: ${err.message}`,
    });
  }
};

const SalesforceController = {
  redirectToSalesforce,
  authorizeSalesforce,
  signOutFromSalesforce,
};

module.exports = SalesforceController;
