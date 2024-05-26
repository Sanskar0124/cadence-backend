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
const BouncedMailSettingsRepository = require('../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const BouncedMailSettingSchema = require('../../../joi/v2/admin/bounced-mail-settings.joi');

const createBouncedMailSettingException = async (req, res) => {
  try {
    let body = BouncedMailSettingSchema.validate(req.body);

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
        msg: 'Subdepartment level exception cannot be created if user is specified',
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
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery(query);
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create bounced mail setting exception',
        error: `Error while fetching bounced mail setting by query: ${errForException}`,
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

    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // Change setting level of those users of sub-dept
      // that do not have higher priority setting level i.e 'user'

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            bounced_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            bounced_settings_id: createdException.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create bounced mail setting exception',
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
            bounced_settings_id: createdException.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create bounced mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
    }

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error('Error while creating bounced mail setting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating bounced mail setting exception: ${err.message}`,
    });
  }
};

const updateBouncedMailSettingException = async (req, res) => {
  try {
    const { bounced_settings_id } = req.params;

    if (req.body?.bounced_settings_id != bounced_settings_id)
      return badRequestResponseWithDevMsg({
        res,
        error:
          'bounced_settings_id in the request body should match the bounced_settings_id in the url',
      });

    let body = BouncedMailSettingSchema.validate(req.body);

    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        error: 'Invalid request: Admin level exception',
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
      return notFoundResponseWithDevMsg({ res, msg: 'Exception not found' });

    if (
      exception.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      exception.sd_id !== body.value.sd_id
    ) {
      // Check if exception exists for new subdp

      const [sdException, errForSdException] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: body.value.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while fetching bounced mail setting by query: ${errForSdException}`,
        });

      if (sdException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this subdepartment',
        });

      // Change setting level of those users of sub-dept

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

      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            bounced_settings_id: adminSetting.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            bounced_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            bounced_settings_id: exception.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while updating old sd users: ${errForUpdateOldSdUsers}`,
        });
      const [__, errForUpdateNewSdUsers] = values[1];
      if (errForUpdateNewSdUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update bounced mail setting exception',
          error: `Error while updating new sd users: ${errForUpdateNewSdUsers}`,
        });
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
      // check if exception exists for new user

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
      // update new user setting
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
          error: `Error whie updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if old user has an sub-dept exception
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

      if (sdException) {
        // Change to subdepartment setting level of old user
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
            error: `Error while updating old user: ${errForUpdateOldUser}`,
          });
      } else {
        // Fetch admin Setting

        const [adminSetting, errForAdminSetting] =
          await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });

        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              bounced_setting_priority: SETTING_LEVELS.ADMIN,
              bounced_settings_id: adminSetting.bounced_settings_id,
            }
          );

        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update bounced mail setting exception',
            error: `Error while updating old user: ${errForUpdateOldUser}`,
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
        {
          bounced_settings_id,
        },
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
    logger.error('Error while updating bounced mail exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating bounced mail exception: ${err.message}`,
    });
  }
};

const deleteBouncedMailSettingException = async (req, res) => {
  try {
    const { bounced_settings_id } = req.params;
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
      return notFoundResponseWithDevMsg({ res, msg: 'Exception not found' });

    if (exception.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete admin setting',
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

    // Check the level of exception
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // If exception is sub-dept level then
      // update the settings where exception is sub-dept level
      // (users having higher priority exception level i.e. 'user' should not be updated)

      const [adminSetting, errForAdminSetting] =
        await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });

      // Update all users of sub-dept to admin level
      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                bounced_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                bounced_settings_id: exception.bounced_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            bounced_settings_id: adminSetting.bounced_settings_id,
            bounced_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );

      if (errForUpdateUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete bounced mail setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUsers}`,
        });
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
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
        const [_, errForUpdateUser] =
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

        const [_, errForUpdateUser] =
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
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error('Error while deleting bounced mail settings: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting bounced mail settings: ${err.message}`,
    });
  }
};

const BouncedeMailSettingControllers = {
  createBouncedMailSettingException,
  updateBouncedMailSettingException,
  deleteBouncedMailSettingException,
};

module.exports = BouncedeMailSettingControllers;
