// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  MAIL_SCOPE_LEVEL,
  TRACKING_ACTIVITIES,
  TRACKING_REASONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { google } = require('googleapis');

// Repositories
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const UserTokenRepository = require('../../../../../../Cadence-Brain/src/repository/user-token.repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CryptoHelper = require('../../../../../../Cadence-Brain/src/helper/crypto');
const oauth2Client = require('../../../../../../Cadence-Brain/src/services/Google/oathClient');
const Mail = require('../../../../../../Cadence-Brain/src/services/Google/Mail');

const getLink = (req, res) => {
  try {
    return successResponse(
      res,
      'Generated oauth link',
      oauth2Client.generateAuthUrl(req.user.email, req.user.email_scope_level)
    );
  } catch (err) {
    logger.error(`Error while getting google link: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting google link: ${err.message}`,
    });
  }
};

const authorize = async (req, res) => {
  try {
    const { auth_code } = req.body;
    const [tokens, err] = await oauth2Client.getTokens(
      auth_code,
      req.user.email_scope_level
    );
    if (err || !tokens)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to connect with Google',
        error: `Error while fetching tokens: ${err}`,
      });

    // update user's primary email
    const oauth = oauth2Client.get(
      { refresh_token: tokens.refresh_token },
      req.user.email_scope_level
    );
    const gmail = google.gmail({ version: 'v1', auth: oauth });

    // * Extract user email for different scope
    switch (req.user.email_scope_level) {
      case MAIL_SCOPE_LEVEL.STANDARD:
        const people = google.people({ version: 'v1', auth: oauth });

        const googleUserInfo = await people.people.get({
          resourceName: 'people/me',
          personFields: 'emailAddresses',
        });

        // * Find if req.user.email is present for the user
        let emailMatched = googleUserInfo.data.emailAddresses.filter(
          (email) => email.value === req.user.email
        );

        // * User email address does not match with cadence
        if (!emailMatched.length)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please sign in with your registered email address',
          });

        // * Update primary mail
        await UserRepository.updateUserById(
          { primary_email: emailMatched[0]?.value },
          req.user.user_id
        );

        break;
      case MAIL_SCOPE_LEVEL.ADVANCE:
        // * Fetch user's email
        let profile = await gmail.users.getProfile({ userId: 'me' });
        // * Check if the user email is matching
        if (profile?.data?.emailAddress !== req.user.email) {
          console.log(' ----- ');
          console.log(profile?.data);
          console.log(' ----- ');
          console.log(profile?.data?.emailAddress);
          console.log(' ----- ');
          console.log(req.user.email);

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Please sign in with your registered email address',
          });
        }

        let aliases = await gmail.users.settings.sendAs.list({ userId: 'me' });
        const signedInEmail =
          aliases.data.sendAs[0]?.sendAsEmail ?? req.user.email;
        await UserRepository.updateUserById(
          { primary_email: signedInEmail },
          req.user.user_id
        );
        break;
    }

    const [encryptedGoogleRefreshToken, errForEncryptedGoogleRefreshToken] =
      CryptoHelper.encrypt(tokens.refresh_token);

    if (!errForEncryptedGoogleRefreshToken) {
      const [_, error] = await UserTokenRepository.updateUserTokenByQuery(
        {
          user_id: req.user.user_id,
        },
        {
          encrypted_google_refresh_token: encryptedGoogleRefreshToken,
          is_google_token_expired: false,
        }
      );

      if (error)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to connect with google',
          error: `Error while updating user token by query: ${error}`,
        });
      Repository.create({
        tableName: DB_TABLES.TRACKING,
        createObject: {
          user_id: req.user.user_id,
          activity: TRACKING_ACTIVITIES.GOOGLE_SIGN_IN,
          reason: TRACKING_REASONS.MANUALLY_SIGNED_IN,
          metadata: {
            correlationId: res?.correlationId,
            controller: `authorize: authorize`,
          },
        },
      });
    }

    successResponse(
      res,
      'Successfully completed google sign in, Sync with google has started!'
    );

    if (req.user.email_scope_level === MAIL_SCOPE_LEVEL.STANDARD)
      return logger.info(
        'Not syncing with Google as user has standard scopes.'
      );

    const [userToken, errForUserToken] =
      await UserTokenRepository.getUserTokenByQuery({
        user_id: req.user.user_id,
      });

    const [history] = await Mail.Inbox.createNotificationChannel({
      refresh_token: userToken?.google_refresh_token,
    });
    if (history) {
      const [
        encryptedGoogleMailLastHistoryId,
        errForEncryptedGoogleMailLastHistoryId,
      ] = CryptoHelper.encrypt(history.historyId);

      if (errForEncryptedGoogleMailLastHistoryId)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'An unexpected error occurred. Please sign in again.',
        });

      const [_, errForUserTokenUpdate] =
        await UserTokenRepository.updateUserTokenByQuery(
          {
            user_id: req.user.user_id,
          },
          {
            encrypted_google_mail_last_history_id:
              encryptedGoogleMailLastHistoryId,
            google_token_expiration: history.expiration,
          }
        );
      if (errForUserTokenUpdate)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'An unexpected error occurred. Please sign in again',
        });
    }
  } catch (err) {
    logger.error(`Error while signing in with Google: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while signing in with Google: ${err.message}`,
    });
  }
};

const revoke = async (req, res) => {
  try {
    const [_, err] = await oauth2Client.revokeToken(
      req.token.refresh_token,
      req.user.email_scope_level
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from google',
        error: `Error while revoking token: ${err}`,
      });

    successResponse(res, 'Successfully revoked access');
    //TODO: Stop notification channel
    // await UserRepository.updateUserById(
    //   {
    //     google_refresh_token: null,
    //     google_mail_last_history_id: null,
    //     google_calendar_sync_token: null,
    //     google_calendar_channel_id: null,
    //   },
    //   req.user.user_id
    // );

    const [userTokenUpdate, errForUserTokenUpdate] =
      await UserTokenRepository.updateUserTokenByQuery(
        {
          user_id: req.user.user_id,
        },
        {
          encrypted_google_refresh_token: null,
          encrypted_google_mail_last_history_id: null,
          encrypted_google_calendar_sync_token: null,
          encrypted_google_calendar_channel_id: null,
          is_google_token_expired: true,
        }
      );
    if (!errForUserTokenUpdate)
      Repository.create({
        tableName: DB_TABLES.TRACKING,
        createObject: {
          user_id: req.user.user_id,
          activity: TRACKING_ACTIVITIES.GOOGLE_SIGNED_OUT,
          reason: TRACKING_REASONS.MANUALLY_REVOKED,
          metadata: {
            correlationId: res?.correlationId,
            controller: `Revoke: revoke`,
          },
        },
      });
  } catch (err) {
    logger.error(`Error while revoking google: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while revoking Google: ${err.message}`,
    });
  }
};

const isGoogleTokenExpired = async (req, res) => {
  try {
    const [userToken, errForUserToken] =
      await UserTokenRepository.getUserTokenByQuery({
        user_id: req.user.user_id,
      });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to check token validity',
        error: `Error while fetching user tokens: ${errForUserToken}`,
      });

    if (
      userToken.is_google_token_expired ||
      !userToken.encrypted_google_refresh_token
    )
      return successResponse(res, 'Fetched google token status', {
        isTokenExpired: true,
      });
    else
      return successResponse(res, 'Fetched google token status', {
        isTokenExpired: false,
      });
  } catch (err) {
    logger.error(`Error while checking is google token expired: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking is google token expired: ${err.message}`,
    });
  }
};

const signout = async (req, res) => {
  try {
    const [userToken, errForUserToken] =
      await UserTokenRepository.getUserTokenByQuery({
        user_id: req.user.user_id,
      });
    if (errForUserToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sign out from google',
        error: `Error while fetching user tokens: ${errForUserToken}`,
      });

    // set primary_email to null
    await UserRepository.updateUserById(
      { primary_email: null },
      req.user.user_id
    );

    const result = await oauth2Client.signout(
      userToken?.google_refresh_token,
      req.user.email_scope_level
    );

    //TODO: What happens if status is not 200?
    if (result.status === 200) {
      const [data, err] = await UserTokenRepository.updateUserTokenByQuery(
        {
          user_id: req.user.user_id,
        },
        {
          encrypted_google_refresh_token: null,
          encrypted_google_mail_last_history_id: null,
          encrypted_google_calendar_sync_token: null,
          encrypted_google_calendar_channel_id: null,
          is_google_token_expired: true,
          //TODO: Make google_token_expiration : null
        }
      );
      if (!err)
        Repository.create({
          tableName: DB_TABLES.TRACKING,
          createObject: {
            user_id: req.user.user_id,
            activity: TRACKING_ACTIVITIES.GOOGLE_SIGNED_OUT,
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
    } else
      return successResponse(res, 'Signed Out Failed', {
        signout: false,
      });
  } catch (err) {
    logger.error(
      'An error occurred while signing out from google: ',
      err.message
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying to sign out from google`,
    });
  }
};

const AuthenticationController = {
  getLink,
  authorize,
  revoke,
  isGoogleTokenExpired,
  signout,
};

module.exports = AuthenticationController;
