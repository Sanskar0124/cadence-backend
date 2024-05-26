// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  createdSuccessResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SETTING_LEVELS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Repository
const UnsubscribeMailSettingsRepository = require('../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Helpers

// Joi
const unsubscribeMailSettingSchema = require('../../../joi/v2/admin/unsubscribe-mail-settings.joi');

const createUnsubscribeMailSettingException = async (req, res) => {
  try {
    let body = unsubscribeMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Admin level exception cannot be created',
      });
    if (
      body.value.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      body.value.user_id
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Subdepartment level exception cannot be created if user specified',
        error: 'Subdepartment level exception cannot be created with user_id',
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
        msg: 'Failed to create unsubscribe mail setting exception',
        error: `Error while fetching unsubscribe mail setting exception: ${errForException}`,
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
        msg: 'Failed to create unsubscribe mail setting exception',
        error: `Error while creating unsubscribe mail setting: ${errForCreatedException}`,
      });

    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // Change setting level of those users of sub-dept
      // that do not have higher priority setting level i.e 'user'

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            unsubscribe_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            unsubscribe_settings_id: createdException.unsubscribe_settings_id,
            unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create unsubscribe mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
    } else if (createdException.priority === SETTING_LEVELS.USER) {
      const [_, errForUpdateSettings] =
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
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create unsubscribe mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
    }

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error(
      'Error while adding exceptions for unsubscribe mail settings: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating unsubscribe mail setting exception: ${err.message}`,
    });
  }
};

const updateUnsubscribeMailSettingException = async (req, res) => {
  try {
    const { unsubscribe_settings_id } = req.params;

    if (req.body?.unsubscribe_settings_id != unsubscribe_settings_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail setting exception',
        error:
          'unsubscribe_settings_id in the request body should match the unsubscribe_settings_id in the url',
      });

    let body = unsubscribeMailSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail setting exception',
        error: 'Invalid request: Admin level exception',
      });

    const [exception, errForException] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        unsubscribe_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail setting exception',
        error: `Error while fetching unsubscribe mail setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail setting exception',
        error: 'Exception not found',
      });

    // Exception's subdepartment/user is updated to new subdepartment or user
    if (
      exception.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      exception.sd_id !== body.value.sd_id
    ) {
      // Check if exception exists for new subdepartment
      const [sdException, errForSdException] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
            sd_id: body.value.sd_id,
          }
        );
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while fetching unsubscribe mail setting by query: ${errForSdException}`,
        });

      if (sdException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this subdepartment',
        });

      // Fetch admin setting
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
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while fetching unsubscribe mail setting by query: ${errForAdminSetting}`,
        });
      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
            unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            unsubscribe_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            unsubscribe_settings_id: exception.unsubscribe_settings_id,
            unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );

      const values = await Promise.all([
        updateOldSdSettingsPromise,
        updateNewSdSettingsPromise,
      ]);

      const [_, errForUpdateOldSdUsers] = values[0];
      if (errForUpdateOldSdUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while updating old sd user: ${errForUpdateOldSdUsers}`,
        });
      const [__, errForUpdateNewSdUsers] = values[1];
      if (errForUpdateNewSdUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while updating new sd users: ${errForUpdateNewSdUsers}`,
        });
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
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
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while fetching unsubscribe mail setting by query: ${errForUserException}`,
        });

      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'An exception already exists of the same enitiy. Please update it',
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
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if old user has an sub-dept exception
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
          msg: 'Failed to update unsubscribe mail setting exception',
          error: `Error while fetching unsubscribe mail setting by query: ${errForSdException}`,
        });

      if (sdException) {
        // use subdepartment exception settings for old user
        const [oldUser, errForOldUser] =
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
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update unsubscribe mail setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
      } else {
        // use admin settings
        const [adminSetting, errForAdminSetting] =
          await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
            {
              priority: SETTING_LEVELS.ADMIN,
              company_id: exception.company_id,
            }
          );

        // update old user
        const [oldUser, errForOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
              unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update unsubscribe mail setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
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
        {
          unsubscribe_settings_id,
        },
        body.value
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update unsubscribe mail setting exception',
        error: `Error while updating unsubscribe mail settings: ${errForUpdateException}`,
      });

    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    logger.error('Error while fetching updating unsubscribe exceptions: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating unsubscribe mail setting exceptions: ${err.message}`,
    });
  }
};

const deleteUnsubscribeMailSettingException = async (req, res) => {
  try {
    const { unsubscribe_settings_id } = req.params;

    const [exception, errForException] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        unsubscribe_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail setting exception',
        error: `Error while fetching unsubscribe mail setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete unsubscribe mail setting exception',
        error: 'Exception not found',
      });

    if (exception.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete admin setting',
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
        msg: 'Failed to delete unsubscribe mail setting exception',
        error: `Error while deleting unsubscribe mail settings by query: ${errForDeleteUnsubscribeSetting}`,
      });

    // Check the level of exception
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // If exception is sub-dept level then
      // update the users where exception is sub-dept level
      // (users having higher priority exception level i.e. 'user' should not be updated)

      // Fetch admin setting
      const [adminSetting, errForAdminSetting] =
        await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
          {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          }
        );

      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                unsubscribe_settings_id: exception.unsubscribe_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
            unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );
      if (errForUpdateUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete unsubscribe mail setting exception',
          error: `Error while deleting unsubscribe mail setting exception: ${errForUpdateUsers}`,
        });
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
      // 2. If present, update setting level to sub-dept
      // else, update setting level to admin
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
          msg: 'Failed to delete unsubscribe mail setting exception',
          error: `Error while fetching unsubscribe mail setting exception: ${errForSdException}`,
        });

      if (sdException) {
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              unsubscribe_settings_id: sdException.unsubscribe_settings_id,
              unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (errForUpdateUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete unsubscribe mail setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
      } else {
        // Fetch admin setting because there is no sub-dept exception

        const [adminSetting, errForAdminSetting] =
          await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
            {
              priority: SETTING_LEVELS.ADMIN,
              company_id: exception.company_id,
            }
          );

        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              unsubscribe_settings_id: adminSetting.unsubscribe_settings_id,
              unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForUpdateUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete unsubscribe mail setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
      }
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error('Error while deleting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting unsubscribe mail setting exception: ${err.message}`,
    });
  }
};

const UnsubscribeMailSettingControllers = {
  createUnsubscribeMailSettingException,
  updateUnsubscribeMailSettingException,
  deleteUnsubscribeMailSettingException,
};

module.exports = UnsubscribeMailSettingControllers;
