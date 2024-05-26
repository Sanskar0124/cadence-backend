// * Packages
const Joi = require('joi');

// * Update Table Column schema
const updateColumnsSchema = Joi.object({
  totalTasks: Joi.number(),
  doneTasks: Joi.number(),
  pendingTasks: Joi.number(),
  skippedTasks: Joi.number(),
  calls: Joi.number(),
  automatedMails: Joi.number(),
  semiAutomatedMails: Joi.number(),
  disqualified: Joi.number(),
  converted: Joi.number(),
  automatedSms: Joi.number(),
  semiAutomatedSms: Joi.number(),
  linkedin: Joi.number(),
  customTask: Joi.number(),
  demosBooked: Joi.number(),
  averageTime: Joi.number(),
  totalLeads: Joi.number(),
  activeLeads: Joi.number(),
  whatsapp: Joi.number(),
  dataCheck: Joi.number(),
  lateTasks: Joi.number(),
  urgentTasks: Joi.number(),
});

module.exports = { updateColumnsSchema };
