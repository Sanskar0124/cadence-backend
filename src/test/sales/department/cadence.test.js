require('dotenv').config({ path: `./.env.${process.env.NODE_ENV}` });

const app = require('../../../app');
const supertest = require('supertest');
const request = supertest(app);

const UserTokensHelper = require('../../../../../Cadence-Brain/src/helper/userTokens');
const {
  CADENCE_TYPES,
  CADENCE_PRIORITY,
  CRM_INTEGRATIONS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const Repository = require('../../../../../Cadence-Brain/src/repository');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

jest.mock('../../../../../Cadence-Brain/src/helper/access-token', () => ({
  getAccessToken: jest
    .fn()
    .mockResolvedValue([
      { access_token: 'dummy_access_token', instance_url: 'localhost' },
      null,
    ]),
}));

jest.mock('../../../../../Cadence-Brain/src/services/Salesforce', () => ({
  createCadence: jest.fn().mockResolvedValue([1, null]),
  deleteCadence: jest.fn().mockResolvedValue([true, null]),
}));

const users = {
  salesPerson: {
    token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMiIsImVtYWlsIjoieml5YW4ua2FybWFsaUBianRtYWlsLmNvbSIsImZpcnN0X25hbWUiOiJaaXlhbiIsInJvbGUiOiJzYWxlc19wZXJzb24iLCJzZF9pZCI6IjQxOTJiZmYwLWUxZTAtNDNjZS1hNGRiLTkxMjgwOGMzMjQ5NSIsImludGVncmF0aW9uX3R5cGUiOiJzYWxlc2ZvcmNlIiwiaWF0IjoxNjcyMjEyNDQ1fQ.4enHZvmaRm3yny1L4C2d3IV0K-nmUhbB732QIhv3xcw',
    userId: '2',
  },
  salesManager: {
    token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMyIsImVtYWlsIjoiYXRtYWRlZXAuZGFzQGJqdG1haWwuY29tIiwiZmlyc3RfbmFtZSI6IkF0bWFkZWVwIiwicm9sZSI6InNhbGVzX21hbmFnZXIiLCJzZF9pZCI6IjQxOTJiZmYwLWUxZTAtNDNjZS1hNGRiLTkxMjgwOGMzMjQ5NSIsImludGVncmF0aW9uX3R5cGUiOiJzYWxlc2ZvcmNlIiwiaWF0IjoxNjcyMjEyNTI0fQ.mp1lTEy0LhWxtyqKgfcXwz_-N2s_ACA8jsZH-gfqKoc',
    userId: '3',
  },
  admin: {
    token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiOCIsImVtYWlsIjoiYWRtaW5AcmluZ292ZXIuY29tIiwiZmlyc3RfbmFtZSI6IkFkbWluIiwicm9sZSI6ImFkbWluIiwic2RfaWQiOiI0MTkyYmZmMC1lMWUwLTQzY2UtYTRkYi05MTI4MDhjMzI0OTUiLCJpbnRlZ3JhdGlvbl90eXBlIjoic2FsZXNmb3JjZSIsImlhdCI6MTY3MjIxMjUzOX0.zxbDMmGGOlIVGDqyei1_xXFAM3tX8KuxEVcSvUpQo5M',
    userId: '8',
  },
  superAdmin: {
    token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNSIsImVtYWlsIjoic3VwZXJhZG1pbkByaW5nb3Zlci5jb20iLCJmaXJzdF9uYW1lIjoiU3VwZXIgQWRtaW4iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJzZF9pZCI6IjQxOTJiZmYwLWUxZTAtNDNjZS1hNGRiLTkxMjgwOGMzMjQ5NSIsImludGVncmF0aW9uX3R5cGUiOiJzYWxlc2ZvcmNlIiwiaWF0IjoxNjcyMjEyNTYyfQ.MKZcWwE1gHy6dGuok-HWIS6E1MIodzNMrHHEPuEvDJM',
    userId: '5',
  },
};

const baseRoute = '/v2/sales/department/cadence';

beforeAll(async () => {
  Object.values(users).forEach(async ({ token, userId }) => {
    await UserTokensHelper.setValidAccessToken(token, userId);
  });
});

describe(`GET ${baseRoute}/task-filter`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/task-filter`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: [],
      msg: 'Fetched cadences for user successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/task-filter`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}/lead-filter`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/lead-filter`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Fetched cadences for user successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/lead-filter`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}`, () => {
  it('should return a list of cadences based on the type specified in the query', async () => {
    const res = await request
      .get(`${baseRoute}`)
      .query({ type: CADENCE_TYPES.PERSONAL, offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Cadences fetched successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a list of cadences based on the type specified in the query', async () => {
    const res = await request
      .get(`${baseRoute}`)
      .query({ type: CADENCE_TYPES.TEAM, offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Cadences fetched successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request
      .get(`${baseRoute}`)
      .query({ type: CADENCE_TYPES.PERSONAL, offset: 0, limit: 10 });

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return a 422 error if the type query parameter is invalid', async () => {
    const res = await request
      .get(`${baseRoute}`)
      .query({ type: 'invalid', offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: '"type" must be one of [personal, team, company, recent]',
    });
    expect(res.statusCode).toBe(422);
  });
});

describe(`GET ${baseRoute}/imports`, () => {
  it('fetches a list of personal cadences', async () => {
    const res = await request
      .get(`${baseRoute}/imports`)
      .query({ type: CADENCE_TYPES.PERSONAL, offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          cadence_id: 3,
          company_id: null,
          name: 'personal cadence 1',
          sd_id: null,
          user_id: '2',
        }),
      ]),
      msg: 'Cadences fetched successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('fetches a list of team cadences', async () => {
    const res = await request
      .get(`${baseRoute}/imports`)
      .query({ type: CADENCE_TYPES.TEAM, offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: [],
      msg: 'No cadences found.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('fetches a list of company cadences', async () => {
    const res = await request
      .get(`${baseRoute}/imports`)
      .query({ type: CADENCE_TYPES.COMPANY, offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: [
        {
          cadence_id: 5,
          company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
          name: 'company cadence 1',
          sd_id: null,
          user_id: '6',
        },
        {
          cadence_id: 6,
          company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
          name: 'company cadence 2',
          sd_id: null,
          user_id: '6',
        },
      ],
      msg: 'Cadences fetched successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request
      .get(`${baseRoute}/imports`)
      .query({ type: CADENCE_TYPES.PERSONAL, offset: 0, limit: 10 });

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return a 422 error if the type query parameter is invalid', async () => {
    const res = await request
      .get(`${baseRoute}/imports`)
      .query({ type: 'invalid', offset: 0, limit: 10 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: '"type" must be one of [personal, team, company, recent]',
    });
    expect(res.statusCode).toBe(422);
  });
});

describe(`GET ${baseRoute}/test-mail-users`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/test-mail-users`)
      .query({
        from: 'cadence',
        cadence_id: 3,
      })
      .auth(users.salesManager.token, { type: 'bearer' });

    expect(res.body).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: expect.anything(),
          first_name: expect.anything(),
          last_name: expect.anything(),
          User_Token: expect.anything(),
        }),
      ]),
      msg: 'Users fetching successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 400 error if the user has no access', async () => {
    const res = await request
      .get(`${baseRoute}/test-mail-users`)
      .query({
        from: 'cadence',
        cadence_id: 3,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: 'You do not have access.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/test-mail-users`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}/allowed-statuses`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/allowed-statuses`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Successfully fetched allowed statuses',
      data: {
        account_integration_status: {
          picklist_values: expect.anything(),
        },
        lead_integration_status: {
          disqualified: expect.anything(),
          name: 'Status',
          picklist_values: expect.anything(),
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/allowed-statuses`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}/:id`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/1`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: {
        cadence_id: 1,
      },
      msg: 'Fetched cadence successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 404 error if it does not exist', async () => {
    const res = await request
      .get(`${baseRoute}/9999999999999999999999`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Cadence not found.',
    });
    expect(res.statusCode).toBe(404);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/1`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}/:cadence_id/stats`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/1/stats`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Fetched leads successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return appropiate object if it does not exist', async () => {
    const res = await request
      .get(`${baseRoute}/9999999999999999999999/stats`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: {
        noOfOwners: 0,
        owners: {},
        totalLeads: 0,
      },
      msg: 'Fetched leads successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/1/stats`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`GET ${baseRoute}/statistics/:cadence_id`, () => {
  it('fetches cadence with given id', async () => {
    const res = await request
      .get(`${baseRoute}/statistics/1`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Fetched statistics.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 404 error if it does not exist', async () => {
    const res = await request
      .get(`${baseRoute}/statistics/9999999999999999999999`)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Cadence not found',
    });
    expect(res.statusCode).toBe(404);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.get(`${baseRoute}/statistics/:cadence_id`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}`, () => {
  const cadence = {
    priority: CADENCE_PRIORITY.HIGH,
    inside_sales: '0',
    integration_type: CRM_INTEGRATIONS.SALESFORCE,
    sd_id: null,
    company_id: null,
  };

  const personalCadence = {
    ...cadence,
    type: CADENCE_TYPES.PERSONAL,
    name: 'test personal cadence 1',
  };

  const teamCadence = {
    ...cadence,
    type: CADENCE_TYPES.TEAM,
    name: 'test team cadence 1',
    sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
  };

  const companyCadence = {
    ...cadence,
    type: CADENCE_TYPES.COMPANY,
    name: 'test company cadence 1',
    company_id: '4192bff0-e1e0-43ce-a4db-912808c32493',
  };

  const cleanUp = async () => {
    const cadenceNamesToCleanUp = [
      personalCadence.name,
      teamCadence.name,
      companyCadence.name,
    ];

    const [cadences, _errCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {
        name: cadenceNamesToCleanUp,
      },
    });

    const cadenceIdsToCleanUp = cadences.map(({ cadence_id }) => cadence_id);

    await Promise.all([
      Repository.destroy({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.NODE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TAG,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
    ]);
  };

  beforeAll(cleanUp);
  afterAll(cleanUp);

  it('creates a new personal cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...personalCadence, user_id: users.salesPerson.userId })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: personalCadence,
      msg: 'Cadence created successfully.',
    });
    expect(res.statusCode).toBe(200);

    expect(SalesforceService.createCadence).lastCalledWith(
      expect.objectContaining(personalCadence),
      expect.anything(),
      expect.anything()
    );
  });

  it('should return 400 if sales person creates team cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...teamCadence, user_id: users.salesPerson.userId })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You do not have access to this functionality.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a new team cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...teamCadence, user_id: users.salesManager.userId })
      .auth(users.salesManager.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: teamCadence,
      msg: 'Cadence created successfully.',
    });
    expect(res.statusCode).toBe(200);

    expect(SalesforceService.createCadence).lastCalledWith(
      expect.objectContaining(teamCadence),
      expect.anything(),
      expect.anything()
    );
  });

  it('should return 400 if sales person creates company cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...companyCadence, user_id: users.salesPerson.userId })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You do not have access to this functionality.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return 400 if sales manager creates company cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...companyCadence, user_id: users.salesManager.userId })
      .auth(users.salesManager.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You do not have access to this functionality.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a new company cadence', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send({ ...companyCadence, user_id: users.admin.userId })
      .auth(users.admin.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: companyCadence,
      msg: 'Cadence created successfully.',
    });
    expect(res.statusCode).toBe(200);

    expect(SalesforceService.createCadence).lastCalledWith(
      expect.objectContaining(companyCadence),
      expect.anything(),
      expect.anything()
    );
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}`).send(companyCadence);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return a 422 error if the type request is invalid', async () => {
    const res = await request
      .post(`${baseRoute}`)
      .send(cadence)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: '"name" is required',
    });
    expect(res.statusCode).toBe(422);
  });
});

describe(`POST ${baseRoute}/duplicate`, () => {
  const duplicate = {
    priority: CADENCE_PRIORITY.STANDARD,
    inside_sales: '1',
    integration_type: CRM_INTEGRATIONS.SALESFORCE,
    sd_id: null,
    company_id: null,
    tags: [
      {
        tag_name: 'inbound',
      },
    ],
  };

  const duplicateAsPersonal = {
    ...duplicate,
    type: CADENCE_TYPES.PERSONAL,
    name: 'personal cadence 1 copy',
  };

  const duplicateAsTeam = {
    ...duplicate,
    type: CADENCE_TYPES.TEAM,
    name: 'team cadence 2 copy',
    sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
  };

  const cleanUp = async () => {
    const cadenceNamesToCleanUp = [
      duplicateAsPersonal.name,
      duplicateAsTeam.name,
    ];

    const [cadences, _errCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {
        name: cadenceNamesToCleanUp,
      },
    });

    const cadenceIdsToCleanUp = cadences.map(({ cadence_id }) => cadence_id);

    await Promise.all([
      Repository.destroy({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.NODE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TAG,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
    ]);
  };

  beforeAll(cleanUp);
  afterAll(cleanUp);

  it('duplicates personal cadence', async () => {
    const res = await request
      .post(`${baseRoute}/duplicate`)
      .send({
        ...duplicateAsPersonal,
        cadence_id: 3,
        user_id: users.salesPerson.userId,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: duplicateAsPersonal,
      msg: 'Cadence created successfully',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return 400 if sales person duplicates team cadence', async () => {
    const res = await request
      .post(`${baseRoute}/duplicate`)
      .send({
        ...duplicateAsTeam,
        cadence_id: 2,
        user_id: users.salesPerson.userId,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You do not have access to this functionality.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('duplicates team cadence', async () => {
    const res = await request
      .post(`${baseRoute}/duplicate`)
      .send({
        ...duplicateAsTeam,
        cadence_id: 2,
        user_id: users.salesManager.userId,
      })
      .auth(users.salesManager.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: duplicateAsTeam,
      msg: 'Cadence created successfully',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request
      .post(`${baseRoute}/duplicate`)
      .send({ ...duplicate, user_id: users.salesPerson.userId });

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}/leads`, () => {
  it('fetches leads', async () => {
    const res = await request
      .post(`${baseRoute}/leads`)
      .send({
        cadence_id: '1',
        limit: 20,
        offset: 0,
        status: null,
        user_id: null,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Fetched leads successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}/leads`).send({
      cadence_id: '1',
      limit: 20,
      offset: 0,
      status: null,
      user_id: null,
    });

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}/share`, () => {
  const cadence = {
    priority: CADENCE_PRIORITY.HIGH,
    inside_sales: '0',
    integration_type: CRM_INTEGRATIONS.SALESFORCE,
    sd_id: null,
    company_id: null,
  };

  const personalCadence = {
    ...cadence,
    type: CADENCE_TYPES.PERSONAL,
    name: 'test personal cadence 1',
  };

  const toShareCadence = {
    ...personalCadence,
    type: CADENCE_TYPES.TEAM,
    name: 'test shared cadence 1',
    sd_id: '4192bff0-e1e0-43ce-a4db-912808c32495',
  };

  let testCadenceId;

  const cleanUp = async () => {
    const cadenceNamesToCleanUp = [personalCadence.name, toShareCadence.name];

    const [cadences, _errCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {
        name: cadenceNamesToCleanUp,
      },
    });

    let cadenceIdsToCleanUp = cadences.map(({ cadence_id }) => cadence_id);

    await Promise.all([
      Repository.destroy({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.NODE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TAG,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
    ]);
  };

  beforeAll(async () => {
    await cleanUp();

    const res = await request
      .post(`${baseRoute}`)
      .send({
        ...personalCadence,
        user_id: users.salesPerson.userId,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    if (res.statusCode === 200) testCadenceId = res.body.data.cadence_id;
  });
  afterAll(cleanUp);

  it('shares cadence with user', async () => {
    const res = await request
      .post(`${baseRoute}/share`)
      .send({
        ...toShareCadence,
        cadence_id: testCadenceId,
        user_id: users.salesManager.userId,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      data: toShareCadence,
      msg: 'Cadence shared successfully',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if shared with same user', async () => {
    const res = await request
      .post(`${baseRoute}/share`)
      .send({
        ...personalCadence,
        name: 'test shared cadence 2',
        cadence_id: testCadenceId,
        user_id: users.salesPerson.userId,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You cannot share a cadence with yourself.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}`).send(personalCadence);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return a 422 error if the type request is invalid', async () => {
    const res = await request
      .post(`${baseRoute}/share`)
      .send(cadence)
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.statusCode).toBe(422);
  });
});

describe(`POST ${baseRoute}/stop-current`, () => {
  it('stops current cadence for lead', async () => {
    const res = await request
      .post(`${baseRoute}/stop-current`)
      .send({
        lead_id: 3,
        cadence_id: 1,
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Stopped cadence successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}/stop-current`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}/pause`, () => {
  it('pauses cadence for leads', async () => {
    const res = await request
      .post(`${baseRoute}/pause`)
      .send({
        cadence_id: 2,
        lead_ids: [1],
        option: 'all',
        status: 'in_progress',
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Paused cadence for leads.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}/pause`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}/stop`, () => {
  it('stops cadence for leads', async () => {
    const res = await request
      .post(`${baseRoute}/stop`)
      .send({
        cadence_id: 2,
        lead_ids: [1],
        option: 'all',
        status: 'in_progress',
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Stopped cadence for leads.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}/stop`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}/reassign/leads`, () => {
  it('reassigns leads', async () => {
    const res = await request
      .post(`${baseRoute}/reassign/leads`)
      .send({
        cadence_id: '1',
        reassignTasksForLeads: true,
        reassignTasksForContacts: true,
        reassignToForLeads: [
          {
            user_id: '3',
            count: '2',
          },
        ],
        reassignToForContacts: [
          {
            user_id: '1',
            count: '1',
          },
          {
            user_id: '3',
            count: '1',
          },
        ],
        leadIds: [],
        contactIds: [],
      })
      .auth(users.salesManager.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Reassignment started, Will be done soon.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 400 error if user has no access', async () => {
    const res = await request
      .post(`${baseRoute}/reassign/leads`)
      .send({
        cadence_id: '1',
        reassignTasksForLeads: true,
        reassignTasksForContacts: true,
        reassignToForLeads: [
          {
            user_id: '3',
            count: '2',
          },
        ],
        reassignToForContacts: [
          {
            user_id: '1',
            count: '1',
          },
          {
            user_id: '3',
            count: '1',
          },
        ],
        leadIds: [],
        contactIds: [],
      })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'You do not have access to this functionality.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.post(`${baseRoute}/reassign/leads`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe(`POST ${baseRoute}`, () => {
  const cadence = {
    priority: CADENCE_PRIORITY.HIGH,
    inside_sales: '0',
    integration_type: CRM_INTEGRATIONS.SALESFORCE,
    sd_id: null,
    company_id: null,
  };

  const personalCadence = {
    ...cadence,
    type: CADENCE_TYPES.PERSONAL,
    name: 'test cadence to delete 1',
    user_id: users.salesPerson.userId,
  };

  const cleanUp = async () => {
    const cadenceNamesToCleanUp = [personalCadence.name];

    const [cadences, _errCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {
        name: cadenceNamesToCleanUp,
      },
    });

    const cadenceIdsToCleanUp = cadences.map(({ cadence_id }) => cadence_id);

    await Promise.all([
      Repository.destroy({
        tableName: DB_TABLES.CADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.NODE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TAG,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.TASK,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
      Repository.destroy({
        tableName: DB_TABLES.LEADTOCADENCE,
        query: { cadence_id: cadenceIdsToCleanUp },
      }),
    ]);
  };

  let testCadenceId;

  beforeAll(async () => {
    await cleanUp();

    const res = await request
      .post(`${baseRoute}`)
      .send(personalCadence)
      .auth(users.salesPerson.token, { type: 'bearer' });

    if (res.statusCode === 200) testCadenceId = res.body.data.cadence_id;
  });
  afterAll(cleanUp);

  it('deletes cadences', async () => {
    const res = await request
      .delete(`${baseRoute}`)
      .send({ cadence_ids: [testCadenceId] })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toMatchObject({
      msg: 'Cadence deleted successfully.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return a 400 error if cadences not found', async () => {
    const res = await request
      .delete(`${baseRoute}`)
      .send({ cadence_ids: [999999999999999] })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: 'Not all the cadences were found.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return a 401 error if the user is not authenticated', async () => {
    const res = await request.delete(`${baseRoute}`);

    expect(res.body).toEqual({
      msg: 'Unauthorized',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return a 422 error if the type request is invalid', async () => {
    const res = await request
      .delete(`${baseRoute}`)
      .send({ cadence_ids: 343 })
      .auth(users.salesPerson.token, { type: 'bearer' });

    expect(res.body).toEqual({
      msg: '"cadence_ids" must be an array',
    });
    expect(res.statusCode).toBe(422);
  });
});
