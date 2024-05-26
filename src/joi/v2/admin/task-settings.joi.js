// Utils
const {
  SETTING_LEVELS,
  NODE_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const createAndUpdateTaskSettingsSchema = Joi.object({
  task_settings_id: Joi.number(),
  priority: Joi.number()
    .valid(...Object.values(SETTING_LEVELS))
    .required(),
  calls_per_day: Joi.number(),
  mails_per_day: Joi.number(),
  messages_per_day: Joi.number(),
  linkedin_connections_per_day: Joi.number(),
  linkedin_messages_per_day: Joi.number(),
  linkedin_profiles_per_day: Joi.number(),
  linkedin_interacts_per_day: Joi.number(),
  data_checks_per_day: Joi.number(),
  cadence_customs_per_day: Joi.number(),
  //reply_tos_per_day: Joi.number(),
  tasks_to_be_added_per_day: Joi.number(),
  max_tasks: Joi.number(),
  late_settings: Joi.object({
    [NODE_TYPES.CALL]: Joi.number().required(),
    [NODE_TYPES.MESSAGE]: Joi.number().required(),
    [NODE_TYPES.MAIL]: Joi.number().required(),
    [NODE_TYPES.DATA_CHECK]: Joi.number().required(),
    [NODE_TYPES.CADENCE_CUSTOM]: Joi.number().required(),
    [NODE_TYPES.LINKEDIN_MESSAGE]: Joi.number().required(),
    [NODE_TYPES.LINKEDIN_PROFILE]: Joi.number().required(),
    [NODE_TYPES.LINKEDIN_INTERACT]: Joi.number().required(),
    [NODE_TYPES.LINKEDIN_CONNECTION]: Joi.number().required(),
    [NODE_TYPES.WHATSAPP]: Joi.number().required(),
  }),
  high_priority_split: Joi.number(),
  company_id: Joi.string().guid().required(),
  sd_id: Joi.alternatives().conditional('priority', {
    switch: [
      {
        is: SETTING_LEVELS.USER,
        then: Joi.string().guid().required().allow(''),
      },
      {
        is: SETTING_LEVELS.SUB_DEPARTMENT,
        then: Joi.string().guid().required().allow(''),
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

module.exports = createAndUpdateTaskSettingsSchema;
