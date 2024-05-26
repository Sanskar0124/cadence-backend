// Utils
const logger = require('../../../../utils/winston');
const {
  notFoundResponseWithDevMsg,
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  SALESFORCE_SOBJECTS,
  ZOHO_ENDPOINTS,
  CRM_INTEGRATIONS,
  LEAD_INTEGRATION_TYPES,
  HIRING_INTEGRATIONS,
  BULLHORN_ENDPOINTS,
  DYNAMICS_ENDPOINTS,
  HUBSPOT_ENDPOINTS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Joi
const customObjectSchema = require('../../../../joi/v2/sales/lead/custom-object.joi');

// GRPC
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

// Helper and Services
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');
const sellsyService = require('../../../../../../Cadence-Brain/src/services/Sellsy');

// * Update custom object data for lead
const updateCustomObjectDataForLead = async (req, res) => {
  try {
    // * Request object validation
    let body = {};
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        body = customObjectSchema.customObjectSalesforceDataSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body = customObjectSchema.customObjectPipedriveDataSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body = customObjectSchema.customObjectHubspotDataSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.ZOHO:
        body = customObjectSchema.customObjectZohoDataSchema.validate(req.body);
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        body = customObjectSchema.customObjectBullhornDataSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.SELLSY:
        body = customObjectSchema.customObjectSellsyDataSchema.validate(
          req.body
        );
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        body = customObjectSchema.customObjectDynamicsDataSchema.validate(
          req.body
        );
        break;
      default:
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to update lead',
          error: 'Invalid CRM Integration',
        });
    }
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Extract lead_id from request
    let { lead_id } = body.value;

    // * Fetch lead from lead_id
    let [lead, errFetchingLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
    });
    if (errFetchingLead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update lead',
        error: `Error while fetching lead: ${errFetchingLead}`,
      });
    if (!lead)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to update lead',
        error: 'Lead not found',
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
          msg: 'Please connect with salesforce to continue',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead',
        error: `Error while fetching tokens for salesforce: ${errForAccessToken}.`,
      });
    }

    // * Logic to make necessary updates
    switch (req.user.integration_type) {
      case CRM_INTEGRATIONS.SALESFORCE:
        if (lead.integration_type === LEAD_INTEGRATION_TYPES.SALESFORCE_LEAD) {
          body.value.type = SALESFORCE_SOBJECTS.LEAD;
          body.value.id = lead.integration_id;

          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        } else {
          body.value.type = SALESFORCE_SOBJECTS.CONTACT;
          body.value.id = lead.integration_id;

          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        }
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        body.value.person_id = lead.integration_id;

        console.log(body);

        const [_, errTestingCustomObject] =
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
            msg: 'Failed to update lead',
            error: `Error while testing custom object: ${errTestingCustomObject}`,
          });
        break;
      case CRM_INTEGRATIONS.HUBSPOT:
        body.value.contact_id = lead.integration_id;
        const [__, errTestingCustomHObject] =
          await CompanyFieldMapHelper.testCustomObject({
            data: body,
            access_token,
            user_id: req.user.user_id,
            crm_integration: req.user.integration_type,
          });
        if (errTestingCustomHObject)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update lead',
            error: `Error while testing custom object: ${errTestingCustomHObject}`,
          });
        break;
      case CRM_INTEGRATIONS.ZOHO:
        if (lead.integration_type === LEAD_INTEGRATION_TYPES.ZOHO_LEAD) {
          body.value.type = ZOHO_ENDPOINTS.LEAD;
          body.value.id = lead.integration_id;
          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        } else {
          body.value.type = ZOHO_ENDPOINTS.CONTACT;
          body.value.id = lead.integration_id;
          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        }
        break;
      case CRM_INTEGRATIONS.SELLSY:
        if (lead.integration_id) {
          body.value.company_id = req.user.company_id;
          body.value.id = lead.integration_id;
          delete body.value.lead_id;

          const [_, errTestingCustomObject] =
            await CompanyFieldMapHelper.testCustomObject({
              data: body,
              access_token,
              user_id: req.user.user_id,
              crm_integration: req.user.integration_type,
            });
          if (errTestingCustomObject)
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        }
        break;
      case HIRING_INTEGRATIONS.BULLHORN:
        switch (lead.integration_type) {
          case LEAD_INTEGRATION_TYPES.BULLHORN_CONTACT:
            body.value.type = BULLHORN_ENDPOINTS.LEAD;
            body.value.id = lead.integration_id;
            const [__, errTestingCustomObject] =
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
                msg: 'Failed to update lead',
                error: `Error while testing custom object: ${errTestingCustomObject}`,
              });
            break;
          case LEAD_INTEGRATION_TYPES.BULLHORN_CANDIDATE:
            body.value.type = BULLHORN_ENDPOINTS.CANDIDATE;
            body.value.id = lead.integration_id;
            const [_, errTestingCustomObjectCandidate] =
              await CompanyFieldMapHelper.testCustomObject({
                data: body,
                access_token,
                instance_url,
                user_id: req.user.user_id,
                crm_integration: req.user.integration_type,
              });
            if (errTestingCustomObjectCandidate)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to update lead',
                error: `Error while testing custom object candidate: ${errTestingCustomObjectCandidate}`,
              });
            break;
          case LEAD_INTEGRATION_TYPES.BULLHORN_LEAD:
            body.value.type = BULLHORN_ENDPOINTS.LEAD;
            body.value.id = lead.integration_id;
            const [___, errTestingCustomObjectLead] =
              await CompanyFieldMapHelper.testCustomObject({
                data: body,
                access_token,
                instance_url,
                user_id: req.user.user_id,
                crm_integration: req.user.integration_type,
              });
            if (errTestingCustomObjectLead)
              return serverErrorResponseWithDevMsg({
                res,
                msg: 'Failed to update lead',
                error: `Error while testing custom object lead: ${errTestingCustomObjectLead}`,
              });
            break;
          default:
            break;
        }
        break;
      case CRM_INTEGRATIONS.DYNAMICS:
        if (lead.integration_type === LEAD_INTEGRATION_TYPES.DYNAMICS_LEAD) {
          body.value.type = DYNAMICS_ENDPOINTS.LEAD;
          body.value.id = lead.integration_id;
          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        } else {
          body.value.type = DYNAMICS_ENDPOINTS.CONTACT;
          body.value.id = lead.integration_id;
          const [_, errTestingCustomObject] =
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
              msg: 'Failed to update lead',
              error: `Error while testing custom object: ${errTestingCustomObject}`,
            });
        }
        break;
      default:
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Failed to update lead',
          error: 'Invalid CRM',
        });
    }

    return successResponse(res, 'Successfully updated lead in salesforce');
  } catch (err) {
    logger.error(`Error while updating lead custom object data: `, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead custom object data: ${err.message}`,
    });
  }
};

// * Fetch lead/(contact+account)
const fetchCustomObjectFromSalesforce = async (req, res) => {
  try {
    const body =
      customObjectSchema.fetchCustomObjectDataFromSalesforce.validate(req.body);
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
      if (errForAccessToken === 'Kindly log in with salesforce.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please connect with salesforce to continue',
        });
      else if (errForAccessToken?.includes('Request failed'))
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please connect with salesforce to continue',
        });
      else
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch custom object',
          error: `Error while fetching tokens for salesforce: ${errForAccessToken}.`,
        });
    }

    // * If (type == 'lead') => getLead, else getContact + getAccount
    if (body.value.type === SALESFORCE_SOBJECTS.LEAD) {
      const [lead, errFetchingLead] =
        await SalesforceService.getLeadFromSalesforce(
          body.value.id,
          access_token,
          instance_url
        );
      if (errFetchingLead)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch lead',
          error: `Error while fetching lead from salesforce: ${errFetchingLead}`,
        });

      // * Handle references
      if (body.value.references && body.value.references.length > 0) {
        for (let reference of body.value.references)
          if (lead[reference.key]) {
            // * Fetch salesforce object where namefield is true
            let query = `SELECT+${reference.reference_field_name.name}+FROM+${
              reference.reference_field_name.sObject
            }+WHERE+ID='${lead[reference.key]}'`;

            let [result, errResult] = await SalesforceService.query(
              query,
              access_token,
              instance_url
            );
            if (errResult)
              return notFoundResponseWithDevMsg({
                res,
                msg: 'Failed to fetch custom object',
                error: `Error while fetching result: ${errResult}`,
              });

            lead[reference.key] = {
              ...result?.records[0],
              id: lead[reference.key],
            };
          }
      }

      return successResponse(
        res,
        'Successfully fetched lead from salesforce',
        lead
      );
    } else {
      const [contact, errFetchingContact] =
        await SalesforceService.getContactById(
          body.value.id,
          access_token,
          instance_url
        );
      if (errFetchingContact)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch contact',
          error: `Error while fetching contact from salesforce: ${errFetchingContact}`,
        });

      // * Handle references
      if (
        body.value.references_contact &&
        body.value.references_contact.length > 0
      ) {
        for (let reference of body.value.references_contact)
          if (contact[reference.key] && reference.key) {
            // * Fetch salesforce object where namefield is true
            let query = `SELECT+${reference.reference_field_name.name}+FROM+${
              reference.reference_field_name.sObject
            }+WHERE+ID='${contact[reference.key]}'`;

            let [result, errResult] = await SalesforceService.query(
              query,
              access_token,
              instance_url
            );
            if (errResult)
              return notFoundResponseWithDevMsg({
                res,
                msg: 'Failed to fetch custom object',
                error: `Error while fetching result: ${errResult}`,
              });

            contact[reference.key] = {
              ...result?.records[0],
              id: contact[reference.key],
            };
          }
      }

      const [account, errFetchingAccount] =
        await SalesforceService.getAccountFromSalesforce(
          contact.AccountId,
          access_token,
          instance_url
        );
      if (errFetchingAccount)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch account',
          error: `Error while fetching account from salesforce: ${errFetchingAccount}`,
        });

      // * Handle references
      if (
        body.value.references_account &&
        body.value.references_account.length > 0
      ) {
        for (let reference of body.value.references_account)
          if (account[reference.key] && reference.key) {
            // * Fetch salesforce object where namefield is true
            let query = `SELECT+${reference.reference_field_name.name}+FROM+${
              reference.reference_field_name.sObject
            }+WHERE+ID='${account[reference.key]}'`;

            let [result, errResult] = await SalesforceService.query(
              query,
              access_token,
              instance_url
            );
            if (errResult)
              return notFoundResponseWithDevMsg({
                res,
                msg: 'Failed to fetch custom object',
                error: `Error while fetching result: ${errResult}`,
              });

            account[reference.key] = {
              ...result?.records[0],
              id: account[reference.key],
            };
          }
      }

      return successResponse(
        res,
        'Successfully fetched contact from salesforce',
        { contact, account }
      );
    }
  } catch (err) {
    logger.error(
      `Error while updating fetching custom object data from salesforce : `,
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Failed to fetch custom object from salesforce: ${err.message}`,
    });
  }
};

// * Fetch search results from any sobject
const fetchSearchResultsForObject = async (req, res) => {
  try {
    // * Request validation
    const body = customObjectSchema.searchObjectSchema.validate(req.query);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });

    // * Fetch salesforce token and instance URL
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken) {
      if (errForAccessToken === 'Please log in with salesforce')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please connect with salesforce to continue',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to perform search',
        error: `Error while fetching tokens for salesforce: ${errForAccessToken}.`,
      });
    }

    // * Salesforce query
    let query = `SELECT+${body.value.reference_field_name},Id+FROM+${body.value.sObject}+WHERE+${body.value.reference_field_name}+LIKE+'%${body.value.search_term}%'+LIMIT+5`;
    let [searchResults, errSearchResults] = await SalesforceService.query(
      query,
      access_token,
      instance_url
    );
    if (errSearchResults)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Unable to perform search',
        error: `Error while running SOQL query in salesforce: ${errSearchResults} `,
      });

    return successResponse(
      res,
      'Successfully fetched search results',
      searchResults
    );
  } catch (err) {
    logger.error(
      `An error occurred while attempting to fetch search results for salesforce object: `,
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching search results for object: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromPipedrive = async (req, res) => {
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
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching person and organization from Pipedrive: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromHubspot = async (req, res) => {
  // * JOI Validation
  let body = customObjectSchema.testHubspotObject.validate(req.body);
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
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching contact and company from Hubspot: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromZoho = async (req, res) => {
  try {
    // * JOI Validation
    let body = customObjectSchema.testZohoObject.validate(req.body);
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
        if (!lead || Object.keys(lead).length === 0)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Lead does not exists in your crm',
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
        if (!contact || Object.keys(contact).length === 0)
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Contact does not exists in your crm',
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
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `An error occurred while fetching contact and company from Zoho: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromBullhorn = async (req, res) => {
  try {
    // * JOI Validation
    let body = customObjectSchema.testBullhornObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    body = body.value;
    let { lead_fields, account_fields } = body;

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
        lead_fields = `${lead_fields},id,clientCorporation`;
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

        if (lead?.clientCorporation?.id && account_fields) {
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
        lead_fields = `${lead_fields},id`;
        let [candidate, errFetchingCandidate] =
          await v2GrpcClients.hiringIntegration.getCandidate({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              candidate_id: req.body.id,
              instance_url,
              fields: lead_fields,
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
        lead_fields = `${lead_fields},id,clientCorporation`;
        let [contact, errFetchingContact] =
          await v2GrpcClients.hiringIntegration.getContact({
            integration_type: HIRING_INTEGRATIONS.BULLHORN,
            integration_data: {
              access_token,
              instance_url,
              contact_id: req.body.id,
              fields: lead_fields,
            },
          });
        if (errFetchingContact)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to fetch lead or contact or candidate from Bullhorn',
            error: `Error while fetching contact from Bullhorn: ${errFetchingContact}`,
          });
        if (contact?.clientCorporation?.id && account_fields) {
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
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching lead or contact or candidate from Bullhorn: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromSellsy = async (req, res) => {
  try {
    let body = customObjectSchema.fetchSellsyObject.validate(req.body);
    if (body.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    const { contact_id, custom_object } = body.value;

    let [{ access_token }, errFetchingAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SELLSY,
        user_id: req.user.user_id,
      });
    if (errFetchingAccessToken) {
      if (errForAccessToken === 'Kindly log in with sellsy.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please connect with Sellsy to continue',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contact and company from sellsy',
        error: `Error while fetching access token: ${errFetchingAccessToken}`,
      });
    }

    let contactCustomIds = 'embed[]=smart_tags';
    let companyCustomIds = 'embed[]=smart_tags';

    for (let i = 0; i < custom_object.length; i++) {
      if (custom_object[i].sellsy_endpoint === 'contact') {
        if (custom_object[i].sellsy_field_id) {
          contactCustomIds += `&embed[]=cf.${custom_object[i].sellsy_field_id}`;
        }
      } else {
        if (custom_object[i].sellsy_field_id) {
          companyCustomIds += `&embed[]=cf.${custom_object[i].sellsy_field_id}`;
        }
      }
    }

    let contactPromise = sellsyService.getContactCustomFields({
      access_token,
      contact_id,
      embed: contactCustomIds,
    });

    let leadPromise = Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { integration_id: contact_id, company_id: req.user.company_id },
      include: {
        [DB_TABLES.ACCOUNT]: {
          attributes: ['integration_id'],
        },
      },
      extras: {
        attributes: ['lead_id', 'integration_id'],
      },
    });

    let [[contact, errForContact], [lead, errForLead]] = await Promise.all([
      contactPromise,
      leadPromise,
    ]);

    if (errForContact)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contact and company from sellsy',
        error: `Error while fetching contact: ${errForContact}`,
      });

    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch contact and company from sellsy',
        error: `Error while fetching lead: ${errForLead}`,
      });

    // * Fetch company
    let company_id = lead?.Account?.integration_id;

    if (!company_id && !lead) {
      const [contactCompanyId, errForContactCompanyId] =
        await sellsyService.getCompanyIdUsingContactId({
          access_token,
          contact_id: contact_id,
        });

      company_id = contactCompanyId;
    }

    if (company_id) {
      const [company, errFetchingCompany] =
        await sellsyService.getAccountCustomFields({
          access_token,
          company_id,
          embed: companyCustomIds,
        });
      if (errFetchingCompany)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to fetch contact and company from sellsy',
          error: `Error while fetching company: ${errFetchingCompany}`,
        });

      return successResponse(
        res,
        'Successfully fetched contact and company from sellsy',
        { contact, company }
      );
    }

    return successResponse(
      res,
      'Successfully fetched contact and company from sellsy',
      contact
    );
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact and company from sellsy : ',
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching contact and company from sellsy: ${err.message}`,
    });
  }
};

const fetchCustomObjectFromDynamics = async (req, res) => {
  try {
    // * JOI Validation
    let body = customObjectSchema.fetchDynamicsObject.validate(req.body);
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
      if (errForAccessToken === 'Kindly log in to dynamics.')
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Please connect with Dynamics to continue',
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch lead or contact from dynamics',
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
            msg: 'Failed to fetch contact and company from Dynamics',
            error: `Error while fetching fetching contact from Dynamics: ${errFetchingContact}`,
          });

        if (contact?._parentcustomerid_value?.length) {
          const [account, errFetchingAccount] =
            await v2GrpcClients.crmIntegration.getAccount({
              integration_type: CRM_INTEGRATIONS.DYNAMICS,
              integration_data: {
                access_token,
                instance_url,
                dynamics_account_id: contact?._parentcustomerid_value,
              },
            });
          if (errFetchingAccount) {
            logger.error('Error while fetching account from dynamics', {
              err: errFetchingAccount,
              user_id: req.user.user_id,
            });
            return successResponse(
              res,
              'Successfully fetched contact and company from dynamics',
              { contact, account: {} }
            );
          }

          return successResponse(
            res,
            'Successfully fetched contact and company from dynamics',
            { contact, account }
          );
        }

        return successResponse(
          res,
          'Successfully fetched contact and company from dynamics',
          { contact, account: {} }
        );
    }
  } catch (err) {
    logger.error(
      'An error occurred while fetching contact or lead from Dynamics : ',
      {
        err,
        user_id: req.user.user_id,
      }
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching contact or lead from Dynamics: ${err.message}`,
    });
  }
};

const CustomObjectController = {
  updateCustomObjectDataForLead,
  fetchCustomObjectFromSalesforce,
  fetchSearchResultsForObject,
  fetchCustomObjectFromPipedrive,
  fetchCustomObjectFromHubspot,
  fetchCustomObjectFromZoho,
  fetchCustomObjectFromBullhorn,
  fetchCustomObjectFromSellsy,
  fetchCustomObjectFromDynamics,
};

module.exports = CustomObjectController;
