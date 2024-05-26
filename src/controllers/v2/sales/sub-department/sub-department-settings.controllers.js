// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  SETTING_LEVELS,
  SETTINGS_ID_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  REDIS_ADDED_USER_IDS_FOR_MAIL,
  REDIS_ADDED_USER_IDS_FOR_MESSAGE,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Package
const { Op } = require('sequelize');

// Repository
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const AutomatedTaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const BouncedMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const UnsubscribeMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');
const TaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/task-settings.repository');
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers
const SettingsHelpers = require('../../../../../../Cadence-Brain/src/helper/settings');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const TaskSettingsHelper = require('../../../../../../Cadence-Brain/src/helper/task-settings');
const AutomatedTasksHelper = require('../../../../../../Cadence-Brain/src/helper/automated-tasks');
const RedisHelper = require('../../../../../../Cadence-Brain/src/helper/redis');

// Joi
const subDepartmentSettingsSchema = require('../../../../joi/v2/sales/sub-department/sub-department-settings.joi');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score');

const getSubDepartmentSettings = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user) return notFoundResponse(res, 'User not found.');

    const automatedSettingsPromise =
      AutomatedTaskSettingsRepository.getAutomatedTaskSettings({
        company_id: user.company_id,
        [Op.or]: {
          priority: SETTING_LEVELS.ADMIN,
          sd_id: user.sd_id,
        },
      });

    const unsubscribeMailSettingsPromise =
      UnsubscribeMailSettingsRepository.getUnsubscribeMailSettings({
        company_id: user.company_id,
        [Op.or]: {
          priority: SETTING_LEVELS.ADMIN,
          sd_id: user.sd_id,
        },
      });

    const bouncedMailSettingsPromise =
      BouncedMailSettingsRepository.getBouncedMailSettings({
        company_id: user.company_id,
        [Op.or]: {
          priority: SETTING_LEVELS.ADMIN,
          sd_id: user.sd_id,
        },
      });
    const taskSettingsPromise = TaskSettingsRepository.getTaskSettings({
      company_id: user.company_id,
      [Op.or]: {
        priority: SETTING_LEVELS.ADMIN,
        sd_id: user.sd_id,
      },
    });

    const skipSettingsPromise = Repository.fetchAll({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        company_id: user.company_id,
        [Op.or]: {
          priority: SETTING_LEVELS.ADMIN,
          sd_id: user.sd_id,
        },
      },
    });

    const leadScoreSettingsPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        company_id: user.company_id,
        [Op.or]: {
          priority: SETTING_LEVELS.ADMIN,
          sd_id: user.sd_id,
        },
      },
    });

    const [
      [automatedTaskSettings, errForAtSettings],
      [unsubscribeMailSettings, errForUnsubscribeMailSettings],
      [bouncedMailSettings, errForBouncedMailSettings],
      [taskSettings, errForTaskSettings],
      [skipSettings, errForSkipSettings],
      [leadScoreSettings, errForLeadScoreSettings],
    ] = await Promise.all([
      automatedSettingsPromise,
      unsubscribeMailSettingsPromise,
      bouncedMailSettingsPromise,
      taskSettingsPromise,
      skipSettingsPromise,
      leadScoreSettingsPromise,
    ]);

    if (errForAtSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching automated task settings: ${errForAtSettings}`,
      });
    if (errForUnsubscribeMailSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching unsubscribe mail settings: ${errForUnsubscribeMailSettings}`,
      });
    if (errForBouncedMailSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching bounced mail settings: ${errForBouncedMailSettings}`,
      });
    if (errForTaskSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching task settings: ${errForTaskSettings}`,
      });
    if (errForSkipSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch sub-department settings',
        error: `Error while fetching skip task settings: ${errForSkipSettings}`,
      });

    // Fetch automated task settings

    let admin_automated_task_setting = null,
      sd_automated_task_setting = null,
      automated_task_setting = null;
    let automatedTaskSettingExceptions = automatedTaskSettings?.filter(
      (setting) => {
        if (
          !automated_task_setting &&
          setting.priority === SETTING_LEVELS.ADMIN
        ) {
          admin_automated_task_setting = setting;

          // Send setting as subdepartment setting when fetched for subdepartment so that it can be used to update

          // automated_task_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
        } else if (
          setting.sd_id === user.sd_id &&
          setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
        )
          sd_automated_task_setting = setting;
        else return setting;
      }
    );
    if (sd_automated_task_setting)
      automated_task_setting = sd_automated_task_setting;
    else automated_task_setting = admin_automated_task_setting;

    // convert workind_days from numbers array to enums array
    const [workingDays, errForWorkingDays] =
      SettingsHelpers.convertWorkingDaysNumbersToEnumsArray(
        automated_task_setting.working_days
      );
    automated_task_setting.working_days = workingDays;
    automatedTaskSettingExceptions = automatedTaskSettingExceptions.map(
      (exception) => ({
        ...exception,
        working_days: SettingsHelpers.convertWorkingDaysNumbersToEnumsArray(
          exception.working_days
        )[0],
      })
    );

    // Fetch bounced mail settings

    let bounced_mail_setting = null,
      admin_bounced_mail_setting = null,
      sd_bounced_mail_setting = null;
    const bouncedMailSettingExceptions = bouncedMailSettings?.filter(
      (setting) => {
        if (
          !bounced_mail_setting &&
          setting.priority === SETTING_LEVELS.ADMIN
        ) {
          admin_bounced_mail_setting = setting;
          // bounced_mail_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
        } else if (
          setting.sd_id === user.sd_id &&
          setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
        )
          sd_bounced_mail_setting = setting;
        else return setting;
      }
    );

    if (sd_bounced_mail_setting) bounced_mail_setting = sd_bounced_mail_setting;
    else bounced_mail_setting = admin_bounced_mail_setting;

    // Fetch unsubscribe mail settings

    let unsubscribe_mail_setting = null,
      admin_unsubscribe_mail_setting = null,
      sd_unsubscribe_mail_setting = null;
    const unsubscribeMailSettingExceptions = unsubscribeMailSettings?.filter(
      (setting) => {
        if (
          !unsubscribe_mail_setting &&
          setting.priority === SETTING_LEVELS.ADMIN
        ) {
          admin_unsubscribe_mail_setting = setting;
          // unsubscribe_mail_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
        } else if (
          setting.sd_id === user.sd_id &&
          setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
        )
          sd_unsubscribe_mail_setting = setting;
        else return setting;
      }
    );

    if (sd_unsubscribe_mail_setting)
      unsubscribe_mail_setting = sd_unsubscribe_mail_setting;
    else unsubscribe_mail_setting = admin_unsubscribe_mail_setting;

    // Fetch task settings

    let task_setting = null,
      admin_task_setting = null,
      sd_task_setting = null;

    const taskSettingsExceptions = taskSettings?.filter((setting) => {
      if (!task_setting && setting.priority === SETTING_LEVELS.ADMIN) {
        admin_task_setting = setting;
        // task_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
      } else if (
        setting.sd_id === user.sd_id &&
        setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
      )
        sd_task_setting = setting;
      else return setting;
    });

    if (sd_task_setting) task_setting = sd_task_setting;
    else task_setting = admin_task_setting;

    // Fetch Skip Setting

    let skip_setting = null,
      admin_skip_setting = null,
      sd_skip_setting = null;
    const skipSettingExceptions = skipSettings?.filter((setting) => {
      if (!skip_setting && setting.priority === SETTING_LEVELS.ADMIN) {
        admin_skip_setting = setting;
        // skip_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
      } else if (
        setting.sd_id === user.sd_id &&
        setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
      )
        sd_skip_setting = setting;
      else return setting;
    });

    if (sd_skip_setting) skip_setting = sd_skip_setting;
    else skip_setting = admin_skip_setting;

    // Fetch Lead Score Settings

    let lead_score_setting = null,
      admin_lead_score_setting = null,
      sd_lead_score_setting = null;
    const leadScoreSettingExceptions = leadScoreSettings?.filter((setting) => {
      if (!lead_score_setting && setting.priority === SETTING_LEVELS.ADMIN) {
        admin_lead_score_setting = setting;
        // skip_setting.priority = SETTING_LEVELS.SUB_DEPARTMENT;
      } else if (
        setting.sd_id === user.sd_id &&
        setting.priority === SETTING_LEVELS.SUB_DEPARTMENT
      )
        sd_lead_score_setting = setting;
      else return setting;
    });

    if (sd_lead_score_setting) lead_score_setting = sd_lead_score_setting;
    else lead_score_setting = admin_lead_score_setting;

    const data = {
      Automated_Task_Settings: {
        ...automated_task_setting,
        exceptions: automatedTaskSettingExceptions,
      },
      Bounced_Mail_Settings: {
        ...bounced_mail_setting,
        exceptions: bouncedMailSettingExceptions,
      },
      Unsubscribe_Mail_Settings: {
        ...unsubscribe_mail_setting,
        exceptions: unsubscribeMailSettingExceptions,
      },
      Task_Settings: {
        ...task_setting,
        exceptions: taskSettingsExceptions,
      },
      Skip_Settings: {
        ...skip_setting,
        exceptions: skipSettingExceptions,
      },
      Lead_Score_Settings: {
        ...lead_score_setting,
        exceptions: leadScoreSettingExceptions,
      },
    };

    return successResponse(
      res,
      'Successfully fetched sub-department settings.',
      data
    );
  } catch (err) {
    logger.error('Error while fetching sub-department settings: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching sub-department settings: ${err.message}`,
    });
  }
};

const updateSubDepartmentSettings = async (req, res) => {
  try {
    const body = subDepartmentSettingsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    let {
      Automated_Task_Settings,
      Bounced_Mail_Settings,
      Unsubscribe_Mail_Settings,
      Task_Settings,
      Skip_Settings,
      Lead_Score_Settings,
    } = body.value;

    // Fetch user
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update group settings',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user) return notFoundResponse(res, 'User not found.');

    let updatedUserIds = [];

    if (Automated_Task_Settings) {
      if (Automated_Task_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        const [exception, errForException] =
          await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
            company_id: user.company_id,
            sd_id: user.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (errForException)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching automated task setting by query: ${errForException}`,
          });

        // convert working_days from enums array to numbers array
        const [workingDays, errForWorkingDays] =
          SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
            Automated_Task_Settings.working_days
          );
        if (errForWorkingDays)
          return unprocessableEntityResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
          });
        Automated_Task_Settings.working_days = workingDays;

        const at_settings_id = Automated_Task_Settings?.at_settings_id;
        delete Automated_Task_Settings.at_settings_id;

        if (exception) {
          const [_, errForUpdateException] =
            await AutomatedTaskSettingsRepository.updateAutomatedTaskSettings(
              {
                company_id: user.company_id,
                sd_id: user.sd_id,
                priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              Automated_Task_Settings
            );
          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating automated task settings: ${errForUpdateException}`,
            });

          const [userIds, errForUserIds] = await Repository.fetchAll({
            tableName: DB_TABLES.SETTINGS,
            query: { at_settings_id },
            extras: { attributes: ['user_id'] },
          });
          userIds?.map((u) => updatedUserIds.push(u.user_id));
        } else {
          const [createdException, errForCreatedException] =
            await AutomatedTaskSettingsRepository.createAutomatedTaskSetting(
              Automated_Task_Settings
            );
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating automated task settings: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')
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
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });

          const [userIds, errForUserIds] = await Repository.fetchAll({
            tableName: DB_TABLES.SETTINGS,
            query: { at_settings_id: createdException?.at_settings_id },
            extras: { attributes: ['user_id'] },
          });
          userIds?.map((u) => updatedUserIds.push(u.user_id));
        }
      }
    }

    if (Bounced_Mail_Settings) {
      if (Bounced_Mail_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        const [exception, errForException] =
          await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
            company_id: user.company_id,
            sd_id: user.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (errForException)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching bounced mail setting by query: ${errForException}`,
          });

        delete Bounced_Mail_Settings.bounced_settings_id;

        Bounced_Mail_Settings.semi_automatic_bounced_data.automated_mail = true;
        Bounced_Mail_Settings.semi_automatic_bounced_data.mail = true;
        Bounced_Mail_Settings.semi_automatic_bounced_data.reply_to = true;
        Bounced_Mail_Settings.semi_automatic_bounced_data.automated_reply_to = true;

        Bounced_Mail_Settings.automatic_bounced_data.automated_mail = true;
        Bounced_Mail_Settings.automatic_bounced_data.mail = true;
        Bounced_Mail_Settings.automatic_bounced_data.reply_to = true;
        Bounced_Mail_Settings.automatic_bounced_data.automated_reply_to = true;

        if (exception) {
          const [_, errForUpdateException] =
            await BouncedMailSettingsRepository.updateBouncedMailSettings(
              {
                company_id: user.company_id,
                sd_id: user.sd_id,
                priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              Bounced_Mail_Settings
            );
          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating bounced mail settings: ${errForUpdateException}`,
            });
        } else {
          const [createdException, errForCreatedException] =
            await BouncedMailSettingsRepository.createBouncedMailSetting(
              Bounced_Mail_Settings
            );
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating bounced mail setting: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')

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
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });
        }
      }
    }

    if (Unsubscribe_Mail_Settings) {
      if (
        Unsubscribe_Mail_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT
      ) {
        const [exception, errForException] =
          await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery(
            {
              company_id: user.company_id,
              sd_id: user.sd_id,
              priority: SETTING_LEVELS.SUB_DEPARTMENT,
            }
          );
        if (errForException)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching unsubscribe mail setting by query: ${errForException}`,
          });

        delete Unsubscribe_Mail_Settings.unsubscribe_settings_id;

        // Set true always for mail tasks
        Unsubscribe_Mail_Settings.semi_automatic_unsubscribed_data.automated_mail = true;
        Unsubscribe_Mail_Settings.semi_automatic_unsubscribed_data.mail = true;
        Unsubscribe_Mail_Settings.semi_automatic_unsubscribed_data.reply_to = true;
        Unsubscribe_Mail_Settings.semi_automatic_unsubscribed_data.automated_reply_to = true;

        Unsubscribe_Mail_Settings.automatic_unsubscribed_data.automated_mail = true;
        Unsubscribe_Mail_Settings.automatic_unsubscribed_data.mail = true;
        Unsubscribe_Mail_Settings.automatic_unsubscribed_data.reply_to = true;
        Unsubscribe_Mail_Settings.automatic_unsubscribed_data.automated_reply_to = true;

        if (exception) {
          const [_, errForUpdateException] =
            await UnsubscribeMailSettingsRepository.updateUnsubscribeMailSettings(
              {
                company_id: user.company_id,
                sd_id: user.sd_id,
                priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              Unsubscribe_Mail_Settings
            );
          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating unsubscribe mail settings: ${errForUpdateException}`,
            });
        } else {
          const [createdException, errForCreatedException] =
            await UnsubscribeMailSettingsRepository.createUnsubscribeMailSetting(
              Unsubscribe_Mail_Settings
            );
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating unsubscribe mail setting: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')

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
                unsubscribe_settings_id:
                  createdException.unsubscribe_settings_id,
                unsubscribe_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              }
            );
          if (errForUpdateSettings)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });
        }
      }
    }

    if (Task_Settings) {
      if (Task_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        //const totalTasksCount =
        //parseInt(Task_Settings.calls_per_day) +
        //parseInt(Task_Settings.mails_per_day) +
        //parseInt(Task_Settings.messages_per_day) +
        //parseInt(Task_Settings.linkedin_connections_per_day) +
        //parseInt(Task_Settings.linkedin_messages_per_day) +
        //parseInt(Task_Settings.linkedin_profiles_per_day) +
        //parseInt(Task_Settings.linkedin_interacts_per_day) +
        //parseInt(Task_Settings.data_checks_per_day) +
        ////parseInt(Task_Settings.reply_tos_per_day) +
        //parseInt(Task_Settings.cadence_customs_per_day);

        //if (totalTasksCount > parseInt(Task_Settings.max_tasks))
        //return badRequestResponse(
        //res,
        //'Sum of individual task exceed Max tasks limit.'
        //);

        //if (totalTasksCount < parseInt(Task_Settings.max_tasks)) {
        //const [adjustedTaskSetting, errForAdjustedTaskSetting] =
        //TaskSettingsHelper.adjustTaskSplits(Task_Settings);

        //if (errForAdjustedTaskSetting)
        //return serverErrorResponse(res, errForAdjustedTaskSetting);

        //Task_Settings = adjustedTaskSetting;
        //}

        delete Task_Settings.task_settings_id;

        const [exception, errForException] =
          await TaskSettingsRepository.getTaskSettingByQuery({
            company_id: user.company_id,
            sd_id: user.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          });
        if (errForException)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching task setting by query: ${errForException}`,
          });

        if (exception) {
          const [_, errForUpdateException] =
            await TaskSettingsRepository.updateTaskSettings(
              {
                company_id: user.company_id,
                sd_id: user.sd_id,
                priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              Task_Settings
            );

          if (Task_Settings.max_tasks || Task_Settings.high_priority_split) {
            const [settings, errForSettings] = await Repository.fetchAll({
              tableName: DB_TABLES.SETTINGS,
              query: {
                task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              },
              include: {
                [DB_TABLES.USER]: {
                  attributes: [],
                  where: {
                    sd_id: user.sd_id,
                  },
                },
              },
            });
            if (errForSettings)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to update group settings',
                error: `Error while fetching settings: ${errForSettings}`,
              });

            if (settings.length > 0) {
              let user_ids_array = [];
              settings.forEach((setting) => {
                user_ids_array.push(setting.user_id);
              });
              TaskHelper.recalculateDailyTasksForUsers(user_ids_array);
              TaskHelper.updateLateTime({
                userIds: user_ids_array,
                late_settings: Task_Settings.late_settings,
              });
            }
          }

          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating task settings: ${errForUpdateException}`,
            });
        } else {
          const [createdException, errForCreatedException] =
            await TaskSettingsRepository.createTaskSetting(Task_Settings);
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating task setting: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')

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
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });

          const [settings, errForSettings] = await Repository.fetchAll({
            tableName: DB_TABLES.SETTINGS,
            query: {
              task_setting_priority: SETTING_LEVELS.SUB_DEPARTMENT,
              task_settings_id: createdException.task_settings_id,
            },
            include: {
              [DB_TABLES.TASK_SETTINGS]: {
                where: { sd_id: createdException.sd_id },
                required: true,
              },
            },
          });
          if (settings.length > 0) {
            let user_ids_array = [];
            settings.forEach((setting) => {
              user_ids_array.push(setting.user_id);
            });
            TaskHelper.recalculateDailyTasksForUsers(user_ids_array);
            TaskHelper.updateLateTime({
              userIds: user_ids_array,
              late_settings: Task_Settings.late_settings,
            });
          }
        }
      }
    }

    if (Skip_Settings) {
      if (Skip_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        const [exception, errForException] = await Repository.fetchOne({
          tableName: DB_TABLES.SKIP_SETTINGS,
          query: {
            company_id: user.company_id,
            sd_id: user.sd_id,
            priority: SETTING_LEVELS.SUB_DEPARTMENT,
          },
        });
        if (errForException)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching skip settings: ${errForException}`,
          });

        delete Skip_Settings.skip_settings_id;

        if (!Skip_Settings?.skip_reasons)
          Skip_Settings.skip_reasons = ['Other'];
        else {
          // Check if skip reasons includes other
          if (typeof Skip_Settings?.skip_reasons === 'object') {
            if (!Skip_Settings.skip_reasons.includes('Other'))
              Skip_Settings.skip_reasons.push('Other');
          } else Skip_Settings.skip_reasons = ['Other'];
        }

        if (exception) {
          const [_, errForUpdateException] = await Repository.update({
            tableName: DB_TABLES.SKIP_SETTINGS,
            query: {
              company_id: user.company_id,
              sd_id: user.sd_id,
              priority: SETTING_LEVELS.SUB_DEPARTMENT,
            },
            updateObject: Skip_Settings,
          });
          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating skip settings: ${errForUpdateException}`,
            });
        } else {
          const [createdException, errForCreatedException] =
            await Repository.create({
              tableName: DB_TABLES.SKIP_SETTINGS,
              createObject: Skip_Settings,
            });
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating skip settings: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')

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
              }
            );
          if (errForUpdateSettings)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });
        }
      }
    }
    let currentLeadScoreSetting, errForCurrentLeadScoreSetting;
    if (Lead_Score_Settings) {
      if (Lead_Score_Settings.priority === SETTING_LEVELS.SUB_DEPARTMENT) {
        const [currentLeadScoreSetting, errForCurrentLeadScoreSetting] =
          await Repository.fetchOne({
            tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
            query: {
              company_id: user.company_id,
              sd_id: user.sd_id,
              priority: SETTING_LEVELS.SUB_DEPARTMENT,
            },
          });
        if (errForCurrentLeadScoreSetting)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update group settings',
            error: `Error while fetching lead score settings: ${errForCurrentLeadScoreSetting}`,
          });

        delete Lead_Score_Settings.ls_settings_id;

        if (currentLeadScoreSetting) {
          const [_, errForUpdateException] = await Repository.update({
            tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
            query: {
              company_id: user.company_id,
              sd_id: user.sd_id,
              priority: SETTING_LEVELS.SUB_DEPARTMENT,
            },
            updateObject: Lead_Score_Settings,
          });
          if (errForUpdateException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating lead score settings: ${errForUpdateException}`,
            });
        } else {
          [currentLeadScoreSetting, errForCurrentLeadScoreSetting] =
            await Repository.fetchOne({
              tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
              query: {
                company_id: user.company_id,
                priority: SETTING_LEVELS.ADMIN,
              },
            });
          const [createdException, errForCreatedException] =
            await Repository.create({
              tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
              createObject: Lead_Score_Settings,
            });
          if (errForCreatedException)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while creating lead score settings: ${errForCreatedException}`,
            });

          // Update all users of the sub-dept
          // (which do not have higher setting priority i.e 'user')

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
              }
            );
          if (errForUpdateSettings)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update group settings',
              error: `Error while updating settings by user query: ${errForUpdateSettings}`,
            });
        }
      }
    }

    successResponse(res, 'Successfully updated sub department settings.');
    AutomatedTasksHelper.adjustStartTime({ userIds: updatedUserIds });
    TaskHelper.recalculateDailyTasksForUsers(updatedUserIds);

    let score_threshold_unchanged =
        Lead_Score_Settings?.score_threshold ===
        currentLeadScoreSetting?.score_threshold,
      reset_period_unchanged =
        Lead_Score_Settings?.reset_period ===
        currentLeadScoreSetting?.reset_period;

    LeadScoreHelper.updateLeadScoreOnSettingsChange({
      id: user?.[SETTINGS_ID_TYPES?.[Lead_Score_Settings?.priority]],
      priority: Lead_Score_Settings.priority,
      score_threshold: Lead_Score_Settings?.score_threshold,
      reset_period: Lead_Score_Settings?.reset_period,
      score_threshold_unchanged,
      reset_period_unchanged,
    });
    // * remove from redis user_ids
    await RedisHelper.removeUsers(
      updatedUserIds || [],
      REDIS_ADDED_USER_IDS_FOR_MAIL
    );
    await RedisHelper.removeUsers(
      updatedUserIds || [],
      REDIS_ADDED_USER_IDS_FOR_MESSAGE
    );
  } catch (err) {
    logger.error('Error while updating sub-department settings: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating sub-department settings: ${err.message}`,
    });
  }
};

const SubDepartmentSettingsControllers = {
  getSubDepartmentSettings,
  updateSubDepartmentSettings,
};

module.exports = SubDepartmentSettingsControllers;
