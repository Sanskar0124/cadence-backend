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
  SETTINGS_ID_TYPES,
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
const leadScoreSettingsSchema = require('../../../../joi/v2/admin/lead_score_settings.joi.js');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score');

const createLeadScoreSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let body = leadScoreSettingsSchema.validate(req.body);
    let priority = body.value?.priority;
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
        msg: 'Failed to create lead score setting exception',
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
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query,
      t,
    });
    if (errForException) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead score setting exception',
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
      logger.error(`Error while creating exception: `, errForCreatedException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead score setting exception',
        error: `Error while creating lead score setting exception: ${errForCreatedException}`,
      });
    }

    const [_, errForUpdateUser] =
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
    if (errForUpdateUser) {
      t.rollback();
      logger.error(`Error while updating user: `, errForUpdateUser);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create lead score setting exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });
    }
    t.commit();
    createdSuccessResponse(res, 'Successfully created new exception.');

    // Reset Lead Scores of Leads
    let [updateLeadScore, errForUpdatedLeadScore] =
      await LeadScoreHelper.updateLeadScoreOnSettingsChange({
        id: createdException?.[SETTINGS_ID_TYPES[createdException.priority]],
        priority: createdException.priority,
        score_threshold: body.value?.score_threshold,
        reset_period: body.value?.reset_period,
      });
  } catch (err) {
    t.rollback();
    logger.error('Error while creating lead score setting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating lead score setting exception: ${err.message}`,
    });
  }
};

const updateLeadScoreSettingException = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { ls_settings_id } = req.params;
    if (!ls_settings_id) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Lead score settings id cannot be empty.',
      });
    }

    let body = leadScoreSettingsSchema.validate(req.body);
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
        msg: 'Failed to update lead score setting exception',
        error: 'Invalid level provided',
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
        msg: 'Failed to update lead score setting exception',
        error: `Error while fetching lead score settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score setting exception',
        error: 'Exception not found',
      });
    }
    if (exception.user_id !== body.value.user_id) {
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
          msg: 'Failed to update lead score setting exception',
          error: `Error while fetching lead score settings: ${errForUserException}`,
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
            ls_settings_id: exception.ls_settings_id,
            ls_setting_priority: SETTING_LEVELS.USER,
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
          msg: 'Failed to update lead score setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      }

      // Check if the old user's sub-dept has an exception
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
        logger.error(
          `Error while fetching subdepartment exception:`,
          errForSdException
        );

        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update lead score setting exception',
          error: `Error while fetching lead score settings: ${errForSdException}`,
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
              ls_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              ls_settings_id: sdException.ls_settings_id,
            },
            t
          );
        if (errForUpdateOldUser) {
          t.rollback();
          logger.error(`Error while updating old user: `, errForUpdateOldUser);
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead score setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
        }
      } else {
        const [adminSetting, errForAdminSetting] = await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
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
              ls_setting_priority: SETTING_LEVELS.ADMIN,
              ls_settings_id: adminSetting.ls_settings_id,
            },
            t
          );
        if (errForUpdateOldUser) {
          t.rollback();
          logger.error(`Error while updating old user: `, errForUpdateOldUser);
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead score setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
        }
      }
    }
    const [_, errForUpdateException] = await Repository.update({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
      updateObject: body.value,
    });
    if (errForUpdateException) {
      t.rollback();
      logger.error(
        `Error while updating lead score settings exception: `,
        errForUpdateException
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead score setting exception',
        error: `Error while updating lead score settings: ${errForUpdateException}`,
      });
    }

    // If score threshold changes or reset_period, reset lead
    let score_threshold_unchanged =
        body.value?.score_threshold === exception?.score_threshold,
      reset_period_unchanged =
        body.value?.reset_period === exception?.reset_period;
    // Reset Lead Scores of Leads
    let [updateLeadScore, errForUpdatedLeadScore] =
      await LeadScoreHelper.updateLeadScoreOnSettingsChange({
        id: exception?.[SETTINGS_ID_TYPES[exception.priority]],
        priority: body.value?.priority,
        score_threshold: body.value?.score_threshold,
        reset_period: body.value?.reset_period,
        score_threshold_unchanged,
        reset_period_unchanged,
      });
    t.commit();
    successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating lead score settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead score settings exception: ${err.message}`,
    });
  }
};

const deleteLeadScoreSettingException = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { ls_settings_id } = req.params;
    if (!ls_settings_id) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'Lead score settings id cannot be empty',
      });
    }
    const [exception, errForException] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        ls_settings_id,
      },
    });
    if (errForException) {
      t.rollback();
      logger.error(`Error while fetching exception: `, errForException);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score setting exception',
        error: `Error while fetching lead score settings: ${errForException}`,
      });
    }
    if (!exception) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score setting exception',
        error: 'Exception not found',
      });
    }
    if (exception.priority !== SETTING_LEVELS.USER) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete lead score setting exception',
        error: 'Invalid exception. Please try again',
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
        msg: 'Failed to delete lead score setting exception',
        error: `Error while deleting lead score settings: ${errForDeleteLeadScoreSetting}`,
      });
    }
    // 1. check if there is an exception for the user's sub-dept
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
        msg: 'Failed to delete lead score setting exception',
        error: `Error while fetching lead score settings: ${errForSdException}`,
      });
    }

    if (sdException) {
      updatedException = sdException;
      const [__, errForUpdateUser] =
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
      if (errForUpdateUser) {
        t.rollback();
        logger.error(`Error while update user: `, errForUpdateUser);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete lead score setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
      }
    } else {
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
          `Error while fetching admin settings: `,
          errForAdminSetting
        );
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete lead score setting exception',
          error: `Error while fetching lead score settings: ${errForAdminSetting}`,
        });
      }
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            ls_setting_priority: SETTING_LEVELS.ADMIN,
            ls_settings_id: adminSetting.ls_settings_id,
          },
          t
        );
      if (errForUpdateUser) {
        t.rollback();
        logger.error(`Error while update users:`, errForUpdateUser);
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete lead score setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
      }
      updatedException = adminSetting;
    }

    // If score threshold changes or reset_period, reset lead
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
    logger.error('Error while deleting LeadScore settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting LeadScore settings exception: ${err.message}`,
    });
  }
};

const LeadScoreSettingControllers = {
  createLeadScoreSettingException,
  updateLeadScoreSettingException,
  deleteLeadScoreSettingException,
};

module.exports = LeadScoreSettingControllers;
