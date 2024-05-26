const logger = require('../utils/winston');
const {
  unauthorizedResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../utils/response');
const { RINGOVER_DEV_AUTH } = require('../utils/config');

module.exports.ringoverDevAuth = (req, res, next) => {
  try {
    if (req.headers.authorization == undefined)
      return unauthorizedResponseWithDevMsg({ res });

    const authToken = req.headers.authorization.split(' ')[1];
    //console.log(authToken);
    if (RINGOVER_DEV_AUTH !== authToken)
      return unauthorizedResponseWithDevMsg({ res });

    next();
    return;
  } catch (err) {
    logger.error('Error while authorizing : ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while authorizing: ${err.message}`,
    });
  }
};
