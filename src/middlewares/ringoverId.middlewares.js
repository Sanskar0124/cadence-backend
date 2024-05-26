// Utils
const {
  badRequestResponseWithDevMsg,
  forbiddenResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../utils/response');

// Repositories
const UserRepository = require('../../../Cadence-Brain/src/repository/user-repository');

module.exports = async (req, res, next) => {
  try {
    const [user, err] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (err)
      return badRequestResponseWithDevMsg({
        res,
        error: `Error while fetching user by query: ${err}`,
      });

    if (!user.ringover_user_id)
      return forbiddenResponseWithDevMsg({
        res,
        error: 'Ringover user id is not present',
      });

    req.user = { ...user, ...req.user };
    next();
  } catch (err) {
    logger.error('Error while checking ringover id middleware:', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while checking ringover id middleware: ${err.message}`,
    });
  }
};
