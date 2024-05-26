// Packages
const Joi = require('joi');

const exportLeadSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number()).required(),
  lead_data: Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().allow('').optional(),
    job_position: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
  }).required(),
  account_data: Joi.object({
    name: Joi.string().required(),
    phone_number: Joi.string().allow('').optional(),
    size: Joi.alternatives(Joi.string(), Joi.number()).allow('').optional(),
    country: Joi.string().allow('').optional(),
    url: Joi.string().allow('').optional(),
    zipcode: Joi.alternatives(Joi.string(), Joi.number()).allow('').optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        phone_number: Joi.string().allow('').required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        email_id: Joi.string().allow('').required(),
      })
    )
    .min(1)
    .optional(),
});

const exportContactSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number()).required(),
  contact_data: Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().allow('').optional(),
    job_position: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
  }).required(),
  account_data: Joi.object({
    integration_id: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .required(),
    name: Joi.string().required(),
    phone_number: Joi.string().allow('').optional(),
    size: Joi.alternatives(Joi.string(), Joi.number()).allow('').optional(),
    country: Joi.string().allow('').optional(),
    url: Joi.string().allow('').optional(),
    zipcode: Joi.alternatives(Joi.string(), Joi.number()).allow('').optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        phone_number: Joi.string().allow('').required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        email_id: Joi.string().allow('').required(),
      })
    )
    .min(1)
    .optional(),
});

const searchZohoAccountsSchema = Joi.object({
  account: Joi.object()
    .keys({
      name: Joi.string().required(),
    })
    .unknown(),
});

const exportSchema = {
  exportLeadSchema,
  exportContactSchema,
  searchZohoAccountsSchema,
};

module.exports = exportSchema;
