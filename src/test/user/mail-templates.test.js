const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

// Import utils
const { loginUser } = require('../utils/login.utils.js');

let access_token = '';

// * Create mail template
describe('Mail Template: Create mail template:', () => {
  it('returns 201 if mail template is created', async () => {
    // [access_token, _] = await loginUser({
    //   email: process.env.TEST_EMAIL,
    //   password: process.env.TEST_PASSWORD,
    // });
    const res = await request
      .post('/sales/employee/template/email')
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        name: 'Email template 1',
        subject: 'subject 1',
        body: 'body 1',
      });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.post('/sales/employee/template/email');
    expect(res.statusCode).equal(401);
  });
});

// * Fetch mail template
describe('Mail Template: Fetch mail templates:', () => {
  it('returns 200 if mail template is created', async () => {
    const res = await request
      .get('/sales/employee/template/email')
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.get('/sales/employee/template/email');
    expect(res.statusCode).equal(401);
  });
});

// * Update mail template
describe('Mail Template: Update mail template:', () => {
  it('returns 200 if mail template is updated', async () => {
    const res = await request
      .put('/sales/employee/template/email')
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        et_id: '1',
        name: 'etw1',
        subject: 'subect11',
      });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.put('/sales/employee/template/email');
    expect(res.statusCode).equal(401);
  });
});

// * Delete mail template
describe('Mail Template: Delete mail template:', () => {
  it('returns 200 if mail template is deleted', async () => {
    const res = await request
      .delete('/sales/employee/template/email/1')
      .set({ Authorization: `Bearer ${access_token}` });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.delete('/sales/employee/template/email/1');
    expect(res.statusCode).equal(401);
  });
});
