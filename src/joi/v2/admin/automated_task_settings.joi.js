// Utils
const {
  SETTING_LEVELS,
  DELAY_BETWEEN_EMAILS_OPTIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const automatedTaskSettingSchema = Joi.object({
  at_settings_id: Joi.number(),
  priority: Joi.number()
    .valid(...Object.values(SETTING_LEVELS))
    .required(),
  working_days: Joi.array(),
  start_hour: Joi.string(),
  end_hour: Joi.string(),
  max_emails_per_day: Joi.number(),
  max_sms_per_day: Joi.number(),
  is_wait_time_random: Joi.bool(),
  wait_time_upper_limit: Joi.number(),
  wait_time_lower_limit: Joi.number(),
  delay: Joi.number(),
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

module.exports = automatedTaskSettingSchema;
