// Packages
const Joi = require('joi');

const exportContactSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number()).required(),
  contact_data: Joi.object({
    first_name: Joi.string().required().label('First name'),
    last_name: Joi.string().allow('').required().label('Last name'),
    job_position: Joi.string().allow('', null).optional(),
    linkedin_url: Joi.string().allow('', null).optional(),
  }).required(),
  company_data: Joi.object({
    integration_id: Joi.alternatives(Joi.string(), Joi.number()).optional(),
    name: Joi.string().required().label('Company name'),
    phone_number: Joi.string().allow('', null).optional(),
    size: Joi.string().allow('', null).optional(),
    country: Joi.string().allow('', null).optional(),
    url: Joi.string().allow('', null).optional(),
    zipcode: Joi.string().allow('', null).optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        phone_number: Joi.string().allow('', null).required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        email_id: Joi.string().allow('', null).required(),
      })
    )
    .min(1)
    .optional(),
});

const searchSellsyCompaniesSchema = Joi.object({
  company: Joi.object()
    .keys({
      name: Joi.string().required(),
    })
    .unknown(),
});

const exportSchema = {
  searchSellsyCompaniesSchema,
  exportContactSchema,
};

module.exports = exportSchema;
