// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  CALENDLY_REDIRECT_URI,
  CALENDLY_CLIENT_ID,
  CALENDLY_CLIENT_SECRET,
  SERVER_URL,
} = require('../../../../../Cadence-Brain/src/utils/config');

const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const axios = require('axios');

// DB
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const CalendlyHelper = require('../../../../../Cadence-Brain/src/helper/calendly');

const redirectToCalendly = async (req, res) => {
  try {
    let URI = `https://auth.calendly.com/oauth/authorize?client_id=${CALENDLY_CLIENT_ID}&response_type=code&redirect_uri=${CALENDLY_REDIRECT_URI}`;
    return successResponse(res, 'Redirect to this URI.', { URI });
  } catch (err) {
    logger.error(`Error while redirecting to calendly auth: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while redirecting to calendly auth: ${err.message}`,
    });
  }
};

const authorizeCalendly = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const { code } = req.query;
    const { user_id } = req.user;
    if (code === null || code === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: 'Code not valid',
      });
    }

    let body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('code', code);
    body.append('redirect_uri', CALENDLY_REDIRECT_URI);

    const { data } = await axios.post(
      'https://auth.calendly.com/oauth/token',
      body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(
              `${CALENDLY_CLIENT_ID}:${CALENDLY_CLIENT_SECRET}`
            ).toString('base64'),
        },
      }
    );

    // Encrypting tokens
    const [accessToken, errAccessToken] = CryptoHelper.encrypt(
      data.access_token
    );
    if (errAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: `Error while encrypting access token: ${errAccessToken}`,
      });

    const [refreshToken, errRefreshToken] = CryptoHelper.encrypt(
      data.refresh_token
    );
    if (errRefreshToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: `Error while encrypting refresh token: ${errRefreshToken}`,
      });

    const resp = await axios.get('https://api.calendly.com/users/me', {
      headers: {
        Authorization: 'Bearer ' + data.access_token,
      },
    });

    let calendlyUser = resp.data.resource.uri;
    const [calendlyUserID, errCalendlyUserID] = CryptoHelper.encrypt(
      calendlyUser.slice(31)
    );
    if (errCalendlyUserID)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: `Error while encrypting calendly user id: ${errCalendlyUserID}`,
      });

    // Creating webhook subscription
    const webhookData = {
      url: `${SERVER_URL}/v2/webhook/calendly/updateEvents`,
      events: ['invitee.created', 'invitee.canceled'],
      organization: resp.data.resource.current_organization,
      user: resp.data.resource.uri,
      scope: 'user',
    };

    const webhookSubs = await axios.post(
      'https://api.calendly.com/webhook_subscriptions',
      webhookData,
      {
        headers: {
          Authorization: 'Bearer ' + data.access_token,
        },
      }
    );

    let webhookUri = webhookSubs.data.resource.uri;
    const [webhookUuid, errWebhookUuid] = CryptoHelper.encrypt(
      webhookUri.slice(47)
    );
    if (errWebhookUuid)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: `Error while encrypting webhook uuid: ${errWebhookUuid}`,
      });

    // Storing data in DB
    const [updateUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id },
      updateObject: {
        encrypted_calendly_access_token: accessToken,
        encrypted_calendly_refresh_token: refreshToken,
        encrypted_calendly_user_id: calendlyUserID,
        encrypted_calendly_webhook_id: webhookUuid,
      },
      t,
    });
    if (errForUserToken) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to connect with calendly',
        error: `Error while updating user token: ${errForUserToken}`,
      });
    }

    t.commit();
    return successResponse(res, 'Calendly authorization successful.');
  } catch (err) {
    t.rollback();
    logger.error(`Error while authorizing calendly user:`, err);
    if (
      err?.response?.data?.message ===
      'Please upgrade your Calendly account to Professional'
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: "It seems like you don't have a calendly premium account. For free users use the non-premium option on the profile page to enter the calendly link.",
      });
    if (err?.response?.data?.message === 'Hook with this url already exists')
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'It seems like you are on your 14 days trial period of calendly, and you can connect your calendly account only with one webhook at a time. For free users use the non-premium option on the profile page to enter the calendly link.',
      });
    if (err?.response?.data?.message)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while authorizing calendly user: ${err?.response?.data?.message}`,
      });
    if (err?.response?.data?.error)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while authorizing calendly user: ${err?.response?.data?.error}`,
      });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing calendly user: ${err.message}`,
    });
  }
};

const signOutFromCalendly = async (req, res) => {
  try {
    const { user_id } = req.user;
    const [calendlyDetails, errisCalendlyDetails] = await Repository.fetchOne({
      tableName: DB_TABLES.USER_TOKEN,
      query: {
        user_id: user_id,
      },
    });
    const [accessToken, errForAccessToken] =
      await CalendlyHelper.GetAccessToken(user_id);
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from calendly',
        error: `Error while fetching access token for calendly: ${errForAccessToken}`,
      });
    const webhookSubs = await axios.delete(
      `https://api.calendly.com/webhook_subscriptions/${calendlyDetails.calendly_webhook_id}`,
      {
        headers: {
          Authorization: 'Bearer ' + accessToken,
        },
      }
    );

    const [updateUserToken, errForUserToken] = await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id },
      updateObject: {
        encrypted_calendly_access_token: null,
        encrypted_calendly_refresh_token: null,
        encrypted_calendly_user_id: null,
        encrypted_calendly_webhook_id: null,
      },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from calendly',
        error: `Error while updating user token: ${errForUserToken}`,
      });

    // Removing Calendly Url from user table
    const [updateUserCalendlyLink, errForupdateUserCalendlyLink] =
      await Repository.update({
        tableName: DB_TABLES.USER,
        query: { user_id },
        updateObject: {
          calendly_url: '',
        },
      });
    if (errForupdateUserCalendlyLink) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from calendly',
        error: `Error while updating calendly url: ${errForupdateUserCalendlyLink}`,
      });
    }

    return successResponse(res, 'Signed out from calendly successfully.');
  } catch (err) {
    logger.error(`Error while signing out from calendly: `, err);
    if (err?.response?.data?.message)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while signing out from calendly: ${err?.response?.data?.message}`,
      });
    if (err?.response?.data?.error)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while signing out from calendly: ${err?.response?.data?.error}`,
      });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing out from calendly: ${err.message}`,
    });
  }
};

const CalendlyController = {
  redirectToCalendly,
  authorizeCalendly,
  signOutFromCalendly,
};

module.exports = CalendlyController;
