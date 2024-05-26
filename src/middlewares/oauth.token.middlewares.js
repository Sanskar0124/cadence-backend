// Utils
const {
  unauthorizedResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../utils/response');
const logger = require('../utils/winston');
const { DB_TABLES } = require('../../../Cadence-Brain/src/utils/modelEnums');
const {
  MAIL_INTEGRATION_TYPES,
} = require('../../../Cadence-Brain/src/utils/enums');

// Repositories
const Repository = require('../../../Cadence-Brain/src/repository');

module.exports = async (req, res, next) => {
  try {
    const { user_id, mail_integration_type } = req.user;

    logger.info(`Mail integration type: ${mail_integration_type}`);

    switch (mail_integration_type) {
      case MAIL_INTEGRATION_TYPES.GOOGLE: {
        const [userToken, err] = await Repository.fetchOne({
          tableName: DB_TABLES.USER_TOKEN,
          query: { user_id },
        });
        if (err)
          return unauthorizedResponseWithDevMsg({
            res,
            msg: "Token doesn't belong to any user",
          });

        if (!userToken?.google_refresh_token) {
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Connect with Google to access this feature',
          });
        }

        req.token = {
          refresh_token: userToken?.google_refresh_token,
          type: MAIL_INTEGRATION_TYPES.GOOGLE,
        };
        return next();
      }
      case MAIL_INTEGRATION_TYPES.OUTLOOK: {
        const [userToken, err] = await Repository.fetchOne({
          tableName: DB_TABLES.USER_TOKEN,
          query: { user_id },
        });
        if (err)
          return unauthorizedResponseWithDevMsg({
            res,
            msg: "Token doesn't belong to any user",
          });

        if (!userToken?.outlook_refresh_token) {
          return unauthorizedResponseWithDevMsg({
            res,
            msg: 'Sign In with Outlook to access this feature',
          });
        }

        req.token = {
          refresh_token: userToken?.outlook_refresh_token,
          type: MAIL_INTEGRATION_TYPES.OUTLOOK,
        };
        return next();
      }
      default: {
        logger.info(`Invalid mail integration type`);
        return unauthorizedResponseWithDevMsg({
          res,
          msg: 'Invalid mail integration type: Please ask Super Admin to register an type of integration for accessing your mails and calendars',
        });
      }
    }
  } catch (err) {
    logger.error('Error while checking oauth:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking oauth: ${err.message}`,
    });
  }
};
