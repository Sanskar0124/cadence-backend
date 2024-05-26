// Packages
const Joi = require('joi');

const logoutSchema = Joi.object({
  user_id: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .allow(null, ''),
  sd_id: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .allow(null, ''),
});

module.exports = logoutSchema;
