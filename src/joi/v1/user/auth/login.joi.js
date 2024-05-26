const Joi = require('joi');

// sample valid data
// {
//     "email": "ziyankarmali786@gmail.com",
//     "password":"ziyan123"
// }

const schema = Joi.object().keys({
  email: Joi.string().email().required().label('Email'),
  password: Joi.string().required().label('Password'),
  language: Joi.string().optional().allow('', null).label('Language'),
});

module.exports = schema;
