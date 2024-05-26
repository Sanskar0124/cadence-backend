const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

// Import utils
const { loginUser } = require('../utils/login.utils.js');

let access_token = '';
let signature_id = '';

// * Create signature
describe('Signature: Create Signature:', () => {
  it('returns 201 if signature is created', async () => {
    // [access_token, _] = await loginUser({
    //   email: process.env.TEST_EMAIL,
    //   password: process.env.TEST_PASSWORD,
    // });
    const res = await request
      .post('/sales/employee/signature')
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        name: 'Signature 1',
        signature: 'Hello, this is a signature',
      });

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.post('/sales/employee/signature');
    expect(res.statusCode).equal(401);
  });
});

// * Fetch signatures
describe('Signature: Fetch user Signatures:', () => {
  it('returns 200 if signatures are fetched', async () => {
    const res = await request
      .get('/sales/employee/signature')
      .set({ Authorization: `Bearer ${access_token}` });
    signature_id = res.body.data[0].signature_id;

    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not logged in', async () => {
    const res = await request.get('/sales/employee/signature');
    expect(res.statusCode).equal(401);
  });
});

// * Make signature primary
describe('Signature: Make signature primary:', () => {
  it('returns 200 if signature is updated', async () => {
    const res = await request
      .put(`/sales/employee/signature/primary/${signature_id}`)
      .set({ Authorization: `Bearer ${access_token}` })
      .send({
        is_primary: true,
      });
    expect(res.statusCode).equal(200);
  });
});

// * Delete signature
describe('Signature: Delete signature:', () => {
  it('returns 200 if signature is deleted', async () => {
    const res = await request
      .delete(`/sales/employee/signature/${signature_id}`)
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });
});
