// * Packages
const Joi = require('joi');

const addSupportAgentSchema = Joi.array().items(
  Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    email: Joi.string().email().required(),
    ringover_user_id: Joi.number().required(),
    company_id: Joi.string().uuid().required(),
  })
);

const userSchema = {
  addSupportAgentSchema,
};

module.exports = userSchema;
