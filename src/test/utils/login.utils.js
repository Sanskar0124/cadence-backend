const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const request = supertest(app);

module.exports.loginUser = async ({ email, password }) => {
  try {
    // const res = await request.post('/user/auth/login').send({
    //   email: email,
    //   password: password,
    // });
    return [res.body.data.accessToken, null];
  } catch (e) {
    return [null, e.message];
  }
};
