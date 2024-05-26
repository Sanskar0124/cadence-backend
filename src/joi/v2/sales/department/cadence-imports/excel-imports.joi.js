//Packages
const Joi = require('joi');

const fieldMapSchema = Joi.object({
  first_name: Joi.string().required(),
  last_name: Joi.string().optional().allow(''),
  linkedin_url: Joi.string().optional().allow(''),
  job_position: Joi.string().optional().allow(''),
  emails: Joi.array().items(Joi.string()).required().min(0),
  phone_numbers: Joi.array().items(Joi.string()).required().min(0),
  primary_email: Joi.string().optional().allow(''),
  primary_phone: Joi.string().optional().allow(''),
  company: Joi.string().required(),
  size: Joi.string().optional().allow(''),
  url: Joi.string().optional().allow(''),
  country: Joi.string().optional().allow(''),
  zip_code: Joi.string().optional().allow(''),
  company_phone_number: Joi.string().optional().allow(''),
  owner_integration_id: Joi.string().required(),
});

const leadsPreviewSchema = Joi.object({
  cadence_id: Joi.string().required(),
  loaderId: Joi.string().optional(),
  field_map: fieldMapSchema.required(),
});

const createLeads = Joi.object({
  cadence_id: Joi.number().required(),
  leads: Joi.array().required(),
  loaderId: Joi.string().optional(),
});

const leadSchema = {
  leadsPreviewSchema,
  fieldMapSchema,
  createLeads,
};

module.exports = leadSchema;
