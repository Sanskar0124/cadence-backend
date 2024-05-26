// Packages
const Joi = require('joi');

const createEmailSchema = Joi.object({
  email_id: Joi.string().email().required(),
  lead_id: Joi.number().required(),
});

const updateEmailSchema = Joi.object({
  lem_id: Joi.number().required(),
  email_id: Joi.string().email().optional(),
  is_primary: Joi.bool().optional(),
  lead_id: Joi.number().required(),
});

const deleteEmailSchema = Joi.object({
  lem_id: Joi.number().required(),
  lead_id: Joi.number().required(),
});

const emailSchema = {
  createEmailSchema,
  updateEmailSchema,
  deleteEmailSchema,
};

module.exports = emailSchema;
