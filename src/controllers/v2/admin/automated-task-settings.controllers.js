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
const AutomatedTaskSettingsRepository = require('../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Helpers
const SettingsHelpers = require('../../../../../Cadence-Brain/src/helper/settings');
const AutomatedTasksHelper = require('../../../../../Cadence-Brain/src/helper/automated-tasks');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');

// Joi
const automatedTaskSettingSchema = require('../../../joi/v2/admin/automated_task_settings.joi');

const createAutomatedTaskSettingException = async (req, res) => {
  try {
    const body = automatedTaskSettingSchema.validate(req.body);
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
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery(
        query
      );
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error while fetching automated task setting by query: ${errForException}`,
      });
    if (exception)
      return badRequestResponseWithDevMsg({
        res,
        error:
          'An exception already exists of the same entity. Please update it',
      });

    const automatedTaskSetting = body.value;

    // convert working days from enums array to numbers array
    const [workingDays, errForWorkingDays] =
      SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
        automatedTaskSetting.working_days
      );
    if (errForWorkingDays) {
      if (errForWorkingDays === 'Array cannot contain more than 7 elements')
        return unprocessableEntityResponseWithDevMsg({
          res,
          error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
      });
    }
    automatedTaskSetting.working_days = workingDays;

    const [createdException, errForCreatedException] =
      await AutomatedTaskSettingsRepository.createAutomatedTaskSetting(
        automatedTaskSetting
      );
    if (errForCreatedException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error for creating automated task setting: ${errForCreatedException}`,
      });

    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            automated_task_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            at_settings_id: createdException.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create automated task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      TaskHelper.recalculateDailyTasksForSdUsers(createdException.sd_id);
      AutomatedTasksHelper.adjustStartTime({ sdIds: [createdException.sd_id] });
      RedisHelper.removeSettingsUser({
        at_settings_id: createdException.at_settings_id,
      });
    } else if (createdException.priority === SETTING_LEVELS.USER) {
      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: createdException.user_id,
          },
          {
            at_settings_id: createdException.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create automated task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
      TaskHelper.recalculateDailyTasksForUsers([createdException.user_id]);
      AutomatedTasksHelper.adjustStartTime({
        userIds: [createdException.user_id],
      });
      RedisHelper.removeSettingsUser({
        at_settings_id: createdException.at_settings_id,
      });
    }

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error('Error while creating automatic setting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating automated task setting exception: ${err.message}`,
    });
  }
};

const updateAutomatedTaskSettingException = async (req, res) => {
  try {
    const { at_settings_id } = req.params;

    if (req.body?.at_settings_id != at_settings_id)
      return badRequestResponseWithDevMsg({
        res,
        error:
          'at_settings_id in the request body should match the at_settings_id in the url',
      });

    const body = automatedTaskSettingSchema.validate(req.body);
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
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
        at_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: `Error while fetching automated task setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({ res, msg: 'Exception not found' });

    const automatedTaskSetting = body.value;

    // convert working days from enums array to numbers array
    const [workingDays, errForWorkingDays] =
      SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
        automatedTaskSetting.working_days
      );
    if (errForWorkingDays) {
      if (errForWorkingDays === 'Array cannot contain more than 7 elements')
        return unprocessableEntityResponseWithDevMsg({
          res,
          error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
        });

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
      });
    }
    automatedTaskSetting.working_days = workingDays;

    // for calling go task service
    let updatedUserIds = [];
    let updatedSdIds = [];
    let foundIdsToUpdate = 0;

    if (
      exception.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      exception.sd_id !== body.value.sd_id
    ) {
      // users for sub departments exception.sd_id and body.value.sd_id
      // check if exception already exists for new sudpt
      const [sdException, errForSdException] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: body.value.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while fetching automated task setting by query: ${errForSdException}`,
        });

      if (sdException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this subdepartment',
        });

      const [adminSetting, errForAdminSetting] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });

      if (errForAdminSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while fetching automated task setting by query: ${errForAdminSetting}`,
        });

      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            at_settings_id: adminSetting.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            automated_task_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            at_settings_id: exception.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
          msg: 'Failed to update automated task setting exception',
          error: `Error while updating old sd users: ${errForUpdateOldSdUsers}`,
        });
      const [__, errForUpdateNewSdUsers] = values[1];
      if (errForUpdateNewSdUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while updating new sd users: ${errForUpdateNewSdUsers}`,
        });

      updatedSdIds.push(exception.sd_id);
      updatedSdIds.push(body.value.sd_id);
      foundIdsToUpdate = 1;
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
      // users exception.user_id and body.value.user_id
      // check if exception already exists for new user

      const [userException, errForUserException] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.USER,
          user_id: body.value.user_id,
        });
      if (errForUserException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while fetching automated task setting by query: ${errForUserException}`,
        });
      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this user',
        });

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: body.value.user_id,
          },
          {
            at_settings_id: exception.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while updating settings by users query: ${errForUpdateSettings}`,
        });

      // Check if old user has an sub-dept exception
      const [sdException, errForSdException] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: exception.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update automated task setting exception',
          error: `Error while fetching automated task setting by query: ${errForSdException}`,
        });

      // update old user

      if (sdException) {
        const [oldUserUpdate, errForOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {},
            {
              user_id: exception.user_id,
            },
            {
              at_settings_id: sdException.at_settings_id,
              automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update automated task setting exception',
            error: `Error while updating setting by user query: ${errForOldUser}`,
          });
      } else {
        const [adminSetting, errForAdminSetting] =
          await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });

        const [oldUserUpdate, errForOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {},
            {
              user_id: exception.user_id,
            },
            {
              at_settings_id: adminSetting.at_settings_id,
              automated_task_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update automated task setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
      }
      updatedUserIds.push(exception.user_id);
      updatedUserIds.push(body.value.user_id);
      foundIdsToUpdate = 1;
    }
    // if above both conditions fail, then check for exception.priority if its for sub department
    // then update for its user, if its user level then for that user

    const [_, errForUpdateException] =
      await AutomatedTaskSettingsRepository.updateAutomatedTaskSettings(
        { at_settings_id },
        automatedTaskSetting
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: `Error while updating automated task settings: ${errForUpdateException}`,
      });

    successResponse(res, 'Successfully updated exception.');

    if (!foundIdsToUpdate) {
      if (exception.priority === SETTING_LEVELS.USER) {
        updatedUserIds.push(body.value.user_id);
      } else if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        updatedSdIds.push(body.value.sd_id);
      }
    }
    AutomatedTasksHelper.adjustStartTime({
      userIds: updatedUserIds || [],
      sdIds: updatedSdIds || [],
    });
    TaskHelper.recalculateDailyTasksForUsers(updatedUserIds || []);
    updatedSdIds?.map((sd_id) =>
      TaskHelper.recalculateDailyTasksForSdUsers(sd_id)
    );
    // * remove from redis user_ids
    await RedisHelper.removeSettingsUser({ at_settings_id });
  } catch (err) {
    console.log(err);
    logger.error('Error while fetching company settings for Admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating automated task setting exception: ${err.message}`,
    });
  }
};

const deleteAutomatedTaskSettingException = async (req, res) => {
  try {
    const { at_settings_id } = req.params;

    const [exception, errForException] =
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
        at_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated task setting exception',
        error: `Error while fetching automated task setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({ res, msg: 'Exception not found' });

    if (exception.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete admin setting',
      });

    const [_, errForDeleteATSetting] =
      await AutomatedTaskSettingsRepository.deleteAutomatedTaskSetting({
        at_settings_id,
      });
    if (errForDeleteATSetting)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated task setting exception',
        error: `Error while deleting automated task setting: ${errForDeleteATSetting}`,
      });

    // Check the level of exception
    // If exception is sub-dept level then
    // update the users where exception is sub-dept level
    // (users having higher priority exception level i.e. 'user' should not be updated)
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      const [adminSetting, errForAdminSetting] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });

      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                at_settings_id: exception.at_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            at_settings_id: adminSetting.at_settings_id,
            automated_task_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );

      if (errForUpdateUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete automated task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUsers}`,
        });
      TaskHelper.recalculateDailyTasksForSdUsers(exception.sd_id);
      AutomatedTasksHelper.adjustStartTime({
        userIds: [],
        sdIds: [exception.sd_id],
      });
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
      // 2. If present, update setting level to sub-dept
      // else, update setting level to admin
      const [sdException, errForSdException] =
        await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: exception.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete automated task setting exception',
          error: `Error while fetching automated task setting by query: ${errForSdException}`,
        });

      if (sdException) {
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              at_settings_id: sdException.at_settings_id,
              automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (errForUpdateUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete automated task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
      } else {
        // fetch admin setting
        const [adminSetting, errForAdminSetting] =
          await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });

        if (errForAdminSetting)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete automated task setting exception',
            error: `Error while fetching automated task setting by query: ${errForAdminSetting}`,
          });

        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              at_settings_id: adminSetting.at_settings_id,
              automated_task_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForUpdateUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to delete automated task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateUser}`,
          });
      }
      TaskHelper.recalculateDailyTasksForUsers([exception.user_id]);
      AutomatedTasksHelper.adjustStartTime({
        userIds: [exception.user_id],
        sdIds: [],
      });
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error(
      'Error while deleting automated task setting exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting automated task setting exception: ${err.message}`,
    });
  }
};

const AutomatedTaskSettingControllers = {
  createAutomatedTaskSettingException,
  updateAutomatedTaskSettingException,
  deleteAutomatedTaskSettingException,
};

module.exports = AutomatedTaskSettingControllers;
