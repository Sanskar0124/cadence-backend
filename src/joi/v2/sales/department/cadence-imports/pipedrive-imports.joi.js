// Packages
const Joi = require('joi');

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
  pipedrive_owner_id: Joi.string().label('Pipedrive Owner ID').required(),
});

const fetchSheetsColumnsSchema = Joi.object({
  url: Joi.string().label('google sheet url').required(),
});

const importDataToCadenceSchema = Joi.object({
  resource: Joi.string().required(),
  view: Joi.string().required(),
  selectedIds: Joi.string().allow('').required(),
  filter: Joi.string().optional().label('Filter'),
  excludedIds: Joi.string().allow('').optional(),
  filter_id: Joi.string().optional().label('Filter Id'),
});

const importPipedrivePersonsSchema = Joi.object({
  cadence_id: Joi.number().required(),
  persons: Joi.array().required(),
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

const leadsPreviewSchemaForCSV = Joi.object({
  field_map: fieldMapSchema.label('CSV map').required(),
  loaderId: Joi.string().label('Loader Id').required(),
});

const leadsPreviewSchemaForSheets = Joi.object({
  url: Joi.string().uri().label('Google sheet url').required(),
  cadence_id: Joi.string().label('Cadence Id').required(),
  field_map: fieldMapSchema.label('Sheets field map').required(),
  loaderId: Joi.string().label('Loader Id').required(),
});

const cadenceSchema = {
  fetchSheetsColumnsSchema,
  importDataToCadenceSchema,
  importPipedrivePersonsSchema,
  leadsPreviewSchemaForCSV,
  leadsPreviewSchemaForSheets,
};

module.exports = cadenceSchema;
