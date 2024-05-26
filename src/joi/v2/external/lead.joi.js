// Utils
const {
  LEAD_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const createLeadSchema = Joi.object({
  cadence_id: Joi.number().required(),
  integration_type: Joi.string()
    .valid(...Object.values(LEAD_INTEGRATION_TYPES))
    .required(),
  leads: Joi.array().items(
    Joi.object({
      first_name: Joi.string().required(),
      last_name: Joi.string().optional().allow(''),
      job_position: Joi.string().optional().allow(''),
      linkedin_url: Joi.string().optional().allow(''),
      emails: Joi.array()
        .items(
          Joi.object({
            type: Joi.string().required(),
            is_primary: Joi.bool().required(),
            email_id: Joi.string().email().required(),
          })
        )
        .min(0),
      phone_numbers: Joi.array()
        .items(
          Joi.object({
            type: Joi.string().required(),
            is_primary: Joi.bool().required(),
            phone_number: Joi.string().required(),
          })
        )
        .min(0),
      company: Joi.string()
        .optional()
        .when('....integration_type', {
          is: Joi.valid(
            ...[
              LEAD_INTEGRATION_TYPES.HUBSPOT_CONTACT,
              LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
            ]
          ),
          then: Joi.string().optional().allow(''),
          otherwise: Joi.string().required(),
        }),
      size: Joi.string().optional().allow(''),
      url: Joi.string().optional().allow(''),
      country: Joi.string().optional().allow(''),
      zip_code: Joi.number().optional().allow(''),
      company_phone: Joi.string().optional().allow(''),
      company_integration_id: Joi.string()
        .required()
        .when('....integration_type', {
          is: LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD,
          then: Joi.string().optional().valid(''),
          otherwise: Joi.string().required(),
        }),
      integration_id: Joi.string().optional(),
      owner_id: Joi.string().required(),
    })
  ),
});

const leadSchema = {
  createLeadSchema,
};

module.exports = leadSchema;
