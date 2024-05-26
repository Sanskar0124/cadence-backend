// Utils
const logger = require('../../../utils/winston');
const {
  serverErrorResponse,
  successResponse,
  badRequestResponse,
} = require('../../../utils/response');
const { TRACKING_URL } = require('../../../utils/config');

// Helpers and services
const LinkStoreHelper = require('../../../../../Cadence-Brain/src/helper/link-store');

const getShortenedLink = async (req, res) => {
  try {
    const { redirectUrl, linkText } = req.body;
    if (!(redirectUrl && linkText))
      return badRequestResponse(
        res,
        'Please provide redirect url and linkText.'
      );

    const [url, err] = await LinkStoreHelper.getShortenedUrlExport(
      redirectUrl,
      linkText
    );
    if (err) {
      logger.error(`Error while creating shortened url: ${err.message}`);
      return serverErrorResponse(res, 'Error while creating shortened url.');
    }
    return successResponse(res, '', TRACKING_URL + url);
  } catch (err) {
    logger.error(`Error while creating shortened url: `, err);
    return serverErrorResponse(res, 'Error while creating shortened url.');
  }
};

module.exports = {
  getShortenedLink,
};
