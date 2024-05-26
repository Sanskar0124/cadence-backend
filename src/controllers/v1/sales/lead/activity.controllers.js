// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  ACTIVITY_TYPE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Repositories
const ActivityRepository = require('../../../../../../Cadence-Brain/src/repository/activity.repository');

const markActivityAsRead = async (req, res) => {
  try {
    const { activity_id } = req.params;

    const [data, errForData] = await ActivityRepository.updateActivity(
      {
        read: 1,
      },
      {
        activity_id: parseInt(activity_id),
      }
    );

    if (errForData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to mark activity as read',
        error: `Error while marking activity ${activity_id} as read: ${errForData}`,
      });

    if (data && !data[0])
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected activity does not exist',
        error: `No activity found with id ${activity_id}`,
      });

    return successResponse(res, `Marked activity ${activity_id} as read.`);
  } catch (err) {
    logger.error(`Error while marking activity as read: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while marking activity as read: ${err.message}.`,
    });
  }
};

const ActivityController = {
  markActivityAsRead,
};

module.exports = ActivityController;
