const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

// Import utils
const { loginUser } = require('../utils/login.utils.js');

describe('Admin: Leaderboard:', () => {
  it('returns 200 if leaderboards are fetched', async () => {
    // * Signin user
    // const [accessToken, e] = await loginUser({
    //   email: 'admin@ringover.com',
    //   password: 'Ringover@123',
    // });
    // if (e) {
    //   chai.expect(true).equal('Failed to login user!');
    //   return;
    // }

    const res = await request
      .get('/admin/leaderboard/this_week')
      .set({ Authorization: `Bearer ${accessToken}` });
    expect(res.statusCode).equal(200);
  });

  it('returns 401 if user is not admin', async () => {
    // * Signin user
    // const [accessToken, e] = await loginUser({
    //   email: process.env.TEST_EMAIL,
    //   password: process.env.TEST_PASSWORD,
    // });
    // if (e) {
    //   chai.expect(true).equal('Failed to login user!');
    //   return;
    // }

    const res = await request
      .get('/admin/leaderboard/this_week')
      .set({ Authorization: `Bearer ${accessToken}` });
    expect(res.statusCode).equal(401);
  });
});
