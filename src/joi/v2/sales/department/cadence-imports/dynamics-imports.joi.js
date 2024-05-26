// Packages
const Joi = require('joi');

// Utils
const {
  DYNAMICS_DATA_IMPORT_TYPES,
} = require('../../../../../../../Cadence-Brain/src/utils/enums');

const importDataToCadenceSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(DYNAMICS_DATA_IMPORT_TYPES))
    .required(),
  id: Joi.string().optional(),
});
const importDynamicsContactSchema = Joi.object({
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

const importDynamicsLeadSchema = Joi.object({
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
  company: Joi.string().required().label('Company'),
  size: Joi.string().optional().allow('').label('Size'),
  url: Joi.string().optional().allow('').label('Url'),
  country: Joi.string().optional().allow('').label('Country'),
  zip_code: Joi.string().optional().allow('').label('Zip code'),
  company_phone_number: Joi.string()
    .optional()
    .allow('')
    .label('Company phone number'),
  user_name: Joi.string().required().label('User name'),
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
  account_name: Joi.string().optional().label('Account name'),
  user_name: Joi.string().required().label('User name'),
  id: Joi.string().required().label('Id'),
});

const leadsPreviewSchema = Joi.object({
  cadence_id: Joi.string().required().label('Cadence Id'),
  loaderId: Joi.string().optional().label('Loader Id'),
  field_map: fieldMapLeadSchema.label('dynamics field map').required(),
});

const contactsPreviewSchema = Joi.object({
  cadence_id: Joi.string().required().label('Cadence Id'),
  loaderId: Joi.string().optional().label('Loader Id'),
  field_map: fieldMapContactSchema.label('dynamics field map').required(),
});
const cadenceSchema = {
  importDataToCadenceSchema,
  importDynamicsContactSchema,
  importDynamicsLeadSchema,
  leadsPreviewSchema,
  contactsPreviewSchema,
};

module.exports = cadenceSchema;
