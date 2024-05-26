// Utils
const logger = require('../../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  createdSuccessResponse,
  unauthorizedResponse,
  badRequestResponse,
  paymentRequiredResponse,
} = require('../../../../utils/response');
const { SALT_ROUNDS } = require('../../../../utils/config');
const {
  SETTING_LEVELS,
  CRM_INTEGRATIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const bcrypt = require('bcrypt');
const token = require('./token');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const CalendarSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/calendar-settings.repository');
const UserTaskRepository = require('../../../../../../Cadence-Brain/src/repository/user-tasks.repository');
const UserTokenRepository = require('../../../../../../Cadence-Brain/src/repository/user-token.repository');
const SettingsRepository = require('../../../../../../Cadence-Brain/src/repository/settings.repository');
const UnsubscribeMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/unsubscribe-mail-settings.repository');
const BouncedMailSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/bounced-mail-settings.repository');
const AutomatedTaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/automated-task-settings.repository');
const TaskSettingsRepository = require('../../../../../../Cadence-Brain/src/repository/task-settings.repository');

// Helpers
const CryptoHelper = require('../../../../../../Cadence-Brain/src/helper/crypto');
const RedisHelper = require('../../../../../../Cadence-Brain/src/helper/redis');
const UserTokensHelper = require('../../../../../../Cadence-Brain/src/helper/userTokens');
const UserHelper = require('../../../../../../Cadence-Brain/src/helper/user');

// Other
const {
  signupValidationSchema,
  loginValidationSchema,
} = require('../../../../joi/v1/user/auth');

const registerUser = async (req, res) => {
  try {
    const joiValidation = signupValidationSchema.validate(req.body);
    if (joiValidation.error) {
      if (joiValidation.error.details[0].message.includes('password'))
        return badRequestResponse(
          res,
          'Password should be atleat 8 characters, should have atleast 1 upper case, 1 lowercase and 1 special character [@, #, $, %, !, ^] '
        );

      return badRequestResponse(res, joiValidation.error.details[0].message);
    }

    let user = req.body;
    const hashedPassword = bcrypt.hashSync(user.password, SALT_ROUNDS);
    user.password = hashedPassword;
    user.smart_action_type = [];

    const [createdUser, err] = await UserRepository.createUser(user);
    if (err) return badRequestResponse(res, err);

    const [_, errForCalendarSettings] =
      await CalendarSettingsRepository.createCalendarSettings({
        user_id: createdUser.user_id,
        meeting_buffer: 30,
        working_start_hour: '09:00',
        working_end_hour: '18:00',
        break_start_time: '13:00',
        break_end_time: '14:00',
        meeting_duration: [15, 30, 45, 60],
        working_days: [1, 1, 1, 1, 1, 0, 0],
      });
    if (errForCalendarSettings)
      return serverErrorResponse(res, errForCalendarSettings);

    const [userTask, errForUserTask] = await UserTaskRepository.createUserTask({
      user_id: createdUser.user_id,
    });
    if (errForUserTask) return serverErrorResponse(res, errForUserTask);

    const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
      CryptoHelper.encrypt(req.body.ringover_api_key);

    const [userToken, errForUserToken] =
      await UserTokenRepository.createUserToken({
        user_id: createdUser.user_id,
        encrypted_ringover_api_key: encryptedRingoverApiKey,
      });
    if (errForUserToken) return serverErrorResponse(res, errForUserToken);
    let unsubscribe_company_settings,
      bounced_company_settings,
      automated_company_settings,
      task_company_settings,
      skip_company_settings,
      lead_score_company_settings,
      error;
    let user_id = createdUser.user_id;
    let company_id = createdUser.company_id;
    [unsubscribe_company_settings, error] =
      await UnsubscribeMailSettingsRepository.getUnsubscribeMailSettingByQuery({
        company_id,
        priority: SETTING_LEVELS.ADMIN,
      });
    [bounced_company_settings, error] =
      await BouncedMailSettingsRepository.getBouncedMailSettingByQuery({
        company_id,
        priority: SETTING_LEVELS.ADMIN,
      });
    [automated_company_settings, error] =
      await AutomatedTaskSettingsRepository.getAutomatedTaskSettingByQuery({
        company_id,
        priority: SETTING_LEVELS.ADMIN,
      });

    [task_company_settings, error] =
      await TaskSettingsRepository.getTaskSettingByQuery({
        company_id,
        priority: SETTING_LEVELS.ADMIN,
      });

    [skip_company_settings, error] = await Repository.fetchOne({
      tableName: DB_TABLES.SKIP_SETTINGS,
      query: {
        priority: SETTING_LEVELS.ADMIN,
        company_id,
      },
    });

    [lead_score_company_settings, error] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
      query: {
        priority: SETTING_LEVELS.ADMIN,
        company_id,
      },
    });

    let [createdSetting, errForCreatedSetting] =
      await SettingsRepository.createSettings({
        user_id,
        automated_task_setting_priority: SETTING_LEVELS.ADMIN,
        unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
        bounced_setting_priority: SETTING_LEVELS.ADMIN,
        task_setting_priority: SETTING_LEVELS.ADMIN,
        skip_setting_priority: SETTING_LEVELS.ADMIN,
        ls_setting_priority: SETTING_LEVELS.ADMIN,
        at_settings_id: automated_company_settings.at_settings_id,
        unsubscribe_settings_id:
          unsubscribe_company_settings.unsubscribe_settings_id,
        bounced_settings_id: bounced_company_settings.bounced_settings_id,
        task_settings_id: task_company_settings.task_settings_id,
        skip_settings_id: skip_company_settings.skip_settings_id,
        ls_settings_id: lead_score_company_settings?.ls_settings_id,
      });
    if (errForCreatedSetting || error)
      return serverErrorResponse(res, errForCreatedSetting);

    const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
      user_id: createdUser.user_id,
      first_name: createdUser.first_name,
      last_name: createdUser.last_name,
    });
    if (errForProfileUrl) return serverErrorResponse(res, errForProfileUrl);

    return createdSuccessResponse(
      res,
      'Created user successfully',
      createdUser
    );
  } catch (err) {
    logger.error(`Error while signing up user: `, err);
    return serverErrorResponse(res, err);
  }
};

const loginUser = async (req, res) => {
  try {
    const joiValidation = loginValidationSchema.validate(req.body);
    if (joiValidation.error)
      return badRequestResponse(res, joiValidation.error.details[0].message);

    const { email, password, language } = req.body;
    if (email === null || password === null)
      return badRequestResponse(res, 'Kindly enter your email and password.');

    let [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { email },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: [
            'is_subscription_active',
            'is_trial_active',
            'integration_type',
            'integration_id',
          ],
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['phone_system', 'mail_integration_type'],
          },
        },
      },
    });
    if (errForUser) return serverErrorResponse(res);
    if (!user)
      return badRequestResponse(
        res,
        'Kindly check your username and password.'
      );

    if (!user.password)
      return badRequestResponse(
        res,
        'Kindly check your username and password.'
      );

    if (!bcrypt.compareSync(password, user.password))
      return unauthorizedResponse(
        res,
        'Password does not match. Kindly retry.'
      );

    if (
      user?.Company?.is_subscription_active ||
      user?.Company?.is_trial_active
    ) {
      const accessToken = token.access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id,
        user.Company?.integration_type
      );

      // const [_, errForValidToken] = await UserTokensHelper.setValidAccessToken(
      //   accessToken,
      //   user.user_id
      // );
      // if (errForValidToken) return serverErrorResponse(res, errForValidToken);

      // Step: update lang if present in req body
      if (language) {
        const [updated, errForUpdate] = await Repository.update({
          tableName: DB_TABLES.USER,
          query: { user_id: user?.user_id },
          updateObject: { language },
        });
        if (updated?.[0]) user.language = language;
      }

      let tokens;
      switch (user.Company?.integration_type) {
        case CRM_INTEGRATIONS.SALESFORCE:
          tokens = DB_TABLES.SALESFORCE_TOKENS;
          break;
        case CRM_INTEGRATIONS.PIPEDRIVE:
          tokens = DB_TABLES.PIPEDRIVE_TOKENS;
        case CRM_INTEGRATIONS.SELLSY:
          tokens = DB_TABLES.SELLSY_TOKENS;
          break;
      }

      const [instanceUrl, errForInstanceUrl] = await Repository.fetchOne({
        tableName: tokens,
        query: { user_id: user.user_id },
      });

      return successResponse(res, 'Successfully logged in.', {
        accessToken,
        user_id: user.user_id,
        sd_id: user.sd_id,
        company_id: user.company_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email: user.email,
        primary_email: user.primary_email,
        linkedin_url: user.linkedin_url,
        primary_phone_number: user.primary_phone_number,
        timezone: user.timezone,
        profile_picture: user.profile_picture,
        is_call_iframe_fixed: user.is_call_iframe_fixed,
        language: user.language,
        integration_type: user.Company.integration_type,
        company_integration_id: user.Company.integration_id,
        instance_url: instanceUrl?.instance_url ?? '',
        phone_system: user.Company.Company_Setting.phone_system,
        mail_integration_type:
          user.Company.Company_Setting.mail_integration_type,
      });
    }

    if (!user?.Company?.is_subscription_active)
      return paymentRequiredResponse(res);
    else if (!user?.Company?.is_trial_active)
      return paymentRequiredResponse(res, 'Your trial period has ended.');
  } catch (err) {
    logger.error(`Error while logging in user: `, err);
    serverErrorResponse(res);
  }
};

module.exports = {
  registerUser,
  loginUser,
};
