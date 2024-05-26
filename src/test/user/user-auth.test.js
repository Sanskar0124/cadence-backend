const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

describe('User: User login:', () => {
  // it('returns 200 if correct credentials are passed', async () => {
  //   const res = await request.post('/user/auth/login').send({
  //     email: 'iamyuvi2000.dev@gmail.com',
  //     password: 'yuvraj123',
  //   });
  //   expect(res.statusCode).equal(200);
  // });
  // it('returns 400 if incorrect credentials are passed', async () => {
  //   const res = await request.post('/user/auth/login').send({
  //     email: 'iamyuvi200.dev@gmail.com',
  //     password: 'yuvraj123',
  //   });
  //   expect(res.statusCode).equal(400);
  // });
});
