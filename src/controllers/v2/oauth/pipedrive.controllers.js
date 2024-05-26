// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  accessDeniedResponseWithDevMsg,
} = require('../../../utils/response');
const {
  PIPEDRIVE_REDIRECT_URI,
  PIPEDRIVE_CLIENT_ID,
  PIPEDRIVE_CLIENT_SECRET,
} = require('../../../../../Cadence-Brain/src/utils/config');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const { SERVER_URL } = require('../../../utils/config');
const {
  PIPEDRIVE_ENDPOINTS,
  USER_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const axios = require('axios');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const PipedriveService = require('../../../../../Cadence-Brain/src/services/Pipedrive');
const OauthHelper = require('../../../../../Cadence-Brain/src/helper/Oauth');

const redirectToPipedrive = async (req, res) => {
  try {
    let URI = `https://oauth.pipedrive.com/oauth/authorize?client_id=${PIPEDRIVE_CLIENT_ID}&redirect_uri=${PIPEDRIVE_REDIRECT_URI}`;
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to pipedrive auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to redirect to Pipedrive',
      error: `Error while redirecting to Pipedrive auth: ${err.message}`,
    });
  }
};

const authorizePipedrive = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id } = req.user;
    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: 'Code not valid',
      });
    }

    let body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('code', code);
    body.append('redirect_uri', PIPEDRIVE_REDIRECT_URI);

    const { data } = await axios.post(
      'https://oauth.pipedrive.com/oauth/token',
      body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(
              `${PIPEDRIVE_CLIENT_ID}:${PIPEDRIVE_CLIENT_SECRET}`
            ).toString('base64'),
        },
      }
    );

    // To fetch owner id of the user
    const [user, errForUser] = await OauthHelper.getPipedriveUser(data);
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: `Error while fetching Pipedrive user: ${errForUser}`,
      });
    }
    // * Check if user already exists with this owner id
    const [userExists, errForUserExists] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: user.id,
        integration_type: USER_INTEGRATION_TYPES.PIPEDRIVE_USER,
        company_id: req.user.company_id,
      },
      extras: ['user_id'],
    });
    if (errForUserExists) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: `Error while fecthing user: ${errForUserExists}`,
      });
    }
    if (userExists?.user_id && userExists?.user_id !== user_id) {
      t.rollback();
      return accessDeniedResponseWithDevMsg({
        res,
        msg: 'Pipedrive account already connected to another user',
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
          integration_id: user.id,
        },
        t,
      });
    if (errForUserIntegrationId) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: `Error while updating user: ${errForUserIntegrationId}`,
      });
    }
    // Encrypting tokens
    const [accessToken, _] = CryptoHelper.encrypt(data.access_token);
    const [refreshToken, __] = CryptoHelper.encrypt(data.refresh_token);
    const [instanceUrl, ___] = CryptoHelper.encrypt(data.api_domain);

    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.PIPEDRIVE_TOKENS,
      query: { user_id },
      updateObject: {
        encrypted_access_token: accessToken,
        encrypted_refresh_token: refreshToken,
        encrypted_instance_url: instanceUrl,
        is_logged_out: 0,
      },
      t,
    });
    if (errForUserToken) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: `Error while updating Pipedrive tokens: ${errForUserToken}`,
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
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Pipedrive',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });
    }

    // * Creating webhooks for CRM Admin
    if (req.user.user_id === crmAdmin?.Company_Setting?.user_id) {
      await PipedriveService.deleteWebhookById({
        access_token: data.access_token,
        instance_url: data.api_domain,
      });

      // add webhook for all person events
      const [personUpdateWebhookData, errForUpdatePersonWebhookData] =
        await PipedriveService.addWebhookForObject({
          access_token: data.access_token,
          instance_url: data.api_domain,
          subscription_url: `${SERVER_URL}/webhook/v1/pipedrive/person`,
          //subscription_url: `${SERVER_URL}/v2/webhook/pipedrive/person`,
          event_action: 'updated',
          event_object: PIPEDRIVE_ENDPOINTS.PERSON,
        });
      if (errForUpdatePersonWebhookData) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Pipedrive',
          error: `Error while updating webhook data: ${errForUpdatePersonWebhookData}`,
        });
      }

      const [personCreateWebhookData, errForCreatePersonWebhookData] =
        await PipedriveService.addWebhookForObject({
          access_token: data.access_token,
          instance_url: data.api_domain,
          //subscription_url: `${SERVER_URL}/webhook/v1/pipedrive/person`,
          subscription_url: `${SERVER_URL}/webhook/v1/pipedrive/person/add`,
          event_action: 'added',
          event_object: PIPEDRIVE_ENDPOINTS.PERSON,
        });
      if (errForCreatePersonWebhookData) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Pipedrive',
          error: `Error while creating webhook data: ${errForCreatePersonWebhookData}`,
        });
      }

      const [personDeleteWebhookData, errForDeletePersonWebhookData] =
        await PipedriveService.addWebhookForObject({
          access_token: data.access_token,
          instance_url: data.api_domain,
          subscription_url: `${SERVER_URL}/webhook/v1/pipedrive/person`,
          //subscription_url: `${SERVER_URL}/v2/webhook/pipedrive/person`,
          event_action: 'deleted',
          event_object: PIPEDRIVE_ENDPOINTS.PERSON,
        });
      if (errForDeletePersonWebhookData) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Pipedrive',
          error: `Error while deleting webhook data: ${errForDeletePersonWebhookData}`,
        });
      }

      // add webhook for all organization events
      const [organizationWebhookData, errForOrganizationWebhookData] =
        await PipedriveService.addWebhookForObject({
          access_token: data.access_token,
          instance_url: data.api_domain,
          subscription_url: `${SERVER_URL}/webhook/v1/pipedrive/organization`,
          //subscription_url: `${SERVER_URL}/v2/webhook/pipedrive/organization`,
          event_action: '*',
          event_object: PIPEDRIVE_ENDPOINTS.ORGANIZATION,
        });
      if (errForOrganizationWebhookData) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Pipedrive',
          error: `Error while organizing webhook data: ${errForOrganizationWebhookData}`,
        });
      }

      // add webhook for all deal events
      const [dealWebhookData, errForDealWebhookData] =
        await PipedriveService.addWebhookForObject({
          access_token: data.access_token,
          instance_url: data.api_domain,
          subscription_url: `${SERVER_URL}/v2/webhook/pipedrive/deal`,
          event_action: '*',
          event_object: PIPEDRIVE_ENDPOINTS.DEAL,
        });
      if (errForDealWebhookData) {
        t.rollback();
        logger.error(
          `Error while establishing deal webhook: `,
          errForDealWebhookData
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with Pipedrive',
          error: `Error while dealing webhook data: ${errForDealWebhookData}`,
        });
      }
    }

    t.commit();

    return successResponse(res, 'Pipedrive authorization successful.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while authorizing Pipedrive user:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing Pipedrive user: ${err.message}`,
    });
  }
};

const signOutFromPipedrive = async (req, res) => {
  try {
    const { user_id } = req.user;

    // * Check if the user is the default pipedrive user
    let [companySettings, errFetchingCompanySettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: { user_id },
      });
    if (errFetchingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from Pipedrive',
        error: `Error while fetching company settings`,
      });
    if (companySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please change default Pipedrive user before signing out',
      });
    // Commented webhooks deletion code, because webhooks are only created for super admin
    // and super admin is not allowed to sign out

    // const [fetchedUserToken, errForFetchedUserToken] =
    //   await Repository.fetchOne({
    //     tableName: DB_TABLES.PIPEDRIVE_TOKENS,
    //     query: { user_id },
    //   });
    // if (errForFetchedUserToken) return serverErrorResponse(res);
    // if (!fetchedUserToken) return notFoundResponse(res);
    // const [data, err] = await PipedriveService.deleteWebhookById({
    //   access_token: fetchedUserToken.access_token,
    //   instance_url: fetchedUserToken.instance_url,
    // });

    const [updatedUser, errForUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: { user_id },
      updateObject: {
        integration_id: null,
      },
    });
    // Remove tokens in user token model
    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.PIPEDRIVE_TOKENS,
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
        msg: 'Failed to sign out from Pipedrive',
        error: `Error while updating Pipedrive tokens: ${errForUserToken}`,
      });

    return successResponse(res, 'Signed out from pipedrive successfully.');
  } catch (err) {
    logger.error(`Error while signing out from pipedrive: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from Pipedrive: ${err.message}`,
    });
  }
};

const PipedriveController = {
  redirectToPipedrive,
  authorizePipedrive,
  signOutFromPipedrive,
};

module.exports = PipedriveController;
