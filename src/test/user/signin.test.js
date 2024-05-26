require('dotenv').config({ path: `./.env.${process.env.NODE_ENV}` });
const supertest = require('supertest');
const { sequelize } = require('../../../../Cadence-Brain/src/db/models');
const UserHelper = require('../../../../Cadence-Brain/src/helper/user');
const Repository = require('../../../../Cadence-Brain/src/repository');
const { DB_TABLES } = require('../../../../Cadence-Brain/src/utils/modelEnums');
const app = require('../../app');

const request = supertest(app);

const cleanUpDB = async () => {
  try {
    let t = await sequelize.transaction();
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        email: 'authtestmail@bjtmail.com',
      },
    });
    await UserHelper.deleteAllUserInfo(user.user_id, t);
    t.commit();
  } catch (e) {}
};

// describe('Auth', () => {
//   beforeAll(cleanUpDB);
//   afterAll(cleanUpDB);

//   describe('POST /v1/user/auth/signup', () => {
//     it('should return 400 if the request body is invalid', async () => {
//       const res = await request.post('/v1/user/auth/signup').send({
//         first_name: 'test',
//         last_name: 'test',
//         email: 'authtestmail@bjtmail.com',
//         password: 'Ringover@123',
//         columns: ['new_lead', 'ongoing', 'test_web', 'agendas'],
//         role: 'sales_person',
//         timezone: 'Asia/Kolkata',
//         salesforce_owner_id: '0055g00000EAcoTAAT',
//         company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
//         department_id: '4192bff0-e1e0-43ce-a4db-912808c32494',
//         sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
//       });

//       expect(res.statusCode).toBe(400);
//     });

//     it('should return 201 if the user is created successfully', async () => {
//       const res = await request.post('/v1/user/auth/signup').send({
//         first_name: 'test',
//         last_name: 'test',
//         email: 'authtestmail@bjtmail.com',
//         password: 'Ringover@123',
//         columns: ['new_lead', 'ongoing', 'test_web', 'agendas'],
//         role: 'sales_person',
//         timezone: 'Asia/Kolkata',
//         salesforce_owner_id: '0055g00000EAcoTAAT',
//         ringover_user_id: '981234634512',
//         company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
//         department_id: '4192bff0-e1e0-43ce-a4db-912808c32494',
//         sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
//       });

//       expect(res.statusCode).toBe(201);
//     });
//   });

//   describe('POST /v1/user/auth/login', () => {
//     it('should return 400 if the request body is invalid', async () => {
//       const res = await request.post('/v1/user/auth/login').send({
//         email: 'authtestmail@bjtmail.com',
//       });

//       expect(res.statusCode).toBe(400);
//     });

//     it('should return 401 if password is wrong', async () => {
//       const res = await request.post('/v1/user/auth/login').send({
//         email: 'authtestmail@bjtmail.com',
//         password: 'password',
//       });

//       expect(res.statusCode).toBe(401);
//       expect(res.body).toEqual({
//         msg: 'Password does not match. Kindly retry.',
//       });
//     });

//     it('should return 200 if the user is created successfully', async () => {
//       const res = await request.post('/v1/user/auth/login').send({
//         email: 'authtestmail@bjtmail.com',
//         password: 'Ringover@123',
//       });

//       expect(res.statusCode).toBe(200);
//     });
//   });
// });
