// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const { SERVER_URL, DEV_AUTH, FRONTEND_URL } = require('../../../utils/config');
const {
  USER_ROLE,
  SETTING_LEVELS,
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTIONS,
  NODE_TYPES,
  CRM_INTEGRATIONS,
  USER_INTEGRATION_TYPES,
  PIPEDRIVE_ACTIVITY_TYPES,
  LEAD_INTEGRATION_TYPES,
  WORKFLOW_DEFAULT_NAMES,
  WEBHOOK_ACTIVITY_TYPES,
  HIRING_INTEGRATIONS,
  SELLSY_ACTIVITY_TYPE,
  COMPANY_HISTORY_CHANGE_VALUES,
  MAIL_SCOPE_LEVEL,
  USER_LANGUAGES,
  INTEGRATIONS_TYPE,
  PHONE_SYSTEM_TYPE,
  ONBOARDING_MAIL_STATUS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Helper
const Webhook = require('../../../../../Cadence-Brain/src/helper/webhook');

// DB
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Services and Helpers
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const SyncHelper = require('../../../../../Cadence-Brain/src/helper/sync');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const PipedriveService = require('../../../../../Cadence-Brain/src/services/Pipedrive');
const UserHelper = require('../../../../../Cadence-Brain/src/helper/user');
const CompanyHelper = require('../../../../../Cadence-Brain/src/helper/company');
const SocketHelper = require('../../../../../Cadence-Brain/src/helper/socket');
const CadenceHelper = require('../../../../../Cadence-Brain/src/helper/cadence');
const AmazonService = require('../../../../../Cadence-Brain/src/services/Amazon');
const HtmlHelper = require('../../../../../Cadence-Brain/src/helper/html');
const OnboardingHelper = require('../../../../../Cadence-Brain/src/helper/onboarding');
const TemplateHelper = require('../../../../../Cadence-Brain/src/helper/template');

// Joi
const companySchema = require('../../../joi/v2/admin/company/company.joi');

// Other
const GoogleSheets = require('../../../../../Cadence-Brain/src/services/Google/Google-Sheets');
const Excel = require('../../../../../Cadence-Brain/src/services/Excel');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');

const createCompanyAndAdmin = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = companySchema.createCompanyAndAdminSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      logger.error(
        `Unable to create company and super admin: ${params.error.message}`
      );
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const [createdCompany, errForCompany] = await Repository.create({
      tableName: DB_TABLES.COMPANY,
      createObject: {
        //company_id: req.body.company_id,
        name: req.body.company_name,
        number_of_licences: req.body.number_of_licences,
        is_subscription_active: req.body.is_subscription_active,
        is_trial_active: req.body.is_trial_active,
        integration: req.body.integration,
        integration_type: req.body.integration_type,
        ringover_team_id: req.body.ringover_team_id,
        trial_valid_until: req.body.trial_valid_until,
      },
      t,
    });
    if (errForCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company: ${errForCompany}`,
        msg: 'Failed to create company',
      });
    }

    // create a trigger for 'when a owner changes' with action of 'stop cadence'
    const [createdWorkflow, errForCreatedWorkflow] = await Repository.create({
      tableName: DB_TABLES.WORKFLOW,
      createObject: {
        name: WORKFLOW_DEFAULT_NAMES[WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES],
        trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
        actions: {
          [WORKFLOW_ACTIONS.STOP_CADENCE]: '',
        },
        company_id: createdCompany.company_id,
      },
      t,
    });
    if (errForCreatedWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating workflow: ${errForCreatedWorkflow}`,
        msg: 'Failed to create company',
      });
    }

    const [createdCompanySettings, errCompanySettings] =
      await Repository.create({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          mail_integration_type: req.body.mail_integration_type,
          email_scope_level: MAIL_SCOPE_LEVEL.ADVANCE,
          phone_system: req.body.phone_system,
          activity_to_log: {
            CALENDAR: {
              enabled: true,
            },
            CALL: {
              enabled: true,
            },
            MAIL: {
              enabled: true,
            },
            NOTE: {
              enabled: true,
            },
            SMS: {
              enabled: true,
            },
          },
        },
        t,
      });
    if (errCompanySettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company settings: ${errCompanySettings}`,
        msg: 'Failed to create company',
      });
    }

    let fieldMapTable = '';
    let extensionFieldMapTable = '';
    let userIntegration = '';
    let tokenToCreate = '';
    let lushaObj = null;
    let kasprObj = null;
    let hunterObj = null;
    let dropcontactObj = null;
    let snovObj = null;
    let defaultLinkedinExportType = null;

    switch (req.body.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        fieldMapTable = DB_TABLES.SALESFORCE_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_SALESFORCE;
        userIntegration = USER_INTEGRATION_TYPES.SALESFORCE_OWNER;
        tokenToCreate = DB_TABLES.SALESFORCE_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: {
            fields: [],
          },
        };
        defaultLinkedinExportType = LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD;
        break;

      case CRM_INTEGRATIONS.PIPEDRIVE:
        fieldMapTable = DB_TABLES.PIPEDRIVE_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_PIPEDRIVE;
        userIntegration = USER_INTEGRATION_TYPES.PIPEDRIVE_USER;
        tokenToCreate = DB_TABLES.PIPEDRIVE_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: {
            fields: [],
          },
        };
        defaultLinkedinExportType = LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON;
        break;

      case CRM_INTEGRATIONS.HUBSPOT:
        fieldMapTable = DB_TABLES.HUBSPOT_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_HUBSPOT;
        userIntegration = USER_INTEGRATION_TYPES.HUBSPOT_OWNER;
        tokenToCreate = DB_TABLES.HUBSPOT_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: {
            fields: [],
          },
        };
        break;

      case CRM_INTEGRATIONS.SHEETS:
        fieldMapTable = DB_TABLES.GOOGLE_SHEETS_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_GOOGLESHEETS;
        userIntegration = USER_INTEGRATION_TYPES.SHEETS_USER;
        tokenToCreate = null;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
            fields: [],
          },
        };
        break;

      case CRM_INTEGRATIONS.ZOHO:
        fieldMapTable = DB_TABLES.ZOHO_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_ZOHO;
        userIntegration = USER_INTEGRATION_TYPES.ZOHO_USER;
        tokenToCreate = DB_TABLES.ZOHO_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        break;

      case CRM_INTEGRATIONS.SELLSY:
        fieldMapTable = DB_TABLES.SELLSY_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_SELLSY;
        userIntegration = USER_INTEGRATION_TYPES.SELLSY_OWNER;
        tokenToCreate = DB_TABLES.SELLSY_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: {
            fields: [],
          },
        };
        break;

      case HIRING_INTEGRATIONS.BULLHORN:
        fieldMapTable = DB_TABLES.BULLHORN_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_BULLHORN;
        userIntegration = USER_INTEGRATION_TYPES.BULLHORN_USER;
        tokenToCreate = DB_TABLES.BULLHORN_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: {
            fields: [],
          },
        };
        defaultLinkedinExportType = LEAD_INTEGRATION_TYPES.BULLHORN_LEAD;
        break;

      case CRM_INTEGRATIONS.DYNAMICS:
        fieldMapTable = DB_TABLES.DYNAMICS_FIELD_MAP;
        extensionFieldMapTable = DB_TABLES.EFM_DYNAMICS;
        userIntegration = USER_INTEGRATION_TYPES.DYNAMICS_OWNER;
        tokenToCreate = DB_TABLES.DYNAMICS_TOKENS;
        lushaObj = {
          [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
          [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: {
            personal_field: null,
            work_field: null,
            other_field: null,
          },
        };
        kasprObj = {
          [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: {
            fields: [],
          },
        };
        hunterObj = {
          [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: {
            field: null,
          },
          [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: {
            field: null,
          },
        };
        dropcontactObj = {
          [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: {
            fields: [],
          },
        };
        snovObj = {
          [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: {
            fields: [],
          },
          [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: {
            fields: [],
          },
        };
        break;

      default:
        t.rollback();
        logger.error(
          `Company integration type: ${req.body.integration_type} is not a valid integration type`
        );
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: 'Company does not have a valid integration type',
        });
    }

    let createEnrichmentsObj = {
      company_id: createdCompany.company_id,
      lusha_phone: lushaObj,
      lusha_email: lushaObj,
      kaspr_phone: kasprObj,
      kaspr_email: kasprObj,
      hunter_email: hunterObj,
      dropcontact_email: dropcontactObj,
      snov_email: snovObj,
      default_linkedin_export_type: defaultLinkedinExportType,
    };

    const [createdCompanyEnrichments, errCompanyEnrichments] =
      await Repository.create({
        tableName: DB_TABLES.ENRICHMENTS,
        createObject: createEnrichmentsObj,
        t,
      });
    if (errCompanyEnrichments) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating Enrichments: ${errCompanyEnrichments}`,
        msg: 'Failed to create company',
      });
    }

    let fieldMapCreateObj = {};
    let extensionFieldMapCreateObj = {};
    if (req.body.integration_type === CRM_INTEGRATIONS.SHEETS)
      fieldMapCreateObj = await GoogleSheets.getFieldMapTemplate();
    extensionFieldMapCreateObj = fieldMapCreateObj;
    fieldMapCreateObj.company_settings_id =
      createdCompanySettings.company_settings_id;
    extensionFieldMapCreateObj.company_settings_id =
      createdCompanySettings.company_settings_id;

    if (fieldMapTable) {
      const [createdFieldMap, errForFieldMap] = await Repository.create({
        tableName: fieldMapTable,
        createObject: fieldMapCreateObj,
        t,
      });
      if (errForFieldMap) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while creating fieldmap ${errForFieldMap}`,
          msg: 'Failed to create company',
        });
      }
    }

    if (extensionFieldMapTable) {
      const [createdExtensionFieldMap, errForExtensionFieldMap] =
        await Repository.create({
          tableName: extensionFieldMapTable,
          createObject: extensionFieldMapCreateObj,
          t,
        });
      if (errForExtensionFieldMap) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while creating extension field map: ${errForExtensionFieldMap}`,
          msg: 'Failed to create company',
        });
      }
    }

    const [createdEmailSettings, errForEmailSettings] = await Repository.create(
      {
        tableName: DB_TABLES.EMAIL_SETTINGS,
        createObject: { company_id: createdCompany.company_id },
        t,
      }
    );
    if (errForEmailSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating email settings: ${errForEmailSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdUnsubscribeSettings, errForUnsubscribeSettings] =
      await Repository.create({
        tableName: DB_TABLES.UNSUBSCRIBE_MAIL_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          semi_automatic_unsubscribed_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
          automatic_unsubscribed_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
        },
        t,
      });
    if (errForUnsubscribeSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating unsubscribe mail settings: ${errForUnsubscribeSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdBouncedSettings, errForBouncedSettings] =
      await Repository.create({
        tableName: DB_TABLES.BOUNCED_MAIL_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          semi_automatic_bounced_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
          automatic_bounced_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
        },
        t,
      });
    if (errForBouncedSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating bounced mail settings: ${errForBouncedSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdAutomatedTaskSettings, errForAutomatedTaskSettings] =
      await Repository.create({
        tableName: DB_TABLES.AUTOMATED_TASK_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          working_days: [1, 1, 1, 1, 1, 0, 0],
        },
        t,
      });
    if (errForAutomatedTaskSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating automated task settings: ${errForAutomatedTaskSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdeSkipSettings, errForSkipSettings] = await Repository.create({
      tableName: DB_TABLES.SKIP_SETTINGS,
      createObject: {
        company_id: createdCompany.company_id,
        priority: 3,
        skip_reasons: ['Other'],
      },
      t,
    });
    if (errForSkipSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating skip settings: ${errForSkipSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdCompanyTokens, errForCompanyTokens] = await Repository.create(
      {
        tableName: DB_TABLES.COMPANY_TOKENS,
        createObject: { company_id: createdCompany.company_id },
        t,
      }
    );
    if (errForCompanyTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company tokens: ${errForCompanyTokens}`,
        msg: 'Failed to create company',
      });
    }

    const [createdTaskSettings, errForTaskSettings] = await Repository.create({
      tableName: DB_TABLES.TASK_SETTINGS,
      createObject: {
        company_id: createdCompany.company_id,
        priority: 3,
        late_settings: {
          [NODE_TYPES.CALL]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.MESSAGE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.MAIL]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_MESSAGE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_PROFILE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_INTERACT]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_CONNECTION]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.DATA_CHECK]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.CADENCE_CUSTOM]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.WHATSAPP]: 1 * 24 * 60 * 60 * 1000,
        },
      },
      t,
    });
    if (errForTaskSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating task settings: ${errForTaskSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdLeadScoreSettings, errForLeadScoreSettings] =
      await Repository.create({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
        },
        t,
      });

    if (errForLeadScoreSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating lead Score Settings: ${errForLeadScoreSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdDepartment, errForCreateDepartment] = await Repository.create(
      {
        tableName: DB_TABLES.DEPARTMENT,
        createObject: {
          name: `${createdCompany.name} department`,
          company_id: createdCompany.company_id,
        },
        t,
      }
    );
    if (errForCreateDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error for creating department: ${errForCreateDepartment}`,
        msg: 'Failed to create company',
      });
    }

    const [createdSubDepartment, errForCreateSubDepartment] =
      await Repository.create({
        tableName: DB_TABLES.SUB_DEPARTMENT,
        createObject: {
          name: `Admin`,
          department_id: createdDepartment.department_id,
        },
        t,
      });

    if (errForCreateSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating sub department: ${errForCreateSubDepartment}`,
        msg: 'Failed to create company',
      });
    }

    const [subDepartmentSettings, errForSubDepartmentSetting] =
      await Repository.create({
        tableName: DB_TABLES.SUB_DEPARTMENT_SETTINGS,
        createObject: {
          sd_id: createdSubDepartment.sd_id,
        },
        t,
      });
    if (errForSubDepartmentSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating sub department setting: ${errForSubDepartmentSetting}`,
        msg: 'Failed to create company',
      });
    }

    // Creating admin
    let user = req.body.admin;
    user.role = USER_ROLE.SUPER_ADMIN;
    user.is_profile_picture_present = false;
    user.company_id = createdCompany.company_id;
    user.department_id = createdDepartment.department_id;
    user.sd_id = createdSubDepartment.sd_id;
    user.smart_action_type = [];
    //user.timezone = null;
    user.integration_type = userIntegration;
    if (userIntegration === USER_INTEGRATION_TYPES.SHEETS_USER)
      user.integration_id = `S${new Date().getTime()}`;
    // * To be removed in the future
    // if (req.body.integration_type === CRM_INTEGRATIONS.SALESFORCE)
    //   //TODO:REMOVE Remove this
    //   user.salesforce_owner_id = req.body.admin.integration_id;
    const [createdUser, errForUser] = await Repository.create({
      tableName: DB_TABLES.USER,
      createObject: user,
      t,
    });
    if (errForUser) {
      t.rollback();
      if (errForUser.includes('unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: `Error while creating user: ${errForUser}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user: ${errForUser}`,
        msg: 'Failed to create company',
      });
    }

    const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
      user_id: createdUser.user_id,
      first_name: createdUser.first_name,
      last_name: createdUser.last_name,
    });

    let userToken = {
      user_id: createdUser.user_id,
    };
    if (user.ringover_api_key && user.ringover_api_key !== '') {
      const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
        CryptoHelper.encrypt(user.ringover_api_key);
      userToken.encrypted_ringover_api_key = encryptedRingoverApiKey;
    }

    const [createdToken, errForToken] = await Repository.create({
      tableName: DB_TABLES.USER_TOKEN,
      createObject: userToken,
      t,
    });
    if (errForToken) {
      t.rollback();
      if (errForToken.includes('unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: `Error while creating user token: ${errForToken}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user token: ${errForToken}`,
        msg: 'Failed to create company',
      });
    }

    if (tokenToCreate) {
      const [crmToken, errForCrmToken] = await Repository.create({
        tableName: tokenToCreate,
        createObject: {
          user_id: createdUser.user_id,
          is_logged_out: 1,
        },
        t,
      });
      if (errForCrmToken) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          error: `Error while create token to create: ${errForCrmToken}`,
          msg: 'Failed to create company',
        });
      }
    }

    // update company tokens
    if (req.body.integration_type === CRM_INTEGRATIONS.DYNAMICS) {
      const [instanceUrl, ___] = CryptoHelper.encrypt(req.body.instance_url);

      const [updatedUserToken, errForUserToken] = await Repository.update({
        tableName: DB_TABLES.DYNAMICS_TOKENS,
        query: { user_id: createdUser.user_id },
        updateObject: { encrypted_instance_url: instanceUrl },
        t,
      });
      if (errForUserToken) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: `Error while updating Dynamics instance_url: ${errForUserToken}`,
        });
      }
    }

    const [createdSetting, errForCreatedSetting] = await Repository.create({
      tableName: DB_TABLES.SETTINGS,
      createObject: {
        user_id: createdUser.user_id,
        automated_task_setting_priority: SETTING_LEVELS.ADMIN,
        unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
        bounced_setting_priority: SETTING_LEVELS.ADMIN,
        task_setting_priority: SETTING_LEVELS.ADMIN,
        at_settings_id: createdAutomatedTaskSettings.at_settings_id,
        unsubscribe_settings_id:
          createdUnsubscribeSettings.unsubscribe_settings_id,
        bounced_settings_id: createdBouncedSettings.bounced_settings_id,
        task_settings_id: createdTaskSettings.task_settings_id,
        skip_settings_id: createdeSkipSettings.skip_settings_id,
        ls_settings_id: createdLeadScoreSettings.ls_settings_id,
        skip_setting_priority: SETTING_LEVELS.ADMIN,
        stats_columns: {
          totalTasks: 1,
          doneTasks: 2,
          skippedTasks: 3,
          pendingTasks: 4,
          disqualified: 5,
          converted: 6,
          calls: 0,
          semiAutomatedMails: 0,
          activeLeads: 0,
          automatedMails: 0,
          automatedSms: 0,
          semiAutomatedSms: 0,
          linkedin: 0,
          customTask: 0,
          demosBooked: 0,
          totalLeads: 0,
          whatsapp: 0,
          callback: 0,
          dataCheck: 0,
          lateTasks: 0,
          urgentTasks: 0,
        },
      },
      t,
    });
    if (errForCreatedSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating settings: ${errForCreatedSetting}`,
        msg: 'Failed to create company',
      });
    }

    // update user table with settings_id
    const [updatedUser, errForUpdatedUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      updateObject: { settings_id: createdSetting.settings_id },
      query: { user_id: createdUser.user_id },
      t,
    });
    if (errForUpdatedUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating user: ${errForUpdatedUser}`,
        msg: 'Failed to create company',
      });
    }

    const [_, errForCalendarSettings] = await Repository.create({
      tableName: DB_TABLES.CALENDAR_SETTINGS,
      createObject: {
        user_id: createdUser.user_id,
        meeting_buffer: 30,
        working_start_hour: '09:00',
        working_end_hour: '18:00',
        break_start_time: '13:00',
        break_end_time: '14:00',
        meeting_duration: [15, 30, 45, 60],
        working_days: [1, 1, 1, 1, 1, 0, 0],
      },
      t,
    });
    if (errForCalendarSettings) {
      t.rollback();
      if (errForCalendarSettings === 'user_id must be unique')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'You have already set your password',
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating calendar settings: ${errForCalendarSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [userTask, errForUserTask] = await Repository.create({
      tableName: DB_TABLES.USER_TASK,
      createObject: { user_id: createdUser.user_id },
      t,
    });
    if (errForUserTask) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user task: ${errForUserTask}`,
        msg: 'Failed to create company',
      });
    }

    // create product tour personal cadence
    const [cadenceCreated, errForCadenceCreated] =
      await CadenceHelper.createProductTourCadence({
        user_id: createdUser?.user_id,
        user_name: createdUser?.first_name || '',
        user_language: createdUser?.language || USER_LANGUAGES.ENGLISH,
        timezone: createdUser?.timezone,
        company_id: createdUser?.company_id,
        integration_type: createdCompany?.integration_type,
        t,
      });
    if (errForCadenceCreated) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to create company`,
        error: `Error while creating product tour cadences: ${errForCadenceCreated}`,
      });
    }
    // create default templates
    const [templateCreated, errForTemplateCreated] =
      await TemplateHelper.createDefaultTemplates({
        user_id: createdUser?.user_id,
        t,
      });
    if (errForTemplateCreated) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to create company`,
        error: `Error while creating default templates: ${errForTemplateCreated}`,
      });
    }

    // send invitation mail
    const [mail, errForMail] = await AmazonService.sendHtmlMails({
      subject: OnboardingHelper.getSubjectForProductTourCadence({
        language: createdUser?.language,
      }),
      body: HtmlHelper.inviteMailForSuperAdmin({
        url: `${FRONTEND_URL}/crm/welcome`,
        user_first_name: createdUser?.first_name || '',
        language: createdUser?.language,
      }),
      emailsToSend: [createdUser.email],
      tracking: true,
    });
    if (errForMail) {
      t.rollback();
      if (errForMail.includes('Sending paused for this account.'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to create company`,
          error:
            'There is an issue with sending mails. Please try again after sometime or contact support',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to create company`,
        error: `Error while sending mail: ${errForMail}`,
      });
    }

    await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: createdUser?.user_id },
      updateObject: {
        onboarding_mail_message_id: mail?.MessageId,
        onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
      },
      t,
    });

    t.commit();

    Webhook.createActivityHook({
      name: createdCompany.name,
      type: createdCompany.integration_type,
      status: WEBHOOK_ACTIVITY_TYPES.COMPANY_ADDED,
      comment: `${createdCompany.name} has successfully added`,
    });
    return successResponse(
      res,
      'Company and admin created successfully. Kindly tell the admin to check join request mail.',
      {
        createdCompany,
        createdUser: {
          user_id: createdUser.user_id,
          first_name: createdUser.first_name,
          last_name: createdUser.last_name,
          email: createdUser.email,
          created_at: createdUser.created_at,
        },
      }
    );
  } catch (err) {
    t.rollback();
    logger.error('Error while creating company and admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating company and super admin: ${err.message}`,
    });
  }
};

const getCompanyInfo = async (req, res) => {
  try {
    if (req.params.company_id == null || req.params.company_id === '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company info',
        error: 'Company id cannot be empty',
      });

    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.params.company_id },
    });
    if (errForCompany)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company info',
        error: `Error while fetching company: ${errForCompany}`,
      });
    if (!company)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch company info',
        error: 'Company does not exist',
      });

    return successResponse(res, 'Company fetched successfully.', company);
  } catch (err) {
    logger.error('Error while fetching company: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching company info: ${err.message}`,
    });
  }
};

const updateCompanyInfo = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = companySchema.updateCompanyInfoSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    if (req.params.company_id == null || req.params.company_id === '') {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: 'Company id cannot be empty',
      });
    }

    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.params.company_id },
      t,
    });
    if (errForCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while fetching company: ${errForCompany}`,
      });
    }
    if (!company) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: 'Company does not exist',
      });
    }

    const [updatedCompany, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.params.company_id },
      updateObject: req.body,
      t,
    });
    if (errForUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while updating company: ${errForUpdate}`,
      });
    }

    t.commit();
    return successResponse(res, 'Company updated successfully.');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating company and admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company info: ${err.message}`,
    });
  }
};

const syncSalesforceEmailAndPhone = async (req, res) => {
  try {
    const params = companySchema.syncSalesforceEmailAndPhoneSchema.validate(
      req.body
    );
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        [
          'Kindly sign in with your crm.',
          'Kindly log in with salesforce.',
          'Error while getting access token and refresh token from salesforce auth',
        ].includes(errForAccessToken)
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Kindly log in to salesforce to sync salesforce email and phone',
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to sync salesforce email and phone',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    successResponse(res, 'Syncing started');

    const [[leads, errForLeads], [companySettings, errForCompanySettings]] =
      await Promise.all([
        Repository.fetchAll(
          { tableName: DB_TABLES.LEAD },
          {
            company_id: req.body.company_id,
          }
        ),
        Repository.fetchOne(
          { tableName: DB_TABLES.COMPANY_SETTINGS },
          {
            company_id: req.body.company_id,
          }
        ),
      ]);
    if (errForLeads) {
      logger.error('Error while fetching leads: ', errForLeads);
      return;
    }
    if (errForCompanySettings) {
      logger.error(
        'Error while fetching company settings: ',
        errForCompanySettings
      );
      return;
    }

    const [salesforceFieldMap, errForSalesforceFieldMap] =
      await Repository.fetchOne(
        { tableName: DB_TABLES.SALESFORCE_FIELD_MAP },
        {
          company_settings_id: companySettings.company_settings_id,
        }
      );
    if (errForSalesforceFieldMap) {
      logger.error(
        'Error while fetching salesforce field map: ',
        errForSalesforceFieldMap
      );
      return;
    }

    for (let i = 0; i < leads.length; i++) {
      if (!leads[i].salesforce_lead_id && !leads[i].salesforce_contact_id)
        continue;

      let salesforceData, errForSalesforceData, fieldMapToUse;

      if (leads[i].salesforce_lead_id) {
        [salesforceData, errForSalesforceData] =
          await SalesforceService.getLeadFromSalesforce(
            leads[i].salesforce_lead_id,
            access_token,
            instance_url
          );
        if (errForSalesforceData) {
          logger.error(
            `Error while fetching salesforce lead ${leads[i].lead_id}: `,
            errForSalesforceData
          );
          continue;
        }

        fieldMapToUse = salesforceFieldMap.lead_map;
      } else {
        [salesforceData, errForSalesforceData] =
          await SalesforceService.getContactById(
            leads[i].salesforce_contact_id,
            access_token,
            instance_url
          );
        if (errForSalesforceData) {
          logger.error(
            `Error while fetching salesforce contact ${leads[i].salesforce_contact_id}: `,
            errForSalesforceData
          );
          continue;
        }

        fieldMapToUse = salesforceFieldMap.contact_map;
      }

      SyncHelper.syncSalesforceData(
        fieldMapToUse,
        { ...salesforceData, lead_id: leads[i].lead_id },
        req.body.sync
      );
    }
  } catch (err) {
    logger.error('Error while creating company and admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while syncing salesforce email and phone: ${err.message}`,
    });
  }
};

const updateActivityToLog = async (req, res) => {
  let t = await sequelize.transaction();
  try {
    const params = companySchema.updateActivityToLog.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      extras: { attributes: ['company_id', 'integration_type'] },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update activity to log.',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    if (
      params.value.SMS.enabled &&
      user.integration_type === USER_INTEGRATION_TYPES.PIPEDRIVE_USER
    ) {
      let [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          user_id: req.user.user_id,
        });
      if (errForAccessToken)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Kindly log in with pipedrive',
        });

      const [data, err] = await PipedriveService.addActivityType({
        access_token,
        instance_url,
        name: PIPEDRIVE_ACTIVITY_TYPES.MESSAGE,
        icon_key: 'signpost',
      });
      if (err)
        if (err?.includes('403'))
          return unauthorizedResponseWithDevMsg({
            res,
            msg: `Please ensure you have global access in Pipedrive to enable this setting`,
          });
        else
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update activity to log',
            error: `Error while creating message activity type: ${err}`,
          });
    }

    if (user.integration_type === USER_INTEGRATION_TYPES.SELLSY_OWNER) {
      let addActivity, errForActivity;
      let customActivity = {};

      const [{ access_token }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SELLSY,
          user_id: req.user.user_id,
        });
      if (errForAccessToken) {
        t.rollback();
        if (errForAccessToken === 'Kindly log in with sellsy.')
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Please connect with sellsy',
          });

        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update activity to log.',
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }

      if (params.value.MAIL.enabled) {
        [addActivity, errForActivity] =
          await v2GrpcClients.crmIntegration.createActivityType({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              access_token,
              name: SELLSY_ACTIVITY_TYPE.EMAIL,
            },
          });
        if (errForActivity) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update activity to log.',
            error: `Error while creating activity type: ${errForActivity}`,
          });
        }
        customActivity.email = addActivity;
      }

      if (params.value.SMS.enabled) {
        [addActivity, errForActivity] =
          await v2GrpcClients.crmIntegration.createActivityType({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: {
              access_token,
              name: SELLSY_ACTIVITY_TYPE.SMS,
            },
          });
        if (errForActivity) {
          t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update activity to log.',
            error: `Error while creating activity type: ${errForActivity}`,
          });
        }
        customActivity.sms = addActivity;
      }

      const [updatedCompanySettings, errForUpdate] = await Repository.update({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        updateObject: { custom_activity_type: customActivity },
        query: { company_id: user.company_id },
        t,
      });
      if (errForUpdate) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update activity to log.',
          error: `Error while updating activity type: ${errForUpdate}`,
        });
      }
    }

    const [updatedCompanySettings, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      updateObject: { activity_to_log: params.value },
      query: { company_id: user.company_id },
      t,
    });
    if (errForUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating activity to log: ${errForUpdate}`,
      });
    }

    t.commit();
    return successResponse(
      res,
      `Updated ${req.user.integration_type} log activities.`
    );
  } catch (err) {
    t.rollback();
    logger.error(
      `Error while updating ${req.user.integration_type} activities to log: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating ${req.user.integration_type} activities to log: ${err.message}`,
    });
  }
};

const fetchActivityToLogInSalesforce = async (req, res) => {
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      include: {
        [DB_TABLES.COMPANY]: {
          [DB_TABLES.COMPANY_SETTINGS]: {
            attributes: ['activity_to_log'],
          },
        },
      },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch activities to log',
        error: `Error while fetching user: ${errForUser}`,
      });

    return successResponse(res, 'Fetched salesforce log activities.', {
      activity_to_log: user?.Company?.Company_Setting?.activity_to_log,
    });
  } catch (err) {
    logger.error('Error while fetching salesforce activities to log: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching activities to log: ${err.message}`,
    });
  }
};

const updateIntegrationFromSupport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = companySchema.updateIntegrationSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const [company, errForCompany] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: params.value?.company_id },
      include: {
        [DB_TABLES.USER]: {
          where: { user_id: params.value?.user_id },
          attributes: ['user_id', 'email', 'ringover_user_id', 'timezone'],
        },
      },
      extras: {
        attributes: [
          'company_id',
          'number_of_licences',
          'is_subscription_active',
          'is_trial_active',
          'trial_valid_until',
          'ringover_team_id',
        ],
      },
      t,
    });
    if (errForCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while fetching company: ${errForCompany}`,
      });
    }
    if (!company) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: 'Company does not exist',
      });
    }

    let user = {};
    let isRingoverUserIdChanged = false;

    if (params?.value?.email && params.value.email !== company?.User?.email) {
      user.email = params.value.email;
      delete params.value.email;
    }

    if (params?.value?.ringover_user_id !== company?.User?.ringover_user_id) {
      user.ringover_user_id = params.value.ringover_user_id;
      isRingoverUserIdChanged = true;
      delete params.value.ringover_user_id;
    }

    if (
      params?.value?.timezone &&
      params?.value?.timezone !== company?.User?.timezone
    ) {
      user.timezone = params.value.timezone;
      delete params.value.timezone;
    }

    const [_, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: params.value?.company_id },
      updateObject: params.value,
      t,
    });
    if (errForUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update company info',
        error: `Error while updating company: ${errForUpdate}`,
      });
    }

    if (Object.keys(user)?.length) {
      const [__, errForUpdateUser] = await Repository.update({
        tableName: DB_TABLES.USER,
        query: { user_id: params.value?.user_id },
        updateObject: user,
        t,
      });
      if (errForUpdateUser) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update company info',
          error: `Error while updating user: ${errForUpdateUser}`,
        });
      }

      if (isRingoverUserIdChanged) {
        await Repository.destroy({
          tableName: DB_TABLES.RINGOVER_TOKENS,
          query: { user_id: params.value?.user_id },
          t,
        });
      }
    }

    t.commit();
    return successResponse(res, 'Company updated successfully.');
  } catch (err) {
    t.rollback();
    logger.error('Error while updating company and admin: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company and admin: ${err.message}`,
    });
  }
};

/**
 *
 * changes integration for a company
 * @param {*} req
 * @param {*} res
 */
const changeIntegration = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    logger.info(`Changing CRM for company: ${req.user.company_id}...`, {
      user_id: req.user.user_id,
    });

    // Step: JOI validation
    const params = companySchema.changeIntegration.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const { integration, option } = req.body;

    // integration and req.user.integration_type should not be same i.e. current integration and integration to change to should not be the same
    if (integration === req.user.integration_type)
      return badRequestResponseWithDevMsg({
        res,
        msg: `You are already using ${integration}`,
      });

    successResponse(
      res,
      `Started proces to change integration for the company`
    );

    const [integrationChange, errForIntegrationChange] =
      await CompanyHelper.changeIntegration({
        company_id: req.user.company_id,
        currentIntegration: req.user.integration_type,
        changeToIntegration: integration,
        option,
        super_admin_user_id: req.user.user_id,
        super_admin_email: req.user.email,
        t,
      });
    if (errForIntegrationChange) {
      t.rollback();
      logger.error(`Error while changing integration: `, {
        err: errForIntegrationChange,
        user_id: req.user.user_id,
      });
      return SocketHelper.sendIntegrationChangeLogsEvent({
        email: req.user.email,
        logs: {
          error: `Error while changing integration: ${errForIntegrationChange}`,
        },
      });
    }

    // Step: commit the changes
    t.commit();

    // Step: Do all required things to be done after integration change
    // notify frontend that process is completed successfully
    SocketHelper.sendIntegrationChangeLogsEvent({
      email: req.user.email,
      logs: {
        completed: 1,
      },
    });
    // record change of integration in company history table
    Repository.create({
      tableName: DB_TABLES.COMPANY_HISTORY,
      createObject: {
        company_id: req.user.company_id,
        change_type: COMPANY_HISTORY_CHANGE_VALUES.INTEGRATION_CHANGE,
        change_option: option,
        previous_value: req.user.integration_type,
        new_value: integration,
      },
    });
    logger.info(`Changed CRM for company: ${req.user.company_id}...`, {
      user_id: req.user.user_id,
    });
  } catch (err) {
    t.rollback();
    logger.error(`Error while changing integration: `, {
      err,
      user_id: req.user.user_id,
    });
    // if response is not sent yet, send response
    if (!res.headersSent)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while changing integration: ${err.message}`,
      });
    // if response is not sent, send through socket
    SocketHelper.sendIntegrationChangeLogsEvent({
      email: req.user.email,
      logs: {
        error: `Error while changing integration: ${errForIntegrationChange}`,
      },
    });
  }
};

/**
 *
 * updates status for a company
 * @param {*} req
 * @param {*} res
 */
const updateCompanyStatus = async (req, res) => {
  try {
    // Step: JOI validation
    const params = companySchema.updateCompanyStatusSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { status } = req.body;

    const [data, err] = await Repository.update({
      tableName: DB_TABLES.COMPANY,
      query: { company_id: req.user.company_id },
      updateObject: { status },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating company status: ${err}`,
      });
    return successResponse(res, `Updated company status`);
  } catch (err) {
    logger.error(`Error while updating company status: `, {
      user_id: req.user.user_id,
      err,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company status: ${err.message}`,
    });
  }
};

const createCompanyFromRingover = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    console.log('---- RECEIVED REQUEST BODY -------');
    console.log(req.body);
    const params = companySchema.createCompanyFromRingoverSchema.validate(
      req.body
    );
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const { company_name, ringover_team_id, admin, plan_details } =
      params.value;

    // Determine the number of trial days based on subscription status and trial duration:
    // 1. If the subscription is active (`is_subscription_active` is true), then trialDays is set to 0.
    // 2. If the subscription is not active and `trial_duration` is provided and greater than 0, then trialDays is set to the value of `trial_duration`.
    // 3. If the subscription is not active and `trial_duration` is not provided or is 0 or negative, then trialDays is set to the default value of 14 days.
    let trialDays = null;
    if (!plan_details.is_subscription_active) {
      if (!plan_details.trial_duration || plan_details.trial_duration < 0)
        plan_details.trial_duration = 14;
      const today = new Date();
      trialDays = new Date(today);
      trialDays.setDate(today.getDate() + plan_details.trial_duration);
    }

    const [createdCompany, errForCompany] = await Repository.create({
      tableName: DB_TABLES.COMPANY,
      createObject: {
        name: company_name,
        number_of_licences: plan_details.number_of_licences,
        is_subscription_active: plan_details.is_subscription_active,
        integration: INTEGRATIONS_TYPE.CRM,
        integration_type: CRM_INTEGRATIONS.SHEETS,
        ringover_team_id: ringover_team_id,
        plan_id: plan_details.plan_id || null,
        plan_name: plan_details.plan_name || null,
        trial_valid_until: trialDays,
        is_trial_active: plan_details.is_subscription_active ? false : true,
      },
      t,
    });
    if (errForCompany) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company: ${errForCompany}`,
        msg: 'Failed to create company',
      });
    }

    // create a trigger for 'when a owner changes' with action of 'stop cadence'
    const [createdWorkflow, errForCreatedWorkflow] = await Repository.create({
      tableName: DB_TABLES.WORKFLOW,
      createObject: {
        name: WORKFLOW_DEFAULT_NAMES[WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES],
        trigger: WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES,
        actions: {
          [WORKFLOW_ACTIONS.STOP_CADENCE]: '',
        },
        company_id: createdCompany.company_id,
      },
      t,
    });
    if (errForCreatedWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating workflow: ${errForCreatedWorkflow}`,
        msg: 'Failed to create company',
      });
    }

    const [createdCompanySettings, errCompanySettings] =
      await Repository.create({
        tableName: DB_TABLES.COMPANY_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          mail_integration_type: null,
          email_scope_level: MAIL_SCOPE_LEVEL.ADVANCE,
          phone_system: PHONE_SYSTEM_TYPE.DEFAULT,
          activity_to_log: {
            CALENDAR: {
              enabled: true,
            },
            CALL: {
              enabled: true,
            },
            MAIL: {
              enabled: true,
            },
            NOTE: {
              enabled: true,
            },
            SMS: {
              enabled: true,
            },
          },
        },
        t,
      });
    if (errCompanySettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company settings: ${errCompanySettings}`,
        msg: 'Failed to create company',
      });
    }

    let lushaObj = {
      [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
        personal_field: null,
        work_field: null,
        other_field: null,
      },
      [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
        personal_field: null,
        work_field: null,
        other_field: null,
      },
    };
    let kasprObj = {
      [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
        fields: [],
      },
      [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
        fields: [],
      },
    };
    let hunterObj = {
      [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
        field: null,
      },
      [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
        field: null,
      },
    };
    let dropcontactObj = {
      [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
        fields: [],
      },
      [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
        fields: [],
      },
    };
    let snovObj = {
      [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: {
        fields: [],
      },
      [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: {
        fields: [],
      },
    };

    let createEnrichmentsObj = {
      company_id: createdCompany.company_id,
      lusha_phone: lushaObj,
      lusha_email: lushaObj,
      kaspr_phone: kasprObj,
      kaspr_email: kasprObj,
      hunter_email: hunterObj,
      dropcontact_email: dropcontactObj,
      snov_email: snovObj,
      default_linkedin_export_type: null,
    };

    const [createdCompanyEnrichments, errCompanyEnrichments] =
      await Repository.create({
        tableName: DB_TABLES.ENRICHMENTS,
        createObject: createEnrichmentsObj,
        t,
      });
    if (errCompanyEnrichments) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating Enrichments: ${errCompanyEnrichments}`,
        msg: 'Failed to create company',
      });
    }

    let fieldMapCreateObj = {};
    let extensionFieldMapCreateObj = {};

    fieldMapCreateObj = await GoogleSheets.getFieldMapTemplate();
    extensionFieldMapCreateObj = fieldMapCreateObj;
    fieldMapCreateObj.company_settings_id =
      createdCompanySettings.company_settings_id;
    extensionFieldMapCreateObj.company_settings_id =
      createdCompanySettings.company_settings_id;

    const [createdFieldMap, errForFieldMap] = await Repository.create({
      tableName: DB_TABLES.GOOGLE_SHEETS_FIELD_MAP,
      createObject: fieldMapCreateObj,
      t,
    });
    if (errForFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating fieldmap ${errForFieldMap}`,
        msg: 'Failed to create company',
      });
    }

    const [createdExtensionFieldMap, errForExtensionFieldMap] =
      await Repository.create({
        tableName: DB_TABLES.EFM_GOOGLESHEETS,
        createObject: extensionFieldMapCreateObj,
        t,
      });
    if (errForExtensionFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating extension field map: ${errForExtensionFieldMap}`,
        msg: 'Failed to create company',
      });
    }

    const [createdEmailSettings, errForEmailSettings] = await Repository.create(
      {
        tableName: DB_TABLES.EMAIL_SETTINGS,
        createObject: { company_id: createdCompany.company_id },
        t,
      }
    );
    if (errForEmailSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating email settings: ${errForEmailSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdUnsubscribeSettings, errForUnsubscribeSettings] =
      await Repository.create({
        tableName: DB_TABLES.UNSUBSCRIBE_MAIL_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          semi_automatic_unsubscribed_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
          automatic_unsubscribed_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
        },
        t,
      });
    if (errForUnsubscribeSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating unsubscribe mail settings: ${errForUnsubscribeSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdBouncedSettings, errForBouncedSettings] =
      await Repository.create({
        tableName: DB_TABLES.BOUNCED_MAIL_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          semi_automatic_bounced_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
          automatic_bounced_data: {
            automated_mail: true,
            mail: true,
            reply_to: true,
            automated_reply_to: true,
          },
        },
        t,
      });
    if (errForBouncedSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating bounced mail settings: ${errForBouncedSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdAutomatedTaskSettings, errForAutomatedTaskSettings] =
      await Repository.create({
        tableName: DB_TABLES.AUTOMATED_TASK_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
          working_days: [1, 1, 1, 1, 1, 0, 0],
        },
        t,
      });
    if (errForAutomatedTaskSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating automated task settings: ${errForAutomatedTaskSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdeSkipSettings, errForSkipSettings] = await Repository.create({
      tableName: DB_TABLES.SKIP_SETTINGS,
      createObject: {
        company_id: createdCompany.company_id,
        priority: 3,
      },
      t,
    });
    if (errForSkipSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating skip settings: ${errForSkipSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdCompanyTokens, errForCompanyTokens] = await Repository.create(
      {
        tableName: DB_TABLES.COMPANY_TOKENS,
        createObject: { company_id: createdCompany.company_id },
        t,
      }
    );
    if (errForCompanyTokens) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating company tokens: ${errForCompanyTokens}`,
        msg: 'Failed to create company',
      });
    }

    const [createdTaskSettings, errForTaskSettings] = await Repository.create({
      tableName: DB_TABLES.TASK_SETTINGS,
      createObject: {
        company_id: createdCompany.company_id,
        priority: 3,
        late_settings: {
          [NODE_TYPES.CALL]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.MESSAGE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.MAIL]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_MESSAGE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_PROFILE]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_INTERACT]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.LINKEDIN_CONNECTION]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.DATA_CHECK]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.CADENCE_CUSTOM]: 1 * 24 * 60 * 60 * 1000,
          [NODE_TYPES.WHATSAPP]: 1 * 24 * 60 * 60 * 1000,
        },
      },
      t,
    });
    if (errForTaskSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating task settings: ${errForTaskSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdLeadScoreSettings, errForLeadScoreSettings] =
      await Repository.create({
        tableName: DB_TABLES.LEAD_SCORE_SETTINGS,
        createObject: {
          company_id: createdCompany.company_id,
          priority: 3,
        },
        t,
      });

    if (errForLeadScoreSettings) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating lead Score Settings: ${errForLeadScoreSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [createdDepartment, errForCreateDepartment] = await Repository.create(
      {
        tableName: DB_TABLES.DEPARTMENT,
        createObject: {
          name: `${createdCompany.name} department`,
          company_id: createdCompany.company_id,
        },
        t,
      }
    );
    if (errForCreateDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error for creating department: ${errForCreateDepartment}`,
        msg: 'Failed to create company',
      });
    }

    const [createdSubDepartment, errForCreateSubDepartment] =
      await Repository.create({
        tableName: DB_TABLES.SUB_DEPARTMENT,
        createObject: {
          name: `Admin`,
          department_id: createdDepartment.department_id,
        },
        t,
      });

    if (errForCreateSubDepartment) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating sub department: ${errForCreateSubDepartment}`,
        msg: 'Failed to create company',
      });
    }

    const [subDepartmentSettings, errForSubDepartmentSetting] =
      await Repository.create({
        tableName: DB_TABLES.SUB_DEPARTMENT_SETTINGS,
        createObject: {
          sd_id: createdSubDepartment.sd_id,
        },
        t,
      });
    if (errForSubDepartmentSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating sub department setting: ${errForSubDepartmentSetting}`,
        msg: 'Failed to create company',
      });
    }

    // Creating admin
    let user = admin;
    user.role = USER_ROLE.SUPER_ADMIN;
    user.is_profile_picture_present = false;
    user.company_id = createdCompany.company_id;
    user.department_id = createdDepartment.department_id;
    user.sd_id = createdSubDepartment.sd_id;
    user.smart_action_type = [];
    user.timezone = null;
    user.integration_type = USER_INTEGRATION_TYPES.SHEETS_USER;
    user.integration_id = `S${new Date().getTime()}`;
    // * To be removed in the future
    // if (req.body.integration_type === CRM_INTEGRATIONS.SALESFORCE)
    //   //TODO:REMOVE Remove this
    //   user.salesforce_owner_id = req.body.admin.integration_id;
    const [createdUser, errForUser] = await Repository.create({
      tableName: DB_TABLES.USER,
      createObject: user,
      t,
    });
    if (errForUser) {
      t.rollback();
      if (errForUser.includes('unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: `Error while creating user: ${errForUser}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user: ${errForUser}`,
        msg: 'Failed to create company',
      });
    }

    const [profileUrl, errForProfileUrl] = await UserHelper.createAvatar({
      user_id: createdUser.user_id,
      first_name: createdUser.first_name,
      last_name: createdUser.last_name,
    });

    let userToken = {
      user_id: createdUser.user_id,
    };
    if (user.ringover_api_key && user.ringover_api_key !== '') {
      const [encryptedRingoverApiKey, errForEncryptedRingoverApiKey] =
        CryptoHelper.encrypt(user.ringover_api_key);
      userToken.encrypted_ringover_api_key = encryptedRingoverApiKey;
    }

    const [createdToken, errForToken] = await Repository.create({
      tableName: DB_TABLES.USER_TOKEN,
      createObject: userToken,
      t,
    });
    if (errForToken) {
      t.rollback();
      if (errForToken.includes('unique'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to create company',
          error: `Error while creating user token: ${errForToken}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user token: ${errForToken}`,
        msg: 'Failed to create company',
      });
    }

    const [createdSetting, errForCreatedSetting] = await Repository.create({
      tableName: DB_TABLES.SETTINGS,
      createObject: {
        user_id: createdUser.user_id,
        automated_task_setting_priority: SETTING_LEVELS.ADMIN,
        unsubscribe_setting_priority: SETTING_LEVELS.ADMIN,
        bounced_setting_priority: SETTING_LEVELS.ADMIN,
        task_setting_priority: SETTING_LEVELS.ADMIN,
        at_settings_id: createdAutomatedTaskSettings.at_settings_id,
        unsubscribe_settings_id:
          createdUnsubscribeSettings.unsubscribe_settings_id,
        bounced_settings_id: createdBouncedSettings.bounced_settings_id,
        task_settings_id: createdTaskSettings.task_settings_id,
        skip_settings_id: createdeSkipSettings.skip_settings_id,
        ls_settings_id: createdLeadScoreSettings.ls_settings_id,
        skip_setting_priority: SETTING_LEVELS.ADMIN,
        stats_columns: {
          totalTasks: 1,
          doneTasks: 2,
          skippedTasks: 3,
          pendingTasks: 4,
          disqualified: 5,
          converted: 6,
          calls: 0,
          semiAutomatedMails: 0,
          activeLeads: 0,
          automatedMails: 0,
          automatedSms: 0,
          semiAutomatedSms: 0,
          linkedin: 0,
          customTask: 0,
          demosBooked: 0,
          totalLeads: 0,
          whatsapp: 0,
          callback: 0,
          dataCheck: 0,
        },
      },
      t,
    });
    if (errForCreatedSetting) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating settings: ${errForCreatedSetting}`,
        msg: 'Failed to create company',
      });
    }

    // update user table with settings_id
    const [updatedUser, errForUpdatedUser] = await Repository.update({
      tableName: DB_TABLES.USER,
      updateObject: { settings_id: createdSetting.settings_id },
      query: { user_id: createdUser.user_id },
      t,
    });
    if (errForUpdatedUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updating user: ${errForUpdatedUser}`,
        msg: 'Failed to create company',
      });
    }

    const [_, errForCalendarSettings] = await Repository.create({
      tableName: DB_TABLES.CALENDAR_SETTINGS,
      createObject: {
        user_id: createdUser.user_id,
        meeting_buffer: 30,
        working_start_hour: '09:00',
        working_end_hour: '18:00',
        break_start_time: '13:00',
        break_end_time: '14:00',
        meeting_duration: [15, 30, 45, 60],
        working_days: [1, 1, 1, 1, 1, 0, 0],
      },
      t,
    });
    if (errForCalendarSettings) {
      t.rollback();
      if (errForCalendarSettings === 'user_id must be unique')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'You have already set your password',
        });
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating calendar settings: ${errForCalendarSettings}`,
        msg: 'Failed to create company',
      });
    }

    const [userTask, errForUserTask] = await Repository.create({
      tableName: DB_TABLES.USER_TASK,
      createObject: { user_id: createdUser.user_id },
      t,
    });
    if (errForUserTask) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while creating user task: ${errForUserTask}`,
        msg: 'Failed to create company',
      });
    }

    // create product tour personal cadence
    const [cadenceCreated, errForCadenceCreated] =
      await CadenceHelper.createProductTourCadence({
        user_id: createdUser?.user_id,
        user_name: createdUser?.first_name || '',
        user_language: createdUser?.language || USER_LANGUAGES.ENGLISH,
        timezone: createdUser?.timezone,
        company_id: createdUser?.company_id,
        integration_type: createdCompany?.integration_type,
        t,
      });
    if (errForCadenceCreated) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to create company`,
        error: `Error while creating product tour cadences: ${errForCadenceCreated}`,
      });
    }

    // send invitation mail
    const [mail, errForMail] = await AmazonService.sendHtmlMails({
      subject: OnboardingHelper.getSubjectForProductTourCadence({
        language: createdUser?.language,
      }),
      body: HtmlHelper.inviteMailForSuperAdmin({
        url: `${FRONTEND_URL}/crm/welcome`,
        user_first_name: createdUser?.first_name || '',
        language: createdUser?.language,
      }),
      emailsToSend: [createdUser.email],
      tracking: true,
    });
    if (errForMail) {
      t.rollback();
      if (errForMail.includes('Sending paused for this account.'))
        return serverErrorResponseWithDevMsg({
          res,
          msg: `Failed to create company`,
          error:
            'There is an issue with sending mails. Please try again after sometime or contact support',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to create company`,
        error: `Error while sending mail: ${errForMail}`,
      });
    }

    await Repository.update({
      tableName: DB_TABLES.USER_TOKEN,
      query: { user_id: createdUser?.user_id },
      updateObject: {
        onboarding_mail_message_id: mail?.MessageId,
        onboarding_mail_status: ONBOARDING_MAIL_STATUS.PROCESSING,
      },
      t,
    });

    t.commit();
    return successResponse(
      res,
      `Successfully created company, and onboarding email sent`,
      { company_id: createdCompany.company_id }
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating company: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating company: ${err.message}`,
    });
  }
};

const updateCompanyFromRingover = async (req, res) => {
  try {
    const params = companySchema.updateCompanyFromRingoverSchema.validate(
      req.body
    );
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { ringover_team_id, plan_details } = params.value;

    let [fetchCompanyLicense, errForFetchCompanyLicense] =
      await Repository.fetchOne({
        tableName: DB_TABLES.COMPANY,
        query: {
          ringover_team_id: ringover_team_id,
        },
        extras: {
          attributes: ['company_id', 'number_of_licences'],
        },
      });
    if (errForFetchCompanyLicense)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to update company`,
        error: `Error while fetching company: ${errForFetchCompanyLicense}`,
      });
    if (!fetchCompanyLicense)
      return notFoundResponseWithDevMsg({ res, msg: 'Company not found' });

    // Ensure that the updated license count isn't less than the total number of users in the company
    if (plan_details.number_of_licences)
      if (
        plan_details.number_of_licences < fetchCompanyLicense.number_of_licences
      ) {
        let [fetchCompanyUsersCount, errForFetchCompanyUsersCount] =
          await Repository.count({
            tableName: DB_TABLES.USER,
            query: {
              ringover_team_id: ringover_team_id,
            },
          });
        if (errForFetchCompanyUsersCount)
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Failed to update company`,
            error: `Error while updating license: ${errForFetchCompanyUsersCount}`,
          });

        if (plan_details.number_of_licences < fetchCompanyUsersCount)
          return badRequestResponseWithDevMsg({
            res,
            error: `License cannot be updated from ${fetchCompanyLicense.number_of_licences} to ${plan_details.number_of_licences} since there are ${fetchCompanyUsersCount} users in company`,
          });
      }

    // Determine the number of trial days based on subscription status and trial duration:
    // 1. If the subscription is active (`is_subscription_active` is true), then trialDays is set to 0.
    // 2. If the subscription is not active and `trial_duration` is provided and greater than 0, then trialDays is set to the value of `trial_duration`.
    // 3. If the subscription is not active and `trial_duration` is not provided or is 0 or negative, then trialDays is set to the default value of 14 days.
    let trialDays = null;
    if (plan_details.is_subscription_active === false) {
      if (!plan_details.trial_duration || plan_details.trial_duration < 0)
        plan_details.trial_duration = 14;
      plan_details.is_trial_active = true;
      const today = new Date();
      trialDays = new Date(today);
      trialDays.setDate(today.getDate() + plan_details.trial_duration);
      delete plan_details.trial_duration;
      plan_details.trial_valid_until = trialDays;
    } else if (plan_details.is_subscription_active) {
      plan_details.is_trial_active = false;
      plan_details.trial_valid_until = null;
    }

    let [updateCompanyInfo, errForUpdatingCompanyInfo] =
      await Repository.update({
        tableName: DB_TABLES.COMPANY,
        query: { ringover_team_id },
        updateObject: plan_details,
      });
    if (errForUpdatingCompanyInfo)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to update company`,
        error: `Error while updating company: ${errForUpdatingCompanyInfo}`,
      });

    return successResponse(res, `Successfully updated company`);
  } catch (err) {
    logger.error(`Error while updating company: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating company: ${err.message}`,
    });
  }
};

/**
 * updates the mail integration type for a company
 * can be used only by the super admin
 * will update the mail integration type only if he has not completed the onboarding
 * */
const updateMailIntegration = async (req, res) => {
  try {
    const { user_id, company_id, is_onboarding_complete } = req.user;
    logger.info(
      `Updating mail integration type for company: ${company_id}...`,
      {
        user_id,
      }
    );
    // Step: JOI validation
    const params = companySchema.updateMailIntegrationType.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    // Step: Destruture variable
    const { mail_integration_type } = req.body;
    // Step: Checks for conditions before updaing mail integration type
    if (is_onboarding_complete)
      return badRequestResponseWithDevMsg({
        res,
        error: `You can only update if onboarding is not completed`,
      });

    // Step: Update mail integration
    const [data, err] = await Repository.update({
      tableName: DB_TABLES.COMPANY_SETTINGS,
      query: { company_id },
      updateObject: { mail_integration_type },
    });
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while updaing mail integration type: ${err.message}`,
      });
    logger.info(`Updated mail integration type for company: ${company_id}`, {
      user_id,
    });
    return successResponse(res, `Updated mail integration type for company`);
  } catch (err) {
    logger.error(`Error while updating mail integration type: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating mail integration type: ${err.message}`,
    });
  }
};

const CompanyController = {
  createCompanyAndAdmin,
  getCompanyInfo,
  updateCompanyInfo,
  syncSalesforceEmailAndPhone,
  updateActivityToLog,
  fetchActivityToLogInSalesforce,
  updateIntegrationFromSupport,
  changeIntegration,
  updateCompanyStatus,
  createCompanyFromRingover,
  updateCompanyFromRingover,
  updateMailIntegration,
};

module.exports = CompanyController;
