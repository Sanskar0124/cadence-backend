// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  SALESFORCE_SOBJECTS,
  CRM_INTEGRATIONS,
  HIRING_INTEGRATIONS,
  ZOHO_ENDPOINTS,
  SELLSY_ENDPOINTS,
  PIPEDRIVE_ENDPOINTS,
  HUBSPOT_ENDPOINTS,
  BULLHORN_ENDPOINTS,
  SELLSY_CUSTOM_FIELDS,
  DYNAMICS_ENDPOINTS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

// Joi
const companyFieldSchema = require('../../../joi/v2/admin/company-field-map.joi');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Helper and Services
const SalesforceService = require('../../../../../Cadence-Brain/src/services/Salesforce');
const SalesforceHelper = require('../../../../../Cadence-Brain/src/helper/salesforce');
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const CompanyHelper = require('../../../../../Cadence-Brain/src/helper/company');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');
const SellsyHelper = require('../../../../../Cadence-Brain/src/helper/sellsy');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');

// * Create salesforce field map
const createCompanyMap = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // * Fetch company integration type
    let [user, errFetchingUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['first_name'],
      },
      include: {
        [DB_TABLES.COMPANY]: {
          attributes: ['name', 'integration_type'],
        },
      },
      t,
    });
    if (errFetchingUser) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create company map',
        error: `Error while fetching user: ${errFetchingUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to create company map',
        error: 'User not found',
      });
    }

    let crm_integration = user?.Company.integration_type;
    if (!Object.values(CRM_INTEGRATIONS).includes(crm_integration)) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Invalid CRM Integration. Please contact support',
      });
    }

    // * Use relevant validation scheme
    let body = {};
    switch (crm_integration) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.salesforceCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.pipedriveCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = companyFieldSchema.hubspotCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = companyFieldSchema.zohoCreateFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = companyFieldSchema.sellsyCreateFieldMapSchema.validate(req.body);
        break;
      default:
        t.rollback();
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to create company map',
          error: `Invalid CRM integration`,
        });
    }
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }

    // * Use helper to create relevant field map
    let [_, errCreatingCompanyFieldMap] =
      await CompanyFieldMapHelper.createCompanyFieldMap(
        {
          data: body.value,
          crm_integration,
          user_id: req.user.user_id,
        },
        t
      );
    if (errCreatingCompanyFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create company fieldmap',
        error: `Error while creating company fieldmap: ${errCreatingCompanyFieldMap}`,
      });
    }

    t.commit();
    return successResponse(res, 'Successfully created map');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to update salesforce field map: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating company field map: ${err.message}`,
    });
  }
};

// * Fetch salesforce field map
const fetchCompanyFieldMap = async (req, res) => {
  try {
    // * Helper function to fetch relevant field map
    let [fieldMap, errFieldMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: req.user.user_id,
      });
    if (errFieldMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch field map',
        error: `Error while fetching company field map from user: ${errFieldMap}`,
      });

    return successResponse(res, `Successfully fetched field map`, fieldMap);
  } catch (err) {
    logger.error(
      `An error occurred while trying to fetch salesforce field map: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching Salesforce field map: ${err.message}`,
    });
  }
};

// * Describe object
const describeObject = async (req, res) => {
  try {
    // *  Fetch company integration
    let [integration_type, errFetchingCrmIntegration] =
      await CompanyHelper.getIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to describe object',
        error: `Error while fetching company integration: ${errFetchingCrmIntegration}`,
      });
    // * Validate request
    let params = {};
    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        params = companyFieldSchema.describeSalesforceObjectSchema.validate(
          req.params
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        params = companyFieldSchema.describePipedriveEndpointSchema.validate(
          req.params
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        params = companyFieldSchema.describeHubspotEndpointSchema.validate(
          req.params
        );
        break;
      case CRM_INTEGRATIONS.ZOHO:
        params = companyFieldSchema.describeZohoObjectSchema.validate(
          req.params
        );
        break;
      case CRM_INTEGRATIONS.SELLSY:
        params = companyFieldSchema.describeSellsyEndpointSchema.validate(
          req.params
        );
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        params = companyFieldSchema.describeBullhornObjectSchema.validate(
          req.params
        );
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        params = companyFieldSchema.describeDynamicsEndpointSchema.validate(
          req.params
        );
        break;
    }
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.USER]: {
            attributes: ['integration_id'],
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to describe object',
        error: `Error while fetching CRM Admin: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: integration_type,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Kindly log in with salesforce.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with salesforce',
        });
      if (errForAccessToken === 'Kindly log in with pipedrive.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with pipedrive',
        });
      if (errForAccessToken === 'Kindly log in with hubspot.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with hubspot',
        });
      if (errForAccessToken === 'Kindly log in with zoho.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with zoho',
        });
      if (errForAccessToken === 'Kindly log in with sellsy.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with sellsy',
        });
      if (errForAccessToken === 'Kindly log in with bullhorn.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with bullhorn',
        });
      if (errForAccessToken === 'Kindly log in with dynamics.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask CRM Admin to log in with dynamics.',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to describe object',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    let data, describeError;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
      case CRM_INTEGRATIONS.PIPEDRIVE:
        if (
          req.user.integration_type === CRM_INTEGRATIONS.PIPEDRIVE && // Adding this check since, params value for user sobject is 'user' and PIPEDRIVE_ENDPOINTS.USER also has value 'user', so for both pipedrive and salesforce it was entering this if block
          params.value.object === PIPEDRIVE_ENDPOINTS.USER
        ) {
          [{ data }, describeError] =
            await v2GrpcClients.crmIntegration.getUser({
              integration_type: integration_type,
              integration_data: {
                correlationId: res.correlationId,
                integration_id: 'me',
                access_token,
                instance_url,
              },
            });

          // * Process data to get labels and value
          let objectKeys = Object.keys(data);
          let finalResult = [];

          for (let key of objectKeys) {
            if (typeof data[key] === 'array' || typeof data[key] === 'object')
              continue;

            let name =
              key.charAt(0).toUpperCase() + key.slice(1).split('_').join(' ');

            finalResult.push({
              key: key,
              name,
              field_type: 'varchar',
            });
          }

          data = {
            data: finalResult,
          };
        } else
          [{ data }, describeError] =
            await v2GrpcClients.crmIntegration.describeObject({
              integration_type: integration_type,
              integration_data: JSON.stringify({
                correlationId: res.correlationId,
                object: params.value.object,
                access_token,
                instance_url,
              }),
            });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to describe object',
            error: `Error while fetching describe field integration data via grpc: ${describeError}`,
          });
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        if (params.value.object === HUBSPOT_ENDPOINTS.USER) {
          [data, describeError] = await v2GrpcClients.crmIntegration.getUser({
            integration_type: integration_type,
            integration_data: {
              correlationId: res.correlationId,
              hubspot_owner_id: crmAdmin?.Company_Setting?.User?.integration_id,
              access_token,
              instance_url,
            },
          });

          // * Process data to get labels and value
          let objectKeys = Object.keys(data);
          let finalResult = [];

          for (let key of objectKeys) {
            if (typeof data[key] === 'array' || typeof data[key] === 'object')
              continue;

            let label =
              key.charAt(0).toUpperCase() + key.slice(1).split('_').join(' ');

            finalResult.push({
              name: key,
              label,
              type:
                key === 'createdAt' || key === 'updatedAt'
                  ? 'datetime'
                  : 'string',
            });
          }

          data = {
            results: finalResult,
          };
        } else {
          [data, describeError] =
            await v2GrpcClients.crmIntegration.describeObject({
              integration_type: integration_type,
              integration_data: JSON.stringify({
                correlationId: res.correlationId,
                object: params.value.object,
                access_token,
                instance_url,
              }),
            });
          if (describeError)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to describe object',
              error: `Error while fetching describe field integration data via grpc: ${describeError}`,
            });
        }

        break;
      case CRM_INTEGRATIONS.ZOHO:
        [data, describeError] =
          await v2GrpcClients.crmIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              correlationId: res.correlationId,
              object: params.value.object,
              access_token,
              instance_url,
            }),
          });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to describe object',
            error: `Error while fetching describe field integration data via grpc: ${describeError}`,
          });
        break;
      case CRM_INTEGRATIONS.SELLSY:
        const [customFields, errForCustomFields] =
          await v2GrpcClients.crmIntegration.describeObject({
            integration_type: CRM_INTEGRATIONS.SELLSY,
            integration_data: JSON.stringify({
              correlationId: res.correlationId,
              access_token,
            }),
          });
        if (errForCustomFields)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to describe object',
            error: `Error while fetching custom fields: ${errForCustomFields}`,
          });

        const validCustomFields = customFields.filter((obj) =>
          Object.values(SELLSY_CUSTOM_FIELDS).includes(obj.type)
        );
        data = {};

        switch (params.value.object) {
          case SELLSY_ENDPOINTS.CONTACT:
            data['contact_fields'] = SellsyHelper.describeContactFields;
            data['custom_fields'] = validCustomFields.filter((obj) =>
              obj.related_objects.includes('contact')
            );
            break;
          case SELLSY_ENDPOINTS.COMPANY:
            data = SellsyHelper.describeCompanyFields;
            data['custom_fields'] = validCustomFields.filter((item) => {
              return (
                item.related_objects.includes('prospect') &&
                item.related_objects.includes('client')
              );
            });
            break;
          case SELLSY_ENDPOINTS.USER:
            data = SellsyHelper.describeUserFields;
            break;
          default:
            data = [];
        }
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        [data, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              correlationId: res.correlationId,
              object: params.value.object,
              access_token,
              instance_url,
            }),
          });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to describe object',
            error: `Error while fetching describe field integration data via grpc:  ${describeError}`,
          });
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        [data, describeError] =
          await v2GrpcClients.crmIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              correlationId: res.correlationId,
              object: params.value.object,
              access_token,
              instance_url,
            }),
          });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to describe object',
            error: `Error while fetching describe field of dynamics integration data via grpc: ${describeError}`,
          });
        break;
    }

    return successResponse(res, 'Successfully fetched sObject fields', data);
  } catch (err) {
    logger.error(`An error occurred while trying to describe object: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying to describe object: ${err.message}`,
    });
  }
};

// * Test Salesforce fields
const testSalesforceFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testSalesforceFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test salesforce field map',
        error: `Error while fetching crm integration: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test salesforce field map',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        error: 'Unable to find CRM Admin',
        msg: 'Please set Cadenece Administrator',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: crmIntegration,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with salesforce')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask Salesforce Admin to log in with salesforce',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test salesforce field map',
        error: `Error while fetching tokens for salesforce: ${errForAccessToken}`,
      });
    }

    let first_name;
    let last_name;
    let linkedin_url;
    let job_position;
    let url;
    let size;
    let country;
    let company;
    let zipcode;
    let emails = [];
    let phone_numbers = [];
    let name;
    let phone_number;
    let integration_status;
    let company_phone_number;

    // * Switch for lead and contact
    switch (body.type) {
      case 'lead':
        // * Use salesforce_lead_map to fetch all the data which is supported in our tool from salesforce
        let [lead, errFetchingLead] =
          await SalesforceService.getLeadFromSalesforce(
            body.salesforce_id,
            access_token,
            instance_url
          );
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test salesforce field map',
            error: `Error while fetching lead from salesforce: ${errFetchingLead}`,
          });

        let { salesforce_lead_map } = body;
        // * Decode the lead into the cadence format and send to frontend
        first_name = lead[salesforce_lead_map.first_name];
        last_name = lead[salesforce_lead_map.last_name];
        linkedin_url = lead[salesforce_lead_map.linkedin_url];
        job_position = lead[salesforce_lead_map.job_position];
        url = lead[salesforce_lead_map.url];
        size =
          lead[
            CompanyFieldMapHelper.getCompanySize({
              size: salesforce_lead_map.size,
            })[0]
          ];
        country = lead[salesforce_lead_map.country];
        company = lead[salesforce_lead_map.company];
        zipcode = lead[salesforce_lead_map.zip_code];
        integration_status = lead[salesforce_lead_map.integration_status?.name];
        company_phone_number = lead[salesforce_lead_map.company_phone_number];

        // * Lead emails
        salesforce_lead_map.emails.forEach((email_type) => {
          if (lead[email_type])
            emails.push({
              email_id: lead[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        salesforce_lead_map.phone_numbers.forEach((phone_type) => {
          if (lead[phone_type])
            phone_numbers.push({
              phone_number: lead[phone_type],
              type: phone_type,
            });
        });

        let decodedLead = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          Account: {
            url,
            size,
            country,
            company,
            zipcode,
            phone_number: company_phone_number,
          },
          emails,
          phone_numbers,
          integration_status,
        };

        successResponse(
          res,
          'Successfully tested salesforce lead',
          decodedLead
        );
        break;
      case 'contact':
        // * Use salesforce_contact_map and salesforce_account_map to fetch all the data which is supported in our tool from salesforce
        // * Use salesforce_lead_map to fetch all the data which is supported in our tool from salesforce
        let [contact, errFetchingContact] = await SalesforceService.getContact(
          body.salesforce_id,
          access_token,
          instance_url
        );
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test salesforce field map',
            error: `Error while fetching contact from salesforce: ${errFetchingContact}`,
          });
        let [account, errFetchingAccount] =
          await SalesforceService.getAccountFromSalesforce(
            contact.AccountId,
            access_token,
            instance_url
          );
        if (errFetchingAccount)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test salesforce field map',
            error: `Error while fetching fetching account from salesforce: ${errFetchingAccount}`,
          });

        let { salesforce_contact_map, salesforce_account_map } = body;

        // * Decode the lead into the cadence format and send to frontend
        first_name = contact[salesforce_contact_map.first_name];
        last_name = contact[salesforce_contact_map.last_name];
        linkedin_url = contact[salesforce_contact_map.first_name];
        job_position = contact[salesforce_contact_map.first_name];
        url = account[salesforce_account_map.url];
        size =
          account[
            CompanyFieldMapHelper.getCompanySize({
              size: salesforce_account_map.size,
            })[0]
          ];
        country = account[salesforce_account_map.country];
        name = account[salesforce_account_map.name];
        zipcode = account[salesforce_account_map.zip_code];
        phone_number = account[salesforce_account_map.phone_number];
        integration_status =
          account[salesforce_account_map.integration_status?.name];

        // * Lead emails
        salesforce_contact_map.emails.forEach((email_type) => {
          if (contact[email_type])
            emails.push({
              email_id: contact[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        salesforce_contact_map.phone_numbers.forEach((phone_type) => {
          if (contact[phone_type])
            phone_numbers.push({
              phone_number: contact[phone_type],
              type: phone_type,
            });
        });

        let decodedContact = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          Account: {
            url,
            size,
            country,
            name,
            zipcode,
            phone_number,
            integration_status,
          },
          emails,
          phone_numbers,
        };

        successResponse(
          res,
          'Successfully tested salesforce contact',
          decodedContact
        );
        break;
    }
  } catch (err) {
    logger.error('An error occurred while testing salesforce field map: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing salesforce fieldmap: ${err.message}`,
    });
  }
};

// * Create all salesforce field map
const createAllCrmMap = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // *  Fetch company integration
    let [integration_type, errFetchingCrmIntegration] =
      await CompanyHelper.getIntegrationType(req.user.user_id, t);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create all crm maps',
        error: `Error while fetching crm integration types: ${errFetchingCrmIntegration}`,
      });

    // * Use relevant validation scheme
    let body = {};
    switch (integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.salesforceAllFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.pipedriveAllCreateFieldMapSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = companyFieldSchema.hubspotAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = companyFieldSchema.zohoAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = companyFieldSchema.sellsyAllFieldMapSchema.validate(req.body);
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        body = companyFieldSchema.bullhornAllFieldMapSchema.validate(req.body);
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = companyFieldSchema.dynamicsAllFieldMapSchema.validate(req.body);
        break;
      default:
        t.rollback();
        return notFoundResponseWithDevMsg({
          res,
          eroor: 'Invalid CRM Integration',
          msg: 'Failed to create all crm maps',
        });
    }
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        msg: 'Please check field map fields',
        error: body.error.message,
      });
    }

    // * Use helper to create all field maps
    let [_, errCreatingAllCompanyFieldMap] =
      await CompanyFieldMapHelper.createAllCompanyFieldMap(
        {
          data: body.value,
          integration_type,
          user_id: req.user.user_id,
        },
        t
      );
    if (errCreatingAllCompanyFieldMap) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create all crm maps',
        error: `Error while creating all company field maps: ${errCreatingAllCompanyFieldMap}`,
      });
    }

    t.commit();
    successResponse(res, 'Successfully created all maps');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to create all crm maps: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating all crm maps: ${err.message}`,
    });
  }
};

// * Update relevant custom object (lead/contact)
const createCustomObject = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    // * Use relevant validation scheme
    let body = {};
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.createSalesforceCustomObject.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.createPipedriveCustomObject.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = companyFieldSchema.createHubspotCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = companyFieldSchema.createZohoCustomObject.validate(req.body);
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        body = companyFieldSchema.createBullhornCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = companyFieldSchema.createSellsyCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = companyFieldSchema.createDynamicsCustomObject.validate(req.body);
        break;
      default:
        t.rollback();
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to create custom object',
          error: 'Invalid CRM Integration',
        });
    }
    if (body.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    // * Create custom object
    let [_, errCreatingCustomObject] =
      await CompanyFieldMapHelper.createCompanyCustomObject(
        {
          data: req.body,
          user_id: req.user.user_id,
          crm_integration: req.user.integration_type,
        },
        t
      );

    if (errCreatingCustomObject) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create custom object',
        error: `Error occurred while trying to create custom object: ${errCreatingCustomObject}`,
      });
    }
    t.commit();

    return successResponse(res, 'Successfully created custom object');
  } catch (err) {
    t.rollback();
    logger.error(
      `An error occurred while trying to create custom objects: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error occurred while trying to create custom objects: ${err.message}`,
    });
  }
};

// * Test custom object
const testCustomObject = async (req, res) => {
  try {
    // * Request object validation
    let body = {};
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = companyFieldSchema.testSalesforceCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = companyFieldSchema.testPipedriveCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = companyFieldSchema.testHubspotCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = companyFieldSchema.testZohoCustomObject.validate(req.body);
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        body = companyFieldSchema.testBullhornCustomObject.validate(req.body);
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = companyFieldSchema.testSellsyCustomObject.validate(req.body);
        body.value.company_id = req.user.company_id;
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = companyFieldSchema.testDynamicsCustomObject.validate(req.body);
        break;
      default:
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to test custom object',
          error: 'Invalid CRM Integration',
        });
    }
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    // * Fetch salesforce token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        user_id: req.user.user_id,
        integration_type: req.user.integration_type,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with salesforce')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please log in with salesforce to continue',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test custom object',
        error: `Error while fetching tokens: ${errForAccessToken}`,
      });
    }

    // * Test custom object
    const [customObjectTest, errTestingCustomObject] =
      await CompanyFieldMapHelper.testCustomObject({
        data: body,
        access_token,
        instance_url,
        user_id: req.user.user_id,
        crm_integration: req.user.integration_type,
      });
    if (errTestingCustomObject)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test custom object',
        error: `Error while testing custom object: ${errTestingCustomObject}`,
      });

    return successResponse(res, 'Successfully updated in CRM');
  } catch (err) {
    logger.error(
      `An error occurred while trying to test custom objects: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying to test custom object: ${err.message}`,
    });
  }
};

// * Add support to fetch fields
const getPersonAndOrganizationFromPipedrive = async (req, res) => {
  try {
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch person and organization from Pipedrive',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });

    let [contact, errFetchingContact] =
      await v2GrpcClients.crmIntegration.getContact({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        integration_data: {
          person_id: req.params?.person_id,
          access_token,
          instance_url,
        },
      });
    if (errFetchingContact)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch person and organization from Pipedrive',
        error: `Error while fetching contact: ${errFetchingContact}`,
      });

    // * Fetch organization
    if (contact?.data?.org_id?.value) {
      let [organization, errFetchingOrganization] =
        await v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          integration_data: {
            id: contact.data.org_id.value,
            access_token,
            instance_url,
          },
        });
      if (errFetchingOrganization)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch person and organization from Pipedrive',
          error: `Error while fetching account: ${errFetchingOrganization}`,
        });

      contact.data.org_id = organization.data;
    }

    return successResponse(
      res,
      'Successfully fetched person and organization from Pipedrive',
      contact
    );
  } catch (err) {
    logger.error(
      'An error occurred while fetching person and organization from Pipedrive : ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching person and organization from Pipedrive: ${err.message}`,
    });
  }
};

// * Test Salesforce fields
const testPipedriveFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testPipedriveFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // * Fetch pipedrive token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Pipedrive fieldmap',
        error: `Error while fetching tokens for pipedrive: ${errForAccessToken}.`,
      });

    let decodedLead = {};

    let emails = [];
    let phone_numbers = [];

    // * Fetch person from pipedrive
    let [lead, errFetchingLead] = await v2GrpcClients.crmIntegration.getContact(
      {
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        integration_data: {
          access_token,
          instance_url,
          person_id: body.person_id,
        },
      }
    );
    if (errFetchingLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Pipedrive fieldmap',
        error: `Error while fetching contact: ${errFetchingLead}`,
      });
    if (!lead.success)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `An error while fetching person from pipedrive`,
      });

    lead = lead.data;

    // * Encoding lead
    decodedLead.first_name = lead[body?.person_map?.first_name];
    decodedLead.last_name = lead[body?.person_map?.last_name];
    decodedLead.linkedin_url = lead[body?.person_map?.linkedin_url];
    decodedLead.job_position = lead[body?.person_map?.job_position];
    decodedLead.first_name = lead[body?.person_map?.first_name];
    // * Lead emails
    lead[body?.person_map?.emails].forEach((emailObj) => {
      emails.push({
        email_id: emailObj.value,
        type: emailObj.label,
      });
    });
    // body?.person_map?.emails?.forEach((email_type) => {
    //   // if (Array.isArray(lead[email_type]))

    //   // else emails.push({ email_id: lead[email_type], type: email_type });
    // });
    decodedLead.emails = emails;

    // * Lead phone
    lead[body?.person_map?.phone_numbers].forEach((phoneObj) => {
      phone_numbers.push({
        phone_number: phoneObj.value,
        type: phoneObj.label,
      });
      // body?.person_map?.phone_numbers?.forEach((phone_type) => {
      //   // if (Array.isArray(lead[phone_type]))

      //   });
      // else
      //   phone_numbers.push({
      //     phone_number: lead[phone_type],
      //     type: phone_type,
      //   });
    });
    decodedLead.phone_numbers = phone_numbers;

    if (!lead.org_id)
      return successResponse(
        res,
        'Successfully fetched pipedrive person and organization',
        decodedLead
      );

    let [organization, errFetchingOrganization] =
      await v2GrpcClients.crmIntegration.getAccount({
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        integration_data: {
          id: lead.org_id.value,
          access_token,
          instance_url,
        },
      });

    decodedLead.Account = {
      url: organization?.data?.[body?.organization_map?.url],
      size: organization?.data?.[body?.organization_map?.size?.name],
      country: organization?.data?.[body?.organization_map?.country],
      name: organization?.data?.[body?.organization_map?.name],
      zipcode: organization?.data?.[body?.organization_map?.zip_code],
      phone_number: organization?.data?.[body?.organization_map?.phone_number],
    };

    return successResponse(
      res,
      'Successfully fetched pipedrive person and organization',
      decodedLead
    );
  } catch (err) {
    logger.error('An error occurred while testing salesforce field map: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing Pipedrive fieldmap: ${err.message}`,
    });
  }
};

// * Test Salesforce fields
const testHubspotFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testHubspotFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Hubspot fieldmap',
        error: `Error while fetching crm integration type: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Hubspot fieldmap',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: crmIntegration,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (
        ['Kindly log in to hubspot.', 'Please log in with hubspot'].includes(
          errForAccessToken
        )
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask Hubspot Admin to log in with hubspot',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Hubspot fieldmap',
        error: `Error while fetching tokens for Hubspot: ${errForAccessToken}.`,
      });
    }

    let contact_properties_query = '';
    let [describeData, describeError] =
      await v2GrpcClients.crmIntegration.describeObject({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        integration_data: JSON.stringify({
          object: HUBSPOT_ENDPOINTS.CONTACT,
          access_token,
        }),
      });
    for (let field of describeData.results)
      contact_properties_query = contact_properties_query + `${field.name},`;

    let account_properties_query = '';

    let [describeDataAccount, describeErrorAccount] =
      await v2GrpcClients.crmIntegration.describeObject({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        integration_data: JSON.stringify({
          object: HUBSPOT_ENDPOINTS.COMPANY,
          access_token,
        }),
      });
    for (let field of describeData.results)
      account_properties_query = account_properties_query + `${field.name},`;
    account_properties_query = account_properties_query + 'name,';

    let first_name;
    let last_name;
    let linkedin_url;
    let job_position;
    let emails = [];
    let phone_numbers = [];

    // * Use hubspot_contact_map and hubspot_company_map to fetch all the data which is supported in our tool from salesforce
    let [contact, errFetchingContact] =
      await v2GrpcClients.crmIntegration.getContact({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        integration_data: {
          access_token,
          contact_id: req.body.hsfm_id,
          properties: contact_properties_query,
        },
      });
    if (errFetchingContact)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Hubspot fieldmap',
        error: `Error while fetching contact from Hubspot: ${errFetchingContact}`,
      });
    contact = contact.properties;

    let { hubspot_contact_map } = body;

    first_name = contact[hubspot_contact_map.first_name];
    last_name = contact[hubspot_contact_map.last_name];
    linkedin_url = contact[hubspot_contact_map.linkedin_url];
    job_position = contact[hubspot_contact_map.job_position];

    // * Lead emails
    hubspot_contact_map.emails.forEach((email_type) => {
      if (contact[email_type])
        emails.push({
          email_id: contact[email_type],
          type: email_type,
        });
    });
    // * Phone numbers
    hubspot_contact_map.phone_numbers.forEach((phone_type) => {
      if (contact[phone_type])
        phone_numbers.push({
          phone_number: contact[phone_type],
          type: phone_type,
        });
    });

    let decodedContact = {
      first_name,
      last_name,
      linkedin_url,
      job_position,
      emails,
      phone_numbers,
    };

    let decodedAccount = {};
    if (contact.associatedcompanyid) {
      let [account, errFetchingAccount] =
        await v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            company_id: contact.associatedcompanyid,
            properties: account_properties_query,
          },
        });
      if (errFetchingAccount === 'Account not found.') {
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to test Hubspot fieldmap',
          error: `Error while fetching account from Hubspot: ${errFetchingAccount}`,
        });
      }

      if (account) {
        let { hubspot_company_map } = body;

        account = account.properties;

        //* Decode the lead into the cadence format and send to frontend
        decodedAccount.name = account[hubspot_company_map.name];
        decodedAccount.url = account[hubspot_company_map.url];
        decodedAccount.size = account[hubspot_company_map.size];
        decodedAccount.country = account[hubspot_company_map.country];
        decodedAccount.zipcode = account[hubspot_company_map.zip_code];
        decodedAccount.phone_number = account[hubspot_company_map.phone_number];
        decodedAccount.integration_status =
          account[hubspot_company_map.integration_status?.name];
      }
    }

    return successResponse(res, 'Successfully tested hubspot contact', {
      decodedContact,
      decodedAccount,
    });
  } catch (err) {
    logger.error('An error occurred while testing hubspot field map: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing Hubspot fieldmap: ${err.message}`,
    });
  }
};

const getContactAndCompanyFromHubspot = async (req, res) => {
  // * JOI Validation
  let body = companyFieldSchema.testHubspotObject.validate(req.body);
  if (body.error)
    return unprocessableEntityResponseWithDevMsg({
      res,
      error: body.error.message,
    });
  body = body.value;

  try {
    let [{ access_token }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contact and company from Hubspot',
        error: `Error while fetching Hubspot access token: ${errFetchingAccessToken}`,
      });

    let contact_properties_query = '';
    let [describeData, describeError] =
      await v2GrpcClients.crmIntegration.describeObject({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        integration_data: JSON.stringify({
          object: HUBSPOT_ENDPOINTS.CONTACT,
          access_token,
        }),
      });

    for (let field of describeData.results)
      contact_properties_query = contact_properties_query + `${field.name},`;

    let [contact, errFetchingContact] =
      await v2GrpcClients.crmIntegration.getContact({
        integration_type: CRM_INTEGRATIONS.HUBSPOT,
        integration_data: {
          contact_id: req.params?.contact_id,
          access_token,
          properties: contact_properties_query,
        },
      });
    if (errFetchingContact)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contact and company from Hubspot',
        error: `Error while fetching contact from Hubspot: ${errFetchingContact}`,
      });

    // * Fetch company
    if (contact?.properties?.associatedcompanyid) {
      let account_properties_query = '';

      let [describeDataAccount, describeErrorAccount] =
        await v2GrpcClients.crmIntegration.describeObject({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: JSON.stringify({
            object: HUBSPOT_ENDPOINTS.COMPANY,
            access_token,
          }),
        });
      for (let field of describeData.results)
        account_properties_query = account_properties_query + `${field.name},`;
      account_properties_query = account_properties_query + 'name,';

      let [company, errForCompany] =
        await v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            company_id: contact?.properties?.associatedcompanyid,
            access_token,
            properties: account_properties_query,
          },
        });
      if (errForCompany)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch contact and company from Hubspot',
          error: `Error while fecthing Hubspot account: ${errForCompany}`,
        });

      contact.properties.associatedcompany = company.properties;
    }

    return successResponse(
      res,
      'Successfully fetched contact and company from Hubspot',
      contact
    );
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact and company from Hubspot : ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching contact and company from Hubspot: ${err.message}`,
    });
  }
};

// * Test Sellsy fields
const testSellsyFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testSellsyFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching integration type: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errForCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errForCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching crm admin: ${errForCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: crmIntegration,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Please ask your CRM admin to connect with Sellsy',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });

    let [contact, errFetchingContact] =
      await v2GrpcClients.crmIntegration.getContact({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        integration_data: {
          access_token,
          contact_id: req.body.contact_id,
        },
      });
    if (errFetchingContact) {
      logger.error(
        'Error while fetching contact from sellsy: ',
        errFetchingContact
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching contact from Sellsy: ${errFetchingContact}`,
      });
    }

    let [decodedContact, errForDecodedContact] = SellsyHelper.mapSellsyField(
      contact,
      body.contact_map
    );
    if (errForDecodedContact)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while mapping contact fields: ${errForDecodedContact}`,
      });

    let [company, errFetchingCompany] =
      await v2GrpcClients.crmIntegration.getAccount({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        integration_data: {
          access_token,
          contact_id: req.body.contact_id,
        },
      });
    if (errFetchingCompany) {
      logger.error(
        'Error while fetching account from sellsy: ',
        errFetchingCompany
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching account from Sellsy: ${errFetchingCompany}`,
      });
    }

    if (company) {
      let [fieldSchema, errForFieldSchema] = SellsyHelper.companyFieldSchema(
        body.company_map
      );
      if (errForFieldSchema)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch Sellsy fields.',
          error: `Error while mapping company fields: ${errForFieldSchema}`,
        });

      let [companyField, errForCompanyField] = SellsyHelper.mapSellsyField(
        company,
        fieldSchema
      );
      if (errForCompanyField)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch Sellsy fields.',
          error: `Error while mapping company fields: ${errForCompanyField}`,
        });

      let accountAddresses, errForAccountAddresses;
      [accountAddresses, errForAccountAddresses] =
        await v2GrpcClients.crmIntegration.getAccount({
          integration_type: CRM_INTEGRATIONS.SELLSY,
          integration_data: {
            access_token,
            company_id: company.id,
            isAddresses: true,
          },
        });
      if (errForAccountAddresses) accountAddresses = [];

      companyField.addresses = accountAddresses;
      decodedContact.account = companyField;
    }

    return successResponse(
      res,
      'Successfully fetched contact from Sellsy',
      decodedContact
    );
  } catch (err) {
    logger.error('An error occurred while testing sellsy field map: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying sellsy field map: ${err.message}`,
    });
  }
};

const getContactAndAccountFromSellsy = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testSellsyObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching CRM Integration: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching CRM Admin: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: crmIntegration,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });

    let [contact, errForContact] = await SellsyHelper.getCustomFields({
      access_token,
      body,
    });
    if (errForContact) {
      logger.error(
        'Error while fetching custom contact fields from sellsy: ',
        errForContact
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch Sellsy fields.',
        error: `Error while fetching custom contact fields from Sellsy: ${errForContact}`,
      });
    }

    return successResponse(res, contact);
  } catch (err) {
    logger.error('An error occurred while testing sellsy custom field: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing sellsy custom field: ${err.message}`,
    });
  }
};

const testZohoFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testZohoFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [crmIntegration, errFetchingCrmIntegration] =
      await CompanyHelper.getCrmIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Zoho fieldmap',
        error: `Error while fetching crm integration type: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Zoho fieldmap',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: crmIntegration,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with zoho')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask Zoho Admin to log in with zoho',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Zoho fieldmap',
        error: `Error while fetching tokens for zoho: ${errForAccessToken}.`,
      });
    }

    let first_name;
    let last_name;
    let linkedin_url;
    let job_position;
    let url;
    let size;
    let country;
    let company;
    let zipcode;
    let emails = [];
    let phone_numbers = [];
    let name;
    let phone_number;

    // * Switch for lead and contact
    switch (body.type) {
      case ZOHO_ENDPOINTS.LEAD:
        // * Use zoho_lead_map to fetch all the data which is supported in our tool from salesforce
        let [lead, errFetchingLead] =
          await v2GrpcClients.crmIntegration.getLead({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              access_token,
              lead_id: req.body.zfm_id,
              instance_url,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Zoho fieldmap',
            error: `Error while fetching lead from zoho: ${errFetchingLead}`,
          });

        let { zoho_lead_map } = body;
        // * Decode the lead into the cadence format and send to frontend
        first_name = lead[zoho_lead_map.first_name];
        last_name = lead[zoho_lead_map.last_name];
        linkedin_url = lead[zoho_lead_map.linkedin_url];
        job_position = lead[zoho_lead_map.job_position];
        url = lead[zoho_lead_map.url];
        size =
          lead[
            CompanyFieldMapHelper.getCompanySize({
              size: zoho_lead_map.size,
            })[0]
          ];
        country = lead[zoho_lead_map.country];
        company = lead[zoho_lead_map.company];
        zipcode = lead[zoho_lead_map.zip_code];

        // * Lead emails
        zoho_lead_map.emails.forEach((email_type) => {
          if (lead[email_type])
            emails.push({
              email_id: lead[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        zoho_lead_map.phone_numbers.forEach((phone_type) => {
          if (lead[phone_type])
            phone_numbers.push({
              phone_number: lead[phone_type],
              type: phone_type,
            });
        });

        let decodedLead = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          Account: {
            url,
            size,
            country,
            company,
            zipcode,
          },
          emails,
          phone_numbers,
        };

        successResponse(res, 'Successfully tested zoho lead', decodedLead);
        break;
      case ZOHO_ENDPOINTS.CONTACT:
        // * Use zoho_contact_map and salesforce_account_map to fetch all the data which is supported in our tool from zoho
        // * Use zoho_lead_map to fetch all the data which is supported in our tool from zoho
        let [contact, errFetchingContact] =
          await v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              access_token,
              instance_url,
              contact_id: req.body.zfm_id,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Zoho fieldmap',
            error: `Error while fetching contact from zoho: ${errFetchingContact}`,
          });
        let decodedAccount = {};
        if (contact?.Account_Name?.id) {
          let [account, errFetchingAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                access_token,
                instance_url,
                account_id: contact.Account_Name.id,
              },
            });
          if (errFetchingAccount === 'Account not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to test Zoho fieldmap',
              error: `Error while fetching account from zoho: ${errFetchingAccount}`,
            });
          }
          if (account) {
            let { zoho_account_map } = body;
            url = account[zoho_account_map.url];
            size =
              account[
                CompanyFieldMapHelper.getCompanySize({
                  size: zoho_account_map.size,
                })[0]
              ];
            country = account[zoho_account_map.country];
            name = account[zoho_account_map.name];
            zipcode = account[zoho_account_map.zip_code];
            phone_number = account[zoho_account_map.phone_number];
            decodedAccount = {
              url,
              size,
              country,
              name,
              zipcode,
              phone_number,
            };
          }
        }

        let { zoho_contact_map } = body;

        // * Decode the lead into the cadence format and send to frontend
        first_name = contact[zoho_contact_map.first_name];
        last_name = contact[zoho_contact_map.last_name];
        linkedin_url = contact[zoho_contact_map.linkedin_url];
        job_position = contact[zoho_contact_map.job_position];
        // * Lead emails
        zoho_contact_map.emails.forEach((email_type) => {
          if (contact[email_type])
            emails.push({
              email_id: contact[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        zoho_contact_map.phone_numbers.forEach((phone_type) => {
          if (contact[phone_type])
            phone_numbers.push({
              phone_number: contact[phone_type],
              type: phone_type,
            });
        });

        let decodedContact = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          emails,
          phone_numbers,
        };

        successResponse(res, 'Successfully tested zoho contact', {
          decodedContact,
          decodedAccount,
        });
        break;
    }
  } catch (err) {
    logger.error('An error occurred while testing zoho field map: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing Zoho fieldmap: ${err.message}`,
    });
  }
};

const getLeadOrContactFromZoho = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testZohoObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.ZOHO,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead or contact from Zoho',
        error: `Error while fetching access token for Zoho: ${errFetchingAccessToken}`,
      });
    switch (body.type) {
      case ZOHO_ENDPOINTS.LEAD:
        let [lead, errFetchingLead] =
          await v2GrpcClients.crmIntegration.getLead({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              access_token,
              lead_id: req.body.id,
              instance_url,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead',
            error: `Error while fetching fetching lead from Zoho: ${errFetchingLead}`,
          });
        return successResponse(
          res,
          'Successfully fetched lead from Zoho',
          lead
        );
        break;
      case ZOHO_ENDPOINTS.CONTACT:
        let [contact, errFetchingContact] =
          await v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.ZOHO,
            integration_data: {
              access_token,
              instance_url,
              contact_id: req.body.id,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching fetching contact from Zoho: ${errFetchingContact}`,
          });
        if (contact?.Account_Name?.id) {
          let [account, errFetchingAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.ZOHO,
              integration_data: {
                access_token,
                instance_url,
                account_id: contact.Account_Name.id,
              },
            });
          if (errFetchingAccount === 'Account not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch account',
              error: `Error while fetching fetching account from zoho: ${errFetchingAccount}`,
            });
          }
          return successResponse(
            res,
            'Successfully fetched contact and company from Zoho',
            {
              contact,
              account,
            }
          );
        }

        return successResponse(
          res,
          'Successfully fetched contact and company from Zoho',
          contact
        );
        break;
    }
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact and company from Zoho : ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `An error occurred while fetching contact and company from Zoho: ${err.message}`,
    });
  }
};

const testBullhornFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testBullhornFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    // *  Fetch company integration
    let [integration_type, errFetchingCrmIntegration] =
      await CompanyHelper.getIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Bullhorn fieldmap',
        error: `Error while fetching integration type: ${errFetchingCrmIntegration}`,
      });

    // * Fetch CRM admin of the company
    const [hiringAdmin, errHiringAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errHiringAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Bullhorn fieldmap',
        error: `Error while fetching company: ${errHiringAdmin}`,
      });

    let hiringAdminUserId = hiringAdmin?.Company_Setting?.user_id;
    if (!hiringAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find Hiring Admin',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: integration_type,
        user_id: hiringAdminUserId,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with bullhorn')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask Hiring Admin to log in with bullhorn',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test Bullhorn fieldmap',
        error: `Error while fetching tokens for Bullhorn: ${errForAccessToken}.`,
      });
    }

    let first_name;
    let last_name;
    let linkedin_url;
    let job_position;
    let url;
    let size;
    let country;
    let company;
    let zipcode;
    let emails = [];
    let phone_numbers = [];
    let name;
    let phone_number;
    let decodedAccount = {};
    let integration_status;
    let account_integration_status;

    // * Switch for lead and contact
    switch (body.type) {
      case BULLHORN_ENDPOINTS.LEAD:
        // * Use bullhorn_lead_map to fetch all the data which is supported in our tool from bullhorn
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.LEAD,
              access_token,
              instance_url,
            }),
          });
        let lead_fields = '';
        for (let field of describeData.fields)
          lead_fields = lead_fields + `${field.name},`;
        lead_fields = lead_fields.slice(0, lead_fields.length - 1);
        let [lead, errFetchingLead] =
          await v2GrpcClients.hiringIntegration.getLead({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              lead_id: req.body.bfm_id,
              instance_url,
              fields: lead_fields,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Bullhorn fieldmap',
            error: `Error while fetching lead from Bullhorn: ${errFetchingLead}`,
          });
        if (lead?.clientCorporation?.id) {
          [describeData, describeError] =
            await v2GrpcClients.hiringIntegration.describeObject({
              integration_type: integration_type,
              integration_data: JSON.stringify({
                object: BULLHORN_ENDPOINTS.CORPORATION,
                access_token,
                instance_url,
              }),
            });
          let account_fields = '';
          for (let field of describeData.fields)
            account_fields = account_fields + `${field.name},`;
          account_fields = account_fields.slice(0, account_fields.length - 1);
          let [account, errFetchingAccount] =
            await v2GrpcClients.hiringIntegration.getAccount({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                access_token,
                instance_url,
                corporation_id: lead?.clientCorporation?.id,
                fields: account_fields,
              },
            });
          if (errFetchingAccount === 'Account not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to test Bullhorn fieldmap',
              error: `Error while fetching account from Bullhorn: ${errFetchingAccount}`,
            });
          }
          if (account) {
            let { bullhorn_account_map } = body;
            url = account[bullhorn_account_map.url];
            size =
              account[
                CompanyFieldMapHelper.getCompanySize({
                  size: bullhorn_account_map.size,
                })[0]
              ];
            country = account?.address?.countryName;
            name = account[bullhorn_account_map.name];
            zipcode = account?.address?.zip;
            phone_number = account[bullhorn_account_map.phone_number];
            account_integration_status =
              account[bullhorn_account_map.integration_status?.name];

            decodedAccount = {
              url,
              size,
              country,
              name,
              zipcode,
              phone_number,
              integration_status: account_integration_status,
            };
          }
        }

        let { bullhorn_lead_map } = body;
        // * Decode the lead into the cadence format and send to frontend
        first_name = lead[bullhorn_lead_map.first_name];
        last_name = lead[bullhorn_lead_map.last_name];
        linkedin_url = lead[bullhorn_lead_map.linkedin_url];
        job_position = lead[bullhorn_lead_map.job_position];
        integration_status = lead[bullhorn_lead_map.integration_status?.name];

        // * Lead emails
        bullhorn_lead_map.emails.forEach((email_type) => {
          if (lead[email_type])
            emails.push({
              email_id: lead[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        bullhorn_lead_map.phone_numbers.forEach((phone_type) => {
          if (lead[phone_type])
            phone_numbers.push({
              phone_number: lead[phone_type],
              type: phone_type,
            });
        });

        let decodedLead = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          Account: decodedAccount,
          emails,
          phone_numbers,
          integration_status,
        };

        successResponse(res, 'Successfully tested bullhorn lead', decodedLead);
        break;
      case BULLHORN_ENDPOINTS.CONTACT:
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.CONTACT,
              access_token,
              instance_url,
            }),
          });
        let contact_fields = '';
        for (let field of describeData.fields)
          contact_fields = contact_fields + `${field.name},`;
        contact_fields = contact_fields.slice(0, contact_fields.length - 1);
        // * Use bullhorn_contact_map and salesforce_account_map to fetch all the data which is supported in our tool from bullhorn
        // * Use bullhorn_account_map to fetch all the data which is supported in our tool from bullhorn
        let [contact, errFetchingContact] =
          await v2GrpcClients.hiringIntegration.getContact({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              instance_url,
              contact_id: req.body.bfm_id,
              fields: contact_fields,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Bullhorn fieldmap',
            error: `Error while fetching contact from Bullhorn: ${errFetchingContact}`,
          });
        if (contact?.clientCorporation?.id) {
          [describeData, describeError] =
            await v2GrpcClients.hiringIntegration.describeObject({
              integration_type: integration_type,
              integration_data: JSON.stringify({
                object: BULLHORN_ENDPOINTS.CORPORATION,
                access_token,
                instance_url,
              }),
            });
          let account_fields = '';
          for (let field of describeData.fields)
            account_fields = account_fields + `${field.name},`;
          account_fields = account_fields.slice(0, account_fields.length - 1);
          let [account, errFetchingAccount] =
            await v2GrpcClients.hiringIntegration.getAccount({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                access_token,
                instance_url,
                corporation_id: contact?.clientCorporation?.id,
                fields: account_fields,
              },
            });
          if (errFetchingAccount === 'Account not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to test Bullhorn fieldmap',
              error: `Error while fetching account from Bullhorn: ${errFetchingAccount}`,
            });
          }
          if (account) {
            let { bullhorn_account_map } = body;
            url = account[bullhorn_account_map.url];
            size =
              account[
                CompanyFieldMapHelper.getCompanySize({
                  size: bullhorn_account_map.size,
                })[0]
              ];
            country = account?.address?.ccountryName;
            name = account[bullhorn_account_map.name];
            zipcode = account?.address?.zip;
            phone_number = account[bullhorn_account_map.phone_number];
            account_integration_status =
              account[bullhorn_account_map.integration_status?.name];

            decodedAccount = {
              url,
              size,
              country,
              name,
              zipcode,
              phone_number,
              integration_status: account_integration_status,
            };
          }
        }

        let { bullhorn_contact_map } = body;

        // * Decode the lead into the cadence format and send to frontend
        first_name = contact[bullhorn_contact_map.first_name];
        last_name = contact[bullhorn_contact_map.last_name];
        linkedin_url = contact[bullhorn_contact_map.linkedin_url];
        job_position = contact[bullhorn_contact_map.job_position];
        integration_status =
          contact[bullhorn_contact_map.integration_status?.name];
        // * Lead emails
        bullhorn_contact_map.emails.forEach((email_type) => {
          if (contact[email_type])
            emails.push({
              email_id: contact[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        bullhorn_contact_map.phone_numbers.forEach((phone_type) => {
          if (contact[phone_type])
            phone_numbers.push({
              phone_number: contact[phone_type],
              type: phone_type,
            });
        });

        let decodedContact = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          emails,
          phone_numbers,
          integration_status,
        };

        successResponse(res, 'Successfully tested bullhorn contact', {
          decodedContact,
          decodedAccount,
        });
        break;
      case BULLHORN_ENDPOINTS.CANDIDATE:
        // * Use bullhorn_candidate_map to fetch all the data which is supported in our tool from bullhorn
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.CANDIDATE,
              access_token,
              instance_url,
            }),
          });
        let candidate_fields = '';
        for (let field of describeData.fields) {
          if (field.name == 'shifts') continue;
          candidate_fields = candidate_fields + `${field.name},`;
        }
        candidate_fields = candidate_fields.slice(
          0,
          candidate_fields.length - 1
        );
        let [candidate, errFetchingCandidate] =
          await v2GrpcClients.hiringIntegration.getCandidate({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              candidate_id: req.body.bfm_id,
              instance_url,
              fields: candidate_fields,
            },
          });
        if (errFetchingCandidate)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Bullhorn fieldmap',
            error: `Error while fetching candidate from Bullhorn: ${errFetchingCandidate}`,
          });

        let { bullhorn_candidate_map } = body;
        // * Decode the lead into the cadence format and send to frontend
        first_name = candidate[bullhorn_candidate_map.first_name];
        last_name = candidate[bullhorn_candidate_map.last_name];
        linkedin_url = candidate[bullhorn_candidate_map.linkedin_url];
        job_position = candidate[bullhorn_candidate_map.job_position];
        url = candidate[bullhorn_candidate_map.url];
        size =
          candidate[
            CompanyFieldMapHelper.getCompanySize({
              size: bullhorn_candidate_map.size,
            })[0]
          ];
        country = candidate?.address?.countryName;
        company = candidate[bullhorn_candidate_map.company];
        zipcode = candidate?.address?.zip;
        integration_status =
          candidate[bullhorn_candidate_map.integration_status?.name];

        // * Lead emails
        bullhorn_candidate_map.emails.forEach((email_type) => {
          if (candidate[email_type])
            emails.push({
              email_id: candidate[email_type],
              type: email_type,
            });
        });
        // * Phone numbers
        bullhorn_candidate_map.phone_numbers.forEach((phone_type) => {
          if (candidate[phone_type])
            phone_numbers.push({
              phone_number: candidate[phone_type],
              type: phone_type,
            });
        });

        let decodedCandidate = {
          first_name,
          last_name,
          linkedin_url,
          job_position,
          integration_status,
          Account: {
            url,
            size,
            country,
            company,
            zipcode,
            integration_status,
          },
          emails,
          phone_numbers,
        };

        successResponse(
          res,
          'Successfully tested bullhorn candidate',
          decodedCandidate
        );
        break;
    }
  } catch (err) {
    logger.error('An error occurred while testing bullhorn field map: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing Bullhorn fieldmap: ${err.message}`,
    });
  }
};

const getLeadOrContactOrCandidateFromBullhorn = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testBullhornObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;
    let [{ access_token, instance_url }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: HIRING_INTEGRATIONS.BULLHORN,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });
    switch (body.type) {
      case BULLHORN_ENDPOINTS.LEAD:
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.LEAD,
              access_token,
              instance_url,
            }),
          });
        let lead_fields = '';
        for (let field of describeData.fields)
          lead_fields = lead_fields + `${field.name},`;
        lead_fields = lead_fields.slice(0, lead_fields.length - 1);
        let [lead, errFetchingLead] =
          await v2GrpcClients.hiringIntegration.getLead({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              lead_id: req.body.id,
              instance_url,
              fields: lead_fields,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
            error: `Error while fetching lead from Bullhorn: ${errFetchingLead}`,
          });
        if (lead?.clientCorporation?.id) {
          [describeData, describeError] =
            await v2GrpcClients.hiringIntegration.describeObject({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: JSON.stringify({
                object: BULLHORN_ENDPOINTS.CORPORATION,
                access_token,
                instance_url,
              }),
            });
          let account_fields = '';
          for (let field of describeData.fields)
            account_fields = account_fields + `${field.name},`;
          account_fields = account_fields.slice(0, account_fields.length - 1);
          let [account, errFetchingAccount] =
            await v2GrpcClients.hiringIntegration.getAccount({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                access_token,
                instance_url,
                corporation_id: lead?.clientCorporation?.id,
                fields: account_fields,
              },
            });
          if (errFetchingAccount === 'Corporation not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
              error: `Error while fetching corporation from Bullhorn: ${errFetchingAccount}`,
            });
          }
          return successResponse(
            res,
            'Successfully fetched lead and company from Bullhorn',
            {
              lead,
              account,
            }
          );
        }
        return successResponse(
          res,
          'Successfully fetched lead from Bullhorn',
          lead
        );
        break;
      case BULLHORN_ENDPOINTS.CANDIDATE:
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.CANDIDATE,
              access_token,
              instance_url,
            }),
          });
        let candidate_fields = '';
        for (let field of describeData.fields) {
          if (field.name == 'shifts') continue;
          candidate_fields = candidate_fields + `${field.name},`;
        }
        candidate_fields = candidate_fields.slice(
          0,
          candidate_fields.length - 1
        );
        let [candidate, errFetchingCandidate] =
          await v2GrpcClients.hiringIntegration.getCandidate({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              candidate_id: req.body.id,
              instance_url,
              fields: candidate_fields,
            },
          });
        if (errFetchingCandidate)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
            error: `Error while fetching candidate from Bullhorn: ${errFetchingCandidate}`,
          });
        return successResponse(
          res,
          'Successfully fetched candidate from Bullhorn',
          candidate
        );
        break;
      case BULLHORN_ENDPOINTS.CONTACT:
        [describeData, describeError] =
          await v2GrpcClients.hiringIntegration.describeObject({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: JSON.stringify({
              object: BULLHORN_ENDPOINTS.CONTACT,
              access_token,
              instance_url,
            }),
          });
        let contact_fields = '';
        for (let field of describeData.fields)
          contact_fields = contact_fields + `${field.name},`;
        contact_fields = contact_fields.slice(0, contact_fields.length - 1);
        let [contact, errFetchingContact] =
          await v2GrpcClients.hiringIntegration.getContact({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              instance_url,
              contact_id: req.body.id,
              fields: contact_fields,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
            error: `Error while fetching contact from Bullhorn: ${errFetchingContact}`,
          });
        if (contact?.clientCorporation?.id) {
          [describeData, describeError] =
            await v2GrpcClients.hiringIntegration.describeObject({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: JSON.stringify({
                object: BULLHORN_ENDPOINTS.CORPORATION,
                access_token,
                instance_url,
              }),
            });
          let account_fields = '';
          for (let field of describeData.fields)
            account_fields = account_fields + `${field.name},`;
          account_fields = account_fields.slice(0, account_fields.length - 1);
          let [account, errFetchingAccount] =
            await v2GrpcClients.hiringIntegration.getAccount({
              integration_type: HIRING_INTEGRATIONS.BULLHORN,
              integration_data: {
                access_token,
                instance_url,
                corporation_id: contact?.clientCorporation?.id,
                fields: account_fields,
              },
            });
          if (errFetchingAccount === 'Corporation not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
              error: `Error while fetching corporation from Bullhorn: ${errFetchingAccount}`,
            });
          }
          return successResponse(
            res,
            'Successfully fetched contact and company from Bullhorn',
            {
              contact,
              account,
            }
          );
        }
        return successResponse(
          res,
          'Successfully fetched contact and company from Zoho',
          contact
        );
        break;
    }
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact and company from Bullhorn : ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead or contact or candidate from Bullhorn: ${err.message}`,
    });
  }
};

// * Test Dynamics fields
const testDynamicsFieldMap = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testDynamicsFieldMap.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;

    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test salesforce field map',
        error: `Error while fetching company: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        error: 'Unable to find CRM Admin',
        msg: 'Please set Cadenece Administrator',
      });

    // * Fetch access token  token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.DYNAMICS,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with dynamics')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please ask Dynamics Admin to log in with dynamics',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to test dynamics field map',
        error: `Error while fetching tokens for dynamics: ${errForAccessToken}`,
      });
    }

    let decodedData = {};
    let emails = [];
    let phone_numbers = [];

    // * Switch for lead and contact
    switch (body.type) {
      case 'lead':
        let [lead, errFetchingLead] =
          await v2GrpcClients.crmIntegration.getLead({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            integration_data: {
              access_token,
              dynamics_lead_id: body.dynamics_id,
              instance_url,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Dynamics fieldmap',
            error: `Error while fetching lead: ${errFetchingLead}`,
          });

        let { lead_map } = body;
        // * Decode the lead into the cadence format and send to frontend
        decodedData.first_name = lead[lead_map.first_name];
        decodedData.last_name = lead[lead_map.last_name];
        decodedData.linkedin_url = lead[lead_map.linkedin_url];
        decodedData.job_position = lead[lead_map.job_position];
        decodedData.account = lead[lead_map.account];
        decodedData.url = lead[lead_map.url];
        decodedData.size =
          lead[
            CompanyFieldMapHelper.getCompanySize({
              size: lead_map.size,
            })[0]
          ];
        decodedData.country = lead[lead_map.country];
        decodedData.zipcode = lead[lead_map.zip_code];
        decodedData.account_phone_number = lead[lead_map.account_phone_number];

        // * Lead emails
        lead_map.emails.forEach((email_type) => {
          if (lead[email_type])
            emails.push({
              email_id: lead[email_type],
              type: email_type,
            });
        });
        decodedData.emails = emails;

        // * Phone numbers
        lead_map.phone_numbers.forEach((phone_type) => {
          if (lead[phone_type])
            phone_numbers.push({
              phone_number: lead[phone_type],
              type: phone_type,
            });
        });
        decodedData.phone_numbers = phone_numbers;

        successResponse(res, 'Successfully tested dynamics lead', decodedData);
        break;
      case 'contact':
        const [contact, errForContact] =
          await v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            integration_data: {
              access_token,
              dynamics_contact_id: body.dynamics_id,
              instance_url,
            },
          });
        if (errForContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to test Dynamics fieldmap',
            error: `Error while fetching contact from dynamics: ${errForContact}`,
          });

        let account, errForAccount;
        if (contact?._parentcustomerid_value?.length) {
          [account, errForAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                access_token,
                dynamics_account_id: contact?._parentcustomerid_value,
                instance_url,
              },
            });
          if (errForAccount)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to test Dynamics fieldmap',
              error: `Error while fetching account from dynamics: ${errForAccount}`,
            });
        }

        let { contact_map, account_map } = body;

        // * Decode the lead into the cadence format and send to frontend
        decodedData.first_name = contact[contact_map.first_name];
        decodedData.last_name = contact[contact_map.last_name];
        decodedData.linkedin_url = contact[contact_map.linkedin_url];
        decodedData.job_position = contact[contact_map.job_position];
        if (contact?._parentcustomerid_value?.length)
          decodedData.Account = {
            name: account[account_map.name],
            size: account[
              CompanyFieldMapHelper.getCompanySize({
                size: account_map.size,
              })[0]
            ],
            url: account[account_map.url],
            country: account[account_map.country],
            zip_code: account[account_map.zip_code],
            phone_number: account[account_map.phone_number],
          };
        else decodedData.Account = null;
        // * Lead emails
        contact_map.emails.forEach((email_type) => {
          if (contact[email_type])
            emails.push({
              email_id: contact[email_type],
              type: email_type,
            });
        });
        decodedData.emails = emails;
        // * Phone numbers
        contact_map.phone_numbers.forEach((phone_type) => {
          if (contact[phone_type])
            phone_numbers.push({
              phone_number: contact[phone_type],
              type: phone_type,
            });
        });
        decodedData.phone_numbers = phone_numbers;

        successResponse(
          res,
          'Successfully tested dynamics contact',
          decodedData
        );
        break;
    }
  } catch (err) {
    logger.error('An error occurred while testing dynamics field map: ', err);
    serverErrorResponseWithDevMsg({
      res,
      error: `Error while testing dynamics fieldmap: ${err.message}`,
    });
  }
};

const getLeadOrContactFromDynamics = async (req, res) => {
  try {
    // * JOI Validation
    let body = companyFieldSchema.testDynamicsObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.DYNAMICS,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('kindly log in')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with dynamics`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }
    switch (body.type) {
      case DYNAMICS_ENDPOINTS.LEAD:
        let [lead, errFetchingLead] =
          await v2GrpcClients.crmIntegration.getLead({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            integration_data: {
              access_token,
              dynamics_lead_id: req.body.id,
              instance_url,
            },
          });
        if (errFetchingLead)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead',
            error: `Error while fetching fetching lead from Dynamics: ${errFetchingLead}`,
          });
        return successResponse(
          res,
          'Successfully fetched lead from Dynamics',
          lead
        );
        break;
      case DYNAMICS_ENDPOINTS.CONTACT:
        let [contact, errFetchingContact] =
          await v2GrpcClients.crmIntegration.getContact({
            integration_type: CRM_INTEGRATIONS.DYNAMICS,
            integration_data: {
              access_token,
              instance_url,
              dynamics_contact_id: req.body.id,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch contact',
            error: `Error while fetching fetching contact from Dynamics: ${errFetchingContact}`,
          });
        if (contact?._parentcustomerid_value?.length) {
          let [account, errFetchingAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                access_token,
                instance_url,
                dynamics_account_id: contact?._parentcustomerid_value,
              },
            });
          if (errFetchingAccount === 'Account not found.') {
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to fetch account',
              error: `Error while fetching fetching account from dynamics: ${errFetchingAccount}`,
            });
          }
          return successResponse(
            res,
            'Successfully fetched contact and company from dynamics',
            {
              contact,
              account,
            }
          );
        }

        return successResponse(
          res,
          'Successfully fetched contact and company from dynamics',
          contact
        );
        break;
    }
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact and company from Dynamics : ',
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `An error occurred while fetching contact and company from Dynamics: ${err.message}`,
    });
  }
};

const describePicklist = async (req, res) => {
  try {
    // *  Fetch company integration
    let [integration_type, errFetchingCrmIntegration] =
      await CompanyHelper.getIntegrationType(req.user.user_id);
    if (errFetchingCrmIntegration)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch picklist values',
        error: `Error while fetching company integration: ${errFetchingCrmIntegration}`,
      });
    // * Validate request
    let params = {};
    switch (integration_type) {
      case CRM_INTEGRATIONS.DYNAMICS:
        params = companyFieldSchema.describeDynamicsEndpointSchema.validate(
          req.params
        );
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        params = companyFieldSchema.describeBullhornPicklist.validate(
          req.params
        );
        break;
      default:
        return notFoundResponseWithDevMsg({
          res,
          error: 'Invalid CRM Integration',
          msg: 'Failed to fetch picklist values',
        });
    }
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    // * Fetch CRM admin of the company
    const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
      tableName: DB_TABLES.COMPANY,
      query: {
        company_id: req.user.company_id,
      },
      include: {
        [DB_TABLES.COMPANY_SETTINGS]: {
          attributes: ['user_id'],
          [DB_TABLES.USER]: {
            attributes: ['integration_id'],
          },
        },
      },
      extras: {
        attributes: ['company_id'],
      },
    });
    if (errCrmAdmin)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to describe object',
        error: `Error while fetching CRM Admin: ${errCrmAdmin}`,
      });

    let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
    if (!crmAdminUserId)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Please set Cadence Administrator',
        error: 'Unable to find CRM Admin',
      });

    // * Fetch access token  token and instance URL
    let [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: integration_type,
        user_id: crmAdminUserId,
      });
    if (errForAccessToken) {
      if (
        errForAccessToken.toLowerCase().includes('kindly sign in') ||
        errForAccessToken.toLowerCase().includes('Kindly log in to dynamics.')
      ) {
        return badRequestResponseWithDevMsg({
          res,
          msg: `Please ask CRM admin to log in with ${integration_type}`,
          error: `Error while fetching access token: ${errForAccessToken}`,
        });
      }
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Something went wrong, please try after some time or contact support.',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    }

    let data, describeError;
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.DYNAMICS:
        [data, describeError] =
          await v2GrpcClients.crmIntegration.describePicklist({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              object: params.value.object,
              access_token,
              instance_url,
            }),
          });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch picklist values',
            error: `Error while fetching picklist field of dynamics integration data via grpc: ${describeError}`,
          });
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        [data, describeError] =
          await v2GrpcClients.hiringIntegration.describePicklist({
            integration_type: integration_type,
            integration_data: JSON.stringify({
              object: params.value.object,
              access_token,
              instance_url,
            }),
          });
        if (describeError)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch picklist values',
            error: `Error while fetching picklist field of dynamics integration data via grpc: ${describeError}`,
          });
        break;
    }

    return successResponse(res, 'Successfully fetched picklist fields', data);
  } catch (err) {
    logger.error(
      `An error occurred while trying to fetch picklist values: `,
      err
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while trying to fetch picklist values: ${err.message}`,
    });
  }
};

module.exports = {
  createCompanyMap,
  fetchCompanyFieldMap,
  describeObject,
  testSalesforceFieldMap,
  createAllCrmMap,
  createCustomObject,
  testCustomObject,
  testPipedriveFieldMap,
  getPersonAndOrganizationFromPipedrive,
  testHubspotFieldMap,
  getContactAndCompanyFromHubspot,
  testZohoFieldMap,
  testSellsyFieldMap,
  getContactAndAccountFromSellsy,
  getLeadOrContactFromZoho,
  testBullhornFieldMap,
  getLeadOrContactOrCandidateFromBullhorn,
  testDynamicsFieldMap,
  getLeadOrContactFromDynamics,
  describePicklist,
};
