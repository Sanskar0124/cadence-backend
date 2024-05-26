require('dotenv').config({ path: `./.env.${process.env.NODE_ENV}` });

const app = require('../../app');
const supertest = require('supertest');

const AmazonService = require('../../../../Cadence-Brain/src/services/Amazon');
const {
  access,
  generateToken,
} = require('../../controllers/v1/user/authentication/token');
const HtmlHelper = require('../../../../Cadence-Brain/src/helper/html');
const UserHelper = require('../../../../Cadence-Brain/src/helper/user');
const { DB_TABLES } = require('../../../../Cadence-Brain/src/utils/modelEnums');
const { FRONTEND_URL } = require('../../utils/config');
const UserRepository = require('../../../../Cadence-Brain/src/repository/user-repository');
const { sequelize } = require('../../../../Cadence-Brain/src/db/models');
const Repository = require('../../../../Cadence-Brain/src/repository');
const UserTokensHelper = require('../../../../Cadence-Brain/src/helper/userTokens');
const {
  USER_ROLE,
  USER_DELETE_OPTIONS,
} = require('../../../../Cadence-Brain/src/utils/enums');
const AccessTokenHelper = require('../../../../Cadence-Brain/src/helper/access-token');
const SettingsRepository = require('../../../../Cadence-Brain/src/repository/settings.repository');

jest.mock('../../../../Cadence-Brain/src/services/Amazon', () => ({
  sendHtmlMails: jest.fn().mockResolvedValue(['mail', null]),
}));
jest.mock('../../../../Cadence-Brain/src/helper/access-token', () => ({
  getAccessToken: jest
    .fn()
    .mockResolvedValue([
      { access_token: 'dummy_access_token', instance_url: 'localhost' },
      null,
    ]),
}));

const request = supertest(app);

const adminTestUser = {
  first_name: 'test',
  last_name: 'test',
  email: 'usertestmail1@bjtmail.com',
  role: USER_ROLE.ADMIN,
  // password: 'Ringover@123',
  columns: ['new_lead', 'ongoing', 'test_web', 'agendas'],
  timezone: 'Asia/Kolkata',
  ringover_user_id: '98123461345122',
  salesforce_owner_id: '0055g00000EAcoTAAT',
  company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
  department_id: '4192bff0-e1e0-43ce-a4db-912808c32494',
  sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
};

// describe('POST /v2/user/forgot-password', () => {
//   beforeAll(async () => {
//     await UserRepository.createUser({
//       first_name: 'test',
//       last_name: 'test',
//       email: 'forgotpwtestmail@bjtmail.com',
//       role: 'sales_person',
//       password: 'Ringover@123',
//       columns: ['new_lead', 'ongoing', 'test_web', 'agendas'],
//       timezone: 'Asia/Kolkata',
//       ringover_user_id: '98123461345121',
//       salesforce_owner_id: '0055g00000EAcoTAAT',
//       company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
//       department_id: '4192bff0-e1e0-43ce-a4db-912808c32494',
//       sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
//     });
//     try {
//       let t = await sequelize.transaction();
//       const [user, errForUser] = await Repository.fetchOne({
//         tableName: DB_TABLES.USER,
//         query: {
//           email: 'test@test.com',
//         },
//       });
//       await UserHelper.deleteAllUserInfo(user.user_id, t);
//       t.commit();
//     } catch (e) {}
//   });

//   afterAll(async () => {
//     try {
//       let t = await sequelize.transaction();
//       const [user, errForUser] = await Repository.fetchOne({
//         tableName: DB_TABLES.USER,
//         query: {
//           email: 'forgotpwtestmail@bjtmail.com',
//         },
//       });
//       await UserHelper.deleteAllUserInfo(user.user_id, t);
//       t.commit();
//     } catch (e) {}
//   });

//   it('should return 400 if invalid request', async () => {
//     const res = await request.post('/v2/user/forgot-password').send({
//       email: '',
//     });
//     expect(res.statusCode).toBe(400);
//     expect(res.body).toEqual({
//       msg: 'Email cannot be empty.',
//     });
//   });

//   it('should return 400 if the user is not found in the database', async () => {
//     const res = await request.post('/v2/user/forgot-password').send({
//       email: 'test@test.com',
//     });
//     expect(res.statusCode).toBe(400);
//     expect(res.body).toEqual({
//       msg: 'A user with this email does not exist.',
//     });
//   });

//   it('should return 200 and send mail if user exists', async () => {
//     const res = await request.post('/v2/user/forgot-password').send({
//       email: 'forgotpwtestmail@bjtmail.com',
//     });

//     expect(res.statusCode).toBe(200);
//     expect(res.body).toEqual({
//       msg: 'Kindly check your email for the password reset link.',
//     });

//     expect(AmazonService.sendHtmlMails).toBeCalledWith(
//       expect.objectContaining({
//         subject: 'Ringover Cadence Password Change.',
//         emailsToSend: ['forgotpwtestmail@bjtmail.com'],
//       })
//     );
//   });
// });

// describe('POST /v2/user/change-password', () => {
//   let accessToken;

//   beforeAll(async () => {
//     const [user, _err] = await UserRepository.createUser(adminTestUser);

//     accessToken = access.generate(
//       user.user_id,
//       user.email,
//       user.first_name,
//       user.role,
//       user.sd_id,
//       user.Company?.integration_type
//     );

//     const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
//       accessToken,
//       user.user_id
//     );
//   });

//   afterAll(async () => {
//     try {
//       let t = await sequelize.transaction();
//       const [user, _err] = await Repository.fetchOne({
//         tableName: DB_TABLES.USER,
//         query: {
//           email: adminTestUser.email,
//         },
//       });
//       await UserHelper.deleteAllUserInfo(user.user_id, t);
//       t.commit();
//     } catch (e) {}
//   });

//   it('should return 401 if user is not logged in', async () => {
//     const res = await request.post('/v2/user/change-password').send({
//       password: 'Ringover@1234',
//     });
//     expect(res.statusCode).toBe(401);
//   });

//   it('should return 422 if invalid password', async () => {
//     const res = await request
//       .post('/v2/user/change-password')
//       .query({ a_token: accessToken })
//       .send({
//         password: 'abc',
//       });
//     expect(res.statusCode).toBe(422);
//   });

//   it('should return 200 if password changed', async () => {
//     const res = await request
//       .post('/v2/user/change-password')
//       .query({ a_token: accessToken })
//       .send({
//         password: 'Ringover@1234',
//       });
//     expect(res.statusCode).toBe(200);
//   });
// });

describe('GET /v2/user/get-users', () => {
  let accessToken;

  beforeAll(async () => {
    const [user, _err] = await UserRepository.createUser(adminTestUser);

    accessToken = access.generate(
      user.user_id,
      user.email,
      user.first_name,
      user.role,
      user.sd_id,
      user.Company?.integration_type
    );

    const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
      accessToken,
      user.user_id
    );
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  it('should return 200 if user is fetched', async () => {
    const res = await request
      .get('/v2/user/get-users')
      .set({ Authorization: `Bearer ${accessToken}` });
    expect(res.statusCode).toBe(200);
  });

  it('should return 401 if user is not logged in', async () => {
    const res = await request.get('/v2/user/get-users');
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /v2/user', () => {
  let accessToken, userIdToDelete;

  beforeAll(async () => {
    {
      const [user, _err] = await UserRepository.createUser(adminTestUser);

      accessToken = access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id,
        user.Company?.integration_type
      );

      const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
        accessToken,
        user.user_id
      );
    }
    {
      const [user, _err] = await UserRepository.createUser({
        ...adminTestUser,
        email: 'usertestmail3@bjtmail.com',
        role: USER_ROLE.SALES_PERSON,
        ringover_user_id: adminTestUser.ringover_user_id + '1',
      });
      userIdToDelete = user.user_id;
    }
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}

    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: 'usertestmail3@bjtmail.com',
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  it('should return 200 if user is deleted', async () => {
    const res = await request
      .delete('/v2/user')
      .set({ Authorization: `Bearer ${accessToken}` })
      .send({
        user_id: userIdToDelete,
        option: USER_DELETE_OPTIONS.DELETE_ALL,
      });

    expect(res.body).toMatchObject({
      msg: 'Started process to delete user...',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return 401 if user is not logged in', async () => {
    const res = await request.delete('/v2/user');
    expect(res.statusCode).toBe(401);
  });
});

describe('GET & PUT /v2/user/onboarding', () => {
  let accessToken;

  beforeAll(async () => {
    const [user, _err] = await UserRepository.createUser(adminTestUser);

    accessToken = access.generate(
      user.user_id,
      user.email,
      user.first_name,
      user.role,
      user.sd_id,
      user.Company?.integration_type
    );

    const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
      accessToken,
      user.user_id
    );
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  describe('GET /v2/user/onboarding', () => {
    it('should return 200 if user exists', async () => {
      const res = await request
        .get('/v2/user/onboarding')
        .set({ Authorization: `Bearer ${accessToken}` });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        data: { is_onboarding_complete: false },
      });
    });

    it('should return 401 if user is not logged in', async () => {
      const res = await request.get('/v2/user/onboarding');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /v2/user/onboarding', () => {
    it('should return 401 if user is not logged in', async () => {
      const res = await request.put('/v2/user/onboarding');
      expect(res.statusCode).toBe(401);
    });

    it('should return 400 if body is invaild ', async () => {
      const res = await request
        .put('/v2/user/onboarding')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({
          is_onboarding_complete: 'tset',
        });

      expect(res.statusCode).toBe(400);
    });

    it('should return 200 if onboarding updated', async () => {
      const res = await request
        .put('/v2/user/onboarding')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({
          is_onboarding_complete: true,
        });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /v2/user/onboarding', () => {
    it('should contain onboarding true after update', async () => {
      const res = await request
        .get('/v2/user/onboarding')
        .set({ Authorization: `Bearer ${accessToken}` });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        data: { is_onboarding_complete: true },
      });
    });
  });
});

describe('POST /v2/user/check-email-exist', () => {
  beforeAll(async () => {
    const [user, _err] = await UserRepository.createUser(adminTestUser);
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  it('should return 401 if auth header not set', async () => {
    const res = await request.post('/v2/user/check-email-exist');
    expect(res.statusCode).toBe(401);
  });

  it('should return 401 if not authorized', async () => {
    const res = await request
      .post('/v2/user/check-email-exist')
      .set({ Authorization: `Bearer asdf2435` });
    expect(res.statusCode).toBe(401);
  });

  it('should return 200 if email exists', async () => {
    const res = await request
      .post('/v2/user/check-email-exist')
      .set({ Authorization: `Bearer ${process.env.DEV_AUTH}` })
      .send({ email: adminTestUser.email });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        exists: true,
      },
      msg: 'User exists',
    });
  });

  it('should return 200 if email does not exist', async () => {
    const res = await request
      .post('/v2/user/check-email-exist')
      .set({ Authorization: `Bearer ${process.env.DEV_AUTH}` })
      .send({ email: 'notexist@test.com' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        exists: false,
      },
      msg: 'User does not exist',
    });
  });
});

describe('GET /v2/user/disconnect', () => {
  let accessToken, userId;

  beforeAll(async () => {
    const [user, _err] = await UserRepository.createUser(adminTestUser);
    userId = user.user_id;

    accessToken = access.generate(
      user.user_id,
      user.email,
      user.first_name,
      user.role,
      user.sd_id,
      user.Company?.integration_type
    );

    const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
      accessToken,
      user.user_id
    );
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  it('should return 401 if not logged in', async () => {
    const res = await request.get('/v2/user/disconnect');
    expect(res.statusCode).toBe(401);
  });

  it('should return 200 if user is disconnected', async () => {
    const res = await request
      .get('/v2/user/disconnect')
      .set({ Authorization: `Bearer ${accessToken}` });

    expect(res.statusCode).toBe(200);
  });

  it('should return 400 after disconnecting', async () => {
    const res = await request
      .get('/v2/user/disconnect')
      .set({ Authorization: `Bearer ${accessToken}` });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v2/user/delay/:user_id', () => {
  let userId, settings;
  beforeAll(async () => {
    const res = await request.post('/v1/user/auth/signup').send(adminTestUser);
    userId = res.body.data.user_id;
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      const [user, _err] = await Repository.fetchOne({
        tableName: DB_TABLES.USER,
        query: {
          email: adminTestUser.email,
        },
      });
      await UserHelper.deleteAllUserInfo(user.user_id, t);
      t.commit();
    } catch (e) {}
  });

  it('should return 200', async () => {
    const res = await request.get(`/v2/user/delay/${userId}`);

    expect(res.body).toEqual({
      data: { delay: 60 },
      msg: 'Fetched delay successfully.',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /v2/user/login-as-user', () => {
  let adminAccessToken, nonAdminAccessToken, adminUser, nonAdminUser;

  beforeAll(async () => {
    {
      const [user, _err] = await UserRepository.createUser(adminTestUser);
      adminUser = user;

      adminAccessToken = access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id,
        user.Company?.integration_type
      );

      const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
        adminAccessToken,
        adminUser.user_id
      );
    }
    {
      const [user, _err] = await UserRepository.createUser({
        ...adminTestUser,
        email: 'usertestmail3@bjtmail.com',
        role: USER_ROLE.SALES_PERSON,
        ringover_user_id: adminTestUser.ringover_user_id + '2',
      });
      nonAdminUser = user;

      nonAdminAccessToken = access.generate(
        user.user_id,
        user.email,
        user.first_name,
        user.role,
        user.sd_id,
        user.Company?.integration_type
      );

      const [_, _errForValidToken] = await UserTokensHelper.setValidAccessToken(
        nonAdminAccessToken,
        nonAdminAccessToken.user_id
      );
    }
  });

  afterAll(async () => {
    try {
      let t = await sequelize.transaction();
      {
        const [user, _err] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            email: adminTestUser.email,
          },
        });
        await UserHelper.deleteAllUserInfo(user.user_id, t);
      }
      {
        const [user, _err] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            email: 'usertestmail3@bjtmail.com',
          },
        });
        await UserHelper.deleteAllUserInfo(user.user_id, t);
      }
      t.commit();
    } catch (e) {}
  });

  it('should return 401 if not logged in', async () => {
    const res = await request.post('/v2/user/login-as-user');
    expect(res.statusCode).toBe(401);
  });

  it('should return 400 if user is not admin', async () => {
    const res = await request
      .post('/v2/user/login-as-user')
      .set({ Authorization: `Bearer ${nonAdminAccessToken}` });

    expect(res.statusCode).toBe(400);
  });

  it('should return 200 if logged in as user', async () => {
    const res = await request
      .post('/v2/user/login-as-user')
      .set({ Authorization: `Bearer ${adminAccessToken}` })
      .send({ email: 'usertestmail3@bjtmail.com' });

    expect(res.statusCode).toBe(200);
  });
});
