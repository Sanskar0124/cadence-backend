// Utils
const {
  serverErrorResponseWithDevMsg,
  successResponse,
  unprocessableEntityResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  badRequestResponseWithDevMsg,
} = require('../../../utils/response');
const logger = require('../../../utils/winston');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const { NODE_TYPES } = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const { Op } = require('sequelize');

// * Repository
const Repository = require('../../../../../Cadence-Brain/src/repository');

// * Helper Imports
const NodeHelper = require('../../../../../Cadence-Brain/src/helper/node');

// * Joi import
const cadenceTemplateSchema = require('../../../joi/v2/support/cadence-template.joi');

// * Create cadence template
const createCadenceTemplate = async (req, res) => {
  try {
    // * JOI Validation
    let body = cadenceTemplateSchema.createCadenceTemplate.validate(req.body);
    if (body.error) {
      logger.error(
        `A JOI error occurred while creating cadence template: ${body.error} `,
        { user_id: req.user.user_id }
      );
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;

    // * Validate nodes
    for (let node of body.nodes) {
      if (
        node.type === NODE_TYPES.REPLY_TO ||
        node.type === NODE_TYPES.AUTOMATED_REPLY_TO
      ) {
        // * Find the step
        let repliedToNode = body.nodes.filter(
          (el) => el.step_number === node.data.replied_node_id
        );
        if (!repliedToNode.length)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Replied to node has incorrect data',
          });

        // * Check if repliedToNode is a MAIL step
        if (
          ![
            NODE_TYPES.REPLY_TO,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.MAIL,
            NODE_TYPES.AUTOMATED_MAIL,
          ].includes(repliedToNode[0].type)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Replied to node has incorrect data',
          });
      }
      const [_, errValidationNode] = NodeHelper.isValidNode(node);
      if (errValidationNode)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add step',
          error: errValidationNode,
        });
    }

    // * Create the template
    let [cadenceTemplate, errCreatingCadenceTemplate] = await Repository.create(
      {
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        createObject: { ...body, user_id: req.user.user_id },
      }
    );
    if (errCreatingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errCreatingCadenceTemplate,
      });

    // * Success response
    return successResponse(
      res,
      'Successfully created cadence template',
      cadenceTemplate
    );
  } catch (err) {
    logger.error(`An error occurred while create a cadence template`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

// * Fetch all cadence templates
const fetchAllCadenceTemplates = async (req, res) => {
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
    query = query.value;

    if (req.query?.created_at)
      query.updated_at = {
        [Op.lt]: req.query.created_at,
      };
    if (req.query?.language) query.language = req.query?.language;
    if (req.query?.type) query.type = req.query?.type;

    // * Fetch all templates
    let [cadenceTemplates, errFetchingCadenceTemplates] =
      await Repository.fetchAll({
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        query,
        include: {
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
          order: [['created_at', 'DESC']],
          limit: 10,
        },
      });
    if (errFetchingCadenceTemplates)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadenceTemplates,
      });

    // * Success response
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

// * Update cadence template
const updateCadenceTemplate = async (req, res) => {
  try {
    // * JOI Validation
    let body = cadenceTemplateSchema.createCadenceTemplate.validate(req.body);
    if (body.error) {
      logger.error(
        `A JOI error occurred while creating cadence template: ${body.error} `,
        { user_id: req.user.user_id }
      );
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: body.error.message,
      });
    }
    body = body.value;

    // * Get cadence template
    let [cadenceTemplate, errFetchingCadenceTemplate] =
      await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        query: {
          cadence_template_id: req.params.id,
        },
      });
    if (errFetchingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadenceTemplate,
      });
    if (!cadenceTemplate)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Cadence template does not exist',
      });

    // * Validate nodes
    for (let node of body.nodes) {
      if (
        node.type === NODE_TYPES.REPLY_TO ||
        node.type === NODE_TYPES.AUTOMATED_REPLY_TO
      ) {
        // * Find the step
        let repliedToNode = body.nodes.filter(
          (el) => el.step_number === node.data.replied_node_id
        );
        if (!repliedToNode.length)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Replied to node has incorrect data',
          });

        // * Check if repliedToNode is a MAIL step
        if (
          ![
            NODE_TYPES.REPLY_TO,
            NODE_TYPES.AUTOMATED_REPLY_TO,
            NODE_TYPES.MAIL,
            NODE_TYPES.AUTOMATED_MAIL,
          ].includes(repliedToNode[0].type)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Replied to node has incorrect data',
          });
      }
      const [_, errValidationNode] = NodeHelper.isValidNode(node);
      if (errValidationNode)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to add step',
          error: errValidationNode,
        });
    }

    // * Update the template
    let [_, errUpdatingCadenceTemplate] = await Repository.update({
      tableName: DB_TABLES.CADENCE_TEMPLATE,
      query: {
        cadence_template_id: cadenceTemplate.cadence_template_id,
      },
      updateObject: { ...body },
    });
    if (errUpdatingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errUpdatingCadenceTemplate,
      });

    // * Success response
    return successResponse(res, 'Successfully updated cadence template');
  } catch (err) {
    logger.error(`An error occurred while updating a cadence template`, {
      err,
      user_id: req.user.user_id,
    });
    return serverErrorResponseWithDevMsg({
      res,
      error: err.message,
    });
  }
};

// * Delete cadence template
const deleteCadenceTemplate = async (req, res) => {
  try {
    // * Get cadence template
    let [cadenceTemplate, errFetchingCadenceTemplate] =
      await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE_TEMPLATE,
        query: {
          cadence_template_id: req.params.id,
        },
      });
    if (errFetchingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errFetchingCadenceTemplate,
      });
    if (!cadenceTemplate)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Cadence template does not exist',
      });

    // * Delete the template
    let [_, errDeletingCadenceTemplate] = await Repository.destroy({
      tableName: DB_TABLES.CADENCE_TEMPLATE,
      query: {
        cadence_template_id: cadenceTemplate.cadence_template_id,
      },
    });
    if (errDeletingCadenceTemplate)
      return serverErrorResponseWithDevMsg({
        res,
        error: errDeletingCadenceTemplate,
      });

    // * Success response
    return successResponse(res, 'Successfully deleted cadence template');
  } catch (err) {
    logger.error(`An error occurred while deleting a cadence template`, {
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
  createCadenceTemplate,
  fetchAllCadenceTemplates,
  updateCadenceTemplate,
  deleteCadenceTemplate,
};
