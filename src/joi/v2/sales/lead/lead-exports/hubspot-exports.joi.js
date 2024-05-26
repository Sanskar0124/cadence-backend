// Packages
const Joi = require('joi');

const exportContactSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number()).required(),
  contact_data: Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().allow('').optional(),
    job_position: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
  }).required(),
  company_data: Joi.object({
    integration_id: Joi.string().allow('').required(),
    name: Joi.string().required(),
    phone_number: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
    size: Joi.string().allow('').optional(),
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

const searchHubspotCompaniesSchema = Joi.object({
  company: Joi.object()
    .keys({
      name: Joi.string().required(),
    })
    .unknown(),
});

const exportSchema = {
  searchHubspotCompaniesSchema,
  exportContactSchema,
};

module.exports = exportSchema;
