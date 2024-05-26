// Utils
const {
  MAIL_SCOPE_LEVEL,
} = require('../../../../../Cadence-Brain/src/utils/enums');
// Packages
const Joi = require('joi');

const mailScopeSchema = Joi.object({
  email_scope_level: Joi.string()
    .valid(...Object.values(MAIL_SCOPE_LEVEL))
    .required()
    .label('Scope level'),
});

module.exports = mailScopeSchema;
