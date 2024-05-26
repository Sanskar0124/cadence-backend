// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponse,
  badRequestResponse,
  successResponse,
} = require('../../../utils/response');
const {
  REDIS_ADDED_USER_IDS_FOR_MAIL,
  REDIS_ADDED_USER_IDS_FOR_MESSAGE,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Repositories
const EmailSettingsRepository = require('../../../../../Cadence-Brain/src/repository/email-settings.repository');

// services and helpers
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');

const createEmailSettings = async (req, res) => {
  try {
    if (!req.body.company_id)
      return badRequestResponse(res, 'No company id provided.');

    const [createdEmailSettings, err] =
      await EmailSettingsRepository.createEmailSettings(req.body);
    if (err) return serverErrorResponse(res, err);

    return successResponse(
      res,
      'Created email settings successfully.',
      createdEmailSettings
    );
  } catch (err) {
    logger.error(`Error while creating email settings: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const updateEmailSettings = async (req, res) => {
  try {
    if (!req.params.company_id)
      return badRequestResponse(res, 'No company id provided.');

    if (req.body.delay && req.body.delay !== parseInt(req.body.delay))
      return badRequestResponse(
        res,
        'Invalid value for delay specified.Only integer values allowed.'
      );

    const [data, err] = await EmailSettingsRepository.updateEmailSettings(
      { company_id: req.params.company_id },
      req.body
    );
    if (err) return serverErrorResponse(res, err);

    if (req.body.max_emails_per_day)
      // * Is max_emails_per_day is changed, remove all company user ids from redis
      RedisHelper.removeCompanyUsers(
        req.params.company_id,
        REDIS_ADDED_USER_IDS_FOR_MAIL
      );

    if (req.body.max_sms_per_day)
      // * Is max_emails_per_day is changed, remove all company user ids from redis
      RedisHelper.removeCompanyUsers(
        req.params.company_id,
        REDIS_ADDED_USER_IDS_FOR_MESSAGE
      );

    return successResponse(res, 'Updated successfully.');
  } catch (err) {
    logger.error(`Error while updating email settings: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const getEmailSettings = async (req, res) => {
  try {
    if (!req.params.company_id)
      return badRequestResponse(res, 'No company id provided.');

    const [emailSetting, err] = await EmailSettingsRepository.getEmailSetting({
      company_id: req.params.company_id,
    });
    if (err) return serverErrorResponse(res, err);

    return successResponse(
      res,
      'Fetched email settings successfully.',
      emailSetting
    );
  } catch (err) {
    logger.error(`Error while fetching email settings: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const EmailSettingsController = {
  createEmailSettings,
  updateEmailSettings,
  getEmailSettings,
};

module.exports = EmailSettingsController;
