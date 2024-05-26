// Utils
const logger = require('../../../utils/winston');
const {
  DB_TABLES,
} = require('../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../utils/response');

// Db
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Joi
const automatedWorkflowJOI = require('../../../joi/v2/admin/automated-workflow.joi');

const createAutomatedWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params =
      automatedWorkflowJOI.CreateSalesforceAutomatedWorkflowSchema.validate(
        req.body
      );
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const [createdAutomatedWorkflow, errForCreatingAutomateWorkflow] =
      await Repository.create({
        tableName: DB_TABLES.AUTOMATED_WORKFLOW,
        createObject: {
          ...req.body,
          company_id: req.user.company_id,
        },
        t,
      });
    if (errForCreatingAutomateWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create automated workflow',
        error: `Error while creating trigger: ${errForCreatingAutomateWorkflow}.`,
      });
    }

    t.commit();
    return successResponse(
      res,
      `Created automated workflow successfully.`,
      createdAutomatedWorkflow
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating an automated workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating an automated workflow: ${err.message}.`,
    });
  }
};

const fetchAutomatedWorkflows = async (req, res) => {
  try {
    const [workflow, errForWorkflow] = await Repository.fetchAll({
      tableName: DB_TABLES.AUTOMATED_WORKFLOW,
      query: {
        company_id: req.user.company_id,
      },
    });
    if (errForWorkflow)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch automated workflows',
        error: `Error while fetching automated workflows: ${errForWorkflow}`,
      });

    return successResponse(
      res,
      `Fetched automated workflows successfully.`,
      workflow
    );
  } catch (err) {
    logger.error(`Error while fetching automated workflows: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching automated workflow: ${err.message}.`,
    });
  }
};

const updateAutomatedWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params =
      automatedWorkflowJOI.CreateSalesforceAutomatedWorkflowSchema.validate(
        req.body
      );
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    const [data, err] = await Repository.update({
      tableName: DB_TABLES.AUTOMATED_WORKFLOW,
      query: { aw_id: req.params.aw_id, company_id: req.user.company_id },
      updateObject: { ...req.body },
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update automated workflow',
        error: `Error while updating automated workflow: ${err}`,
      });
    }

    t.commit();
    return successResponse(res, `Updated successfully.`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while updating automated workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating automated workflow: ${err.message}.`,
    });
  }
};

const deleteAutomatedWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [workflow, errForWorkflow] = await Repository.fetchOne({
      tableName: DB_TABLES.AUTOMATED_WORKFLOW,
      query: { aw_id: req.params.aw_id, company_id: req.user.company_id },
      t,
    });
    if (errForWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated workflow',
        error: `Error while fetching trigger to delete: ${errForWorkflow} `,
      });
    }
    if (!workflow) {
      t.rollback();
      return badRequestResponseWithDevMsg({ res, msg: `Trigger not found` });
    }

    const [data, err] = await Repository.destroy({
      tableName: DB_TABLES.AUTOMATED_WORKFLOW,
      query: { aw_id: req.params.aw_id, company_id: req.user.company_id },
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete automated workflow',
        error: `Error while deleting automated workflow: ${err}.`,
      });
    }

    t.commit();
    return successResponse(res, `Deleted automated workflow successfully.`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while automated deleting workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting automated workflow: ${err.message}.`,
    });
  }
};

const AutomatedWorkflowController = {
  createAutomatedWorkflow,
  fetchAutomatedWorkflows,
  updateAutomatedWorkflow,
  deleteAutomatedWorkflow,
};

module.exports = AutomatedWorkflowController;
