// Utils
const { successResponse } = require('../../../utils/response');
const logger = require('../../../utils/winston');

// * Service imports
const AmazonService = require('../../../../../Cadence-Brain/src/services/Amazon');

const reportFrontendBug = async (req, res) => {
  try {
    // * Alert mail
    AmazonService.sendHtmlMails({
      subject: '[ERROR] : FRONTEND CRASHED.',
      body: `
          <html> 
            <body> 
                <p>${JSON.stringify(req.body)}</p>
            </body>
          </html>
        `,
      emailsToSend: ['yuvi@bjtmail.com', 'sambhav.jain@bjtmail.com'],
    });

    return successResponse(res, 'Successfully reported bug');
  } catch (err) {
    logger.error('Error reporting frontend bug : ', {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error reporting frontend bug: ${err.message}`,
    });
  }
};

module.exports = {
  reportFrontendBug,
};
