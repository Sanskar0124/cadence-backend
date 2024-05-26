// const supertest = require('supertest');
// const chai = require('chai');
// const app = require('../../app');

// const expect = chai.expect;
// const request = supertest(app);

// // Import utils
// const { loginUser } = require('../utils/login.utils.js');

// let access_token = '';

// // * Send email test
// describe('Mail: Send mail:', () => {
//   it('returns 200 if correct credentials are passed', async () => {
//     [access_token, _] = await loginUser({
//       email: process.env.TEST_EMAIL,
//       password: process.env.TEST_PASSWORD,
//     });
//     const res = await request
//       .post('/google/mail')
//       .set({ Authorization: `Bearer ${access_token}` })
//       .send({
//         lead_id: '1',
//         to: 'iamyuvi2000.dev@gmail.com',
//         subject: 'CRM-Mail.test.js',
//         body: '<p>This is a test email generated from mail.test.js</p>',
//       });
//     expect(res.statusCode).equal(200);
//   });
// });

// // * Fetch sent email test
// describe('Mail: Fetch mail:', () => {
//   it('returns 200 if correct credentials are passed', async () => {
//     const res = await request
//       .get('/google/mail/17ccbb222b2d28dc')
//       .set({ Authorization: `Bearer ${access_token}` });

//     expect(res.statusCode).equal(200);
//   });
// });
