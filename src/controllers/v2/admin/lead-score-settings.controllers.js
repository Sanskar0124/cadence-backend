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
  SETTINGS_ID_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Joi
const leadScoreSettingSchema = require('../../../joi/v2/admin/lead_score_settings.joi');
const LeadScoreHelper = require('../../../../../Cadence-Brain/src/helper/lead-score');

const createLeadScoreSettingsException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let body = leadScoreSettingSchema.validate(req.body);
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
        msg: 'Failed to create lead score settings exception',
        error: 'Admin level exception cannot be created',
      });
    }
    if (
      body.value.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      body.value.user_id
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Subdepartment level exception cannot be created if user exist',
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
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query,
      t,
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead score settings exception',
        error: `Error while fetching lead score settings: ${errForException}`,
      });
    }
    if (exception) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists of the same enitiy. Please update it',
      });
    }

    const [createdException, errForCreatedException] = await Repository.create({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      createObject: body.value,
      t,
    });
    if (errForCreatedException) {
      t.rollback();
      logger.error(
        `Error while creating lead score settings setting exception: `,
        errForCreatedException
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead score settings exception',
        error: `Error while creating lead score settings: ${errForCreatedException}`,
      });
    }
    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // Change setting level of those users of sub-dept
      // that do not have higher priority setting level i.e 'user'

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            ls_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            ls_settings_id: createdException.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
          msg: 'Failed to create lead score settings exception',
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
            ls_settings_id: createdException.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.USER,
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
          msg: 'Failed to create lead score settings exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }
    }

    t.commit();
    createdSuccessResponse(
      res,
      'Successfully created new exception for lead scoring.'
    );
    // Reset Lead Scores of Leads
    let [updateLeadScore, errForUpdatedLeadScore] =
      await LeadScoreHelper.updateLeadScoreOnSettingsChange({
        id: createdException?.[SETTINGS_ID_TYPES?.[createdException?.priority]],
        priority: createdException?.priority,
        score_threshold: body.value?.score_threshold,
        reset_period: body.value?.reset_period,
      });
    return;
  } catch (err) {
    t.rollback();
    console.log('Err', err);
    logger.error(
      'Error while adding exceptions for Lead Score Settings: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating lead score settings exception: ${err.message}`,
    });
  }
};

const updateLeadScoreSettingsException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { ls_settings_id } = req.params;

    if (req.body?.ls_settings_id != ls_settings_id) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score settings exception',
        error:
          'ls_settings_id in the request body should match the ls_settings_id in the url',
      });
    }
    let body = leadScoreSettingSchema.validate(req.body);
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
        msg: 'Failed to update lead score settings exception',
        error: 'Invalid request: Admin level exception',
      });
    }
    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
      t,
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score settings exception',
        error: `Error while fetching lead score settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score settings exception',
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
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
          msg: 'Failed to update lead score settings exception',
          error: `Error while fetching lead score settings: ${errForSdException}`,
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
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        query: {
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        },
        t,
      });
      if (errForAdminSetting) {
        t.rollback();
        logger.error(
          `Error while fetching admin Lead Score Settings: `,
          errForAdminSetting
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update lead score settings exception',
          error: `Error while fetching lead score settings: ${errForAdminSetting}`,
        });
      }
      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            ls_settings_id: adminSetting.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.ADMIN,
          },
          t
        );

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            ls_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            ls_settings_id: exception.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
          msg: 'Failed to update lead score settings exception',
          error: `Error while updating old sd users: ${errForUpdateOldSdUsers}`,
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
          msg: 'Failed to update lead score settings exception',
          error: `Error while updating new sd users: ${errForUpdateNewSdUsers}`,
        });
      }
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
      // check if exception exists for new user
      const [userException, errForUserException] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
          msg: 'Failed to update lead score settings exception',
          error: `Error while fetching lead score settings: ${errForUserException}`,
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
            ls_settings_id: exception.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.USER,
          },
          t
        );
      if (errForUpdateSettings) {
        t.rollback();
        logger.error(`Error while updating user: `, errForUpdateSettings);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update lead score settings exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }

      // Check if old user has an sub-dept exception
      const [sdException, errForSdException] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
          msg: 'Failed to update lead score settings exception',
          error: `Error while fetching lead score settings: ${errForSdException}`,
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
              ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              ls_settings_id: sdException.ls_settings_id,
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
              msg: 'Failed to update lead score settings exception',
              error: `Error while updating settings by user query: ${errForOldUser}`,
            });
          }
        }
      } else {
        // use admin settings
        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
              ls_settings_id: adminSetting.ls_settings_id,
              ls_setting_priority: SETTING_LEVELS.ADMIN,
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
            msg: 'Failed to update lead score settings exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
        }
      }
    }

    const [_, errForUpdateException] = await Repository.update({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
      t,
      updateObject: body.value,
    });
    if (errForUpdateException) {
      t.rollback();
      logger.error(
        `Error while updating Lead Score Settings exception: `,
        errForUpdateException
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score settings exception',
        error: `Error while updating lead score settings exception: ${errForUpdateException}`,
      });
    }
    let score_threshold_unchanged =
        body.value?.score_threshold === exception?.score_threshold,
      reset_period_unchanged =
        body.value?.reset_period === exception?.reset_period;
    // Reset Lead Scores of Leads
    let [updateLeadScore, errForUpdatedLeadScore] =
      await LeadScoreHelper.updateLeadScoreOnSettingsChange({
        id: exception?.[SETTINGS_ID_TYPES[exception.priority]],
        priority: exception.priority,
        score_threshold: body.value?.score_threshold,
        reset_period: body.value?.reset_period,
        score_threshold_unchanged,
        reset_period_unchanged,
      });
    t.commit();
    successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    t.rollback();
    logger.error(
      'Error while fetching updating Lead Score Settings settings exceptions: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating Lead Score settings exceptions: ${err.message}`,
    });
  }
};

const deleteLeadScoreSettingsexception = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { ls_settings_id } = req.params;

    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
      t,
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score settings exception',
        error: `Error while fetching lead score settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score settings exception',
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
    const [_, errForDeleteLeadScoreSetting] = await Repository.destroy({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
      t,
    });
    if (errForDeleteLeadScoreSetting) {
      t.rollback();
      logger.error(
        `Error while deleting exception: `,
        errForDeleteLeadScoreSetting
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score settings exception',
        error: `Error while deleting lead score settings:  ${errForDeleteLeadScoreSetting}`,
      });
    }

    // Check the level of exception
    let updatedException;
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // If exception is sub-dept level then
      // update the users where exception is sub-dept level
      // (users having higher priority exception level i.e. 'user' should not be updated)

      // Fetch admin setting
      const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        query: {
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        },
      });

      updatedException = adminSetting;

      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                ls_settings_id: exception.ls_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            ls_settings_id: adminSetting.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.ADMIN,
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
          msg: 'Failed to delete lead score settings exception',
          error: `Error while updating settings by user query: ${errForUpdateUsers}`,
        });
      }
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
      // 2. If present, update setting level to sub-dept
      // else, update setting level to admin
      const [sdException, errForSdException] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
          msg: 'Failed to delete lead score settings exception',
          error: `Error while fetching lead score settings: ${errForSdException}`,
        });
      }

      if (sdException) {
        updatedException = sdException;
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              ls_settings_id: sdException.ls_settings_id,
              ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
            msg: 'Failed to delete lead score settings exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
        }
      } else {
        // Fetch admin setting because there is no sub-dept exception

        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
          query: {
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          },
        });

        updatedException = adminSetting;
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              ls_settings_id: adminSetting.ls_settings_id,
              ls_setting_priority: SETTING_LEVELS.ADMIN,
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
            msg: 'Failed to delete lead score settings exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
        }
      }
    }

    let score_threshold_unchanged =
        updatedException?.score_threshold === exception?.score_threshold,
      reset_period_unchanged =
        updatedException?.reset_period === exception?.reset_period;
    // Reset Lead Scores of Leads
    let [updateLeadScore, errForUpdatedLeadScore] =
      await LeadScoreHelper.updateLeadScoreOnSettingsChange({
        id: exception?.[SETTINGS_ID_TYPES[exception.priority]],
        priority: exception.priority,
        score_threshold: updatedException?.score_threshold,
        reset_period: updatedException?.reset_period,
        score_threshold_unchanged,
        reset_period_unchanged,
      });
    t.commit();
    successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while deleting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting lead score settings exception: ${err.message}`,
    });
  }
};

module.exports = {
  createLeadScoreSettingsException,
  updateLeadScoreSettingsException,
  deleteLeadScoreSettingsexception,
};
