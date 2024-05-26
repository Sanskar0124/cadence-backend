// Packages
const Joi = require('joi');

const {
  BULLHORN_IMPORT_SOURCE,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

const importBullhornContactSchema = Joi.object({
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

const importBullhornLeadSchema = Joi.object({
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
const importBullhornCandidateSchema = Joi.object({
  cadence_id: Joi.number().required(),
  candidates: Joi.array().required(),
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
const fieldMapCandidateSchema = Joi.object({
  first_name: Joi.string().required().label('First name'),
  last_name: Joi.string().optional().allow('').label('Last name'),
  linkedin_url: Joi.string().optional().allow('').label('LinkedIn url'),
  job_position: Joi.string().optional().allow('').label('Job position'),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Emails'),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Phone numbers'),
  company: Joi.string().required().label('Company'),
  size: Joi.string().optional().allow('').label('Size'),
  url: Joi.string().optional().allow('').label('Url'),
  country: Joi.string().optional().allow('').label('Country'),
  zip_code: Joi.string().optional().allow('').label('Zip code'),
  integration_status: Joi.string().optional().label('Integration_status'),
  company_phone_number: Joi.string()
    .optional()
    .allow('')
    .label('Company phone number'),
  owner: Joi.string().required().label('Owner'),
  id: Joi.string().required().label('Id'),
});

const fieldMapContactSchema = Joi.object({
  first_name: Joi.string().required().label('First name'),
  last_name: Joi.string().optional().allow('').label('Last name'),
  linkedin_url: Joi.string().optional().allow('').label('LinkedIn url'),
  job_position: Joi.string().optional().allow('').label('Job position'),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Emails'),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Phone numbers'),
  account_name: Joi.string().required().label('Account name'),
  integration_status: Joi.string().optional().label('Integration_status'),
  owner: Joi.string().required().label('Owner'),
  id: Joi.string().required().label('Id'),
});
const fieldMapLeadSchema = Joi.object({
  first_name: Joi.string().required().label('First name'),
  last_name: Joi.string().optional().allow('').label('Last name'),
  linkedin_url: Joi.string().optional().allow('').label('LinkedIn url'),
  job_position: Joi.string().optional().allow('').label('Job position'),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Emails'),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        column_name: Joi.string().label('column name').required(),
      }).optional()
    )
    .min(0)
    .required()
    .label('Phone numbers'),
  account_name: Joi.string().required().label('Account name'),
  integration_status: Joi.string().optional().label('Integration_status'),
  owner: Joi.string().required().label('Owner'),
  id: Joi.string().required().label('Id'),
});

const leadsPreviewSchema = Joi.object({
  cadence_id: Joi.string().required().label('Cadence Id'),
  loaderId: Joi.string().required().label('Loader Id'),
  field_map: fieldMapLeadSchema.label('CSV map').required(),
});

const contactsPreviewSchema = Joi.object({
  cadence_id: Joi.string().required().label('Cadence Id'),
  loaderId: Joi.string().required().label('Loader Id'),
  field_map: fieldMapContactSchema.label('CSV map').required(),
});

const candidatesPreviewSchema = Joi.object({
  cadence_id: Joi.string().required().label('Cadence Id'),
  loaderId: Joi.string().required().label('Loader Id'),
  field_map: fieldMapCandidateSchema.label('CSV map').required(),
});

const previewBullhornDataFromExtension = Joi.object({
  type: Joi.string()
    .valid(...Object.values(BULLHORN_IMPORT_SOURCE))
    .required()
    .label('Type'),
  id: Joi.alternatives().conditional('query', {
    is: Joi.exist(),
    then: Joi.forbidden(),
    otherwise: Joi.string().required().label('Id'),
  }),
  query: Joi.alternatives().conditional('id', {
    is: Joi.exist(),
    then: Joi.forbidden(),
    otherwise: Joi.string().required().label('Query'),
  }),
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
  bullhorn_owner_id: Joi.string().label('Bullhorn Owner ID').required(),
});

const previewLeadsViaCSVSchema = Joi.object({
  field_map: fieldMapSchema.label('CSV map').required(),
  loaderId: Joi.string().label('Loader id').required(),
});

const previewLeadsViaSheetsSchema = Joi.object({
  url: Joi.string().uri().label('google sheet url').required(),
  cadence_id: Joi.string().label('cadence id').required(),
  field_map: fieldMapSchema.label('sheets field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const cadenceSchema = {
  importBullhornContactSchema,
  importBullhornLeadSchema,
  importBullhornCandidateSchema,
  leadsPreviewSchema,
  contactsPreviewSchema,
  candidatesPreviewSchema,
  fetchSheetsColumnsSchema,
  previewBullhornDataFromExtension,
  previewLeadsViaCSVSchema,
  previewLeadsViaSheetsSchema,
};

module.exports = cadenceSchema;
