// Packages
const Joi = require('joi');

// Utils
const {
  SALESFORCE_DATA_IMPORT_TYPES,
  CADENCE_TYPES,
  CADENCE_PRIORITY,
  CADENCE_STATUS,
  CADENCE_LEAD_STATUS,
  COMPANY_CONTACT_REASSIGNMENT_OPTIONS,
  USER_DELETE_OPTIONS,
  CRM_INTEGRATIONS,
  HIRING_INTEGRATIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

const stopCurrentCadenceForLeadSchema = Joi.object({
  lead_id: Joi.number().required(),
  cadence_id: Joi.number().required(),
});

const createCadenceSchema = Joi.object({
  name: Joi.string().required(),
  type: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_TYPES)),
  description: Joi.string().optional(),
  priority: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_PRIORITY))
    .allow('', null),
  integration_type: Joi.alternatives()
    .try(
      Joi.string()
        .required()
        .valid(...Object.values(CRM_INTEGRATIONS)),
      Joi.string()
        .required()
        .valid(...Object.values(HIRING_INTEGRATIONS))
    )
    .required(),
  inside_sales: Joi.string().required().valid('0', '1'),
  remove_if_reply: Joi.boolean().optional(),
  remove_if_bounce: Joi.boolean().optional(),
  scheduled: Joi.bool().optional().allow(),
  launch_at: Joi.number().optional(),
  company_id: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.valid(null),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.string().guid().required(),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  user_id: Joi.string()
    .guid()
    .required()
    .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'),
  tags: Joi.array().items(
    Joi.object({
      tag_name: Joi.string(),
    })
  ),
});

const duplicateCadenceSchema = Joi.object({
  cadence_id: Joi.number().required(),
  name: Joi.string().trim().required(),
  type: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_TYPES)),
  priority: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_PRIORITY)),
  description: Joi.string().optional().allow(null, ''),
  integration_type: Joi.alternatives()
    .try(
      Joi.string()
        .required()
        .valid(...Object.values(CRM_INTEGRATIONS)),
      Joi.string()
        .required()
        .valid(...Object.values(HIRING_INTEGRATIONS)),
      Joi.string().required().valid(null)
    )
    .required(),
  inside_sales: Joi.string().required().valid('0', '1'),
  remove_if_reply: Joi.boolean().optional(),
  remove_if_bounce: Joi.boolean().optional(),
  company_id: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.valid(null),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.string().guid().required(),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  user_id: Joi.string()
    .guid()
    .required()
    .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'),
  is_workflow: Joi.boolean().optional().label('duplicate cadence workflow'),
});

const shareCadenceSchema = Joi.object({
  cadence_id: Joi.number().required(),
  name: Joi.string().trim().required(),
  type: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_TYPES)),
  priority: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_PRIORITY)),
  description: Joi.string().allow('').optional().label('Cadence description'),
  integration_type: Joi.alternatives()
    .try(
      Joi.string()
        .required()
        .valid(...Object.values(CRM_INTEGRATIONS)),
      Joi.string()
        .required()
        .valid(...Object.values(HIRING_INTEGRATIONS)),
      Joi.string().required().valid(null)
    )
    .required(),
  inside_sales: Joi.string().required().valid('0', '1'),
  remove_if_reply: Joi.boolean().optional(),
  remove_if_bounce: Joi.boolean().optional(),
  company_id: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.valid(null),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_ids: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.valid(null),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.array().items(Joi.string().required()).required(),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  user_ids: Joi.alternatives()
    .conditional('type', {
      switch: [
        {
          is: CADENCE_TYPES.PERSONAL,
          then: Joi.array().items(Joi.string().required()).required(),
        },
        // {
        //   is: CADENCE_TYPES.TEAM,
        //   then: Joi.valid(null),
        // },
        {
          is: CADENCE_TYPES.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  is_workflow: Joi.boolean().optional().label('share cadence workflow'),
});

const fetchCadenceSchema = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_TYPES)),
  status: Joi.string()
    .optional()
    .valid(...Object.values(CADENCE_STATUS)),
  priority: Joi.string()
    .optional()
    .valid(...Object.values(CADENCE_PRIORITY)),
  user_id: Joi.string()
    .guid()
    .optional()
    .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'),
  sd_id: Joi.string().guid().optional(),
  limit: Joi.number().optional(),
  offset: Joi.number().optional(),
  search: Joi.string().optional(),
  favorite: Joi.number().optional().valid(0, 1),
  created_at: Joi.string().optional(),
  updated_at: Joi.string().optional(),
  move_to_another_cadence: Joi.boolean()
    .optional()
    .label('move to another cadence'),
});

const fetchCadenceLeadsSchema = Joi.object({
  limit: Joi.number().optional(),
  offset: Joi.number().optional(),
  cadence_id: Joi.number().required(),
  status: Joi.string()
    .valid(...Object.values(CADENCE_LEAD_STATUS))
    .allow(null),
  search: Joi.string().optional(),
  user_ids: Joi.array()
    .items(
      Joi.string()
        .guid()
        .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', null)
    )
    .optional(),
  created_at: Joi.string().optional(),
});

const deleteManyCadenceSchema = Joi.object({
  cadence_ids: Joi.array().items(Joi.number()).required(),
});

const reassignLeadsAndContactsSchema = Joi.object({
  cadence_id: Joi.string().required(),
  leadIds: Joi.array().items(Joi.number()).default([]),
  contactIds: Joi.array().items(Joi.number()).default([]),
  /*
   * contact_reassignment_rule - should be required only if we have received contactIds for reassignment, since this is not applicable to leads
   * */
  contact_reassignment_rule: Joi.string()
    .valid(...Object.values(COMPANY_CONTACT_REASSIGNMENT_OPTIONS))
    .when('contactIds', {
      is: Joi.array().min(1),
      then: Joi.string().required(),
      otherwise: Joi.optional().allow(null),
    }),
  reassignTasksForLeads: Joi.boolean(),
  reassignTasksForContacts: Joi.boolean(),
  reassignToForLeads: Joi.array()
    .items(
      Joi.object({
        user_id: Joi.string().required(),
        count: Joi.number().required(),
      })
    )
    .default([]),
  reassignToForContacts: Joi.array()
    .items(
      Joi.object({
        user_id: Joi.string().required(),
        count: Joi.number().required(),
      })
    )
    .default([]),
});

const fetchTestMailUsersSchema = Joi.object({
  from: Joi.string().allow('cadence', 'template').required(),
  cadence_id: Joi.alternatives()
    .conditional('from', {
      switch: [
        {
          is: 'cadence',
          then: Joi.number().required(),
        },
        {
          is: 'template',
          then: Joi.allow(null),
        },
      ],
    })
    .required(),
});

const CADENCE_TYPES_FOR_TASK_FILTER = [
  CADENCE_TYPES.PERSONAL,
  // CADENCE_TYPES.TEAM,
  CADENCE_TYPES.COMPANY,
];

const cadencesForTaskFilterSchema = Joi.object({
  user_id: Joi.string().optional().allow(null, ''),
  limit: Joi.number().optional().default(20),
  offset: Joi.number().optional().default(0),
  type: Joi.string()
    .required()
    .valid(...Object.values(CADENCE_TYPES_FOR_TASK_FILTER))
    .label('cadence type'),
  search: Joi.string().optional().allow('', null),
});

const updateFavoriteSchema = Joi.object({
  favorite: Joi.number().required().valid(0, 1),
});

const cadenceSchema = {
  stopCurrentCadenceForLeadSchema,
  createCadenceSchema,
  duplicateCadenceSchema,
  shareCadenceSchema,
  fetchCadenceSchema,
  fetchCadenceLeadsSchema,
  deleteManyCadenceSchema,
  reassignLeadsAndContactsSchema,
  fetchTestMailUsersSchema,
  cadencesForTaskFilterSchema,
  updateFavoriteSchema,
};

module.exports = cadenceSchema;
