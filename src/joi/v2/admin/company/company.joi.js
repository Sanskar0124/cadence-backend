// Utils
const {
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTIONS,
  SALESFORCE_SYNC_OPTIONS,
  CRM_INTEGRATIONS,
  MAIL_INTEGRATION_TYPES,
  PHONE_SYSTEM_TYPE,
  HIRING_INTEGRATIONS,
  INTEGRATIONS_TYPE,
  USER_LANGUAGES,
  INTEGRATION_CHANGE_OPTIONS,
  COMPANY_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const createCompanyAndAdminSchema = Joi.object({
  company_name: Joi.string().required().label('Company Name'),
  integration: Joi.string()
    .valid(...Object.values(INTEGRATIONS_TYPE))
    .required()
    .label('Integration'),
  integration_type: Joi.alternatives()
    .try(
      Joi.string()
        .required()
        .when('integration', {
          is: 'crm',
          then: Joi.valid(...Object.values(CRM_INTEGRATIONS)),
        }),
      Joi.string()
        .required()
        .when('integration', {
          is: 'hiring',
          then: Joi.valid(...Object.values(HIRING_INTEGRATIONS)),
        })
    )
    .required(),
  mail_integration_type: Joi.string()
    .valid(...Object.values(MAIL_INTEGRATION_TYPES))
    .optional()
    .label('Mail')
    .allow(null, ''),
  number_of_licences: Joi.number().required().label('Number of Licenses'),
  is_subscription_active: Joi.bool().required().label('Subscription'),
  is_trial_active: Joi.bool()
    .disallow(Joi.ref('is_subscription_active'))
    .required()
    .label('Trial'),
  trial_valid_until: Joi.date()
    .required()
    .when('is_trial_active', {
      is: false,
      then: Joi.optional().allow(null, ''),
    })
    .label('Trial date'),
  //company_id: Joi.string().required(),
  ringover_team_id: Joi.string().optional(),
  phone_system: Joi.string()
    .valid(...Object.values(PHONE_SYSTEM_TYPE))
    .required(),
  instance_url: Joi.string().when('integration_type', {
    is: CRM_INTEGRATIONS.DYNAMICS,
    then: Joi.string().required(),
    otherwise: Joi.string().optional().allow(null, ''),
  }),
  admin: Joi.object({
    //user_id: Joi.string().required().label('User ID'),
    first_name: Joi.string().required().label('First Name'),
    last_name: Joi.string().required().label('Last Name'),
    email: Joi.string().email().required().label('Email'),
    ringover_user_id: Joi.number()
      .optional()
      .allow(null, '')
      .label('Ringover User Id'),
    ringover_api_key: Joi.string()
      .optional()
      .allow(null, '')
      .label('Ringover API Key'),
    integration_id: Joi.string().optional(),
    //password: Joi.string().optional().allow(null, '').label('Password'),
    language: Joi.string()
      .required()
      .default(USER_LANGUAGES.ENGLISH)
      .valid(...Object.values(USER_LANGUAGES))
      .label('Language'),
    timezone: Joi.string().required(),
  }),
});

const updateCompanyInfoSchema = Joi.object({
  number_of_licences: Joi.number().optional(),
  is_subscription_active: Joi.bool().optional(),
  is_trial_active: Joi.bool().optional(),
});

const updateIntegrationSchema = Joi.object({
  company_id: Joi.string().guid().required().label('Company Id'),
  user_id: Joi.string().guid().required().label('User Id'),
  number_of_licences: Joi.number()
    .optional()
    .allow(0)
    .label('Number of Licenses'),
  is_subscription_active: Joi.boolean().optional().label('Subscription'),
  is_trial_active: Joi.boolean()
    .disallow(Joi.ref('is_subscription_active'))
    .optional()
    .label('Trial'),
  trial_valid_until: Joi.date()
    .when('is_trial_active', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .label('Trial Valid Until'),
  email: Joi.string().email().optional().label('Email'),
  ringover_user_id: Joi.number()
    .optional()
    .allow(null)
    .label('Ringover User Id'),
  ringover_team_id: Joi.string()
    .optional()
    .allow(null)
    .label('Ringover Team Id'),
  timezone: Joi.string().optional().allow(null, '').label('Timezone'),
});

const syncSalesforceEmailAndPhoneSchema = Joi.object({
  sync: Joi.string()
    .valid(
      SALESFORCE_SYNC_OPTIONS.EMAIL,
      SALESFORCE_SYNC_OPTIONS.PHONE_NUMBER,
      SALESFORCE_SYNC_OPTIONS.ALL
    )
    .required(),
  company_id: Joi.string().required(),
});

const updateActivityToLog = Joi.object({
  CALL: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
  SMS: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
  MAIL: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
  LINKEDIN: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
  CALENDAR: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
  NOTE: Joi.object({
    enabled: Joi.bool().required(),
  }).required(),
});

// since google_sheets and excel is not yet removed from enums as of 07/08/2023, creating a new local enum for integration change joi
let CRM_INTEGRATIONS_FOR_INTEGRATION_CHANGE = CRM_INTEGRATIONS;
delete CRM_INTEGRATIONS_FOR_INTEGRATION_CHANGE.GOOGLE_SHEETS;
delete CRM_INTEGRATIONS_FOR_INTEGRATION_CHANGE.EXCEL;

const changeIntegration = Joi.object({
  integration: Joi.string()
    .valid(...Object.values(CRM_INTEGRATIONS_FOR_INTEGRATION_CHANGE))
    .required()
    .label('Integration'),
  option: Joi.string()
    .valid(...Object.values(INTEGRATION_CHANGE_OPTIONS))
    .required()
    .label('Option'),
});

const updateCompanyStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...Object.values(COMPANY_STATUS))
    .required()
    .label('Status'),
});

const updateMailIntegrationType = Joi.object({
  mail_integration_type: Joi.string()
    .valid(...Object.values(MAIL_INTEGRATION_TYPES))
    .required()
    .label('Mail Type'),
});

const createCompanyFromRingoverSchema = Joi.object({
  company_name: Joi.string().required().label('Company Name'),
  ringover_team_id: Joi.string().required().label('Ringover Team ID'),
  admin: Joi.object({
    first_name: Joi.string().required().label('Admin First Name'),
    last_name: Joi.string().required().label('Admin Last Name'),
    email: Joi.string().email().required().label('Admin Email'),
    ringover_user_id: Joi.number()
      .integer()
      .optional()
      .label('Ringover User ID'),
    language: Joi.string()
      .required()
      .default(USER_LANGUAGES.ENGLISH)
      .valid(...Object.values(USER_LANGUAGES))
      .label('Language'),
  }).required(),
  plan_details: Joi.object({
    plan_id: Joi.string().required().label('Plan ID'),
    plan_name: Joi.string().required().label('Plan Name'),
    number_of_licences: Joi.number()
      .integer()
      .min(1)
      .required()
      .label('Number of Licenses'),
    is_subscription_active: Joi.boolean()
      .required()
      .label('Is Subscription Active'),
    trial_duration: Joi.number().integer().optional().label('Trial Duration'),
  }).required(),
});

const updateCompanyFromRingoverSchema = Joi.object({
  ringover_team_id: Joi.string().required().label('Ringover Team ID'),
  plan_details: Joi.object({
    plan_id: Joi.string().optional().label('Plan ID'),
    plan_name: Joi.string().optional().label('Plan Name'),
    number_of_licences: Joi.number()
      .integer()
      .min(1)
      .optional()
      .label('Number of Licenses'),
    is_subscription_active: Joi.boolean()
      .optional()
      .label('Is Subscription Active'),
    trial_duration: Joi.number().integer().optional().label('Trial Duration'),
  }).optional(),
});

const companySchema = {
  createCompanyAndAdminSchema,
  updateCompanyInfoSchema,
  syncSalesforceEmailAndPhoneSchema,
  updateActivityToLog,
  changeIntegration,
  updateCompanyStatusSchema,
  updateMailIntegrationType,
  updateIntegrationSchema,
  createCompanyFromRingoverSchema,
  updateCompanyFromRingoverSchema,
};

module.exports = companySchema;
