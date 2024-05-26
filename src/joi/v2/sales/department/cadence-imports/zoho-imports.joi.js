// Packages
const Joi = require('joi');

const importZohoContactSchema = Joi.object({
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

const importZohoLeadSchema = Joi.object({
  cadence_id: Joi.number().required(),
  leads: Joi.array().required(),
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

const fetchSheetsColumnsSchema = Joi.object({
  url: Joi.string().label('google sheet url').required(),
});

const fieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
  company_name: Joi.string().label('Company Name').required(),
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
  zoho_owner_id: Joi.string().label('Zoho Owner ID').required(),
});

const leadsPreviewSchemaForCSV = Joi.object({
  field_map: fieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').required(),
});

const leadsPreviewSchemaForSheets = Joi.object({
  url: Joi.string().uri().label('google sheet url').required(),
  cadence_id: Joi.string().label('cadence id').required(),
  field_map: fieldMapSchema.label('sheets field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const previewZohoLeadData = Joi.object({
  leadIds: Joi.array().label('Lead Ids'),
  custom_view_id: Joi.string().label('Custom View Id'),
  loaderId: Joi.string().label('loader id').optional(),
}).xor('leadIds', 'custom_view_id');

const previewZohoContactData = Joi.object({
  contactIds: Joi.array().label('Contact Ids'),
  custom_view_id: Joi.string().label('Custom View Id'),
  loaderId: Joi.string().label('loader id').optional(),
}).xor('contactIds', 'custom_view_id');

const cadenceSchema = {
  importZohoContactSchema,
  importZohoLeadSchema,
  fetchSheetsColumnsSchema,
  leadsPreviewSchemaForCSV,
  leadsPreviewSchemaForSheets,
  previewZohoContactData,
  previewZohoLeadData,
};

module.exports = cadenceSchema;
