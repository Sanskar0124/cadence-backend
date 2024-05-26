// Packages
const Joi = require('joi');

// Utils
const {
  HUBSPOT_CONTACT_IMPORT_STATUS,
  HUBSPOT_IMPORT_SOURCE,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

const fieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
  company_name: Joi.string().label('Company Name').required(),
  company_phone_number: Joi.string().label('Company Phone Number').optional(),
  company_linkedin_url: Joi.string().label('Company Linkedin URL').optional(),
  url: Joi.string().label('Company Website').optional(),
  country: Joi.string().label('Country').optional(),
  size: Joi.string().label('Size').optional(),
  zip_code: Joi.string().label('Zipcode').optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        column_name: Joi.string().label('column name').required(),
      })
    )
    .min(0)
    .required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        column_name: Joi.string().label('column name').required(),
      })
    )
    .min(0)
    .required(),
  hubspot_owner_id: Joi.string().label('Hubspot Owner ID').required(),
});

const fetchSheetsColumnsSchema = Joi.object({
  url: Joi.string().label('google sheet url').required(),
});

const importDataToCadenceSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(HUBSPOT_CONTACT_IMPORT_STATUS))
    .required(),
  selections: Joi.string().optional(),
  id: Joi.string().when('selection', {
    is: null,
    then: Joi.string().required(),
  }),
});

const importHubspotContactSchema = Joi.object({
  cadence_id: Joi.number().required(),
  contacts: Joi.array().required(),
  loaderId: Joi.string()
    .when('websocket', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .label('Loader Id'),
  stopPreviousCadences: Joi.boolean().optional(),
  websocket: Joi.boolean().default(true).optional().label('Websocket'),
});

// * Parse CSV request validation
const csvImportSchema = Joi.object({
  record_id: Joi.number().required(),
  first_name: Joi.number().required(),
  last_name: Joi.number().optional(),
  linkedin_url: Joi.number().optional(),
  owner: Joi.number().required(),
  job_position: Joi.number().optional(),
  emails: Joi.string().optional(),
  phone_numbers: Joi.string().optional(), // {"elements"  : [{type: "phone" , column_index: "1"}]}
  country: Joi.number().optional(),
  url: Joi.number().optional(),
  account_phone_number: Joi.number().optional(),
  account_linkedin_url: Joi.number().optional(),
  size: Joi.number().optional(),
  zipcode: Joi.string().optional(),
  company_name: Joi.number().required(),
  company_id: Joi.number().required(),
  integration_status: Joi.number().allow(null),
});
const contactsPreviewSchema = Joi.object({
  loaderId: Joi.string().required().label('Loader Id'),
  field_map: csvImportSchema.label('hubspot field map').required(),
});

// * Preview leads from extension
const previewHubspotDataFromExtension = Joi.object({
  type: Joi.string()
    .valid(...Object.values(HUBSPOT_IMPORT_SOURCE))
    .required()
    .label('Type'),
  id: Joi.string().required().label('Id'),
});

const leadsPreviewSchemaForCSV = Joi.object({
  field_map: fieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const leadsPreviewSchemaForSheets = Joi.object({
  url: Joi.string().uri().label('google sheet url').required(),
  cadence_id: Joi.string().label('cadence id').required(),
  field_map: fieldMapSchema.label('sheets field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const cadenceSchema = {
  fetchSheetsColumnsSchema,
  importDataToCadenceSchema,
  importHubspotContactSchema,
  csvImportSchema,
  leadsPreviewSchemaForCSV,
  leadsPreviewSchemaForSheets,
  previewHubspotDataFromExtension,
  contactsPreviewSchema,
};

module.exports = cadenceSchema;
