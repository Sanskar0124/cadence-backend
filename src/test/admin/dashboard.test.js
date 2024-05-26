const supertest = require('supertest');
const chai = require('chai');
const app = require('../../app');

const expect = chai.expect;
const request = supertest(app);

// Import utils
const { loginUser } = require('../utils/login.utils.js');

let access_token = '';

// *  Monitoring data
describe('Admin: Get monitoring dashboard data:', () => {
  it('returns 200 if monitoring dashboard is fetched', async () => {
    // * Signin user
    // [access_token, _] = await loginUser({
    //   email: 'admin@ringover.com',
    //   password: 'Ringover@123',
    // });
    const res = await request
      .get(
        '/admin/dashboard/monitoring/4192bff0-e1e0-43ce-a4db-912808c32494/this_month'
      )
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });
});

// * Metric data
describe('Admin: Get dashboard data metrics:', () => {
  it('returns 200 if dashboard data metrics is fetched', async () => {
    const res = await request
      .get(
        '/admin/dashboard/metrics/4192bff0-e1e0-43ce-a4db-912808c32494/this_month'
      )
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });
});

// * Monitoring data - Sub department
describe('Admin: Get dashboard monitoring data  for sub department:', () => {
  it('returns 200 if dashboard monitoring data for sub department is fetched', async () => {
    const res = await request
      .get(
        '/admin/dashboard/monitoring/sub-department/4192bff0-e1e0-43ce-a4db-912808c32495/last_month'
      )
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });
});

// * Metric data - Sub department
describe('Admin: Get dashboard data metrics for sub department:', () => {
  it('returns 200 if dashboard data metrics for sub department is fetched', async () => {
    const res = await request
      .get(
        '/admin/dashboard/metrics/sub-department/4192bff0-e1e0-43ce-a4db-912808c32495/last_month'
      )
      .set({ Authorization: `Bearer ${access_token}` });
    expect(res.statusCode).equal(200);
  });
});
