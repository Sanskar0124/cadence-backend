// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  CADENCE_LEAD_STATUS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Packages
const { Op } = require('sequelize');

// DB
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

const getNodeStats = async (req, res) => {
  try {
    const { node_id } = req.params;
    if (node_id == null || node_id === '')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch step stats',
        error: 'Node id cannot be null',
      });

    const currentTimeInUnix = new Date().getTime();

    const [leadsOnCurrentNode, errForLeadsOnCurrentNode] =
      await Repository.fetchAll({
        tableName: DB_TABLES.TASK,
        query: { node_id, completed: 0, is_skipped: 0 },
        include: {
          [DB_TABLES.LEAD]: {
            where: {
              status: {
                [Op.in]: [LEAD_STATUS.ONGOING, LEAD_STATUS.NEW_LEAD],
              },
            },
            attributes: [],
            required: true,
            [DB_TABLES.LEADTOCADENCE]: {
              where: {
                status: { [Op.in]: [CADENCE_LEAD_STATUS.IN_PROGRESS] },
              },
              attributes: [],
              required: true,
            },
          },
          [DB_TABLES.USER]: {
            attributes: [
              'user_id',
              'first_name',
              'last_name',
              'is_profile_picture_present',
              'profile_picture',
            ],
          },
        },
        extras: {
          attributes: [
            [
              sequelize.literal(`COUNT(CASE
                  WHEN start_time > ${currentTimeInUnix}
                  THEN 1
                  ELSE NULL
              END ) `),
              'scheduled_count',
            ],
            [
              sequelize.literal(`COUNT(CASE
                  WHEN start_time < ${currentTimeInUnix}
                  THEN 1
                  ELSE NULL
              END ) `),
              'count',
            ],
            'user_id',
            'start_time',
          ],
          group: [['user_id']],
        },
      });
    if (errForLeadsOnCurrentNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch step stats',
        error: `Error while fetching leads on current node: ${errForLeadsOnCurrentNode}`,
      });

    return successResponse(res, 'Node stats fetched successfully.', {
      leadsOnCurrentNode,
    });
  } catch (err) {
    logger.error('Error while fetching node stats: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching node stats: ${err.message}`,
    });
  }
};

const NodeController = {
  getNodeStats,
};

module.exports = NodeController;
