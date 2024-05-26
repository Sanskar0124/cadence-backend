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
  USER_ROLE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Repository
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const TaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/task-settings.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const createAndUpdateTaskSettingsSchema = require('../../../../joi/v2/admin/task-settings.joi');

// Helpers and Services
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const TaskSettingsHelper = require('../../../../../../Cadence-Brain/src/helper/task-settings');

const createTaskSettingException = async (req, res) => {
  try {
    const body = createAndUpdateTaskSettingsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create task setting exception',
        error: 'Invalid level provided',
      });

    //const totalTasksCount =
    //parseInt(body.value.calls_per_day) +
    //parseInt(body.value.mails_per_day) +
    //parseInt(body.value.messages_per_day) +
    //parseInt(body.value.linkedin_connections_per_day) +
    //parseInt(body.value.linkedin_messages_per_day) +
    //parseInt(body.value.linkedin_profiles_per_day) +
    //parseInt(body.value.linkedin_interacts_per_day) +
    //parseInt(body.value.data_checks_per_day) +
    ////parseInt(body.value.reply_tos_per_day) +
    //parseInt(body.value.cadence_customs_per_day);

    //if (totalTasksCount > parseInt(body.value.max_tasks))
    //return badRequestResponse(
    //res,
    //'Sum of individual task exceed Max tasks limit.'
    //);

    //if (totalTasksCount < parseInt(body.value.max_tasks)) {
    //const [adjustedTaskSetting, errForAdjustedTaskSetting] =
    //TaskSettingsHelper.adjustTaskSplits(body.value);

    //if (errForAdjustedTaskSetting)
    //return serverErrorResponse(res, errForAdjustedTaskSetting);

    //body.value = adjustedTaskSetting;
    //}

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
      await TaskSettingsRepository.getTaskSettingByQuery(query);
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create task setting exception',
        error: `Error while fetching task setting by query: ${errForException}`,
      });
    if (exception)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists of the same enitiy. Please update it',
      });

    const [createdException, errForCreatedException] =
      await TaskSettingsRepository.createTaskSetting(body.value);
    if (errForCreatedException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create task setting exception',
        error: `Error while creating task setting: ${errForCreatedException}`,
      });

    const [_, errForUpdateUser] =
      await SettingsRepository.updateSettingsByUserQuery(
        {},
        {
          user_id: createdException.user_id,
        },
        {
          task_settings_id: createdException.task_settings_id,
          task_setting_priority: SETTING_LEVELS.USER,
        }
      );
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create task setting exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });

    // Recalculate tasks for user
    TaskHelper.recalculateDailyTasksForUsers([createdException.user_id]);
    TaskHelper.updateLateTime({
      userIds: [createdException.user_id],
      late_settings: createdException.late_settings,
    });

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error('Error while creating task setting exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating task setting exception: ${err.message}`,
    });
  }
};

const updateTaskSettingException = async (req, res) => {
  try {
    const { task_settings_id } = req.params;
    if (!task_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: 'Task settings id cannot be empty',
      });

    const body = createAndUpdateTaskSettingsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: 'Invalid level provided',
      });

    //const totalTasksCount =
    //parseInt(body.value.calls_per_day) +
    //parseInt(body.value.mails_per_day) +
    //parseInt(body.value.messages_per_day) +
    //parseInt(body.value.linkedin_connections_per_day) +
    //parseInt(body.value.linkedin_messages_per_day) +
    //parseInt(body.value.linkedin_profiles_per_day) +
    //parseInt(body.value.linkedin_interacts_per_day) +
    //parseInt(body.value.data_checks_per_day) +
    ////parseInt(body.value.reply_tos_per_day) +
    //parseInt(body.value.cadence_customs_per_day);

    //if (totalTasksCount > parseInt(body.value.max_tasks))
    //return badRequestResponse(
    //res,
    //'Sum of individual task exceed Max tasks limit.'
    //);

    //if (totalTasksCount < parseInt(body.value.max_tasks)) {
    //const [adjustedTaskSetting, errForAdjustedTaskSetting] =
    //TaskSettingsHelper.adjustTaskSplits(body.value);

    //if (errForAdjustedTaskSetting)
    //return serverErrorResponse(res, errForAdjustedTaskSetting);

    //body.value = adjustedTaskSetting;
    //}

    const [exception, errForException] =
      await TaskSettingsRepository.getTaskSettingByQuery({
        task_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: `Error while fetching task setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: 'Exception not found',
      });

    if (exception.user_id !== body.value.user_id) {
      // check if exception exists for new user
      const [userException, errForUserException] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.USER,
          user_id: body.value.user_id,
        });
      if (errForUserException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while fetching task setting by query: ${errForUserException}`,
        });

      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          error: 'An exception already exists for this user',
        });

      // update new user

      const [newUserUpdate, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {},
          {
            user_id: body.value.user_id,
          },
          {
            task_settings_id: exception.task_settings_id,
            task_setting_priority: SETTING_LEVELS.USER,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if the old user's sub-dept has an exception
      const [sdException, errForSdException] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: exception.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while fetching task setting by query: ${errForSdException}`,
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
              task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              task_settings_id: sdException.task_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      } else {
        const [adminSetting, errForAdminSetting] =
          await TaskSettingsRepository.getTaskSettingByQuery({
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
              task_setting_priority: SETTING_LEVELS.ADMIN,
              task_settings_id: adminSetting.task_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      }
    }
    const [_, errForUpdateException] =
      await TaskSettingsRepository.updateTaskSettings(
        { task_settings_id },
        body.value
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: `Error while updating task settings: ${errForUpdateException}`,
      });

    // Recalculate tasks for user
    if (exception.user_id !== body.value.user_id) {
      TaskHelper.recalculateDailyTasksForUsers([body.value.user_id]);
      TaskHelper.updateLateTime({
        userIds: [body.value.user_id],
        late_settings: body.value.late_settings,
      });

      TaskHelper.recalculateDailyTasksForUsers([exception.user_id]);
      TaskHelper.updateLateTime({
        userIds: [exception.user_id],
        late_settings: exception.late_settings,
      });
    } else {
      TaskHelper.recalculateDailyTasksForUsers([body.value.user_id]);
      TaskHelper.updateLateTime({
        userIds: [body.value.user_id],
        late_settings: body.value.late_settings,
      });
    }

    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    logger.error('Error while updating task settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating task settings exception: ${err.message}`,
    });
  }
};

const deleteTaskSettingException = async (req, res) => {
  try {
    const { task_settings_id } = req.params;
    if (!task_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: 'Task settings id cannot be empty',
      });

    const [exception, errForException] =
      await TaskSettingsRepository.getTaskSettingByQuery({
        task_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: `Error while fetching task setting by query: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: 'Exception not found',
      });

    if (exception.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: 'Invalid exception',
      });

    const [_, errForDeleteTaskException] =
      await TaskSettingsRepository.deleteTaskSettingsByQuery({
        task_settings_id,
      });
    if (errForDeleteTaskException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: `Error while deleting task settings by query: ${errForDeleteTaskException}`,
      });

    // 1. check if there is an exception for the user's sub-dept
    // 2. If present, update setting level to sub-dept
    // else, update setting level to admin
    const [sdException, errForSdException] =
      await TaskSettingsRepository.getTaskSettingByQuery({
        priority: SETTING_LEVELS.SUB_DEPARTMENT,
        sd_id: exception.sd_id,
      });
    if (errForSdException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete task setting exception',
        error: `Error while fetching task setting by query: ${errForSdException}`,
      });

    let updatedException = {};

    if (sdException) {
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
            task_settings_id: sdException.task_settings_id,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
      updatedException = sdException;
    } else {
      const [adminSetting, errForAdminSetting] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });
      if (errForAdminSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete task setting exception',
          error: `Error while fetching task setting by query: ${errForAdminSetting}`,
        });
      const [__, errForUpdateUser] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            user_id: exception.user_id,
          },
          {},
          {
            task_setting_priority: SETTING_LEVELS.ADMIN,
            task_settings_id: adminSetting.task_settings_id,
          }
        );
      if (errForUpdateUser)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUser}`,
        });
      updatedException = adminSetting;
    }

    // Recalculate tasks for user
    TaskHelper.recalculateDailyTasksForUsers([exception.user_id]);
    TaskHelper.updateLateTime({
      userIds: [exception.user_id],
      late_settings: updatedException.late_settings,
    });

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error('Error while deleting task settings exception: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting task settings exception: ${err.message}`,
    });
  }
};

const TaskSettingsControllers = {
  createTaskSettingException,
  updateTaskSettingException,
  deleteTaskSettingException,
};

module.exports = TaskSettingsControllers;
