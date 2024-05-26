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
  REDIS_ADDED_USER_IDS_FOR_MAIL,
  REDIS_ADDED_USER_IDS_FOR_MESSAGE,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Repository
const AutomatedTaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');

// Helpers
const SettingsHelpers = require('../../../../../../Cadence-Brain/src/helper/settings');
const AutomatedTasksHelper = require('../../../../../../Cadence-Brain/src/helper/automated-tasks');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const RedisHelper = require('../../../../../../Cadence-Brain/src/helper/redis');

// Joi
const automatedTaskSettingSchema = require('../../../../joi/v2/admin/automated_task_settings.joi');

const createAutomatedTaskSettingException = async (req, res) => {
  try {
    const body = automatedTaskSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
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
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery(
        query
      );
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error while fetching automated task settings by query: ${errForException}`,
      });
    if (exception)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'An exception already exists for the user. Please update it',
      });

    const automatedTaskSetting = body.value;

    // convert working days from enums array to numbers array
    const [workingDays, errForWorkingDays] =
      SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
        automatedTaskSetting.working_days
      );
    if (errForWorkingDays)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
      });
    automatedTaskSetting.working_days = workingDays;

    const [createdException, errForCreatedException] =
      await AutomatedTaskSettingsRepository.createAutomatedTaskSetting(
        automatedTaskSetting
      );
    if (errForCreatedException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error while creating exception: ${errForCreatedException}`,
      });

    const [_, errForUpdateUser] =
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
    if (errForUpdateUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated task setting exception',
        error: `Error while updating settings by user query: ${errForUpdateUser}`,
      });

    TaskHelper.recalculateDailyTasksForUsers([createdException.user_id]);
    AutomatedTasksHelper.adjustStartTime({
      userIds: [createdException.user_id],
    });
    // * remove from redis user_ids
    await RedisHelper.removeUsers(
      [createdException.user_id] || [],
      REDIS_ADDED_USER_IDS_FOR_MAIL
    );
    await RedisHelper.removeUsers(
      [createdException.user_id] || [],
      REDIS_ADDED_USER_IDS_FOR_MESSAGE
    );

    return createdSuccessResponse(res, 'Successfully created new exception.');
  } catch (err) {
    logger.error(
      'Error while creating automated task setting exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating automated task setting exception: ${err.message}`,
    });
  }
};

const updateAutomatedTaskSettingException = async (req, res) => {
  try {
    const { at_settings_id } = req.params;
    if (!at_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'At settings id cannot be empty',
      });

    const body = automatedTaskSettingSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    if (body.value.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: 'Invalid level provided.',
      });

    const [exception, errForException] =
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
        at_settings_id,
      });
    if (errForException)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: `Error while fetching automated task settings: ${errForException}`,
      });
    if (!exception)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update automated task setting exception',
        error: 'Exception not found',
      });

    const automatedTaskSetting = body.value;

    // convert working days from enums array to numbers array
    const [workingDays, errForWorkingDays] =
      SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
        automatedTaskSetting.working_days
      );
    if (errForWorkingDays)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
      });
    automatedTaskSetting.working_days = workingDays;

    if (exception.user_id !== body.value.user_id) {
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
          error: `Error while fetching automated task settings: ${errForUserException}`,
        });
      if (userException)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Exception already exists for this user',
        });

      // update new user

      const [newUserUpdate, errForUpdateSettings] =
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
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });

      // Check if the old user's sub-dept has an exception
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

      if (sdException) {
        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              automated_task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              at_settings_id: sdException.at_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update automated task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      } else {
        const [adminSetting, errForAdminSetting] =
          await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
            priority: SETTING_LEVELS.ADMIN,
            company_id: exception.company_id,
          });
        if (errForAdminSetting)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update automated task setting exception',
            error: `Error while fetching automated task settings by query: ${errForAdminSetting}`,
          });

        const [oldUser, errForUpdateOldUser] =
          await SettingsRepository.updateSettingsByUserQuery(
            {
              user_id: exception.user_id,
            },
            {},
            {
              automated_task_setting_priority: SETTING_LEVELS.ADMIN,
              at_settings_id: adminSetting.at_settings_id,
            }
          );
        if (errForUpdateOldUser)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update automated task setting exception',
            error: `Error while updating settings by user query: ${errForUpdateOldUser}`,
          });
      }
    }

    // user ids will be [exception.user_id,body.value.user_id]
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

    let userIds = [...new Set([exception.user_id, body.value.user_id])];
    AutomatedTasksHelper.adjustStartTime({ userIds });
    TaskHelper.recalculateDailyTasksForUsers(userIds);
    // * remove from redis user_ids
    await RedisHelper.removeUsers(userIds || [], REDIS_ADDED_USER_IDS_FOR_MAIL);
    await RedisHelper.removeUsers(
      userIds || [],
      REDIS_ADDED_USER_IDS_FOR_MESSAGE
    );
  } catch (err) {
    logger.error(
      'Error while updating automated task settings exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating automated task settings exception: ${err.message}`,
    });
  }
};

const deleteAutomatedTaskSettingException = async (req, res) => {
  try {
    const { at_settings_id } = req.params;
    if (!at_settings_id)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: 'At settings id cannot be empty',
      });

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
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated task setting exception',
        error: 'Exception not found',
      });

    if (exception.priority !== SETTING_LEVELS.USER)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated task setting exception',
        error: 'Invalid exception',
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

    // 1. check if there is an exception for the user's sub-dept
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
      const [__, errForUpdateSettings] =
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
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete automated task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
    } else {
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
      const [__, errForUpdateSettings] =
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
      if (errForUpdateSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete automated task setting exception',
          error: `Error while updating settings by user query: ${errForUpdateSettings}`,
        });
    }

    successResponse(res, 'Successfully deleted exception.');
    TaskHelper.recalculateDailyTasksForUsers([exception.user_id]);
    AutomatedTasksHelper.adjustStartTime({ userIds: [exception.user_id] });
    // * remove from redis user_ids
    await RedisHelper.removeUsers(
      [exception.user_id],
      REDIS_ADDED_USER_IDS_FOR_MAIL
    );
    await RedisHelper.removeUsers(
      [exception.user_id],
      REDIS_ADDED_USER_IDS_FOR_MESSAGE
    );
  } catch (err) {
    logger.error(
      'Error while deleting automated task settings exception: ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting automated task settings exception: ${err.message}`,
    });
  }
};

const AutomatedTaskSettingControllers = {
  createAutomatedTaskSettingException,
  updateAutomatedTaskSettingException,
  deleteAutomatedTaskSettingException,
};

module.exports = AutomatedTaskSettingControllers;
