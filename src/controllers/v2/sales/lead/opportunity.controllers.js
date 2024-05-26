// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  CRM_INTEGRATIONS,
  ACCOUNT_INTEGRATION_TYPES,
  INTEGRATION_TYPE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// DB
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const {
  createNoteActivity,
} = require('../../../../../../Cadence-Brain/src/grpc/v2/crm-integration');
const SalesforceHelpers = require('../../../../../../Cadence-Brain/src/helper/salesforce');

// GRPC
const v2GrpcClients = require('../../../../../../Cadence-Brain/src/grpc/v2');

// Joi
const opportunitySchema = require('../../../../joi/v2/sales/lead/note.joi');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');

const createOpportunity = async (req, res) => {
  try {
    let createOpportunity = {};
    let opportunityObject = req.body;
    let integration_type = opportunityObject.integration_type;
    createOpportunity.integration_type = opportunityObject.integration_type;
    createOpportunity.user_id = req.user.user_id;
    createOpportunity.company_id = req.user.company_id;
    delete opportunityObject.integration_type;

    // const body =
    //   opportunitySchema.createOpportunitySchema.validate(opportunityObject);
    // if (body.error) {
    //   t.rollback();
    //   return unprocessableEntityResponse(res, body.error.message);
    // }
    let access_token = '',
      instance_url = '',
      errForAccessToken = '';
    switch (integration_type) {
      case INTEGRATION_TYPE.SALESFORCE:
        // const [account, errForAccount] = await Repository.fetchOne({
        //   account_id: req.body.account_id,
        // });
        // if (errForAccount) {
        //   t.rollback();
        //   return serverErrorResponse(res);
        // }
        // if (!account) {
        //   t.rollback();
        //   return notFoundResponse(res, 'Account not found');
        // }

        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });

        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Salesforce`,
          });
        }

        if (access_token && instance_url) {
          const [salesforceOpportunityId, salesforceErr] =
            await v2GrpcClients.crmIntegration.createOpportunity({
              integration_type,
              integration_data: {
                access_token,
                instance_url,
                opportunity: opportunityObject,
              },
            });
          if (salesforceErr) {
            logger.error(
              `Error while creating salesforce opportunity: `,
              salesforceErr
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create opportunity',
              error: `Error while creating oppoortunity: ${salesforceErr}`,
            });
          }

          let [salesforceFieldMap, errForMap] =
            await SalesforceHelpers.getFieldMapForCompanyFromUser(
              req.user.user_id
            );
          if (errForMap) {
            logger.error(
              '\nError while creating opportunity in db:\n',
              errForMap
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create opportunity',
              error: `Error while fetching fieldmap for company from user: ${errForMap}`,
            });
          }

          let opportunity_map = salesforceFieldMap.opportunity_map;
          for (const key in opportunity_map) {
            if (opportunity_map?.[key]) {
              if (opportunity_map?.[key].constructor.name === 'Object')
                createOpportunity[key] =
                  opportunityObject[opportunity_map[key]?.['name']];
              else
                createOpportunity[key] =
                  opportunityObject[opportunity_map[key]];
            }
          }
          const [account, errForAccount] = await Repository.fetchOne({
            tableName: DB_TABLES.ACCOUNT,
            query: {
              integration_id: createOpportunity.account,
              integration_type: ACCOUNT_INTEGRATION_TYPES.SALESFORCE_ACCOUNT,
            },
          });
          if (errForAccount)
            logger.error(`Error while fetching account: `, errForAccount);

          if (account) {
            createOpportunity.integration_account_id =
              createOpportunity.account;
            createOpportunity.account_id = account.account_id;
          }
          delete createOpportunity.account;

          createOpportunity.integration_id = salesforceOpportunityId.id;
          createOpportunity.integration_owner_id =
            salesforceOpportunityId.OwnerId;
        }
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: req.user.user_id,
          });
        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }

        if (access_token && instance_url) {
          const [pipedriveDeal, pipedriveDealErr] =
            await v2GrpcClients.crmIntegration.createOpportunity({
              integration_type,
              integration_data: {
                access_token,
                instance_url,
                opportunity: opportunityObject,
              },
            });
          if (pipedriveDealErr) {
            logger.error(
              `Error while creating salesforce opportunity: `,
              pipedriveDealErr
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to create opportunity',
              error: `Error while creating opportunity: ${pipedriveDealErr}`,
            });
          }

          // * Fetch pipedrive field map
          let [pipedriveFieldMap, errFetchingPipedriveFieldMap] =
            await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
              user_id: req.user.user_id,
            });
          if (errFetchingPipedriveFieldMap)
            return badRequestResponse(res, errFetchingPipedriveFieldMap);

          let pipedriveDealMap = pipedriveFieldMap.deal_map;

          for (const key in pipedriveDealMap) {
            if (pipedriveDealMap?.[key]) {
              if (pipedriveDealMap?.[key].constructor.name === 'Object')
                createOpportunity[key] =
                  opportunityObject[pipedriveDealMap[key]?.['name']];
              else
                createOpportunity[key] =
                  opportunityObject[pipedriveDealMap[key]];
            }
          }

          createOpportunity.integration_id = pipedriveDeal.data.id;
          createOpportunity.integration_owner_id =
            pipedriveDeal.data.user_id.id;
          createOpportunity.user_id = req.user.user_id;
          createOpportunity.company_id = req.user.company_id;
        }

        break;

      case CRM_INTEGRATIONS.HUBSPOT:
        [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: lead?.User.user_id,
          });
        if (access_token === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }

        const [hubspotData, hubspotDataError] = await createNoteActivity({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            hs_timestamp: new Date(),
            hs_note_body: `<h4>${req.body.title}</h4>${req.body.note}`,
            hubspot_contact_id: lead.integration_id,
          },
        });
        if (hubspotDataError)
          logger.error(`Error while creating hubspot note: `, hubspotDataError);
        break;
      default:
        logger.error(`Bad integration type.`);
    }

    const [createdOpportunity, errForCreateOpportunity] =
      await Repository.create({
        tableName: DB_TABLES.OPPORTUNITY,
        createObject: createOpportunity,
      });
    if (errForCreateOpportunity) {
      logger.error(
        '\nError while creating opportunity in db:\n',
        errForCreateOpportunity
      );

      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create opportunity',
        error: `Error while creating opportunity: ${errForCreateOpportunity}`,
      });
    }

    return successResponse(
      res,
      'Opportunity created succesfully.',
      createdOpportunity
    );
  } catch (err) {
    logger.error(`Error while creating Opportunity: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating opportunity: ${err.message}`,
    });
  }
};

const updateOpportunity = async (req, res) => {
  try {
    const { id } = req.params;

    let createOpportunity = {};
    let opportunityObject = req.body;
    let integration_type = opportunityObject.integration_type;

    delete opportunityObject.integration_type;

    let access_token = '',
      instance_url = '',
      errForAccessToken = '';
    switch (integration_type) {
      case INTEGRATION_TYPE.SALESFORCE:
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });
        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }

        if (access_token && instance_url) {
          const [salesforceOpportunityId, salesforceErr] =
            await v2GrpcClients.crmIntegration.updateOpportunity({
              integration_type,
              integration_data: {
                access_token,
                instance_url,
                opportunity: opportunityObject,
                integration_id: id,
              },
            });
          if (salesforceErr) {
            logger.error(
              `Error while updating salesforce opportunity: `,
              salesforceErr
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update opportunity',
              error: `Error while updating opportunity: ${salesforceErr}`,
            });
          }
        }
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: req.user.user_id,
          });
        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }

        if (access_token && instance_url) {
          const [pipedriveDealUpdate, pipedriveDealErr] =
            await v2GrpcClients.crmIntegration.updateOpportunity({
              integration_type,
              integration_data: {
                access_token,
                instance_url,
                opportunity: opportunityObject,
                integration_id: id,
              },
            });
          if (pipedriveDealErr) {
            logger.error(
              `Error while creating salesforce opportunity: `,
              pipedriveDealErr
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to update opportunity',
              error: `Error while updating opportunity: ${pipedriveDealErr}`,
            });
          }
        }
        break;

      case CRM_INTEGRATIONS.HUBSPOT:
        [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: lead?.User.user_id,
          });
        if (access_token === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Kindly login with Hubspot',
          });
        }

        const [hubspotData, hubspotDataError] = await createNoteActivity({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            hs_timestamp: new Date(),
            hs_note_body: `<h4>${req.body.title}</h4>${req.body.note}`,
            hubspot_contact_id: lead.integration_id,
          },
        });
        if (hubspotDataError)
          logger.error(`Error while creating hubspot note: `, hubspotDataError);
        break;
      default:
        logger.error(`Bad integration type.`);
    }

    return successResponse(res, 'Opportunity updated succesfully.', {});
  } catch (err) {
    logger.error(`Error while updating Opportunity: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating opportunity: ${err.message}`,
    });
  }
};

const deleteOpportunity = async (req, res) => {
  try {
    const { id } = req.params;

    const [opportunity, errForOpportunity] = await Repository.fetchOne({
      tableName: DB_TABLES.OPPORTUNITY,
      query: {
        integration_id: id,
      },
    });
    if (errForOpportunity) {
      logger.error(
        `Error while fetching opportunity from db: `,
        errForOpportunity
      );
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete opportunity',
        error: `Error while fetching opportunity: ${errForOpportunity}`,
      });
    }

    let integration_type = opportunity.integration_type;

    let access_token = '',
      instance_url = '',
      errForAccessToken = '';

    switch (integration_type) {
      case INTEGRATION_TYPE.SALESFORCE:
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.SALESFORCE,
            user_id: req.user.user_id,
          });

        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Salesforce`,
          });
        }

        if (access_token && instance_url) {
          const [salesforceOpportunityId, salesforceErr] =
            await v2GrpcClients.crmIntegration.deleteOpportunity({
              integration_type,
              integration_data: {
                access_token,
                instance_url,
                opportunity: {},
                integration_id: id,
              },
            });
          if (salesforceErr) {
            logger.error(
              `Error while deleting salesforce opportunity: `,
              salesforceErr
            );
            return serverErrorResponseWithDevMsg({
              res,
              msg: 'Failed to delete opportunity',
              error: `Error while deleting opportunity: ${salesforceErr}`,
            });
          }
        }
        break;
      case CRM_INTEGRATIONS.PIPEDRIVE:
        [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: lead?.User.user_id,
          });
        if (access_token === null || instance_url === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }
        const [pipedriveData, pipedriveDataError] = await createNoteActivity({
          integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
          integration_data: {
            access_token,
            instance_url,
            content: `<B>${req.body.title}</B><br>${req.body.note}`,
            person_id: lead.integration_id,
          },
        });
        if (pipedriveDataError)
          logger.error(
            `Error while creating pipedrive note: `,
            pipedriveDataError
          );
        break;

      case CRM_INTEGRATIONS.HUBSPOT:
        [{ access_token }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.HUBSPOT,
            user_id: lead?.User.user_id,
          });
        if (access_token === null) {
          logger.error(
            '\nError while getting access token or instance url:\n',
            errForAccessToken
          );
          return serverErrorResponseWithDevMsg({
            res,
            msg: `Kindly login with Pipedrive`,
          });
        }

        const [hubspotData, hubspotDataError] = await createNoteActivity({
          integration_type: CRM_INTEGRATIONS.HUBSPOT,
          integration_data: {
            access_token,
            hs_timestamp: new Date(),
            hs_note_body: `<h4>${req.body.title}</h4>${req.body.note}`,
            hubspot_contact_id: lead.integration_id,
          },
        });
        if (hubspotDataError)
          logger.error(`Error while creating hubspot note: `, hubspotDataError);
        break;
      default:
        logger.error(`Bad integration type.`);
    }

    return successResponse(res, 'Opportunity deleted succesfully.', {});
  } catch (err) {
    console.log('here', err);
    logger.error(`Error while deleting Opportunity: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting opportunity: ${err.message}`,
    });
  }
};

const OpportunityController = {
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
};

module.exports = OpportunityController;
