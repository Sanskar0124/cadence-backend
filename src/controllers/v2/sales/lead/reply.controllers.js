// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

// Repositories
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');

// Helpers and Services
const NodeHelper = require('../../../../../../Cadence-Brain/src/helper/node');

// Joi
const replySchema = require('../../../../joi/v2/sales/lead/reply.joi');

const getPreviousNodes = async (req, res) => {
  try {
    const params = replySchema.getPreviousNodesSchema.validate(req.body);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { node_id, cadence_id } = req.body;

    // * retreive all nodes in cadence
    const [nodesInCadence, errForNodesInCadence] =
      await NodeRepository.getNodes({ cadence_id });
    if (errForNodesInCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch previous node',
        error: `Error while fetching nodes: ${errForNodesInCadence}`,
      });

    // * No nodes in cadence
    if (!nodesInCadence.length)
      return successResponse(res, 'Fetched cadence but no nodes present.', {
        ...requiredCadence,
        sequence: [],
      });

    // * sort all nodes in sequence
    const [nodesInSequence, errForNodesInSequence] =
      NodeHelper.getNodesInSequence(nodesInCadence);
    if (errForNodesInSequence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch previous node',
        error: `Error while fetching nodes in sequence: ${errForNodesInSequence}`,
      });

    const [mailNodes, errForMailNodes] = NodeHelper.getMailNodes(
      nodesInSequence,
      node_id
    );
    if (errForMailNodes)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch previous node',
        error: `Error while fetching mail nodes: ${errForMailNodes}`,
      });

    return successResponse(
      res,
      'Fetched previous mail nodes in sequence',
      mailNodes
    );
  } catch (err) {
    logger.error('Error while getting previous nodes: ', err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching previous nodes: ${err.message}`,
    });
  }
};
const replyControllers = {
  getPreviousNodes,
};

module.exports = replyControllers;
