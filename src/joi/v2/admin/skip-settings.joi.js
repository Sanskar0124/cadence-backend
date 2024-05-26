// Utils
const {
  SETTING_LEVELS,
  NODE_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const skipSettingSchema = Joi.object({
  skip_settings_id: Joi.number(),
  skip_allowed_tasks: Joi.object({
    [NODE_TYPES.CALL]: Joi.boolean(),
    [NODE_TYPES.MESSAGE]: Joi.boolean(),
    [NODE_TYPES.AUTOMATED_MESSAGE]: Joi.boolean(),
    [NODE_TYPES.AUTOMATED_MAIL]: Joi.boolean(),
    [NODE_TYPES.MAIL]: Joi.boolean(),
    [NODE_TYPES.REPLY_TO]: Joi.boolean(),
    [NODE_TYPES.AUTOMATED_REPLY_TO]: Joi.boolean(),
    [NODE_TYPES.DATA_CHECK]: Joi.boolean(),
    [NODE_TYPES.CADENCE_CUSTOM]: Joi.boolean(),
    [NODE_TYPES.LINKEDIN_MESSAGE]: Joi.boolean(),
    [NODE_TYPES.LINKEDIN_PROFILE]: Joi.boolean(),
    [NODE_TYPES.LINKEDIN_INTERACT]: Joi.boolean(),
    [NODE_TYPES.LINKEDIN_CONNECTION]: Joi.boolean(),
    [NODE_TYPES.WHATSAPP]: Joi.boolean(),
  }),
  priority: Joi.number()
    .valid(...Object.values(SETTING_LEVELS))
    .required(),
  skip_reasons: Joi.array().optional(),
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

module.exports = skipSettingSchema;
