// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');
const {
  LEAD_INTEGRATION_TYPES,
  ACCOUNT_INTEGRATION_TYPES,
  CRM_INTEGRATIONS,
  INTEGRATION_TYPE,
  OPPORTUNITY_STATUS,
} = require('../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
} = require('../../../../../Cadence-Brain/src/utils/constants');

// Packages
const { Op } = require('sequelize');
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const CompanyFieldMapHelper = require('../../../../../Cadence-Brain/src/helper/company-field-map');
const CryptoHelper = require('../../../../../Cadence-Brain/src/helper/crypto');
const AccessTokenHelper = require('../../../../../Cadence-Brain/src/helper/access-token');

// GRPC
const v2GrpcClients = require('../../../../../Cadence-Brain/src/grpc/v2');
const deleteAllLeadInfo = require('../../../../../Cadence-Brain/src/helper/lead/deleteAllLeadInfo');

const updatePipedrivePerson = async (req, res) => {
  // let t = await sequelize.transaction();
  try {
    const { current, previous, meta } = req.body;
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR PERSON FROM HOST: https://${meta.host}`
    );

    // fetch company having users with instance_url same as received in webhook
    const receivedInstanceUrl = `https://${meta.host}`;

    if (meta.action === 'deleted') {
      const [deletableLead, errForDeletableLead] = await Repository.fetchOne({
        tableName: DB_TABLES.LEAD,
        query: {
          integration_type: LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
          integration_id: meta.id,
        },
        // t
      });

      if (errForDeletableLead)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Selected lead does not exist',
          error: 'Lead not found for deletion',
        });

      const [deletedLeadMsg, errForDeletedLeadMsg] = await deleteAllLeadInfo({
        leadIds: [deletableLead.lead_id],
        // t
      });

      if (errForDeletedLeadMsg)
        serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update Pipedrive person',
          error: `Error while deleting all leads info: ${errForDeletedLeadMsg}`,
        });
      return successResponse(res, 'Successfully removed lead from Cadence');
    }

    const [encryptedReceivedInstanceUrl, errForEncryptedReceivedInstanceUrl] =
      CryptoHelper.encrypt(receivedInstanceUrl);
    if (errForEncryptedReceivedInstanceUrl) {
      //t.rollback();
      return successResponse(res);
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      include: {
        [DB_TABLES.PIPEDRIVE_TOKENS]: {
          where: {
            encrypted_instance_url: encryptedReceivedInstanceUrl,
          },
        },
      },
    });
    if (errForUser) {
      // t.rollback();
      return successResponse(res);
    }
    if (!user) {
      // t.rollback();
      logger.info('User not found for pipedrive person in webhook.');
      return successResponse(res);
    }
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR PERSON FROM USER: ${user.user_id}`
    );

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        integration_type: LEAD_INTEGRATION_TYPES.PIPEDRIVE_PERSON,
        integration_id: meta.id,
      },
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: user.company_id,
          },
          required: true,
        },
        [DB_TABLES.ACCOUNT]: {},
      },
      // t,
    });
    if (errForLead) {
      // t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive person',
        error: `Error while fetching lead: ${errForLead}`,
      });
    }
    if (!lead) {
      // t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });
    }

    let [pipedriveMap, errForPipedriveMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: lead.user_id,
      });
    if (errForPipedriveMap) {
      // t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive person',
        error: `Error while fetching fieldmap for company from user: ${errForPipedriveMap}`,
      });
    }

    let organizationMap = pipedriveMap?.organization_map;
    let pipedrivePersonMap = pipedriveMap?.person_map;

    // === Handling all organization changes possible ===

    // * If unlinked lead is linked with a company || (lead has an account in db but, the org is different)
    if (
      (!lead.account_id && current.org_id) ||
      (lead.account_id &&
        current.org_id &&
        lead?.Account.integration_id !== current.org_id)
    ) {
      logger.info('Organization has been linked with the person');

      // * Check if organization exists in database
      let [account, errForAccount] = await Repository.fetchOne({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          integration_id: current.org_id,
          integration_type: ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_ORGANIZATION,
        },
        include: {
          [DB_TABLES.USER]: {
            where: { company_id: user.company_id },
            required: true,
          },
        },
        //t,
      });
      if (errForAccount) {
        //  t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update Pipedrive person',
          error: `Failed to fetch account: ${errForAccount}`,
        });
      }

      // * Account not found, Create account
      if (!account) {
        // * Fetch CRM admin of the company
        const [crmAdmin, errCrmAdmin] = await Repository.fetchOne({
          tableName: DB_TABLES.COMPANY,
          query: {
            company_id: user.company_id,
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
        if (errCrmAdmin) {
          // t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update Pipedrive person',
            error: `Error while fetching company: ${errCrmAdmin}`,
          });
        }

        let crmAdminUserId = crmAdmin?.Company_Setting?.user_id;
        if (!crmAdminUserId) {
          //t.rollback();
          return notFoundResponseWithDevMsg({
            res,
            msg: 'Please set Cadence Administrator',
            error: 'Failed to update Pipedrive person',
          });
        }

        // * Fetch access token  token and instance URL
        const [{ access_token, instance_url }, errForAccessToken] =
          await AccessTokenHelper.getAccessToken({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            user_id: crmAdminUserId,
          });
        if (errForAccessToken) {
          // t.rollback();
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update Pipedrive person',
            error: `Error while fetching access token for pipedrive: ${errForAccessToken}.`,
          });
        }

        // * Fetch account from pipedrive
        let [organization, errFetchingOrganization] =
          await v2GrpcClients.crmIntegration.getAccount({
            integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
            integration_data: {
              id: current.org_id,
              access_token,
              instance_url,
            },
          });

        [account, errForAccount] = await Repository.create({
          tableName: DB_TABLES.ACCOUNT,
          createObject: {
            name: organization.data?.[organizationMap.name],
            size: organization.data?.[organizationMap.size],
            url: organization.data?.[organizationMap.url],
            country: organization.data?.[organizationMap.country],
            linkedin_url: organization.data?.[organizationMap.linkedin_url],
            integration_type: ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_ORGANIZATION,
            integration_id: organization.data.id,
            zipcode: organization.data?.[organizationMap.zip_code],
            phone_number: organization.data?.[organizationMap.phone_number],
            user_id: lead.user_id,
            company_id: user.company_id,
          },
          // t,
        });
      }

      await Repository.update({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: lead.lead_id,
        },
        updateObject: {
          account_id: account.account_id,
        },
        // t,
      });
    }

    // * If the lead has been unlinked with the company
    if (lead.account_id && !current.org_id) {
      logger.info('Lead has been unlinked with an account');
      await Repository.update({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: lead.lead_id,
        },
        updateObject: {
          account_id: null,
        },
        // t,
      });
    }

    // === END OF ORG CHANGES  =====

    /**
     * Things to change in the person (if any):
     * - first_name
     * - last_name
     * - full_name
     * - email
     * - phone
     */
    //const pipedriveMap = {
    //first_name: 'first_name',
    //last_name: 'last_name',
    //};

    let personToUpdate = {};

    // if a particular value in pipedrive is different than in our tool, then update it
    // for a particular value in pipedrive, key to check will be pipedriveMap[key] and object to check will be current
    // for a particular value in our tool, key to check will be key and object to check will be lead
    // exclude for emails and phone_numbers in this check as they are stored in another table
    for (let key in pipedrivePersonMap) {
      if (
        !['emails', 'phone_numbers'].includes(key) &&
        current[pipedrivePersonMap[key]] !== lead[key]
      )
        personToUpdate[key] = current[pipedrivePersonMap[key]];
    }

    if (Object.keys(personToUpdate).length > 0) {
      //if (updated)
      //updatedPerson[
      //'full_name'
      //] = `${current['first_name']} ${current['last_name']}`;
      personToUpdate.full_name = `${current[pipedrivePersonMap?.first_name]} ${
        current[pipedrivePersonMap?.last_name]
      }`;
      const [updatedLead, errForUpdatedLead] = await Repository.update({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: lead.lead_id,
        },
        updateObject: personToUpdate,
        // t,
      });
      if (errForUpdatedLead) {
        // t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update Pipedrive person',
          error: `Error while updating lead: ${errForUpdatedLead}`,
        });
      }
    }

    // delete all phone numbers
    await Repository.destroy({
      tableName: DB_TABLES.LEAD_PHONE_NUMBER,
      query: { lead_id: lead.lead_id },
      // t,
    });

    // update phone numbers
    if (Array.isArray(current?.[pipedrivePersonMap.phone_numbers])) {
      for (let phone_obj of current?.[pipedrivePersonMap.phone_numbers]) {
        if (!phone_obj.label) continue;

        await Repository.create({
          tableName: DB_TABLES.LEAD_PHONE_NUMBER,
          createObject: {
            lead_id: lead.lead_id,
            type: phone_obj.label,
            phone_number: phone_obj.value,
            is_primary: phone_obj.primary,
          },
          // t,
        });
      }
    }

    // delete all emails
    await Repository.destroy({
      tableName: DB_TABLES.LEAD_EMAIL,
      query: { lead_id: lead.lead_id },
      // t,
    });

    // update emails
    if (Array.isArray(current?.[pipedrivePersonMap.emails])) {
      for (let email_obj of current?.[pipedrivePersonMap.emails]) {
        if (!email_obj.label) continue;

        await Repository.create({
          tableName: DB_TABLES.LEAD_EMAIL,
          createObject: {
            lead_id: lead.lead_id,
            type: email_obj.label,
            email_id: email_obj.value,
            is_primary: email_obj.primary,
          },
          // t,
        });
      }
    }

    // t.commit();
    return successResponse(res, 'Successfully updated Person');
  } catch (err) {
    //t.rollback();
    logger.error('Error while updating pipedrive person: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating Pipedrive person: ${err.message}`,
    });
  }
};

const updatePipedriveOrganization = async (req, res) => {
  try {
    const { current, previous, meta } = req.body;
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR ORGANISATION FROM HOST: https://${meta.host}`
    );

    const receivedInstanceUrl = `https://${meta.host}`;

    if (meta.action === 'deleted') {
      const [deletableAccount, errForDeletableAccount] =
        await Repository.destroy({
          tableName: DB_TABLES.ACCOUNT,
          query: {
            integration_type: ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_ORGANIZATION,
            integration_id: meta.id,
          },
          // t
        });

      if (errForDeletableAccount)
        return notFoundResponseWithDevMsg({
          res,
          msg: 'Selected account does not exist',
          error: 'Account not found for deletion',
        });
      return successResponse(res, 'Successfully removed account from Cadence');
    }

    const [encryptedReceivedInstanceUrl, errForEncryptedReceivedInstanceUrl] =
      CryptoHelper.encrypt(receivedInstanceUrl);
    if (errForEncryptedReceivedInstanceUrl) {
      logger.error(
        `Error while encrypting instance url: `,
        errForEncryptedReceivedInstanceUrl
      );
      return successResponse(res);
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      include: {
        [DB_TABLES.PIPEDRIVE_TOKENS]: {
          where: {
            encrypted_instance_url: encryptedReceivedInstanceUrl,
          },
        },
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: `, errForUser);
      return successResponse(res);
    }
    if (!user) {
      logger.info('User not found for pipedrive person in webhook.');
      return successResponse(res);
    }
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR ORGANISATION FROM USER: ${user.user_id}`
    );

    const [account, errForAccount] = await Repository.fetchOne({
      tableName: DB_TABLES.ACCOUNT,
      query: {
        integration_type: ACCOUNT_INTEGRATION_TYPES.PIPEDRIVE_ORGANIZATION,
        integration_id: meta.id,
        company_id: user.company_id,
      },
    });
    if (errForAccount)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive organization',
        error: `Error while fetching account: ${errForAccount}`,
      });
    if (!account)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected account does not exist',
        error: 'Account not found',
      });

    /**
     * Things to change in the organization (if any):
     * - name
     * - country
     * - zipcode
     */

    let [pipedriveMap, errForPipedriveMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: account.user_id,
      });
    if (errForPipedriveMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive organization',
        error: `Error while fetching fieldmap for company from user: ${errForPipedriveMap}`,
      });

    // we need organization map
    pipedriveMap = pipedriveMap?.organization_map;

    let organizationToUpdate = {};

    for (let key in pipedriveMap) {
      if (
        !['emails', 'phone_numbers', 'size'].includes(key) &&
        current[pipedriveMap[key]] !== account[key]
      )
        organizationToUpdate[key] = current[pipedriveMap[key]];
      if ('size' === key) {
        let size = pipedriveMap?.size?.picklist_values.filter(
          (el) => current[pipedriveMap?.size?.name] === el.value
        );
        organizationToUpdate[key] = size?.[0]?.label;
      }
    }

    if (Object.keys(organizationToUpdate).length > 0) {
      const [updatedAccount, errForUpdatedAccount] = await Repository.update({
        tableName: DB_TABLES.ACCOUNT,
        query: {
          account_id: account.account_id,
        },
        updateObject: organizationToUpdate,
      });
      if (errForUpdatedAccount)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update Pipedrive organization',
          error: `Error while updating account: ${errForUpdatedAccount}`,
        });
    }

    return successResponse(res, 'Successfully updated organization.');
  } catch (err) {
    logger.error('Error while updating pipedrive organization: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating Pipedrive organization: ${err.message}`,
    });
  }
};

const updatePipedriveDeal = async (req, res) => {
  try {
    const { current, previous, meta } = req.body;
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR DEAL FROM HOST: https://${meta.host}`
    );

    const receivedInstanceUrl = `https://${meta.host}`;

    const [encryptedReceivedInstanceUrl, errForEncryptedReceivedInstanceUrl] =
      CryptoHelper.encrypt(receivedInstanceUrl);
    if (errForEncryptedReceivedInstanceUrl) {
      logger.error(
        `Error while encrypting instance url: `,
        errForEncryptedReceivedInstanceUrl
      );
      return successResponse(res);
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      include: {
        [DB_TABLES.PIPEDRIVE_TOKENS]: {
          where: {
            encrypted_instance_url: encryptedReceivedInstanceUrl,
          },
        },
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user: `, errForUser);
      return successResponse(res);
    }
    if (!user) {
      logger.info('User not found for pipedrive person in webhook.');
      return successResponse(res);
    }
    logger.info(
      `RECEIVED PIPEDRIVE WEBHOOK FOR DEAL FROM USER: ${user.user_id}`
    );

    const [opportunity, errForOpportunity] = await Repository.fetchOne({
      tableName: DB_TABLES.OPPORTUNITY,
      query: {
        integration_type: CRM_INTEGRATIONS.PIPEDRIVE,
        integration_id: meta.id,
        company_id: user.company_id,
      },
    });
    if (errForOpportunity)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive deal',
        error: `Error while fetching opportunity: ${errForAccount}`,
      });
    if (!opportunity)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected opportunity does not exist',
        error: 'Opportunity not found',
      });

    /**
     * Things to change in the deal (if any):
     * - name
     * - amount
     * - close date
     * - status -> won, lost, open, closed
     */

    let [pipedriveMap, errForPipedriveMap] =
      await CompanyFieldMapHelper.getFieldMapForCompanyFromUser({
        user_id: opportunity.user_id,
      });
    if (errForPipedriveMap)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update Pipedrive deal',
        error: `Error while fetching fieldmap for company from user: ${errForPipedriveMap}`,
      });

    // we need organization map
    pipedriveMap = pipedriveMap?.deal_map;

    let dealToUpdate = {};

    let status = OPPORTUNITY_STATUS.OPEN;

    for (let key in pipedriveMap) {
      if (current[pipedriveMap[key]] !== opportunity[key])
        dealToUpdate[key] = current[pipedriveMap[key]];

      if ('integration_stage' === key) {
        let integration_stage =
          pipedriveMap?.integration_stage?.picklist_values.filter(
            (el) => current[pipedriveMap?.integration_stage?.name] === el.value
          );
        dealToUpdate[key] = integration_stage?.[0]?.label;
        if (pipedriveMap?.integration_stage?.won.label == dealToUpdate[key])
          status = OPPORTUNITY_STATUS.WON;
        else if (
          pipedriveMap?.integration_stage?.lost.label == dealToUpdate[key]
        )
          status = OPPORTUNITY_STATUS.LOST;
      }
    }
    dealToUpdate.status = status;

    if (Object.keys(dealToUpdate).length > 0) {
      const [updatedDeal, errForUpdatedDeal] = await Repository.update({
        tableName: DB_TABLES.OPPORTUNITY,
        query: {
          opportunity_id: opportunity.opportunity_id,
        },
        updateObject: dealToUpdate,
      });
      if (errForUpdatedDeal)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update Pipedrive deal',
          error: `Error while updating opportunity: ${errForUpdatedDeal}`,
        });
    }

    return successResponse(res, 'Successfully updated pipedrive deal.');
  } catch (err) {
    logger.error('Error while updating pipedrive deal: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating Pipedrive deal: ${err.message}`,
    });
  }
};

const PipedriveController = {
  updatePipedrivePerson,
  updatePipedriveOrganization,
  updatePipedriveDeal,
};

module.exports = PipedriveController;
