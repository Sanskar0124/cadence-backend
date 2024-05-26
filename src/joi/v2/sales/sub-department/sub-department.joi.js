// Utils
const {
  USER_ROLE,
  USER_LANGUAGES,
  TEAM_CHANGE_OPTIONS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  PASSWORD_REGEX,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Packages
const Joi = require('joi');

const subDepartmentUsersSchema = Joi.array().items(
  Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    email: Joi.string().email().required(),
    ringover_user_id: Joi.string().optional().allow(null, ''),
    ringover_api_key: Joi.string().optional().allow(null, ''),
    salesforce_owner_id: Joi.string().required(),
    role: Joi.string()
      .required()
      .allow(...Object.values(USER_ROLE)),
    timezone: Joi.string().required(),
  })
);

const subDepartmentUserSchema = Joi.object({
  first_name: Joi.string().required(),
  last_name: Joi.string().required(),
  email: Joi.string().email().required(),
  ringover_user_id: Joi.number().required().label('Ringover User ID'),
  ringover_api_key: Joi.string().optional().allow(null, ''),
  salesforce_owner_id: Joi.string().allow(null, ''),
  integration_id: Joi.string().optional(),
  role: Joi.string()
    .required()
    .allow(...Object.values(USER_ROLE)),
  timezone: Joi.string().required(),
  language: Joi.string()
    .required()
    .valid(...Object.values(USER_LANGUAGES)),
  sd_id: Joi.alternatives().conditional('role', {
    switch: [
      {
        is: USER_ROLE.ADMIN,
        then: Joi.string().guid().required(),
      },
      {
        is: USER_ROLE.SUPER_ADMIN,
        then: Joi.string().guid().required(),
      },
      {
        is: USER_ROLE.SALES_PERSON,
        then: Joi.string().guid().required(),
      },
      {
        is: USER_ROLE.SALES_MANAGER,
        then: Joi.string().guid().required(),
      },
    ],
  }),
});

const subDepartmentCreateSchema = Joi.object({
  name: Joi.string().required(),
  department_id: Joi.string().guid().required(),
});

const subDepartmentUpdateSchema = Joi.object({
  name: Joi.string()
    .required()
    .custom((value, helper) => {
      if (value === 'Admin')
        return helper.message("Cannot name a group 'Admin'.");
      return value;
    }),
  department_id: Joi.string().guid().required(),
});

const setUpPasswordSchema = Joi.object({
  password: Joi.string().regex(PASSWORD_REGEX).required(),
  language: Joi.string().optional().allow(null, '').label('Language'),
});

const changeSubDepartmentForUser = Joi.object({
  user_id: Joi.string()
    .guid()
    .allow('1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
    .required(),
  sd_id: Joi.string().guid().required(),
  role: Joi.string().optional(),
  lead_option: Joi.string()
    .required()
    .allow(...Object.values(TEAM_CHANGE_OPTIONS)),
  cadence_id: Joi.alternatives().conditional('lead_option', {
    switch: [
      {
        is: TEAM_CHANGE_OPTIONS.MOVE_LEADS_TO_ANOTHER_CADENCE,
        then: Joi.number().required(),
      },
    ],
  }),
});

const subDepartmentSchema = {
  subDepartmentUsersSchema,
  subDepartmentUserSchema,
  subDepartmentCreateSchema,
  subDepartmentUpdateSchema,
  setUpPasswordSchema,
  changeSubDepartmentForUser,
};

module.exports = subDepartmentSchema;
