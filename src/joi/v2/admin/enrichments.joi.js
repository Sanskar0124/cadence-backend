// Utils
const {
  ENRICHMENT_SERVICES,
  LUSHA_KASPR_OPTIONS,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const lushaFieldsSchema = Joi.object({
  personal_field: Joi.string().allow(null, ''),
  work_field: Joi.string().allow(null, ''),
  other_field: Joi.string().allow(null, ''),
});

const kasprFieldsSchema = Joi.object({
  fields: Joi.array(),
});

const hunterFieldSchema = Joi.object({
  field: Joi.string().allow(null),
});

const dropcontactFieldSchema = Joi.object({
  fields: Joi.array(),
});

const snovFieldSchema = Joi.object({
  fields: Joi.array(),
});

const updateEnrichmentsConfigSchema = Joi.object({
  lusha_api_key: Joi.string().allow(null),
  kaspr_api_key: Joi.string().allow(null),
  hunter_api_key: Joi.string().allow(null),
  dropcontact_api_key: Joi.string().allow(null),
  snov_client_id: Joi.string().allow(null),
  snov_client_secret: Joi.string().allow(null),
  enr_id: Joi.number().required(),
  company_id: Joi.string().uuid(),
  lusha_api_limit: Joi.number(),
  kaspr_api_limit: Joi.number(),
  hunter_api_limit: Joi.number(),
  dropcontact_api_limit: Joi.number(),
  snov_api_limit: Joi.number(),
  lusha_action: Joi.string()
    .valid(...Object.values(LUSHA_KASPR_OPTIONS))
    .allow(null),
  kaspr_action: Joi.string()
    .valid(...Object.values(LUSHA_KASPR_OPTIONS))
    .allow(null),
  dropcontact_action: Joi.string()
    .valid(...Object.values(LUSHA_KASPR_OPTIONS))
    .allow(null),
  snov_action: Joi.string()
    .valid(...Object.values(LUSHA_KASPR_OPTIONS))
    .allow(null),
  is_lusha_activated: Joi.bool(),
  is_kaspr_activated: Joi.bool(),
  is_hunter_activated: Joi.bool(),
  is_dropcontact_activated: Joi.bool(),
  is_snov_activated: Joi.bool(),
  is_linkedin_activated: Joi.bool(),
  integration_type: Joi.string().valid(...Object.values(CRM_INTEGRATIONS)),
  lusha_phone: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: lushaFieldsSchema,
      }),
    },
  ]),
  lusha_email: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: lushaFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: lushaFieldsSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: lushaFieldsSchema,
      }),
    },
  ]),
  kaspr_phone: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: kasprFieldsSchema,
      }),
    },
  ]),
  kaspr_email: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: kasprFieldsSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: kasprFieldsSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: kasprFieldsSchema,
      }),
    },
  ]),
  hunter_email: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: hunterFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: hunterFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: hunterFieldSchema,
      }),
    },
  ]),
  dropcontact_email: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: dropcontactFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: dropcontactFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: dropcontactFieldSchema,
      }),
      otherwise: null,
    },
  ]),
  snov_email: Joi.alternatives().conditional('integration_type', [
    {
      is: CRM_INTEGRATIONS.SALESFORCE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.SALESFORCE_CONTACT]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.PIPEDRIVE,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.HUBSPOT,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SHEETS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.GOOGLE_SHEETS_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.EXCEL_LEAD]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.SELLSY,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.SELLSY_CONTACT]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.ZOHO,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.ZOHO_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.ZOHO_CONTACT]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.BULLHORN,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.BULLHORN_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: snovFieldSchema,
      }),
    },
    {
      is: CRM_INTEGRATIONS.DYNAMICS,
      then: Joi.object({
        [LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD]: snovFieldSchema,
        [LEAD_INTEGRATION_TYPES.DYNAMICS_CONTACT]: snovFieldSchema,
      }),
      otherwise: null,
    },
  ]),
  lusha_linkedin_enabled: Joi.boolean(),
  kaspr_linkedin_enabled: Joi.boolean(),
  hunter_linkedin_enabled: Joi.boolean(),
  dropcontact_linkedin_enabled: Joi.boolean(),
  snov_linkedin_enabled: Joi.boolean(),
  default_linkedin_export_type: Joi.string().allow(null),
}).options({
  stripUnknown: true,
});

const updateEnrichmentsAccessSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(ENRICHMENT_SERVICES))
    .required(),
  checkedUserIds: Joi.array().items(
    Joi.string().uuid().allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
  ),
  uncheckedUserIds: Joi.array().items(
    Joi.string().uuid().allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
  ),
  enabledSdIds: Joi.array().items(Joi.string().uuid()),
  disabledSdIds: Joi.array().items(Joi.string().uuid()),
});

module.exports = {
  updateEnrichmentsConfigSchema,
  updateEnrichmentsAccessSchema,
};
