// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  createdSuccessResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  SETTING_LEVELS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Repository
const BouncedMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const bouncedMailSettingSchema = require('../../../../joi/v2/admin/bounced-mail-settings.joi');

const createBouncedMailSettingException = async (req, res) => {
  try {
    let body = bouncedMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create bounced mail setting exception',
        error: 'Invalid level provided',
      });

    // Check if the same exception already exists
    let query = null;
    if (body.value.priority === SETTING_LEVELS.SUB_DEPARTMENT)
      query = {
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
        company_id: body.value.company_id,
        sd_id: body.value.sd_id,
      };
    else
      query = {
        priority: SETTING_LEVELS.USER,
        company_id: body.value.company_id,
        sd_id: body.value.sd_id,
        user_id: body.value.user_id,
      };

    const [exception, errForException] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery(query);
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create bounced mail setting exception',
        error: `Error while fetching bounced mail setting by query:${errForException}`,
      });
    if (exception)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists of the same enitiy. Please update it',
      });

    body.value.semi_automatic_bounced_data.automated_mail = true;
    body.value.semi_automatic_bounced_data.mail = true;
    body.value.semi_automatic_bounced_data.reply_to = true;
    body.value.semi_automatic_bounced_data.automated_reply_to = true;

    body.value.automatic_bounced_data.automated_mail = true;
    body.value.automatic_bounced_data.mail = true;
    body.value.automatic_bounced_data.reply_to = true;
    body.value.automatic_bounced_data.automated_reply_to = true;

    const [createdException, errForCreatedException] =
      await BouncedMailSettingsRepository.createBouncedMailSetting(body.value);
    if (errForCreatedException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create bounced mail setting exception',
        error: `Error while creating bounced mail setting: ${errForCreatedException}`,
      });

    const [_, errForUpdateUser] =
      await SettingsRepository.updateSettingsByUserQuery(
        {
          user_id: createdException.user_id,
        },
        {},
        {
          bounced_settings_id: createdException.bounced_settings_id,
          bounced_setting_priority: SETTING_LEVELS.USER,
        }
      );
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create bounced mail setting exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error('Error while creating bounced mail exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating bounced mail exception: ${err.message}`,
    });
  }
};

const updateBouncedMailSettingException = async (req, res) => {
  try {
    const { bounced_settings_id } = req.params;
    if (!bounced_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Bounced settings id cannot be empty',
      });

    let body = bouncedMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update bounced mail setting exception',
        error: 'Invalid level provided',
      });

    const [exception, errForException] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
        bounced_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update bounced mail setting exception',
        error: `Error while fetching bounced mail setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update bounced mail setting exception',
        error: 'Exception not found',
      });

    if (exception.user_id !== body.value.user_id) {
      const [userException, errForUserException] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          priority: SETTING_LEVELS.USER,
          user_id: body.value.user_id,
        });
      if (errForUserException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while fetching bounced mail setting by query: ${errForUserException}`,
        });

      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this user',
        });

      // update new user

      const [newUserUpdate, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: body.value.user_id,
          },
          {
            bounced_settings_id: exception.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if the old user's sub-dept has an exception
      const [sdException, errForSdException] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: exception.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while fetching bounced mail setting by query: ${errForSdException}`,
        });
      // update old user

      if (sdException) {
        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              bounced_settings_id: sdException.bounced_settings_id,
              bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update bounced mail setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      } else {
        const [adminSetting, errForAdminSetting] =
          await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });

        if (errForAdminSetting)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update bounced mail setting exception',
            error: `Error while fetching bounced mail setting by query: ${errForAdminSetting}`,
          });

        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              bounced_settings_id: adminSetting.bounced_settings_id,
              bounced_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update bounced mail setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      }
    }

    body.value.semi_automatic_bounced_data.automated_mail = true;
    body.value.semi_automatic_bounced_data.mail = true;
    body.value.semi_automatic_bounced_data.reply_to = true;
    body.value.semi_automatic_bounced_data.automated_reply_to = true;

    body.value.automatic_bounced_data.automated_mail = true;
    body.value.automatic_bounced_data.mail = true;
    body.value.automatic_bounced_data.reply_to = true;
    body.value.automatic_bounced_data.automated_reply_to = true;

    const [_, errForUpdateException] =
      await BouncedMailSettingsRepository.updateBouncedMailSettings(
        { bounced_settings_id },
        body.value
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update bounced mail setting exception',
        error: `Error while updating bounced mail settings: ${errForUpdateException}`,
      });

    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    logger.error(
      'Error while updating bounced mail exception for admin: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating bounced mail exception for admin: ${err.message}`,
    });
  }
};

const deleteBouncedMailSettingException = async (req, res) => {
  try {
    const { bounced_settings_id } = req.params;
    if (!bounced_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Bounced settings id cannot be empty',
      });

    const [exception, errForException] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
        bounced_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete bounced mail setting exception',
        error: `Error while fetching bounced mail setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete bounced mail setting exception',
        error: 'Exception not found',
      });

    if (exception.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete bounced mail setting exception',
        error: 'Invalid exception',
      });

    const [_, errForDeleteBouncedSetting] =
      await BouncedMailSettingsRepository.deleteBouncedMailSettingsByQuery({
        bounced_settings_id,
      });
    if (errForDeleteBouncedSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete bounced mail setting exception',
        error: `Error while deleting bounced mail settings by query: ${errForDeleteBouncedSetting}`,
      });

    // 1. check if there is an exception for the user's sub-dept
    // 2. If present, update setting level to sub-dept
    // else, update setting level to admin
    const [sdException, errForSdException] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
        sd_id: exception.sd_id,
      });
    if (errForSdException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete bounced mail setting exception',
        error: `Error while fetching bounced mail setting by query: ${errForSdException}`,
      });

    if (sdException) {
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            bounced_settings_id: sdException.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete bounced mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
    } else {
      const [adminSetting, errForAdminSetting] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });

      if (errForAdminSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete bounced mail setting exception',
          error: `Error while fetching bounced mail setting by query: ${errForAdminSetting}`,
        });

      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            bounced_settings_id: adminSetting.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete bounced mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error('Error while deleting bounced mail exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting bounced mail exception: ${err.message}`,
    });
  }
};

const BouncedMailSettingControllers = {
  createBouncedMailSettingException,
  updateBouncedMailSettingException,
  deleteBouncedMailSettingException,
};

module.exports = BouncedMailSettingControllers;
