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
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repository
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const skipSetingsSchema = require('../../../../joi/v2/admin/skip-settings.joi');

const createSkipSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let body = skipSetingsSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    if (body.value.priority !== SETTING_LEVELS.USER) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create skip setting exception',
        error: 'Invalid level provided',
      });
    }

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

    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query,
      t,
    });
    if (errForException) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create skip setting exception',
        error: `Error while fetching skip settings: ${errForException}`,
      });
    }
    if (exception) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists of the same enitiy. Please update it',
      });
    }

    if (!body.value?.skip_reasons) body.value.skip_reasons = ['Other'];
    else {
      // Check if skip reasons includes other
      if (typeof body.value?.skip_reasons === 'object') {
        if (!body.value.skip_reasons.includes('Other'))
          body.value.skip_reasons.push('Other');
      } else body.value.skip_reasons = ['Other'];
    }

    const [createdException, errForCreatedException] = await Repository.create({
      tableName: DB_TABLES.SKIP_SETTINGS,
      createObject: body.value,
      t,
    });
    if (errForCreatedException) {
      t.rollback();
      logger.error(`Error while creating exception: `, errForCreatedException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create skip setting exception',
        error: `Error while fetching skip settings: ${errForCreatedException}`,
      });
    }

    const [_, errForUpdateUser] =
      await SettingsRepository.updateSettingsByUserQuery(
        {},
        {
          user_id: createdException.user_id,
        },
        {
          skip_settings_id: createdException.skip_settings_id,
          skip_setting_priority: SETTING_LEVELS.USER,
        },
        t
      );
    if (errForUpdateUser) {
      t.rollback();
      logger.error(`Error while updating user: `, errForUpdateUser);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create skip setting exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });
    }

    t.commit();
    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while creating skip setting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating skip setting exception: ${err.message}`,
    });
  }
};

const updateSkipSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { skip_settings_id } = req.params;
    if (!skip_settings_id) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Skip settings id cannot be empty',
      });
    }

    let body = skipSetingsSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    if (body.value.priority !== SETTING_LEVELS.USER) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error: 'Invalid level provided',
      });
    }

    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        skip_settings_id,
      },
      t,
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error: `Error while fetching skip settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error: 'Exception not found',
      });
    }
    if (exception.user_id !== body.value.user_id) {
      // check if exception exists for new user
      const [userException, errForUserException] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          priority: SETTING_LEVELS.USER,
          user_id: body.value.user_id,
        },
        t,
      });
      if (errForUserException) {
        t.rollback();
        logger.error(
          `Error while fetching user exception: `,
          errForUserException
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while fetching skip settings: ${errForUserException}`,
        });
      }
      if (userException) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: 'An exception already exists for this user',
        });
      }
      // update new user

      const [newUserUpdate, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: body.value.user_id,
          },
          {
            skip_settings_id: exception.skip_settings_id,
            skip_setting_priority: SETTING_LEVELS.USER,
          },
          t
        );
      if (errForUpdateSettings) {
        t.rollback();
        logger.error(
          `Error while updating user settings: `,
          errForUpdateSettings
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }

      // Check if the old user's sub-dept has an exception
      const [sdException, errForSdException] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: exception.sd_id,
        },
        t,
      });
      if (errForSdException) {
        t.rollback();
        logger.error(
          `Error while fetching subdepartment exception:`,
          errForSdException
        );

        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while fetching skip settings: ${errForSdException}`,
        });
      }
      // update old user

      if (sdException) {
        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              skip_settings_id: sdException.skip_settings_id,
            },
            t
          );
        if (errForUpdateOldUser) {
          t.rollback();
          logger.error(`Error while updating old user: `, errForUpdateOldUser);
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update skip setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
        }
      } else {
        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          },
        });

        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              skip_setting_priority: SETTING_LEVELS.ADMIN,
              skip_settings_id: adminSetting.skip_settings_id,
            },
            t
          );
        if (errForUpdateOldUser) {
          t.rollback();
          logger.error(`Error while updating old user: `, errForUpdateOldUser);
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update skip setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
        }
      }
    }

    if (!body.value?.skip_reasons) body.value.skip_reasons = ['Other'];
    else {
      // Check if skip reasons includes other
      if (typeof body.value?.skip_reasons === 'object') {
        if (!body.value.skip_reasons.includes('Other'))
          body.value.skip_reasons.push('Other');
      }
    }

    const [_, errForUpdateException] = await Repository.update({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        skip_settings_id,
      },
      updateObject: body.value,
    });
    if (errForUpdateException) {
      t.rollback();
      logger.error(
        `Error while updating skip settings exception: `,
        errForUpdateException
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error: `Error while updating skip settings: ${errForUpdateException}`,
      });
    }
    t.commit();
    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating skip settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating skip settings exception: ${err.message}`,
    });
  }
};

const deleteSkipSettingException = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { skip_settings_id } = req.params;
    if (!skipSetingsSchema) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Skip settings id cannot be empty',
      });
    }
    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        skip_settings_id,
      },
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete skip setting exception',
        error: `Error while fetching skip settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete skip setting exception',
        error: 'Exception not found',
      });
    }
    if (exception.priority !== SETTING_LEVELS.USER) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete skip setting exception',
        error: 'Invalid exception',
      });
    }
    const [_, errForDeleteSkipSetting] = await Repository.destroy({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        skip_settings_id,
      },
      t,
    });
    if (errForDeleteSkipSetting) {
      t.rollback();
      logger.error(`Error while deleting exception: `, errForDeleteSkipSetting);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete skip setting exception',
        error: `Error while deleting slip settings: ${errForDeleteSkipSetting}`,
      });
    }
    // 1. check if there is an exception for the user's sub-dept
    // 2. If present, update setting level to sub-dept
    // else, update setting level to admin
    const [sdException, errForSdException] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
        sd_id: exception.sd_id,
      },
      t,
    });
    if (errForSdException) {
      t.rollback();
      logger.error(`Error while fetching sd exception: `, errForSdException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete skip setting exception',
        error: `Error while fetching sd exception: ${errForSdException}`,
      });
    }

    if (sdException) {
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            skip_settings_id: sdException.skip_settings_id,
          },
          t
        );
      if (errForUpdateUser) {
        t.rollback();
        logger.error(`Error while update user: `, errForUpdateUser);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete skip setting exception',
          error: `Error while updating setting by user query: ${errForUpdateUser}`,
        });
      }
    } else {
      const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        },
        t,
      });
      if (errForAdminSetting) {
        t.rollback();
        logger.error(
          `Error while fetching admin settings: `,
          errForAdminSetting
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete skip setting exception',
          error: `Error while fetching skip settings: ${errForAdminSetting}`,
        });
      }
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            skip_setting_priority: SETTING_LEVELS.ADMIN,
            skip_settings_id: adminSetting.skip_settings_id,
          },
          t
        );
      if (errForUpdateUser) {
        t.rollback();
        logger.error(`Error while update users:`, errForUpdateUser);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete skip setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
      }
    }
    t.commit();
    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while deleting skip settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting skip setting exception: ${err.message}`,
    });
  }
};

const SkipSettingControllers = {
  createSkipSettingException,
  updateSkipSettingException,
  deleteSkipSettingException,
};

module.exports = SkipSettingControllers;
