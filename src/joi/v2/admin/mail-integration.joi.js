// Utils

const {
  MAIL_INTEGRATION_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');
// Packages
const Joi = require('joi');

const mailIntegrationSchema = Joi.object({
  mail_integration_type: Joi.string()
    .valid(...Object.values(MAIL_INTEGRATION_TYPES))
    .required(),
});

module.exports = mailIntegrationSchema;
