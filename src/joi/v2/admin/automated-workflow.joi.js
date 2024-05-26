// Utils
const {
  AUTOMATED_WORKFLOW_TRIGGERS,
  AUTOMATED_WORKFLOW_ACTIONS,
  AUTOMATED_WORKFLOW_FILTER_OPERATION,
  AUTOMATED_WORKFLOW_FILTER_EQUATORS,
  AUTOMATED_WORKFLOW_DATA_TYPES,
  MODEL_TYPES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

const filterValidationSchema = Joi.object({
  id: Joi.string().required(),
  operation: Joi.string()
    .valid(...Object.values(AUTOMATED_WORKFLOW_FILTER_OPERATION))
    .required(),
  condition: Joi.object({
    integration_field: Joi.string().required(), // * This is the field that the integration understands. (Example API Name in Salesforce)
    integration_label: Joi.string().required(), // * This is the correlated label to the integration_field visible to the user
    integration_data_type: Joi.string()
      .valid(...Object.values(AUTOMATED_WORKFLOW_DATA_TYPES))
      .required(),
    model_type: Joi.string()
      .valid(...Object.values(MODEL_TYPES))
      .required(),
    equator: Joi.string()
      .valid(...Object.values(AUTOMATED_WORKFLOW_FILTER_EQUATORS))
      .required(),
    value: Joi.alternatives(Joi.string(), Joi.number()).required(),
  }).when('operation', {
    is: AUTOMATED_WORKFLOW_FILTER_OPERATION.CONDITION,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),

  children: Joi.array()
    .items(Joi.link('...'))
    .min(1)
    .when('operation', {
      is: [
        AUTOMATED_WORKFLOW_FILTER_OPERATION.AND,
        AUTOMATED_WORKFLOW_FILTER_OPERATION.OR,
      ],
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
})
  .required()
  .id('filterValidationSchema');

const CreateSalesforceAutomatedWorkflowSchema = Joi.object({
  rule_name: Joi.string().required(),
  trigger: Joi.string()
    .valid(...Object.values(AUTOMATED_WORKFLOW_TRIGGERS))
    .required(),
  actions: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid(...Object.values(AUTOMATED_WORKFLOW_ACTIONS))
          .required(),
        cadence_id: Joi.string().when('type', {
          is: AUTOMATED_WORKFLOW_ACTIONS.ADD_TO_CADENCE,
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),
        status: Joi.string().when('type', {
          is: AUTOMATED_WORKFLOW_ACTIONS.UPDATE_STATUS,
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),
      }).required()
    )
    .required()
    .min(1),
  filter: filterValidationSchema,
  is_enabled: Joi.boolean().required(),
});

module.exports = {
  CreateSalesforceAutomatedWorkflowSchema,
};
