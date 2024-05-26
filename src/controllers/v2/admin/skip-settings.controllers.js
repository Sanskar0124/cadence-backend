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
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const skipSettingSchema = require('../../../joi/v2/admin/skip-settings.joi');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

const createSkipSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let body = skipSettingSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    if (body.value.priority === SETTING_LEVELS.ADMIN) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Admin level exception cannot be created',
      });
    }
    if (
      body.value.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      body.value.user_id
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Subdepartment level exception cannot be created if user specified',
        error: 'Subdepartment level exception cannot be created with user_id',
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
      logger.error(`Error while fetching exception: `, errForException);
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
      logger.error(
        `Error while creating skip setting exception: `,
        errForCreatedException
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create skip setting exception',
        error: `Error while creating skip settings: ${errForCreatedException}`,
      });
    }
    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // Change setting level of those users of sub-dept
      // that do not have higher priority setting level i.e 'user'

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            skip_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            skip_settings_id: createdException.skip_settings_id,
            skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          t
        );
      if (errForUpdateSettings) {
        t.rollback();
        logger.error(
          `Error while updating settings for sd users: `,
          errForUpdateSettings
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create skip setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }
    } else if (createdException.priority === SETTING_LEVELS.USER) {
      const [_, errForUpdateSettings] =
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
      if (errForUpdateSettings) {
        t.rollback();
        logger.error(
          `Error while updating settings for user: `,
          errForUpdateSettings
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create skip setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }
    }
    t.commit();
    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while adding exceptions for Skip settings: ', err);
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

    if (req.body?.skip_settings_id != skip_settings_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error:
          'skip_settings_id in the request body should match the skip_settings_id in the url',
      });
    }
    let body = skipSettingSchema.validate(req.body);
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    if (body.value.priority === SETTING_LEVELS.ADMIN) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update skip setting exception',
        error: 'Invalid request: Admin level exception',
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
        mag: 'Failed to update skip setting exception',
        error: 'Exception not found',
      });
    }

    // Exception's subdepartment/user is updated to new subdepartment or user
    if (
      exception.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      exception.sd_id !== body.value.sd_id
    ) {
      // Check if exception exists for new subdepartment
      const [sdException, errForSdException] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: body.value.sd_id,
        },
        t,
      });
      if (errForSdException) {
        t.rollback();
        logger.error(`Error while fetching subdpt: `, errForSdException);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while fetching sub-department: ${errForSdException}`,
        });
      }
      if (sdException) {
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this subdepartment',
        });
      }

      // Fetch admin setting
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
          `Error while fetching admin skip settings: `,
          errForAdminSetting
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while fetching skip settings: ${errForAdminSetting}`,
        });
      }
      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            skip_settings_id: adminSetting.skip_settings_id,
            skip_setting_priority: SETTING_LEVELS.ADMIN,
          },
          t
        );

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            skip_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            skip_settings_id: exception.skip_settings_id,
            skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          t
        );

      const values = await Promise.all([
        updateOldSdSettingsPromise,
        updateNewSdSettingsPromise,
      ]);

      const [_, errForUpdateOldSdUsers] = values[0];
      if (errForUpdateOldSdUsers) {
        t.rollback();
        logger.error(
          `Error while updating old subdpt users: `,
          errForUpdateOldSdUsers
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while updating old users: ${errForUpdateOldSdUsers}`,
        });
      }
      const [__, errForUpdateNewSdUsers] = values[1];
      if (errForUpdateNewSdUsers) {
        t.rollback();
        logger.error(
          `Error while updating new sd users: `,
          errForUpdateNewSdUsers
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while updating new sd users: ${errForUpdateNewSdUsers}`,
        });
      }
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
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
          msg: 'An exception already exists of the same enitiy. Please update it',
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
        logger.error(`Error while updating user: `, errForUpdateSettings);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update skip setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }

      // Check if old user has an sub-dept exception
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
          msg: 'Failed to update skip setting exception',
          error: `Error while fetching skip settings: ${errForSdException}`,
        });
      }
      if (sdException) {
        // use subdepartment exception settings for old user
        const [oldUser, errForOldUser] =
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
        if (errForOldUser) {
          {
            t.rollback();
            logger.error(
              `Error while updating exceptions for old subdpt users: `,
              errForOldUser
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update skip setting exception',
              error: `Error while updating settings by user query: ${errForOldUser}`,
            });
          }
        }
      } else {
        // use admin settings
        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          },
        });

        // update old user
        const [oldUser, errForOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              skip_settings_id: adminSetting.skip_settings_id,
              skip_setting_priority: SETTING_LEVELS.ADMIN,
            },
            t
          );
        if (errForOldUser) {
          t.rollback();
          logger.error(
            `Error while updating exceptions for old user: `,
            errForOldUser
          );

          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update skip setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
        }
      }
    }

    const [_, errForUpdateException] = await Repository.update({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        skip_settings_id,
      },
      t,
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
    logger.error(
      'Error while fetching updating skip settings exceptions: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating skip setting exception: ${err.message}`,
    });
  }
};

const deleteSkipSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { skip_settings_id } = req.params;

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

    if (exception.priority === SETTING_LEVELS.ADMIN) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete admin setting',
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
        error: `Error while deleting skip settings: ${errForDeleteSkipSetting}`,
      });
    }

    // Check the level of exception
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // If exception is sub-dept level then
      // update the users where exception is sub-dept level
      // (users having higher priority exception level i.e. 'user' should not be updated)

      // Fetch admin setting
      const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        },
      });

      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                skip_settings_id: exception.skip_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            skip_settings_id: adminSetting.skip_settings_id,
            skip_setting_priority: SETTING_LEVELS.ADMIN,
          },
          t
        );
      if (errForUpdateUsers) {
        t.rollback();
        logger.error(
          `Error while updating user settings for subdepartment: `,
          errForUpdateUsers
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete skip setting exception',
          error: `Error while updating settings by user by query: ${errForUpdateUsers}`,
        });
      }
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
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
          error: `Error while fetching skip settings: ${errForSdException}`,
        });
      }
      if (sdException) {
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              skip_settings_id: sdException.skip_settings_id,
              skip_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            },
            t
          );
        if (errForUpdateUser) {
          t.rollback();
          logger.error(
            `Error while fetching updating user setting for user level: `,
            errForUpdateUser
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete skip setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
        }
      } else {
        // Fetch admin setting because there is no sub-dept exception

        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          },
        });

        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              skip_settings_id: adminSetting.skip_settings_id,
              skip_setting_priority: SETTING_LEVELS.ADMIN,
            },
            t
          );
        if (errForUpdateUser) {
          t.rollback();
          logger.error(
            `Error while fetching updating old user to admin setting: `,
            errForUpdateUser
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete skip setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
        }
      }
    }
    t.commit();
    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while deleting exception: ', err);
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
