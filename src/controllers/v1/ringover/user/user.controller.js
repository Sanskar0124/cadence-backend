// * Package Imports
const axios = require('axios');

// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and services
const RingoverHelper = require('../../../../../../Cadence-Brain/src/helper/ringover-service');
const Ringover = require('../../../../../../Cadence-Brain/src/services/Ringover');

const getInfo = async (req, res) => {
  try {
    // * Fetch Ringover Numbers
    let [numbers, errFetchingNumbers] = await RingoverHelper.getNumbers({
      access_token: req.user.access_token,
      region: req.user.region,
    });
    if (errFetchingNumbers)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Kindly login with Ringover from your Profile page',
        error: `Error while fetching number: ${errFetchingNumbers}`,
      });

    return successResponse(
      res,
      'Successfully retrieved ringover user data.',
      numbers
    );
  } catch (err) {
    logger.error(`Error while fetching ringover user: ${err.message}`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching ringover user: ${err.message}`,
    });
  }
};

const userController = { getInfo };

module.exports = userController;
