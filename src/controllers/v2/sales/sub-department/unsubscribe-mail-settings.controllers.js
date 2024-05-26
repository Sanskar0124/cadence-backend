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
const UnsubscribeMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const unsubscribeMailSettingSchema = require('../../../../joi/v2/admin/unsubscribe-mail-settings.joi');

const createUnsubscribeMailSettingException = async (req, res) => {
  try {
    let body = unsubscribeMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create unsubscribe mail settings exception',
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
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
        query
      );
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create unsubscribe mail settings exception',
        error: `Error while fetching unsubscribe mail settings by query: ${errForException}`,
      });
    if (exception)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists of the same enitiy. Please update it',
      });

    // Set true always for mail tasks
    body.value.semi_automatic_unsubscribed_data.automated_mail = true;
    body.value.semi_automatic_unsubscribed_data.mail = true;
    body.value.semi_automatic_unsubscribed_data.reply_to = true;
    body.value.semi_automatic_unsubscribed_data.automated_reply_to = true;

    body.value.automatic_unsubscribed_data.automated_mail = true;
    body.value.automatic_unsubscribed_data.mail = true;
    body.value.automatic_unsubscribed_data.reply_to = true;
    body.value.automatic_unsubscribed_data.automated_reply_to = true;

    const [createdException, errForCreatedException] =
      await UnsubscribeMailSettingsRepository.createUnsubscribeMailSetting(
        body.value
      );
    if (errForCreatedException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create unsubscribe mail settings exception',
        error: `Error while creating unsubscribe mail settings: ${errForCreatedException}`,
      });

    const [_, errForUpdateUser] =
      await SettingsRepository.updateSettingsByUserQuery(
        {},
        {
          user_id: createdException.user_id,
        },
        {
          unsubscribe_settings_id: createdException.unsubscribe_settings_id,
          unsubscribe_setting_priority: SETTING_LEVELS.USER,
        }
      );
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create unsubscribe mail settings exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error(
      'Error while creating unsubscribe mail settings exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating unsubscribe mail settings exception: ${err.message}`,
    });
  }
};

const updateUnsubscribeMailSettingException = async (req, res) => {
  try {
    const { unsubscribe_settings_id } = req.params;
    if (!unsubscribeMailSettingSchema)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Unsubscribe settings id cannot be empty',
      });

    let body = unsubscribeMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail settings exception',
        error: 'Invalid level provided',
      });

    const [exception, errForException] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        unsubscribe_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail settings exception',
        error: `Error while fetching unsubscribe mail settings by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail settings exception',
        error: 'Exception not found',
      });

    if (exception.user_id !== body.value.user_id) {
      // check if exception exists for new user
      const [userException, errForUserException] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            priority: SETTING_LEVELS.USER,
            user_id: body.value.user_id,
          }
        );
      if (errForUserException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail settings exception',
          error: `Error while fetching unsubscribe mail settings by query: ${errForUserException}`,
        });

      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'An exception already exists for this user',
        });

      // update new user

      const [newUserUpdate, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: body.value.user_id,
          },
          {
            unsubscribe_settings_id: exception.unsubscribe_settings_id,
            unsubscribe_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail settings exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if the old user's sub-dept has an exception
      const [sdException, errForSdException] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
            sd_id: exception.sd_id,
          }
        );
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail settings exception',
          error: `Error while fetching unsubscribe mail setting by query: ${errForSdException}`,
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
              unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              unsubscribe_settings_id: sdException.unsubscribe_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update unsubscribe mail settings exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      } else {
        const [adminSetting, errForAdminSetting] =
          await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
            {
              priority: SETTING_LEVELS.ADMIN,
              company_id: exception.company_id,
            }
          );

        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
              unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update unsubscribe mail settings exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      }
    }

    // Set true always for mail tasks
    body.value.semi_automatic_unsubscribed_data.automated_mail = true;
    body.value.semi_automatic_unsubscribed_data.mail = true;
    body.value.semi_automatic_unsubscribed_data.reply_to = true;
    body.value.semi_automatic_unsubscribed_data.automated_reply_to = true;

    body.value.automatic_unsubscribed_data.automated_mail = true;
    body.value.automatic_unsubscribed_data.mail = true;
    body.value.automatic_unsubscribed_data.reply_to = true;
    body.value.automatic_unsubscribed_data.automated_reply_to = true;

    const [_, errForUpdateException] =
      await UnsubscribeMailSettingsRepository.updateUnsubscribeMailSettings(
        { unsubscribe_settings_id },
        body.value
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail settings exception',
        error: `Error while updating unsubscribe mail settings: ${errForUpdateException}`,
      });

    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    logger.error(
      'Error while updating unsubscribe mail settings exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating unsubscribe mail settings exception: ${err.message}`,
    });
  }
};

const deleteUnsubscribeMailSettingException = async (req, res) => {
  try {
    const { unsubscribe_settings_id } = req.params;
    if (!unsubscribeMailSettingSchema)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Unsubscribe settings id cannot be empty',
      });

    const [exception, errForException] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        unsubscribe_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail settings exception',
        error: `Error while fetching unsubscribe mail setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail settings exception',
        error: 'Exception not found',
      });

    if (exception.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail settings exception',
        error: 'Invalid exception',
      });

    const [_, errForDeleteUnsubscribeSetting] =
      await UnsubscribeMailSettingsRepository.deleteUnsubscribeMailSettingsByQuery(
        {
          unsubscribe_settings_id,
        }
      );
    if (errForDeleteUnsubscribeSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail settings exception',
        error: `Error while deleting unsubscribe mail settings: ${errForDeleteUnsubscribeSetting}`,
      });

    // 1. check if there is an exception for the user's sub-dept
    // 2. If present, update setting level to sub-dept
    // else, update setting level to admin
    const [sdException, errForSdException] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
        sd_id: exception.sd_id,
      });
    if (errForSdException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail settings exception',
        error: `Error while fetching unsubscribe mail settings by query: ${errForSdException}`,
      });

    if (sdException) {
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            unsubscribe_settings_id: sdException.unsubscribe_settings_id,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete unsubscribe mail settings exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
    } else {
      const [adminSetting, errForAdminSetting] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          }
        );
      if (errForAdminSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete unsubscribe mail settings exception',
          error: `Error while fetching unsubscribe mail settings by query: ${errForAdminSetting}`,
        });
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
            unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete unsubscribe mail settings exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error(
      'Error while deleting unsubscribe mail settings exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting unsubscribe mail settings exception: ${err.message}`,
    });
  }
};

const UnsubscribeMailSettingControllers = {
  createUnsubscribeMailSettingException,
  updateUnsubscribeMailSettingException,
  deleteUnsubscribeMailSettingException,
};

module.exports = UnsubscribeMailSettingControllers;
