// Utils
const logger = require('../../../utils/winston');
const {
  successResponse,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');

// Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');

const getAllCadence = async (req, res) => {
  try {
    const [cadences, errForCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.CADENCE,
      query: {},
      include: {
        [DB_TABLES.USER]: {
          where: {
            company_id: req.company_id,
          },
          attributes: [],
          required: true,
        },
      },
      extras: {
        attributes: ['name', 'cadence_id'],
      },
    });
    if (errForCadences)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadences',
        error: `Error while fetching cadences: ${errForCadences}`,
      });
    return successResponse(res, `Fetched cadences successfully`, cadences);
  } catch (err) {
    logger.error(`Error while fetching cadences: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching cadences: ${err.message}`,
    });
  }
};

const CadenceController = {
  getAllCadence,
};

module.exports = CadenceController;
