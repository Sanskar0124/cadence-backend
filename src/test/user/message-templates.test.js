const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

// Import utils
const { loginUser } = require('../utils/login.utils.js');

let access_token = '';

// * Create message template
describe('Message Template: Create message template:', () => {
  it('returns 201 if message template is created', async () => {
    // [access_token, _] = await loginUser({
    //   email: process.env.TEST_EMAIL,
    //   password: process.env.TEST_PASSWORD,
    // });
    const res = await request
      .post('/sales/employee/template/message')
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        name: 'message template 1',
        message: 'message body 1',
      });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.post('/sales/employee/template/message');
    expect(res.statusCode).equal(401);
  });
});

// * Fetch message template
describe('Message Template: Fetch message templates:', () => {
  it('returns 200 if message template is created', async () => {
    const res = await request
      .get('/sales/employee/template/message')
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.get('/sales/employee/template/message');
    expect(res.statusCode).equal(401);
  });
});

// * Update message template
describe('Message Template: Update message template:', () => {
  it('returns 200 if message template is updated', async () => {
    const res = await request
      .put('/sales/employee/template/message')
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        mt_id: '1',
        name: 'message template 1',
        message: 'message body 1',
      });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.put('/sales/employee/template/message');
    expect(res.statusCode).equal(401);
  });
});

// * Delete message template
describe('Message Template: Delete message template:', () => {
  it('returns 200 if message template is deleted', async () => {
    const res = await request
      .delete('/sales/employee/template/message/1')
      .set({ Authorization: `Bearer ${access_token}` });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.delete('/sales/employee/template/message/1');
    expect(res.statusCode).equal(401);
  });
});
