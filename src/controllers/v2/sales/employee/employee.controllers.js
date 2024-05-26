// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  USER_ROLE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Helpers and Services
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');

const searchLeads = async (req, res) => {
  try {
    const searchText = req.body?.search?.trim();
    if (searchText === '') return successResponse(res, 'Search is empty');

    // * Construct user query
    let userQuery = {
      user_id: req.user.user_id,
    };
    if ([USER_ROLE.ADMIN, USER_ROLE.SUPER_ADMIN].includes(req.user.role))
      userQuery = {
        company_id: req.user.company_id,
      };

    const [leads, err] = await LeadHelper.searchLeads(searchText, userQuery);
    if (err) {
      logger.error('Error searching leads: ', err);
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to search leads',
        error: `Error while searching leads: ${err.message}.`,
      });
    }

    if (leads.length === 0) return successResponse(res, 'No leads found');

    return successResponse(res, 'Leads found', leads);
  } catch (err) {
    logger.error(`Error while searching leads: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while searching leads: ${err.message}.`,
    });
  }
};

const EmployeeContoller = {
  searchLeads,
};

module.exports = EmployeeContoller;
