// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  OUTLOOK_ACCESS_TOKEN_REDIS_KEY,
} = require('../../../../../../Cadence-Brain/src/utils/constants');
const {
  TRACKING_ACTIVITIES,
  TRACKING_REASONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const redisHelper = require('../../../../../../Cadence-Brain/src/helper/redis');
const oauth2Client = require('../../../../../../Cadence-Brain/src/services/Outlook/oauthClient');
const CryptoHelper = require('../../../../../../Cadence-Brain/src/helper/crypto');
const OutlookService = require('../../../../../../Cadence-Brain/src/services/Outlook/Mail');

const getLink = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [authUrl, err] = await oauth2Client.generateAuthUrl(user_id);
    if (err)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch link',
        error: `Error while generating url: ${err}`,
      });

    return successResponse(res, 'Generated oauth link.', authUrl);
  } catch (err) {
    logger.error(`Error in generating url for outlook ouath`, err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching link: ${err.message}`,
    });
  }
};

const authorize = async (req, res) => {
  try {
    const { auth_code } = req.body;

    //fetching refresh token
    logger.info('Fetching refresh token from authcode.');

    const [tokenData, err] = await oauth2Client.getRefreshToken(auth_code);
    if (err) {
      logger.error('Error in fetching refresh token');
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Error in exchanging auth-code for refresh token: ${err}`,
      });
    }

    const { refresh_token, access_token, expires_in } = tokenData;

    // Setting cache
    logger.info(`Caching access token`);

    const [redisStatus, redisError] = await redisHelper.setWithExpiry(
      OUTLOOK_ACCESS_TOKEN_REDIS_KEY + '-' + refresh_token,
      access_token,
      expires_in - 10 //keeping a margin of 10sec to expire in our system before 10sec
    );
    if (redisError) logger.error(`Failed to update in redis.`);

    //create subscription
    logger.info(`Creating subscription`);

    const [subscriptionData, subscriptionErr] =
      await OutlookService.Subscriptions.create({
        refresh_token: refresh_token,
        user_id: req.user.user_id,
      });
    if (subscriptionErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Error while creating outlook subscribtion: ${subscriptionErr}`,
      });

    //updating database with outlook data
    logger.info(`Updating user tokens in database.`);

    const [encrypted_refresh_token, err_in_encryption] =
      CryptoHelper.encrypt(refresh_token);
    if (err_in_encryption)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Error while encryption of refresh token: ${err_in_encryption}`,
      });

    const [updateTokens, updateUserTokenErr] = await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: req.user.user_id },
      updateObject: {
        encrypted_outlook_refresh_token: encrypted_refresh_token,
        is_outlook_token_expired: false,
        is_google_token_expired: false,
        outlook_mail_outbox_subscription_id: subscriptionData.inboxMailSub.id,
        outlook_mail_inbox_subscription_id: subscriptionData.outboxMailSub.id,
        outlook_calendar_subscription_id: subscriptionData.calendarSub.id,
      },
    });
    if (updateUserTokenErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Failed to update outlook data in DB: ${updateUserTokenErr}`,
      });

    Repository.create({
      tableName: DB_TABLES.TRACKING,
      createObject: {
        user_id: req.user.user_id,
        activity: TRACKING_ACTIVITIES.OUTLOOK_SIGN_IN,
        reason: TRACKING_REASONS.MANUALLY_SIGNED_IN,
        metadata: {
          correlationId: res?.correlationId,
          controller: `authorize: authorize`,
        },
      },
    });

    //set primary mail
    logger.info(`Setting primary mail`);

    const [user, userErr] = await oauth2Client.getUser(refresh_token);
    if (userErr) {
      logger.error(`Error while fetching outlook user`);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Error while fetching outlook user: ${userErr}`,
      });
    }

    const [userUpdate, userUpdateErr] = await Repository.update({
      tableName: DB_TABLES.USER,
      updateObject: { primary_email: user.userPrincipalName },
      query: { user_id: req.user.user_id },
    });
    if (userUpdateErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to authorize',
        error: `Error while updating user: ${userUpdateErr}`,
      });

    return successResponse(res, 'Successfully completed outlook sign in.', {
      refresh_token,
    });
  } catch (err) {
    logger.error(`Error in outlook authorization.`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing in with outlook: ${err.message}`,
    });
  }
};

const isOutlookTokenExpired = async (req, res) => {
  try {
    const [userToken, errForUserToken] = await Repository.fetchOne({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: req.user.user_id },
    });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to verify outlook token',
        error: `Error while fetching user tokens: ${errForUserToken}`,
      });

    if (userToken.is_outlook_token_expired || !userToken.outlook_refresh_token)
      return successResponse(res, 'Fetched outlook token status.', {
        isTokenExpired: true,
      });

    return successResponse(res, 'Fetched outlook token status.', {
      isTokenExpired: false,
    });
  } catch (err) {
    logger.error(`Error while checking if outlook token is expired: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking if outlook token is expired: ${err.message}`,
    });
  }
};

const signout = async (req, res) => {
  try {
    // logger.info(`Trying to revoke token on outlook's end`);

    const [userToken, fetchUserTokenErr] = await Repository.fetchOne({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: req.user.user_id },
    });
    if (fetchUserTokenErr) {
      logger.error(`Unable to fetch user_token table.`);
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching user token: ${fetchUserTokenErr}`,
      });
    }

    // set primary_email to null

    logger.info(`Updating user table.`);
    const [_, updateErr] = await Repository.update({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      updateObject: { primary_email: null },
    });
    if (updateErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from outlook',
        error: `Error in updating primary email: ${updateErr}`,
      });

    //clear subscriptions
    const [deleteSubRes, deleteSubErr] =
      await OutlookService.Subscriptions.deleteSub({
        refresh_token: userToken.outlook_refresh_token,
        subscriptionIds: [
          userToken.outlook_mail_inbox_subscription_id,
          userToken.outlook_mail_outbox_subscription_id,
          userToken.outlook_calendar_subscription_id,
        ],
      });
    if (deleteSubErr)
      logger.error(
        `Error while removing active subscriptions, continuing signout: `,
        deleteSubErr
      );

    logger.info(`subscriptions removed`);

    //update user_token Table
    logger.info(`Updating user_token table.`);
    const [updateUserTokenResult, updateUserTokenErr] = await Repository.update(
      {
        tableName: DB_TABLES.USER_TOKEN,
        query: {
          user_id: req.user.user_id,
        },
        updateObject: {
          encrypted_outlook_refresh_token: null,
          is_outlook_token_expired: true,
          is_google_token_expired: true,
          outlook_calendar_subscription_id: null,
          outlook_mail_inbox_subscription_id: null,
          outlook_mail_outbox_subscription_id: null,
        },
      }
    );
    if (updateUserTokenErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from outlook',
        error: `Error while updating user token: ${updateUserTokenErr}`,
      });

    Repository.create({
      tableName: DB_TABLES.TRACKING,
      createObject: {
        user_id: req.user.user_id,
        activity: TRACKING_ACTIVITIES.OUTLOOK_SIGNED_OUT,
        reason: TRACKING_REASONS.MANUALLY_SIGNED_OUT,
        metadata: {
          correlationId: res?.correlationId,
          controller: `Sign out: signout`,
        },
      },
    });

    return successResponse(res, 'Signed Out', {
      signout: true,
    });
  } catch (err) {
    logger.error('An error occured while signing out from outlook: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying to sign out from outlook: ${err.message}`,
    });
  }
};

const authenticationController = {
  getLink,
  authorize,
  isOutlookTokenExpired,
  signout,
};

module.exports = authenticationController;
