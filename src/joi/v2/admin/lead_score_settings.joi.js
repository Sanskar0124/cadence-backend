// Utils
const {
  SETTING_LEVELS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const leadScoreSettingsSchema = Joi.object({
  ls_settings_id: Joi.number(),
  priority: Joi.number()
    .valid(...Object.values(SETTING_LEVELS))
    .required(),
  total_score: Joi.number().required(),
  email_clicked: Joi.number().required(),
  email_opened: Joi.number().required(),
  email_replied: Joi.number().required(),
  incoming_call_received: Joi.number().required(),
  demo_booked: Joi.number().required(),
  unsubscribe: Joi.number().required(),
  bounced_mail: Joi.number().required(),
  outgoing_call: Joi.number().required(),
  outgoing_call_duration: Joi.number().required(),
  sms_clicked: Joi.number().required(),
  status_update: Joi.object().optional().allow(null),
  total_score: Joi.number().optional().allow(null),
  score_threshold: Joi.number().required(),
  reset_period: Joi.number().required(),
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

module.exports = leadScoreSettingsSchema;
