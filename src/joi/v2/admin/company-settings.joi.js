// Utils
const {
  SETTING_LEVELS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

// Schemas
const automatedTaskSettingSchema = require('./automated_task_settings.joi');
const bouncedMailSettingSchema = require('./bounced-mail-settings.joi');
const unsubscribeMailSettingSchema = require('./unsubscribe-mail-settings.joi');
const createAndUpdateTaskSettingsSchema = require('./task-settings.joi');
const createAndUpdateSkipSettingsSchema = require('./skip-settings.joi');
const leadScoreSettingsSchema = require('./lead_score_settings.joi');
//const phoneSystemSettingsSchema = require('./phone-system-settings.joi');

const companySettingsSchema = Joi.object({
  Automated_Task_Settings: automatedTaskSettingSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  Bounced_Mail_Settings: bouncedMailSettingSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  Unsubscribe_Mail_Settings: unsubscribeMailSettingSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  Task_Settings: createAndUpdateTaskSettingsSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  Skip_Settings: createAndUpdateSkipSettingsSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  Lead_Score_Settings: leadScoreSettingsSchema.keys({
    priority: Joi.number().equal(SETTING_LEVELS.ADMIN).required(),
  }),
  //Phone_System_Settings: phoneSystemSettingsSchema,
});

module.exports = companySettingsSchema;
