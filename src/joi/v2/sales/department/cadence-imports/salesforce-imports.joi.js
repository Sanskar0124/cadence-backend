// Packages
const Joi = require('joi');

// Utils
const {
  SALESFORCE_DATA_IMPORT_TYPES,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

const fieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  company: Joi.string().label('Company Name').required(),
  salesforce_owner_id: Joi.string().label('Salesforce Owner ID').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
  company_phone_number: Joi.string().label('Company Phone Number').optional(),
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
});

const existingLeadFieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  company: Joi.string().label('Company Name').required(),
  salesforce_owner_id: Joi.string().label('Salesforce Owner ID').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
  company_phone_number: Joi.string().label('Company Phone Number').optional(),
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
  id: Joi.string().label('Id').required(),
  status: Joi.string().label('Status').required(),
});

const existingContactFieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  salesforce_owner_id: Joi.string().label('Salesforce Owner ID').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
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
  id: Joi.string().label('Id').required(),
  account_id: Joi.string().label('Account Id').required(),
});

const fetchSheetsColumnsSchema = Joi.object({
  url: Joi.string().label('google sheet url').required(),
});

const importDataToCadenceSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(SALESFORCE_DATA_IMPORT_TYPES))
    .required(),
  selections: Joi.string().optional(),
  id: Joi.string().when('selection', {
    is: null,
    then: Joi.string().required(),
  }),
});

const importSalesforceContactSchema = Joi.object({
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

const importSalesforceLeadSchema = Joi.object({
  cadence_id: Joi.number().required(),
  leads: Joi.array().required(),
  stopPreviousCadences: Joi.boolean().optional(),
  websocket: Joi.boolean().default(true).optional().label('Websocket'),
  loaderId: Joi.string()
    .when('websocket', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .label('Loader Id'),
});

const leadsPreviewSchemaForCSV = Joi.object({
  field_map: fieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').required(),
});

const existingLeadsPreviewSchemaForCSV = Joi.object({
  field_map: existingLeadFieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').required(),
});

const existingContactsPreviewSchemaForCSV = Joi.object({
  field_map: existingContactFieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').required(),
});

const leadsPreviewSchemaForSheets = Joi.object({
  url: Joi.string().uri().label('google sheet url').required(),
  cadence_id: Joi.string().label('cadence id').required(),
  field_map: fieldMapSchema.label('sheets field map').required(),
  loaderId: Joi.string().label('loader id').required(),
});

const cadenceSchema = {
  fetchSheetsColumnsSchema,
  importDataToCadenceSchema,
  importSalesforceContactSchema,
  importSalesforceLeadSchema,
  leadsPreviewSchemaForCSV,
  existingLeadsPreviewSchemaForCSV,
  existingContactsPreviewSchemaForCSV,
  leadsPreviewSchemaForSheets,
};

module.exports = cadenceSchema;
