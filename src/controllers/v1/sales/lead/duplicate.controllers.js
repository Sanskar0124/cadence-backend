// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponse,
  badRequestResponse,
  notFoundResponse,
} = require('../../../../utils/response');

// Repositories
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');

// Helpers and services
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');

const getDuplicatesForLead = async (req, res) => {
  try {
    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: req.user.integration_type,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponse(res, errForAccessToken);
    else if (errForAccessToken) return serverErrorResponse(res);

    const [duplicates, err] = await SalesforceService.getDuplicates(
      req.params.id,
      access_token,
      instance_url
    );
    if (err) return badRequestResponse(res, err);

    if (duplicates === null || duplicates.length === 0)
      return notFoundResponse(res, 'No duplicates found');

    let leadDuplicates = [],
      accountDuplicates = [];
    duplicates.forEach((duplicate) => {
      if (duplicate.attributes.type === 'Lead') leadDuplicates.push(duplicate);
      else accountDuplicates.push(duplicate);
    });

    return successResponse(res, 'Duplicates fetched.', {
      leadDuplicates,
      accountDuplicates,
    });
  } catch (err) {
    logger.error(`Error while fetching duplicates: `, err);
    return serverErrorResponse(res);
  }
};

const mergeDuplicateLeads = async (req, res) => {
  try {
    const { salesforce_lead_id, duplicate_ids } = req.body;
    if (
      salesforce_lead_id === '' ||
      salesforce_lead_id === undefined ||
      duplicate_ids === '' ||
      duplicate_ids === undefined
    ) {
      return badRequestResponse(
        res,
        'Send salesforce_lead_id and duplicate_id'
      );
    }

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: req.user.integration_type,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponse(res, errForAccessToken);
    else if (errForAccessToken) return serverErrorResponse(res);

    const [lead_id, err] = await SalesforceService.mergeDuplicates(
      salesforce_lead_id,
      duplicate_ids,
      access_token
    );
    if (err) {
      return serverErrorResponse(res, err);
    }
    return successResponse(res, 'Merged successfully');
  } catch (err) {
    logger.error(`Error while merging duplicates: `, err);
    return serverErrorResponse(res);
  }
};

const updateDuplicateLeadStatus = async (req, res) => {
  try {
    let lead = req.body;
    if (lead.lead_id === null || lead.lead_id === undefined)
      return res.status(400).send({
        msg: 'Lead id cannot be empty',
      });
    lead.duplicate = false;
    const [lead_id, err] = await LeadRepository.updateLead(lead);
    if (err) return serverErrorResponse(res, err);
    return successResponse(res, 'Removed duplicate successfully');
  } catch (err) {
    logger.error(`Error while updating duplicate lead value: `, err);
    return serverErrorResponse(res);
  }
};

const DuplicateController = {
  getDuplicatesForLead,
  mergeDuplicateLeads,
  updateDuplicateLeadStatus,
};

module.exports = DuplicateController;
