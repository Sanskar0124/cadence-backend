// Packages
const Joi = require('joi');

// Utils
const {
  CUSTOM_TASK_NODE_ID,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

const skipTaskSchema = Joi.object({
  task_id: Joi.number().required(),
  skip_reason: Joi.string().optional(),
});

const createCustomTaskSchema = Joi.object({
  name: Joi.string()
    .required()
    .valid(...Object.keys(CUSTOM_TASK_NODE_ID)),
  lead_id: Joi.number().required(),
  cadence_id: Joi.number(),
  user_id: Joi.string().required(),
  duration: Joi.number().required(),
  start_time: Joi.number().required(),
  event_name: Joi.string().required(),
  send_reminder_email: Joi.number().valid(0, 1).default(0),
  reminder_time: Joi.number().optional().allow(null),
  instance_url: Joi.string().optional().allow(null),
});
const updateCustomTaskTimeSchema = Joi.object({
  start_time: Joi.string().required(),
});

const updateCustomTaskSchema = Joi.object({
  name: Joi.string()
    .optional()
    .valid(...Object.keys(CUSTOM_TASK_NODE_ID)),
  user_id: Joi.string().optional(),
  duration: Joi.number().optional().allow(null),
  start_time: Joi.number().when('duration', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  event_name: Joi.string().optional().allow(null),
  event_id: Joi.string().optional().allow(null),
  send_reminder_email: Joi.number().valid(0, 1).default(0),
  reminder_time: Joi.number().optional().allow(null),
});

const getCustomTaskSchema = Joi.object({
  task_id: Joi.string().required(),
  event_id: Joi.string().optional(),
});

const taskCompletionForProductTourLeadsSchema = Joi.object({
  task_id: Joi.number().required().label('Task id'),
  from_number: Joi.string().optional().allow('', null).label('From number'),
  to_number: Joi.string().optional().allow('', null).label('To number'),
  subject: Joi.string().optional().allow('', null).label('Subject'),
  message: Joi.string().optional().allow('', null).label('Message'),
});

const taskSchema = {
  skipTaskSchema,
  createCustomTaskSchema,
  updateCustomTaskTimeSchema,
  updateCustomTaskSchema,
  getCustomTaskSchema,
  taskCompletionForProductTourLeadsSchema,
};

module.exports = taskSchema;
