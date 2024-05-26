// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SETTING_LEVELS,
  USER_ROLE,
  CRM_INTEGRATIONS,
  HIRING_INTEGRATIONS,
  SETTINGS_ID_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  REDIS_ADDED_USER_IDS_FOR_MAIL,
  REDIS_ADDED_USER_IDS_FOR_MESSAGE,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Repository
const UserRepository = require('../../../../../Cadence-Brain/src/repository/user-repository');
const AutomatedTaskSettingsRepository = require('../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const UnsubscribeMailSettingsRepository = require('../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const BouncedMailSettingsRepository = require('../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const TaskSettingsRepository = require('../../../../../Cadence-Brain/src/repository/task-settings.repository');
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and services
const SettingsHelpers = require('../../../../../Cadence-Brain/src/helper/settings');
const TaskHelper = require('../../../../../Cadence-Brain/src/helper/task');
const TaskSettingsHelper = require('../../../../../Cadence-Brain/src/helper/task-settings');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const AutomatedTasksHelper = require('../../../../../Cadence-Brain/src/helper/automated-tasks');
const RedisHelper = require('../../../../../Cadence-Brain/src/helper/redis');
const SocketHelper = require('../../../../../Cadence-Brain/src/helper/socket');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const EmailUpdateHelper = require('../../../../../Cadence-Brain/src/helper/emailUpdate');

// DB
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Joi
const companySettingsSchema = require('../../../joi/v2/admin/company-settings.joi');
const phoneSystemSettingsSchema = require('../../../joi/v2/admin/phone-system-settings.joi');
const mailIntegrationSchema = require('../../../joi/v2/admin/mail-integration.joi');
const mailScopeSchemaSchema = require('../../../joi/v2/admin/mail-scope.joi');

// Packages
const { Op } = require('sequelize');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const LeadScoreHelper = require('../../../../../Cadence-Brain/src/helper/lead-score');

const getCompanySettingsForAdmin = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({ res, msg: 'User not found' });

    // Fetch all Settings

    const automatedSettingsPromise =
      AutomatedTaskSettingsRepository.getAutomatedTaskSettings({
        company_id: user.company_id,
      });

    const unsubscribeMailSettingsPromise =
      UnsubscribeMailSettingsRepository.getUnsubscribeMailSettings({
        company_id: user.company_id,
      });

    const bouncedMailSettingsPromise =
      BouncedMailSettingsRepository.getBouncedMailSettings({
        company_id: user.company_id,
      });
    const taskSettingsPromise = TaskSettingsRepository.getTaskSettings({
      company_id: user.company_id,
    });

    const skipSettingsPromise = Repository.fetchAll({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        company_id: user.company_id,
      },
    });

    const leadScoreSettingsPromise = Repository.fetchAll({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        company_id: user.company_id,
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
        msg: 'Failed to fetch company settings',
        error: `Error while fetching automated task settings: ${errForAtSettings}`,
      });
    if (errForUnsubscribeMailSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching unsubscribe mail settings: ${errForUnsubscribeMailSettings}`,
      });
    if (errForBouncedMailSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching bounced mail settings: ${errForBouncedMailSettings}`,
      });
    if (errForTaskSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching task settings: ${errForTaskSettings}`,
      });
    if (errForSkipSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching skip settings: ${errForSkipSettings}`,
      });
    if (errForLeadScoreSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while lead score settings: ${errForLeadScoreSettings}`,
      });

    // automated task settings

    let automated_task_setting = null;
    let automatedTaskSettingExceptions = automatedTaskSettings?.filter(
      (setting) => {
        if (setting.priority === SETTING_LEVELS.ADMIN)
          automated_task_setting = setting;
        else return setting;
      }
    );

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

    //  unsubscribe mail settings

    let unsubscribe_mail_setting = [];
    const unsubscribe_mail_exceptions = unsubscribeMailSettings?.filter(
      (setting) => {
        if (setting.priority === SETTING_LEVELS.ADMIN)
          unsubscribe_mail_setting = setting;
        else return setting;
      }
    );

    // bounced mail settings

    // Fetch company domain
    let extrasForCompanySettings = {
      attributes: [
        'custom_domain',
        'unsubscribe_link_madatory_for_semi_automated_mails',
        'unsubscribe_link_madatory_for_automated_mails',
        'default_unsubscribe_link_text',
      ],
    };
    const [companyDomainSettings, errForCompanyDomainSettings] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        query: {
          company_id: user.company_id,
        },
        extras: extrasForCompanySettings,
      });

    let domain, errForDomain;
    const extrasForCd = {
      attributes: ['cd_id', 'domain_name', 'domain_status'],
    };
    if (companyDomainSettings && !errForCompanyDomainSettings) {
      [domain, errForDomain] = await Repository.fetchOne({
        tableName: DB_TABLES.CUSTOM_DOMAIN,
        query: {
          company_id: user.company_id,
        },
        extras: extrasForCd,
      });
    }
    if (errForDomain)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company settings',
        error: `Error while fetching custom domain: ${errForDomain}`,
      });
    let bounced_mail_setting = [];
    const bounced_mail_exceptions = bouncedMailSettings?.filter((setting) => {
      if (setting.priority === SETTING_LEVELS.ADMIN)
        bounced_mail_setting = setting;
      else return setting;
    });

    // Task Settings
    let task_settings;
    const task_settings_exceptions = taskSettings?.filter((setting) => {
      if (setting.priority === SETTING_LEVELS.ADMIN) task_settings = setting;
      else return setting;
    });
    // // Phone System Settings
    // const [phoneSystemType, errForPhoneSystemType] = await Repository.fetchOne({
    //   tableName: DB_TABLES.COMPANY_SETTINGS,
    //   query: { company_id: user.company_id },
    //   extras: {
    //     attributes: ['phone_system'],
    //   },
    // });
    // if (errForPhoneSystemType)
    //   return serverErrorResponse(res, errForPhoneSystemType);

    // Skip Settings

    let skip_setting;
    const skip_exceptions = skipSettings?.filter((setting) => {
      if (setting.priority === SETTING_LEVELS.ADMIN) skip_setting = setting;
      else return setting;
    });

    // Skip Settings

    let lead_score_setting;
    const lead_score_exceptions = leadScoreSettings?.filter((setting) => {
      if (setting.priority === SETTING_LEVELS.ADMIN)
        lead_score_setting = setting;
      else return setting;
    });

    const data = {
      Automated_Task_Settings: {
        ...automated_task_setting,
        exceptions: automatedTaskSettingExceptions,
      },
      Unsubscribe_Mail_Settings: {
        ...unsubscribe_mail_setting,
        exceptions: unsubscribe_mail_exceptions,
        ...companyDomainSettings,
      },
      Bounced_Mail_Settings: {
        ...bounced_mail_setting,
        exceptions: bounced_mail_exceptions,
      },
      Task_Settings: {
        ...task_settings,
        exceptions: task_settings_exceptions,
      },
      Custom_Domain_Settings: {
        ...domain,
      },
      Skip_Settings: {
        ...skip_setting,
        exceptions: skip_exceptions,
      },
      Lead_Score_Settings: {
        ...lead_score_setting,
        exceptions: lead_score_exceptions,
      },
      // Phone_System_Settings: {
      //   phone_system_type: phoneSystemType.phone_system,
      // },
    };

    return successResponse(
      res,
      'Successfully fetched company settings for admin.',
      data
    );
  } catch (err) {
    logger.error('Error while fetching company settings for Admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching company settings for admin: ${err.message}`,
    });
  }
};

const updateCompanySettingsForAdmin = async (req, res, next) => {
  try {
    const body = companySettingsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    let {
      Automated_Task_Settings,
      Unsubscribe_Mail_Settings,
      Bounced_Mail_Settings,
      Task_Settings,
      Skip_Settings,
      Lead_Score_Settings,
      //Phone_System_Settings,
    } = body.value;

    // Fetch the user
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company settings',
        error: `Error while fetching user by query: ${errForUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({ res, msg: 'User not found' });

    let updatedUserIds = [];

    // update automated task setting
    if (Automated_Task_Settings) {
      // update for all users with this at_id in settings table
      if (Automated_Task_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field provided',
        });

      // convert working_days from enums array to numbers array
      const [workingDays, errForWorkingDays] =
        SettingsHelpers.convertWorkingDaysEnumsToNumbersArray(
          Automated_Task_Settings.working_days
        );
      if (errForWorkingDays)
        return unprocessableEntityResponseWithDevMsg({
          res,
          error: `Error while converting working days enums to numbers array: ${errForWorkingDays}`,
        });
      Automated_Task_Settings.working_days = workingDays;

      const at_settings_id = Automated_Task_Settings?.at_settings_id;
      delete Automated_Task_Settings.at_settings_id;

      const [_, errForUpdateATSetting] =
        await AutomatedTaskSettingsRepository.updateAutomatedTaskSettings(
          {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
          Automated_Task_Settings
        );
      if (errForUpdateATSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company settings',
          error: `Error while updating automated task settings: ${errForUpdateATSetting}`,
        });

      const [userIds, errForUserIds] = await Repository.fetchAll({
        tableName: DB_TABLES.SETTINGS,
        query: { at_settings_id },
        extras: { attributes: ['user_id'] },
      });
      userIds?.map((u) => updatedUserIds.push(u.user_id));
    }

    // update unsubscribe mail setting
    if (Unsubscribe_Mail_Settings) {
      if (Unsubscribe_Mail_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field in Unsubscribe_Mail_Settings',
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

      const [_, errForUpdateUnsubscribeMailSetting] =
        await UnsubscribeMailSettingsRepository.updateUnsubscribeMailSettings(
          {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
          Unsubscribe_Mail_Settings
        );
      if (errForUpdateUnsubscribeMailSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company settings',
          error: `Error while updating unsubscribe mail settings: ${errForUpdateUnsubscribeMailSetting}`,
        });
    }

    // update bounced mail setting
    if (Bounced_Mail_Settings) {
      if (Bounced_Mail_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field in Bounced_Mail_Settings',
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

      const [_, errForUpdateBouncedMailSetting] =
        await BouncedMailSettingsRepository.updateBouncedMailSettings(
          {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
          Bounced_Mail_Settings
        );
      if (errForUpdateBouncedMailSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company settings',
          error: `Error while updating bounced mail settings: ${errForUpdateBouncedMailSetting}`,
        });
    }

    // update task setting
    if (Task_Settings) {
      if (Task_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field in Task_Settings',
        });

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

      const [_, errForUpdateTaskSetting] =
        await TaskSettingsRepository.updateTaskSettings(
          {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
          Task_Settings
        );
      if (Task_Settings.max_tasks || Task_Settings.high_priority_split) {
        const [settings, errForSettings] = await Repository.fetchAll({
          tableName: DB_TABLES.SETTINGS,
          query: {
            task_setting_priority: SETTING_LEVELS.ADMIN,
          },
          include: {
            [DB_TABLES.TASK_SETTINGS]: {
              where: { company_id: user.company_id },
              required: true,
            },
          },
        });
        if (errForSettings)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update company settings',
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
      if (errForUpdateTaskSetting)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company settings',
          error: `Error while updating task settings: ${errForUpdateTaskSetting}`,
        });
    }

    if (Skip_Settings) {
      if (Skip_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field in Skip_Settings',
        });

      delete Skip_Settings.skip_settings_id;

      if (!Skip_Settings?.skip_reasons) Skip_Settings.skip_reasons = ['Other'];
      else {
        // Check if skip reasons includes other
        if (typeof Skip_Settings?.skip_reasons === 'object') {
          if (!Skip_Settings.skip_reasons.includes('Other'))
            Skip_Settings.skip_reasons.push('Other');
        } else Skip_Settings.skip_reasons = ['Other'];
      }

      const [_, errForUpdateSkipSettings] = await Repository.update({
        tableName: DB_TABLES.SKIP_SETTINGS,
        query: {
          company_id: user.company_id,
          priority: SETTING_LEVELS.ADMIN,
        },
        updateObject: Skip_Settings,
      });
      if (errForUpdateSkipSettings)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company settings',
          error: `Error while updating skip settings: ${errForUpdateSkipSettings}`,
        });
    }
    let currentLeadScoreSettings, errForCurrentLeadScoreSettings;
    if (Lead_Score_Settings) {
      // Fetch previous Lead Score Settings
      [currentLeadScoreSettings, errForCurrentLeadScoreSettings] =
        await Repository.fetchOne({
          tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
          query: {
            company_id: user.company_id,
            priority: SETTING_LEVELS.ADMIN,
          },
          extras: {
            attributes: ['score_threshold', 'reset_period'],
          },
        });
      if (Lead_Score_Settings.priority !== SETTING_LEVELS.ADMIN)
        return badRequestResponseWithDevMsg({
          res,
          error: 'Invalid level field in Skip_Settings',
        });

      delete Lead_Score_Settings.ls_settings_id;
      const [_, errForUpdateSkipSettings] = await Repository.update({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        query: {
          company_id: user.company_id,
          priority: SETTING_LEVELS.ADMIN,
        },
        updateObject: Lead_Score_Settings,
      });
    }

    // //Phone System Settings
    // if (Phone_System_Settings) {
    //   const [_, errForUpdatePhoneSystemSettings] = await Repository.update({
    //     tableName: DB_TABLES.COMPANY_SETTINGS,
    //     query: { company_id: Phone_System_Settings.company_id },
    //     updateObject: {
    //       phone_system: Phone_System_Settings.phone_system_type,
    //     },
    //   });
    //   if (errForUpdatePhoneSystemSettings)
    //     return serverErrorResponse(res, errForUpdatePhoneSystemSettings);
    // }

    successResponse(res, 'Successfully updated company settings for admin.');

    AutomatedTasksHelper.adjustStartTime({ userIds: updatedUserIds });
    TaskHelper.recalculateDailyTasksForUsers(updatedUserIds);

    let score_threshold_unchanged =
        Lead_Score_Settings?.score_threshold ===
        currentLeadScoreSettings?.score_threshold,
      reset_period_unchanged =
        Lead_Score_Settings?.reset_period ===
        currentLeadScoreSettings?.reset_period;

    LeadScoreHelper.updateLeadScoreOnSettingsChange({
      id: user?.[SETTINGS_ID_TYPES[Lead_Score_Settings.priority]],
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
    logger.error('Error while updating company settings for Admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company settings for admin: ${err.message}`,
    });
  }
};

// * Fetch current user for salesforce tokens
const getCrmAdmin = async (req, res) => {
  try {
    // * Get company setting id
    let tokens;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        tokens = DB_TABLES.HUBSPOT_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokens = DB_TABLES.SELLSY_TOKENS;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokens = DB_TABLES.ZOHO_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokens = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokens = DB_TABLES.DYNAMICS_TOKENS;
        break;
    }

    const [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['user_id'],
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['company_id'],
          //attributes: [],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['company_settings_id'],
            [DB_TABLES.USER]: {
              attributes: ['first_name', 'last_name', 'user_id'],
              [tokens]: {
                attributes: [
                  'is_logged_out',
                  //'encrypted_instance_url',
                  //'instance_url',
                ],
              },
            },
          },
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch crm admin',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({ res, msg: 'User not found' });

    return successResponse(res, 'Successfully fetched tokens user', user);
  } catch (err) {
    logger.error(
      `An error occurred while getting user with CRM token access`,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching crm admin: ${err.message}`,
    });
  }
};

// * const getAdmins and super admins of the company
const getAdminsAndSuperAdmins = async (req, res) => {
  try {
    // * Get company setting id
    const [company, errFetchingCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errFetchingCompany)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch admins and super admins',
        error: `Error while fetching company: ${errFetchingCompany}`,
      });
    if (!company)
      return notFoundResponseWithDevMsg({ res, msg: 'User not found' });

    // * Get company setting id
    const [users, errFetchingUsers] = await Repository.fetchAll({
      tableName: DB_TABLES.USER,
      query: {
        company_id: company.company_id,
        role: {
          [Op.or]: [USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN],
        },
      },
      extras: {
        attributes: ['user_id', 'first_name', 'last_name'],
      },
    });
    if (errFetchingUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch admins and super admins',
        error: `Error while fetching users: ${errFetchingUsers}`,
      });

    return successResponse(res, 'Successfully fetched admins', users);
  } catch (err) {
    logger.error(
      `An error occurred while getting admins and super admins`,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching admins and super admins: ${err.message}`,
    });
  }
};

// * Update user to extract salesforce tokens from
const updateUserToExtractTokensFrom = async (req, res) => {
  try {
    // * Get company setting id
    let tokens;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        tokens = DB_TABLES.SALESFORCE_TOKENS;
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        break;
      case CRM_INTEGRATIONS.SELLSY:
        tokens = DB_TABLES.SELLSY_TOKENS;
        break;
      case CRM_INTEGRATIONS.ZOHO:
        tokens = DB_TABLES.ZOHO_TOKENS;
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        tokens = DB_TABLES.BULLHORN_TOKENS;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        tokens = DB_TABLES.DYNAMICS_TOKENS;
        break;
    }

    // * Get company setting id
    const [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.body.user_id },
      include: {
        [DB_TABLES.USER_TOKEN]: {
          attributes: ['is_salesforce_logged_out'],
        },
        [tokens]: { attributes: ['is_logged_out'] },
        [DB_TABLES.COMPANY]: {
          attributes: ['company_id'],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['company_settings_id'],
          },
        },
      },
    });
    if (errFetchingUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update CRM admin',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    if (!user)
      return notFoundResponseWithDevMsg({ res, msg: 'User not found' });

    // Fetching CRM tokens and instance url
    const [__, errForAccessToken] = await AccessTokenHelper.getAccessToken({
      integration_type: req.user.integration_type,
      user_id: user.user_id,
    });
    if (
      errForAccessToken === 'Please log in with CRM' ||
      errForAccessToken ===
        'Error while getting access token and refresh token from CRM auth'
    )
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please log in with CRM',
      });
    else if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update CRM admin',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });

    // * Update company setting
    let [_, errUpdatingCompanySettings] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: {
        company_settings_id: user.Company.Company_Setting.company_settings_id,
      },
      updateObject: { user_id: user.user_id },
    });
    if (errUpdatingCompanySettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update CRM admin',
        error: `Error while updating company settings: ${errUpdatingCompanySettings}`,
      });

    return successResponse(
      res,
      'Successfully updated user to extract CRM tokens from'
    );
  } catch (err) {
    logger.error('Error while updating user to extract CRM tokens from: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating user to extract CRM tokens from: ${err.message}`,
    });
  }
};

const updatePhoneSystemForAdmin = async (req, res) => {
  try {
    let body = phoneSystemSettingsSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const [company_id, errForCompanyID] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForCompanyID)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update phone system',
        error: `Error while fetching company by user: ${errForCompanyID}`,
      });

    const [_, errForUpdatePhoneSystemSettings] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: { company_id: company_id.company_id },
      updateObject: {
        phone_system: body.phone_system,
      },
    });
    if (errForUpdatePhoneSystemSettings)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update phone system',
        error: `Error while updating company settings: ${errForUpdatePhoneSystemSettings}`,
      });

    //const [users, errForUsers] = await Repository.fetchAll({
    //tableName: DB_TABLES.USER,
    //query: { company_id: company_id.company_id },
    //extras: {
    //attributes: ['user_id', 'email'],
    //},
    //});
    //if (errForUsers) return serverErrorResponse(res, errForUsers);
    //for (let user of users) {
    //const [_, errForNotification] =
    //await SocketHelper.sendPhoneSystemUpdateEvent({
    //user_id: user.user_id,
    //email: user.email,
    //phone_system: body.phone_system,
    //});
    //if (errForNotification)
    //return serverErrorResponse(res, errForNotification);
    //}

    return successResponse(res, 'Phone system updated successfully');
  } catch (err) {
    logger.error('Error while updating phone system for admin:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating phone system for admin: ${err.message}`,
    });
  }
};

const getPhoneSystemForAdmin = async (req, res) => {
  try {
    const [company_id, errForCompanyID] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForCompanyID)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch phone system',
        error: `Error while fetching company id: ${errForCompanyID}`,
      });

    const [phoneSystemType, errForPhoneSystemType] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: { company_id: company_id.company_id },
      extras: {
        attributes: ['phone_system'],
      },
    });
    if (errForPhoneSystemType)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch phone system',
        error: `Error while fetching company settings: ${errForPhoneSystemType}`,
      });
    return successResponse(
      res,
      'Phone system fetched successfully',
      phoneSystemType
    );
  } catch (err) {
    logger.error('Error while getting phone system for admin:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while getting phone system for admin: ${err.message}`,
    });
  }
};

const updateCompanyMailIntegrationType = async (req, res) => {
  try {
    let body = mailIntegrationSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    if (body.mail_integration_type === req.user.mail_integration_type) {
      return successResponse(
        res,
        `Integration type already ${body.mail_integration_type}`
      );
    }

    // Logging out all users from their respective mail_integrations

    const [update, updateErr] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: {
        company_id: req.user.company_id,
      },
      updateObject: {
        mail_integration_type: body.mail_integration_type,
      },
    });

    if (updateErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company mail integration type',
        error: `Error while updating company settings: ${updateErr}`,
      });
    return successResponse(
      res,
      `Mail Integration changed to ${body.mail_integration_type} successfully`
    );
  } catch (err) {
    logger.error('Error while updating mail integration for admin:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating mail integration for admin: ${err.message}`,
    });
  }
};

const updateCompanyInstanceUrl = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { instance_url } = req.body;

    let tokens;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.DYNAMICS:
        tokens = DB_TABLES.DYNAMICS_TOKENS;
        break;
      default:
        t.rollback();
        return badRequestResponseWithDevMsg({
          res,
          msg: `Instance URL update is not supported for ${req.user.integration_type}`,
        });
    }

    const [encrypted_instance_url, __] = CryptoHelper.encrypt(instance_url);

    let promiseList = await Promise.all([
      Repository.fetchOne({
        tableName: tokens,
        query: { encrypted_instance_url },
        extras: {
          attributes: ['user_id'],
        },
      }),
      Repository.fetchAll({
        tableName: DB_TABLES.USER,
        query: { company_id: req.user.company_id },
        extras: {
          attributes: ['user_id'],
        },
      }),
    ]);

    const [tokensForUser, errForTokens] = promiseList[0];
    if (errForTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update instance url',
        error: `Error while fetching tokens: ${errForTokens}`,
      });
    }
    if (tokensForUser) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Instance url already exists',
      });
    }

    const [user, errForUser] = promiseList[1];
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update instance url',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const userIds = user.map((user) => user.user_id);

    const [updatedUserToken, errForUserToken] = await Repository.update({
      tableName: tokens,
      query: {
        user_id: { [Op.in]: userIds },
      },
      updateObject: { encrypted_instance_url, is_logged_out: 1 },
      t,
    });
    if (errForUserToken) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update instance url',
        error: `Error while updating instance url: ${errForUserToken}`,
      });
    }

    t.commit();
    return successResponse(res, 'Instance url updated successfully');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating company instance url: ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company instance url: ${err.message}`,
    });
  }
};

// * Update the mail scope of the company
const updateCompanyMailScope = async (req, res) => {
  try {
    let body = mailScopeSchemaSchema.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    body = body.value;

    if (body.email_scope_level === req.user.email_scope_level)
      return successResponse(
        res,
        `Scope level is already ${body.email_scope_level}`
      );

    //  * Logging out all users from their respective mail_integrations
    let [_, errSigningOutUsers] = await EmailUpdateHelper.signOutUsersMail({
      integration_type: req.user.mail_integration_type,
      company_id: req.user.company_id,
    });
    if (errSigningOutUsers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company email scope level',
        error: errSigningOutUsers,
      });

    const [update, updateErr] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: {
        company_id: req.user.company_id,
      },
      updateObject: {
        email_scope_level: body.email_scope_level,
      },
    });
    if (updateErr)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company email scope level',
        error: updateErr,
      });
    return successResponse(res, `Mail scope changed to upgraded successfully`);
  } catch (err) {
    logger.error('Error while updating email scope level:', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

const CompanySettingsControllers = {
  getCompanySettingsForAdmin,
  updateCompanySettingsForAdmin,
  getAdminsAndSuperAdmins,
  getPhoneSystemForAdmin,
  updatePhoneSystemForAdmin,
  getCrmAdmin,
  updateUserToExtractTokensFrom,
  updateCompanyMailIntegrationType,
  updateCompanyInstanceUrl,
  updateCompanyMailScope,
};

module.exports = CompanySettingsControllers;
