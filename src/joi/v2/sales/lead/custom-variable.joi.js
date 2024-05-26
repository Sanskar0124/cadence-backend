// Packages
const Joi = require('joi');

const requestBodySchema = Joi.object({
  lead_id: Joi.number().required(),
  body: Joi.string().required(),
  from_email_address: Joi.string().optional().allow(null),
});

const customVariableSchema = {
  requestBodySchema,
};

module.exports = customVariableSchema;
