// Packages
const Joi = require('joi');

const customDomainSettingsSchema = Joi.object({
  domain_name: Joi.string().required(),
});

module.exports = customDomainSettingsSchema;
