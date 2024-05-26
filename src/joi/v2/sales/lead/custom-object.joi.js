// Packages
const Joi = require('joi');

// Utils
const {
  SALESFORCE_SOBJECTS,
  ZOHO_ENDPOINTS,
  BULLHORN_ENDPOINTS,
  HUBSPOT_ENDPOINTS,
  DYNAMICS_ENDPOINTS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

const customObjectSalesforceDataSchema = Joi.object({
  lead_id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_account: Joi.object().optional(),
  salesforce_account_id: Joi.string().optional(),
});

const customObjectPipedriveDataSchema = Joi.object({
  lead_id: Joi.string().optional(),
  person_object: Joi.object().optional(),
  organization_id: Joi.string().optional(),
  organization_object: Joi.object().optional(),
});
const customObjectHubspotDataSchema = Joi.object({
  lead_id: Joi.string().optional(),
  custom_object: Joi.object().required(),
  custom_object_company: Joi.object().optional(),
  hubspot_company_id: Joi.string().optional(),
});

const fetchCustomObjectDataFromSalesforce = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(SALESFORCE_SOBJECTS)),
  id: Joi.string().required(),
  references: Joi.array()
    .items(
      Joi.object({
        reference_to: Joi.string().required(),
        key: Joi.string().required(),
        reference_field_name: Joi.object({
          label: Joi.string().required(),
          name: Joi.string().required(),
          sObject: Joi.string().required(),
        }).required(),
      })
    )
    .optional(),
  references_contact: Joi.array()
    .items(
      Joi.object({
        reference_to: Joi.string().required(),
        key: Joi.string().required(),
        reference_field_name: Joi.object({
          label: Joi.string().required(),
          name: Joi.string().required(),
          sObject: Joi.string().required(),
        }).required(),
      })
    )
    .optional(),
  references_account: Joi.array()
    .items(
      Joi.object({
        reference_to: Joi.string().required(),
        key: Joi.string().required(),
        reference_field_name: Joi.object({
          label: Joi.string().required(),
          name: Joi.string().required(),
          sObject: Joi.string().required(),
        }).required(),
      })
    )
    .optional(),
});

const searchObjectSchema = Joi.object({
  sObject: Joi.string().required(),
  search_term: Joi.string().required(),
  reference_field_name: Joi.string().required(),
});
const customObjectZohoDataSchema = Joi.object({
  lead_id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_account: Joi.object().optional(),
  zoho_account_id: Joi.string().optional(),
});
const customObjectBullhornDataSchema = Joi.object({
  lead_id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_corporation: Joi.object().optional(),
  bullhorn_corporation_id: Joi.string().optional(),
});

const customObjectSellsyDataSchema = Joi.object({
  lead_id: Joi.string().required(),
  contact_custom_object: Joi.object().required(),
  company_custom_object: Joi.object().optional(),
  sellsy_company_id: Joi.number().optional(),
});

const customObjectDynamicsDataSchema = Joi.object({
  lead_id: Joi.string().required().label('Lead Id'),
  custom_object: Joi.object().required().label('Custom Object'),
  custom_object_account: Joi.object().optional().label('Custom object account'),
  dynamics_account_id: Joi.string().optional().label('Dynamics account id'),
});

const testHubspotObject = Joi.object({
  contact_properties: Joi.string().required(),
  company_properties: Joi.string().required(),
});

const testZohoObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(ZOHO_ENDPOINTS)),
  id: Joi.string().required(),
});

const testBullhornObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(BULLHORN_ENDPOINTS)),
  id: Joi.string().required(),
  lead_fields: Joi.string().required(),
  account_fields: Joi.string().optional(),
});

const fetchSellsyObject = Joi.object({
  contact_id: Joi.string().required().label('Contact Id'),
  custom_object: Joi.array().required().label('Custom Object'),
});

const fetchDynamicsObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .label('Type'),
  id: Joi.string().required().label('Id'),
});

const customObjectSchema = {
  customObjectSalesforceDataSchema,
  customObjectPipedriveDataSchema,
  fetchCustomObjectDataFromSalesforce,
  searchObjectSchema,
  customObjectHubspotDataSchema,
  customObjectZohoDataSchema,
  customObjectBullhornDataSchema,
  customObjectSellsyDataSchema,
  customObjectDynamicsDataSchema,
  testBullhornObject,
  testHubspotObject,
  testZohoObject,
  fetchSellsyObject,
  fetchDynamicsObject,
};

module.exports = customObjectSchema;
