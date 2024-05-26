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
  USER_ROLE,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');

// Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');
const TaskSettingsRepository = require('../../../../../Cadence-Brain/src/repository/task-settings.repository');
const SettingsRepository = require('../../../../../Cadence-Brain/src/repository/settings.repository');

// Joi
const createAndUpdateTaskSettingsSchema = require('../../../joi/v2/admin/task-settings.joi');

// Helpers and Services
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const TaskSettingsHelper = require('../../../../../Cadence-Brain/src/helper/task-settings');

const createTaskSettingException = async (req, res) => {
  try {
    const body = createAndUpdateTaskSettingsSchema.validate(req.body);

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
        error: `Error while creating task setting:  ${errForCreatedException}`,
      });

    if (createdException.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // Change setting level of those users of sub-dept
      // that do not have higher priority setting level i.e 'user'

      const [_, errForUpdateSettings] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            task_setting_priority: {
              [Op.not]: [SETTING_LEVELS.USER],
            },
          },
          {
            sd_id: createdException.sd_id,
          },
          {
            task_settings_id: createdException.task_settings_id,
            task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          }
        );
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Recalculate tasks for sd users
      TaskHelper.recalculateDailyTasksForSdUsers(createdException.sd_id);
      TaskHelper.updateLateTime({
        sdIds: [createdException.sd_id],
        late_settings: createdException.late_settings,
        settings_query: { task_settings_id: createdException.task_settings_id },
      });
    } else if (createdException.priority === SETTING_LEVELS.USER) {
      const [_, errForUpdateSettings] =
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
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Recalculate tasks for user
      TaskHelper.recalculateDailyTasksForUsers([createdException.user_id]);
      TaskHelper.updateLateTime({
        userIds: [createdException.user_id],
        late_settings: createdException.late_settings,
      });
    }

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error('Error while adding exceptions for task settings: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating task setting exception: ${err.message}`,
    });
  }
};

const updateTaskSettingException = async (req, res) => {
  try {
    const { task_settings_id } = req.params;

    if (req.body?.task_settings_id != task_settings_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error:
          'task_settings_id in the request body should match the task_settings_id in the url',
      });

    const body = createAndUpdateTaskSettingsSchema.validate(req.body);

    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: 'Invalid request: Admin level exception',
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

    // for updating late time
    let updatedUserIds = [];
    let updatedSdIds = [];
    let lateTimeUpdated = 0;
    let updatedException = {};

    // Exception's subdepartment/user is updated to new subdepartment or user
    if (
      exception.priority === SETTING_LEVELS.SUB_DEPARTMENT &&
      exception.sd_id !== body.value.sd_id
    ) {
      // Check if exception exists for new subdepartment
      const [sdException, errForSdException] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.SUB_DEPARTMENT,
          sd_id: body.value.sd_id,
        });
      if (errForSdException)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while fetching task setting by query: ${errForSdException}`,
        });

      if (sdException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this subdepartment',
        });

      // Fetch admin setting
      const [adminSetting, errForAdminSetting] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });
      if (errForAdminSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while fetching task setting by query: ${errForAdminSetting}`,
        });
      const updateOldSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
          {
            sd_id: exception.sd_id,
          },
          {
            task_settings_id: adminSetting.task_settings_id,
            task_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );
      updatedException = adminSetting;

      const updateNewSdSettingsPromise =
        SettingsRepository.updateSettingsByUserQuery(
          {
            task_setting_priority: {
              [Op.notIn]: [SETTING_LEVELS.USER, SETTING_LEVELS.SUB_DEPARTMENT],
            },
          },
          {
            sd_id: body.value.sd_id,
          },
          {
            task_settings_id: exception.task_settings_id,
            task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
          msg: 'Failed to update task setting exception',
          error: `Error while updating old sd users: ${errForUpdateOldSdUsers}`,
        });
      const [__, errForUpdateNewSdUsers] = values[1];
      if (errForUpdateNewSdUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update task setting exception',
          error: `Error while updating new sd user: ${errForUpdateNewSdUsers}`,
        });

      TaskHelper.updateLateTime({
        sdIds: [exception.sd_id],
        settings_query: { task_settings_id: adminSetting.task_settings_id },
        late_settings: adminSetting.late_settings,
      });
      TaskHelper.updateLateTime({
        sdIds: [body.value.sd_id],
        settings_query: { task_settings_id: exception.task_settings_id },
        late_settings: exception.late_settings,
      });
      updatedSdIds.push(exception.sd_id);
      updatedSdIds.push(body.value.sd_id);
      lateTimeUpdated = 1;
    } else if (
      exception.priority === SETTING_LEVELS.USER &&
      exception.user_id !== body.value.user_id
    ) {
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
          msg: 'An exception already exists of the user. Please update it',
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

      TaskHelper.updateLateTime({
        userIds: [body.value.user_id],
        late_settings: exception.late_settings,
      });

      // Check if old user has an sub-dept exception
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

      if (sdException) {
        // use subdepartment exception settings for old user
        const [oldUser, errForOldUser] =
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
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update task setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
        updatedException = sdException;
      } else {
        // use admin settings
        const [adminSetting, errForAdminSetting] =
          await TaskSettingsRepository.getTaskSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });

        // update old user
        const [oldUser, errForOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              task_settings_id: adminSetting.task_settings_id,
              task_setting_priority: SETTING_LEVELS.ADMIN,
            }
          );
        if (errForOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update task setting exception',
            error: `Error while updating settings by user query: ${errForOldUser}`,
          });
        updatedException = adminSetting;
      }
      TaskHelper.updateLateTime({
        userIds: [exception.user_id],
        late_settings: updatedException.late_settings,
      });
      updatedUserIds.push(exception.user_id);
      updatedUserIds.push(body.value.user_id);
      lateTimeUpdated = 1;
    }

    const [_, errForUpdateException] =
      await TaskSettingsRepository.updateTaskSettings(
        {
          task_settings_id,
        },
        body.value
      );
    if (errForUpdateException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update task setting exception',
        error: `Error while updating task settings: ${errForUpdateException}`,
      });

    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      if (body.value.max_tasks || body.value.high_priority_split) {
        TaskHelper.recalculateDailyTasksForSdUsers(body.value.sd_id);
        //TaskHelper.updateLateTime({
        //sdIds: [body.value.sd_id],
        //late_settings: body.value.late_settings,
        //settings_query: { task_settings_id },
        //});
        TaskHelper.recalculateDailyTasksForSdUsers(exception.sd_id);
        if (exception.sd_id === body.value.sd_id && !lateTimeUpdated) {
          TaskHelper.updateLateTime({
            sdIds: [body.value.sd_id],
            late_settings: body.value.late_settings,
            settings_query: {
              task_settings_id,
            },
          });
        }
      }
    } else if (exception.priority === SETTING_LEVELS.USER) {
      if (body.value.max_tasks || body.value.high_priority_split) {
        TaskHelper.recalculateDailyTasksForUsers([body.value.user_id]);
        //TaskHelper.updateLateTime({
        //userIds: [body.value.user_id],
        //late_settings: body.value.late_settings,
        //settings_query: { task_settings_id },
        //});
        TaskHelper.recalculateDailyTasksForUsers([exception.user_id]);
        if (exception.user_id === body.value.user_id && !lateTimeUpdated) {
          TaskHelper.updateLateTime({
            userIds: [body.value.user_id],
            late_settings: body.value.late_settings,
            settings_query: {
              task_settings_id,
            },
          });
        }
      }
    }

    return successResponse(res, 'Successfully updated exception.');
  } catch (err) {
    logger.error('Error while fetching updating task setting exceptions:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating task setting exceptions: ${err.message}`,
    });
  }
};

const deleteTaskSettingException = async (req, res) => {
  try {
    const { task_settings_id } = req.params;

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

    if (exception.priority === SETTING_LEVELS.ADMIN)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot delete admin setting',
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

    // Check the level of exception
    if (exception.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
      // If exception is sub-dept level then
      // update the users where exception is sub-dept level
      // (users having higher priority exception level i.e. 'user' should not be updated)

      // Fetch admin setting
      const [adminSetting, errForAdminSetting] =
        await TaskSettingsRepository.getTaskSettingByQuery({
          priority: SETTING_LEVELS.ADMIN,
          company_id: exception.company_id,
        });

      const [_, errForUpdateUsers] =
        await SettingsRepository.updateSettingsByUserQuery(
          {
            [Op.or]: [
              {
                task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              {
                task_settings_id: exception.task_settings_id,
              },
            ],
          },
          {
            sd_id: exception.sd_id,
          },
          {
            task_settings_id: adminSetting.task_settings_id,
            task_setting_priority: SETTING_LEVELS.ADMIN,
          }
        );
      if (errForUpdateUsers)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateUsers}`,
        });

      // Recalculate tasks for sd users
      TaskHelper.recalculateDailyTasksForSdUsers(exception.sd_id);
      TaskHelper.updateLateTime({
        sdIds: [exception.sd_id],
        late_settings: adminSetting.late_settings,
        settings_query: { task_settings_id: adminSetting.task_settings_id },
      });
    } else if (exception.priority === SETTING_LEVELS.USER) {
      // 1. If exception is user level then
      // check if there is an exception for the user's sub-dept
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
        const [_, errForUpdateUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              task_settings_id: sdException.task_settings_id,
              task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
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
        // Fetch admin setting because there is no sub-dept exception

        const [adminSetting, errForAdminSetting] =
          await TaskSettingsRepository.getTaskSettingByQuery({
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
              task_settings_id: adminSetting.task_settings_id,
              task_setting_priority: SETTING_LEVELS.ADMIN,
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
    }

    return successResponse(res, 'Successfully deleted exception.');
  } catch (err) {
    logger.error('Error while deleting exception : ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting task setting exception: ${err.message}`,
    });
  }
};

const TaskSettingsControllers = {
  createTaskSettingException,
  updateTaskSettingException,
  deleteTaskSettingException,
};

module.exports = TaskSettingsControllers;
