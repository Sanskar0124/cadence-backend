// Packages
const Joi = require('joi');

const sendConnectionRequestSchema = Joi.object({
  message: Joi.string().allow(''),
  lead_id: Joi.number().required(),
});

const sendLinkedinMessageSchema = Joi.object({
  message: Joi.string().required(),
  lead_id: Joi.number().required(),
  task_id: Joi.number().optional(),
});

const nodeSchema = {
  sendConnectionRequestSchema,
  sendLinkedinMessageSchema,
};

module.exports = nodeSchema;
