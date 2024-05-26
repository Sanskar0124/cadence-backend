// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponse,
  badRequestResponse,
  serverErrorResponse,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_LEAD_STATUS,
  ACTIVITY_TYPE,
  SALESFORCE_SOBJECTS,
  ACTIVITY_SUBTYPES,
  ACCOUNT_INTEGRATION_TYPES,
  USER_INTEGRATION_TYPES,
  INTEGRATION_TYPE,
  OPPORTUNITY_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const SalesforceHelper = require('../../../../../../Cadence-Brain/src/helper/salesforce');
const CompanyFieldMapHelper = require('../../../../../../Cadence-Brain/src/helper/company-field-map');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

const updateOpportunity = async (req, res) => {
  try {
    const { opportunities } = req.body;
    if (opportunities === undefined || opportunities.length === 0)
      return badRequestResponse(res, 'Array cannot be empty.');

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        integration_id: opportunities[0]?.OwnerId,
      },
    });
    if (errForUser) {
      logger.error(`Error while fetching user:`, errForUser);
      return badRequestResponse(res, errForUser);
    }
    if (!user) {
      logger.error(`User not found.`);
      return badRequestResponse(res, `User not found.`);
    }

    // * Fetch salesforce field map
    let [salesforceFieldMap, errFetchingSalesforceFieldMap] =
      await SalesforceHelper.getFieldMapForCompanyFromCompany(
        user.company_id,
        SALESFORCE_SOBJECTS.OPPORTUNITY
      );
    if (errFetchingSalesforceFieldMap)
      return badRequestResponse(res, errFetchingSalesforceFieldMap);

    for (let opportunity of opportunities) {
      const [fetchedOpportunity, errForFetch] = await Repository.fetchOne({
        tableName: DB_TABLES.OPPORTUNITY,
        query: {
          integration_id: opportunity.salesforce_opportunity_id,
          integration_type: INTEGRATION_TYPE.SALESFORCE,
        },
      });
      if (errForFetch || !fetchedOpportunity) continue;

      if (
        (opportunity?.[salesforceFieldMap?.account] &&
          fetchedOpportunity.integration_account_id !=
            opportunity?.[salesforceFieldMap?.account]) ||
        (opportunity?.[salesforceFieldMap?.integration_owner_id] &&
          fetchedOpportunity.integration_owner_id !=
            opportunity?.[salesforceFieldMap?.integration_owner_id])
      ) {
        const [account, errForAccount] = await Repository.fetchOne({
          tableName: DB_TABLES.ACCOUNT,
          query: {
            integration_id: opportunity?.[salesforceFieldMap?.account],
          },
        });
        if (errForAccount || !account) {
          logger.error(
            `Error while fetching account while account change: `,
            errForAccount
          );
          continue;
        }

        const [user, errForUser] = await Repository.fetchOne({
          tableName: DB_TABLES.USER,
          query: {
            integration_id:
              opportunity?.[salesforceFieldMap?.integration_owner_id],
          },
        });
        if (errForUser)
          logger.error(
            `Error while fetching user while owner change for opportunity: `,
            errForUser
          );
        if (!user) logger.error(`User does not exist in our tool.`);

        let status = OPPORTUNITY_STATUS.OPEN;

        if (
          opportunity?.[salesforceFieldMap?.integration_stage.name] ===
          salesforceFieldMap?.integration_stage?.won?.value
        )
          status = OPPORTUNITY_STATUS.WON;
        else if (
          opportunity?.[salesforceFieldMap?.integration_stage.name] ===
          salesforceFieldMap?.integration_stage?.lost?.value
        )
          status = OPPORTUNITY_STATUS.LOST;

        const [updatedOpportunity, err] = await Repository.update({
          tableName: DB_TABLES.OPPORTUNITY,
          query: {
            opportunity_id: fetchedOpportunity.opportunity_id,
          },
          updateObject: {
            name: opportunity?.[salesforceFieldMap?.name],
            amount: opportunity?.[salesforceFieldMap?.amount],
            probability: opportunity?.[salesforceFieldMap?.probability],
            close_date: opportunity?.[salesforceFieldMap?.close_date],
            account_id: account?.account_id,
            integration_account_id: opportunity?.[salesforceFieldMap?.account],
            integration_stage:
              opportunity?.[salesforceFieldMap?.integration_stage?.name],
            integration_owner_id:
              opportunity?.[salesforceFieldMap?.integration_owner_id],
            user_id: user.user_id,
            company_id: user.company_id,
            status,
          },
        });
      } else {
        // check if status was changed to won or lost

        let status = OPPORTUNITY_STATUS.OPEN;

        if (
          opportunity?.[salesforceFieldMap?.integration_stage.name] ===
          salesforceFieldMap?.integration_stage?.won?.value
        )
          status = OPPORTUNITY_STATUS.WON;
        else if (
          opportunity?.[salesforceFieldMap?.integration_stage.name] ===
          salesforceFieldMap?.integration_stage?.lost?.value
        )
          status = OPPORTUNITY_STATUS.LOST;

        const [updatedOpportunity, err] = await Repository.update({
          tableName: DB_TABLES.OPPORTUNITY,
          query: {
            opportunity_id: fetchedOpportunity.opportunity_id,
          },
          updateObject: {
            name: opportunity?.[salesforceFieldMap?.name],
            amount: opportunity?.[salesforceFieldMap?.amount],
            probability: opportunity?.[salesforceFieldMap?.probability],
            close_date: opportunity?.[salesforceFieldMap?.close_date],
            integration_stage:
              opportunity?.[salesforceFieldMap?.integration_stage?.name],
            status: status,
          },
        });
      }
    }
    return successResponse(res, 'Opportunity updated successfully.');
  } catch (err) {
    logger.error('Error while updating salesforce opportunity: ', err);
    return serverErrorResponse(res);
  }
};

const deleteOpportunities = async (req, res) => {
  let t = await sequelize.transaction();
  let count = 0;
  try {
    const { opportunities } = req.body;

    /**
     * Currently Opportunites are only associated with
     * 1. Account
     * 2. User
     * Hence we can delete the opportunity without deleting
     * Associated Models
     */

    for (let opportunity of opportunities) {
      let [deletedOpportunity, errForDeletedOpportunity] =
        await Repository.destroy({
          tableName: DB_TABLES.OPPORTUNITY,
          query: {
            integration_id: opportunity.salesforce_opportunity_id,
            integration_type: INTEGRATION_TYPE.SALESFORCE,
          },
          t,
        });
      count++;
      if (errForDeletedOpportunity) {
        logger.error(
          `An error occurred while deleting opportunity ${opportunity.salesforce_opportunity_id}`,
          err.message
        );
        continue;
      }
    }

    t.commit();
    logger.info(`Successfully deleted ${count} opportunities`);
    return successResponse(res, `Successfully deleted ${count} opportunities`);
  } catch (err) {
    t.rollback();
    logger.error('Error while deleting opportunities', err);
    return serverErrorResponse(
      res,
      `An error occured while deleting opportunity ${err?.message}`
    );
  }
};

module.exports = {
  updateOpportunity,
  deleteOpportunities,
};
