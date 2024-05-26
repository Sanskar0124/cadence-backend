// Utils
const {
  LEAD_TYPE,
  LEAD_STATUS,
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const createLeadsSchema = Joi.array().items(
  Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    full_name: Joi.string().required(),
    linkedin_url: Joi.string().allow(null, ''),
    job_position: Joi.string().allow(null, ''),
    type: Joi.string()
      .valid(...Object.values(LEAD_TYPE))
      .allow(null, '')
      .empty(['', null])
      .default(LEAD_TYPE.HEADER_FORM),
    status: Joi.string()
      .valid(...Object.values(LEAD_STATUS))
      .allow(null, '')
      .empty(['', null])
      .default(LEAD_STATUS.NEW_LEAD),
    phone_numbers: Joi.object(),
    emails: Joi.object(),
    integration_type: Joi.string()
      .valid(...Object.values(LEAD_INTEGRATION_TYPES))
      .required(),
    integration_id: Joi.string().required(),
    integration_status: Joi.string().allow(null),
    user_integration_id: Joi.string(),

    account_id: Joi.number(),
    account: Joi.object({
      name: Joi.string().required(),
      url: Joi.string().allow(''),
      linkedin_url: Joi.string().allow(null, ''),
      phone_number: Joi.string().allow(null, ''),
      size: Joi.string().allow(null, ''),
      zip_code: Joi.string().allow(null, ''),
      country: Joi.string().allow(null, ''),
      integration_type: Joi.string()
        .valid(...Object.values(ACCOUNT_INTEGRATION_TYPES))
        .required(),
      integration_id: Joi.string(),
      integration_status: Joi.string().allow(null),
    }).options({ stripUnknown: true }),
  }).options({
    stripUnknown: true,
  })
);

module.exports = createLeadsSchema;
