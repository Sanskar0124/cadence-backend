// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  CRM_INTEGRATIONS,
  LEAD_SCORE_RUBRIKS,
  LEAD_INTEGRATION_TYPES,
  SALESFORCE_SOBJECTS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Repository
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const LeadScoreHelper = require('../../../../../../Cadence-Brain/src/helper/lead-score/');
const SalesforceHelpers = require('../../../../../../Cadence-Brain/src/helper/salesforce');

const updateAccountQualification = async (req, res) => {
  try {
    const { id: salesforce_account_id } = req.params;
    const { salesforce_contact_id } = req.body;
    if (salesforce_account_id === null || salesforce_account_id === undefined)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update account qualification',
        error: 'Salesforce account id is incorrect',
      });

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update account qualification',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    else if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update account qualification',
        error: `Error while fetching salesforce accesstoken: ${errForAccessToken}`,
      });

    const [qualificationInfo, err] =
      await SalesforceService.updateAccountQualification(
        salesforce_account_id,
        req.body,
        access_token,
        instance_url
      );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update account qualification',
        error: `Error while updating account qualification: ${err}`,
      });

    // Lead Scoring Process: START
    // Fetch Company Field Map
    const [salesforceFieldMap, errForSalesforceFieldMap] =
      await SalesforceHelpers.getFieldMapForCompanyFromUser(
        req.user.user_id,
        SALESFORCE_SOBJECTS.ACCOUNT
      );

    // Fetch Contact and Account Association
    // All Contact Statuses will essentially change through a webhook
    // But only the contact in this context should get a lead score increment

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: {
        salesforce_contact_id,
      },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'integration_type', 'email'],
        },
        [DB_TABLES.ACCOUNT]: {
          attributes: ['integration_status'],
        },
      },
    });

    // Score the contact
    const [scoredLead, errForScoredLead] =
      await LeadScoreHelper.updateLeadScore({
        lead,
        rubrik: LEAD_SCORE_RUBRIKS.STATUS_UPDATE,
        current_status:
          req?.body?.[salesforceFieldMap?.integration_status?.name],
        previous_status: lead?.Account?.integration_status,
        field_map: salesforceFieldMap,
      });
    if (errForScoredLead)
      logger.error(
        'An error occured while scoring lead for account status update',
        errForScoredLead
      );

    return successResponse(
      res,
      'Account qualification details updated successfully.'
    );
  } catch (err) {
    logger.error(
      `Error while updating account qualification info: ${err.message}.`
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating account qualification info: ${err.message}`,
    });
  }
};

const updateLeadQualification = async (req, res) => {
  try {
    const { id: salesforce_lead_id } = req.params;
    if (salesforce_lead_id === null || salesforce_lead_id === undefined)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update lead qualification',
        error: 'Salesforce lead id is incorrect',
      });

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update lead qualification',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    else if (errForAccessToken)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead qualification',
        error: `Error while fetching salesforce access token: ${errForAccessToken}`,
      });

    const [qualificationInfo, err] =
      await SalesforceService.updateLeadQualification(
        salesforce_lead_id,
        req.body,
        access_token,
        instance_url
      );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update lead qualification',
        error: `Error while updating lead qualification: ${err}`,
      });
    return successResponse(
      res,
      'Lead qualification details updated successfully.'
    );
  } catch (err) {
    logger.error(
      `Error while updating lead qualification info: ${err.message}.`
    );
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating lead qualification info: ${err.message}`,
    });
  }
};

module.exports = {
  updateAccountQualification,
  updateLeadQualification,
};
