// Utils
const {
  SETTING_LEVELS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

// Schema
const automatedTaskSettingSchema = require('../../admin/automated_task_settings.joi');
const bouncedMailSettingSchema = require('../../admin/bounced-mail-settings.joi');
const unsubscribeMailSettingSchema = require('../../admin/unsubscribe-mail-settings.joi');
const createAndUpdateTaskSettingsSchema = require('../../admin/task-settings.joi');
const skipMailSettingSchema = require('../../admin/skip-settings.joi');
const leadScoreSettingsSchema = require('../../admin/lead_score_settings.joi');

const subDepartmentSettingsSchema = Joi.object({
  Automated_Task_Settings: automatedTaskSettingSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
  Unsubscribe_Mail_Settings: unsubscribeMailSettingSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
  Bounced_Mail_Settings: bouncedMailSettingSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
  Task_Settings: createAndUpdateTaskSettingsSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
  Skip_Settings: skipMailSettingSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
  Lead_Score_Settings: leadScoreSettingsSchema.keys({
    priority: Joi.number()
      .valid(SETTING_LEVELS.ADMIN, SETTING_LEVELS.SUB_DEPARTMENT)
      .required(),
  }),
});

module.exports = subDepartmentSettingsSchema;
