// Packages
const Joi = require('joi');

const exportLeadSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number())
    .label('lead id')
    .required(),
  lead_data: Joi.object({
    first_name: Joi.string().label('first name').required(),
    last_name: Joi.string().allow('').label('last name').optional(),
    job_position: Joi.string().allow('').label('job position').optional(),
    linkedin_url: Joi.string().allow('').label('linkedin url').optional(),
  }).required(),
  account_data: Joi.object({
    integration_id: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('integration id')
      .required(),
    name: Joi.string().label('company name').required(),
    phone_number: Joi.string()
      .allow('')
      .label('company phone number')
      .optional(),
    size: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('company size')
      .optional(),
    country: Joi.string().allow('').label('country').optional(),
    url: Joi.string().allow('').label('company url').optional(),
    zipcode: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('zipcode')
      .optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        phone_number: Joi.string().allow('').label('phone number').required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        email_id: Joi.string().allow('').label('email id').required(),
      })
    )
    .min(1)
    .optional(),
});

const exportContactSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number())
    .label('lead id')
    .required(),
  contact_data: Joi.object({
    first_name: Joi.string().label('first name').required(),
    last_name: Joi.string().allow('').label('last name').optional(),
    job_position: Joi.string().allow('').label('job position').optional(),
    linkedin_url: Joi.string().allow('').label('linkedin url').optional(),
  }).required(),
  account_data: Joi.object({
    integration_id: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('integration id')
      .required(),
    name: Joi.string().label('company name').required(),
    phone_number: Joi.string()
      .allow('')
      .label('company phone number')
      .optional(),
    size: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('company size')
      .optional(),
    country: Joi.string().allow('').label('country').optional(),
    url: Joi.string().allow('').label('company url').optional(),
    zipcode: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('zipcode')
      .optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        phone_number: Joi.string().allow('').label('phone number').required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        email_id: Joi.string().allow('').label('email id').required(),
      })
    )
    .min(1)
    .optional(),
});

const exportCandidateSchema = Joi.object().keys({
  lead_id: Joi.alternatives(Joi.string(), Joi.number())
    .label('lead id')
    .required(),
  candidate_data: Joi.object({
    first_name: Joi.string().label('first name').required(),
    last_name: Joi.string().label('last name').required(),
    job_position: Joi.string().label('job position').allow('').optional(),
    linkedin_url: Joi.string().label('linkedin url').allow('').optional(),
  }).required(),
  account_data: Joi.object({
    name: Joi.string().allow('').label('company name').optional(),
    size: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('company size')
      .optional(),
    country: Joi.string().label('country').required(),
    url: Joi.string().allow('').label('company url').optional(),
    zipcode: Joi.alternatives(Joi.string(), Joi.number())
      .allow('')
      .label('zipcode')
      .optional(),
  }).required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        phone_number: Joi.string().allow('').label('phone number').required(),
      })
    )
    .min(1)
    .optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        email_id: Joi.string().allow('').label('email id').required(),
      })
    )
    .min(1)
    .required(),
});

const searchBullhornAccountsSchema = Joi.object({
  account: Joi.object()
    .keys({
      name: Joi.string().label('company name').required(),
    })
    .unknown(),
});

const exportSchema = {
  exportLeadSchema,
  exportContactSchema,
  exportCandidateSchema,
  searchBullhornAccountsSchema,
};

module.exports = exportSchema;
