// Utils
const {
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTIONS,
  WORKFLOW_LEVEL,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const CreateWorkflowSchema = Joi.object({
  name: Joi.string().allow(null, ''),
  trigger: Joi.string()
    .valid(...Object.values(WORKFLOW_TRIGGERS))
    .required(),
  actions: Joi.object({
    [WORKFLOW_ACTIONS.CHANGE_OWNER]: Joi.object({
      to: Joi.string()
        .guid()
        .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
        .required(),
    }),
    [WORKFLOW_ACTIONS.MOVE_TO_ANOTHER_CADENCE]: Joi.object({
      cadence_id: Joi.number().required(),
    }),
    [WORKFLOW_ACTIONS.PAUSE_CADENCE]: Joi.object({
      unix_time: Joi.number().required(),
    }),
    [WORKFLOW_ACTIONS.STOP_CADENCE]: '',
    [WORKFLOW_ACTIONS.CONTINUE_CADENCE]: '',
    [WORKFLOW_ACTIONS.CHANGE_INTEGRATION_STATUS]: Joi.object({
      lead_status: Joi.string().optional().label('Lead Status'),
      account_status: Joi.string().optional().label('Account Status'),
      contact_status: Joi.string().optional().label('Contact Status'),
      candidate_status: Joi.string().optional().label('Candidate Status'),
      lead_reason: Joi.string()
        .optional()
        .label('Lead disqualification reason'),
      account_reason: Joi.string()
        .optional()
        .label('Account disqualification reason'),
      contact_reason: Joi.string()
        .optional()
        .label('Contact disqualification reason'),
      candidate_reason: Joi.string()
        .optional()
        .label('Candidate disqualification reason'),
    }),
    [WORKFLOW_ACTIONS.GO_TO_LAST_STEP_OF_CADENCE]: '',
  }),
  allow_edit: Joi.bool(),
  cadence_id: Joi.number(),
  metadata: Joi.object({
    trigger_call_duration: Joi.number().optional(),
    trigger_lead_status: Joi.array().items(Joi.string()).optional(),
  }),
});

const UpdateWorkflowSchema = Joi.object({
  name: Joi.string().allow(''),
  trigger: Joi.string().valid(...Object.values(WORKFLOW_TRIGGERS)),
  actions: Joi.object({
    [WORKFLOW_ACTIONS.CHANGE_OWNER]: Joi.object({
      to: Joi.string()
        .guid()
        .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
        .required(),
    }),
    [WORKFLOW_ACTIONS.MOVE_TO_ANOTHER_CADENCE]: Joi.object({
      cadence_id: Joi.number().required(),
    }),
    [WORKFLOW_ACTIONS.PAUSE_CADENCE]: Joi.object({
      unix_time: Joi.number(),
    }),
    [WORKFLOW_ACTIONS.STOP_CADENCE]: '',
    [WORKFLOW_ACTIONS.CONTINUE_CADENCE]: '',
    [WORKFLOW_ACTIONS.CHANGE_INTEGRATION_STATUS]: Joi.object({
      lead_status: Joi.string().optional(),
      account_status: Joi.string().optional(),
      contact_status: Joi.string().optional(),
      candidate_status: Joi.string().optional(),
      lead_reason: Joi.string().optional(),
      account_reason: Joi.string().optional(),
      candidate_reason: Joi.string().optional(),
    }),
    [WORKFLOW_ACTIONS.GO_TO_LAST_STEP_OF_CADENCE]: '',
  }),
  allow_edit: Joi.bool(),
  metadata: Joi.object({
    trigger_call_duration: Joi.number().optional(),
    trigger_lead_status: Joi.array().items(Joi.string()).optional(),
  }),
});

const fetchWorkflowSchema = Joi.object({
  cadence_id: Joi.when('option', {
    is: WORKFLOW_LEVEL.CADENCE,
    then: Joi.number().required(),
  }),
  option: Joi.string()
    .valid(...Object.values(WORKFLOW_LEVEL))
    .default(WORKFLOW_LEVEL.COMPANY),
});

module.exports = {
  CreateWorkflowSchema,
  UpdateWorkflowSchema,
  fetchWorkflowSchema,
};
