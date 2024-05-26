// Utils
const {
  NODE_TYPES,
  SETTING_LEVELS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const unsubscribeMailSettingSchema = Joi.object({
  unsubscribe_settings_id: Joi.number(),
  priority: Joi.number()
    .valid(...Object.values(SETTING_LEVELS))
    .required(),
  automatic_unsubscribed_data: Joi.object({
    mail: Joi.boolean(),
    automated_mail: Joi.boolean(),
    call: Joi.boolean(),
    message: Joi.boolean(),
    automated_message: Joi.boolean(),
    linkedin_connection: Joi.boolean(),
    linkedin_message: Joi.boolean(),
    linkedin_profile: Joi.boolean(),
    linkedin_interact: Joi.boolean(),
    data_check: Joi.boolean(),
    cadence_custom: Joi.boolean(),
    reply_to: Joi.boolean(),
    automated_reply_to: Joi.boolean(),
    [NODE_TYPES.WHATSAPP]: Joi.boolean(),
    [NODE_TYPES.CALLBACK]: Joi.boolean(),
  }).allow(null),
  semi_automatic_unsubscribed_data: Joi.object({
    mail: Joi.boolean(),
    automated_mail: Joi.boolean(),
    call: Joi.boolean(),
    message: Joi.boolean(),
    automated_message: Joi.boolean(),
    linkedin_connection: Joi.boolean(),
    linkedin_message: Joi.boolean(),
    linkedin_profile: Joi.boolean(),
    linkedin_interact: Joi.boolean(),
    data_check: Joi.boolean(),
    cadence_custom: Joi.boolean(),
    reply_to: Joi.boolean(),
    automated_reply_to: Joi.boolean(),
    [NODE_TYPES.WHATSAPP]: Joi.boolean(),
    [NODE_TYPES.CALLBACK]: Joi.boolean(),
  }).allow(null),
  company_id: Joi.string().guid().required(),
  sd_id: Joi.alternatives().conditional('priority', {
    switch: [
      {
        is: SETTING_LEVELS.USER,
        then: Joi.string().guid().required().allow(),
      },
      {
        is: SETTING_LEVELS.SUB_DEPARTMENT,
        then: Joi.string().guid().required().allow(),
        otherwise: null,
      },
    ],
  }),
  user_id: Joi.alternatives().conditional('priority', {
    is: SETTING_LEVELS.USER,
    then: Joi.string()
      .guid()
      .required()
      .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'),
    otherwise: null,
  }),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

module.exports = unsubscribeMailSettingSchema;
