// * Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
} = require('../../../../utils/response');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  CADENCE_ACTIONS,
  NODE_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const { Op } = require('sequelize');

// * Repository
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// * JOI Import
const cadenceTemplateSchema = require('../../../../joi/v2/sales/department/cadence-template.joi');

// * Helper Imports
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');

// * Fetch cadence templates
const fetchCadenceTemplates = async (req, res) => {
  try {
    // * JOI Validation
    let query = cadenceTemplateSchema.fetchCadenceTemplate.validate(req.query);
    if (query.error) {
      logger.error(
        `A JOI error occurred while fetching cadence templates: ${query.error} `,
        { user_id: req.user.user_id }
      );
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: query.error.message,
      });
    }
    query = {};

    if (req.query?.created_at)
      query.created_at = {
        [Op.lt]: req.query.created_at,
      };
    if (req.query?.language) query.language = req.query?.language;
    if (req.query?.type) query.type = req.query?.type;
    if (req.query?.search)
      query.name = sequelize.where(
        sequelize.fn('lower', sequelize.col('name')),
        {
          [Op.like]: `%${req.query.search.toLowerCase()}%`,
        }
      );

    // * Fetch all templates
    let [cadenceTemplates, errFetchingCadenceTemplates] =
      await Repository.fetchAll({
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        query,
        extras: {
          attributes: [
            'cadence_template_id',
            'name',
            'type',
            'language',
            'nodes',
            'created_at',
          ],
          order: [['created_at', 'DESC']],
          limit: 10,
        },
      });
    if (errFetchingCadenceTemplates)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadenceTemplates,
      });

    return successResponse(
      res,
      'Successfully fetched cadence templates',
      cadenceTemplates
    );
  } catch (err) {
    logger.error(`An error occurred while fetching cadence templates`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

// * Use cadence template
const useCadenceTemplate = async (req, res) => {
  try {
    // * JOI validation
    let body = cadenceTemplateSchema.useCadenceTemplate.validate(req.body);
    if (body.error) {
      logger.error(
        `A JOI error occurred while using cadence template: ${body.error} `,
        { user_id: req.user.user_id }
      );
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;

    let promiseArray = [];

    // * Fetch cadence
    promiseArray.push(
      Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: {
          cadence_id: body.cadence_id,
          company_id: req.user.company_id,
        },
        include: {
          [DB_TABLES.NODE]: {
            attributes: ['node_id'],
          },
        },
      })
    );

    // * Fetch template
    promiseArray.push(
      Repository.fetchOne({
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        query: {
          cadence_template_id: body.cadence_template_id,
        },
      })
    );

    let values = await Promise.all(promiseArray);

    let [cadence, errFetchingCadence] = values[0];
    let [cadenceTemplate, errFetchingCadenceTemplate] = values[1];

    // * Cadence error handling
    if (errFetchingCadence)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadence,
      });
    if (!cadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Cadence not found',
      });

    // * Cadence template error handling
    if (errFetchingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadenceTemplate,
      });
    if (!cadenceTemplate)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Cadence template not found',
      });

    // * Check access
    let [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence,
      user: req.user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Error while using cadence template',
        error: errForAccess,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    if (cadence.Nodes.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cadence templates can only be used for without any steps',
      });

    // * Create nodes for cadence
    let createdNodeStepToIdMap = {};
    let previousNode = null;
    for (let node of cadenceTemplate.nodes) {
      node.cadence_id = cadence.cadence_id;

      // * Handle Replied to Node
      if (
        [NODE_TYPES.REPLY_TO, NODE_TYPES.AUTOMATED_REPLY_TO].includes(node.type)
      )
        if (createdNodeStepToIdMap[node.data.replied_node_id])
          node.data.replied_node_id =
            createdNodeStepToIdMap[node.data.replied_node_id];
        else
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Error while creating a step for "Replied to"',
          });

      // * create a node
      const [createdNode, errForNode] = await CadenceHelper.addNodeToCadence(
        node,
        previousNode?.node_id
      );
      if (errForNode)
        return serverErrorResponseWithDevMsg({
          res,
          error: errForNode,
        });

      if (
        [
          NODE_TYPES.REPLY_TO,
          NODE_TYPES.AUTOMATED_REPLY_TO,
          NODE_TYPES.MAIL,
          NODE_TYPES.AUTOMATED_MAIL,
        ].includes(createdNode.type)
      )
        createdNodeStepToIdMap[createdNode.step_number] = createdNode.node_id;

      previousNode = createdNode;
    }

    return successResponse(res, 'Successfully used cadence template');
  } catch (err) {
    logger.error(`An error occurred while populating cadence with template`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

module.exports = {
  fetchCadenceTemplates,
  useCadenceTemplate,
};
