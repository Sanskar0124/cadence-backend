const supertest = require('supertest');
const chai = require('chai');
const app = require('../app');

const expect = chai.expect;
const request = supertest(app);

describe('Ping cadence api: ', () => {
  it('Ping', async () => {
    const res = await request.get('/');
    expect(res.statusCode).equal(200);
  });
});
