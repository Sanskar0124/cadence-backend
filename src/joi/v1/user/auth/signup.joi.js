const joi = require('joi');

const {
  PASSWORD_REGEX,
} = require('../../../../../../Cadence-Brain/src/utils/constants');
// sample valid data
// {
//     "first_name": "Vianney",
//     "last_name": "Test",
//     "email": "vianney@gmail.com",
//     "password": "Ringover@123",
//     "columns": [
//         "new_lead",
//         "ongoing",
//         "test_web",
//         "agendas"
//     ],
//     "role": "sales_person",
//     "timezone": "Asia/Kolkata",
//     "salesforce_owner_id":"0052p000009gaq5AAA",
//     "company_id": "4192bff0-e1e0-43ce-a4db-912808c32493",
//     "department_id": "4192bff0-e1e0-43ce-a4db-912808c32494",
//     "ringover_user_id": 85819,
//     "sd_id": "4192bff0-e1e0-43ce-a4db-912808c32495",
// }

const schema = joi.object().keys({
  first_name: joi.string().required(),
  last_name: joi.string().required(),
  email: joi.string().email().required(),
  password: joi.string().regex(PASSWORD_REGEX).required(),
  primary_email: joi.string().email(),
  columns: joi.array().items(joi.string()),
  role: joi.string(),
  linkedin_url: joi.string().uri(),
  primary_phone_number: joi.string(),
  timezone: joi.string(),
  salesforce_owner_id: joi.string().required(),
  ringover_api_key: joi.string(),
  company_id: joi.string().required(),
  department_id: joi.string().required(),
  ringover_user_id: joi.number().required(),
  sd_id: joi.string().required(),
});

module.exports = schema;
