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
const {
  WORKFLOW_TRIGGERS,
  WORKFLOW_DEFAULT_NAMES,
  WORKFLOW_LEVEL,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Db
const { sequelize } = require('../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../Cadence-Brain/src/repository');

// Joi
const workflowJOI = require('../../../joi/v2/admin/workflow.joi');

const createWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = workflowJOI.CreateWorkflowSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    // check if trigger already exists at company or cadence level
    const [existingWorkflow, errForExistingWorkflow] =
      await Repository.fetchOne({
        tableName: DB_TABLES.WORKFLOW,
        query: {
          trigger: req.body.trigger,
          company_id: req.user.company_id,
          cadence_id: req.body.cadence_id || null,
        },
        t,
      });

    if (errForExistingWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create workflow',
        error: `Error while fetching existing workflow: ${errForExistingWorkflow}`,
      });
    }
    if (existingWorkflow) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `Trigger already exists for this ${
          req.body.cadence_id ? WORKFLOW_LEVEL.CADENCE : WORKFLOW_LEVEL.COMPANY
        }.`,
      });
    }

    req.body.company_id = req.user.company_id;
    if (!req.body.name)
      req.body.name = WORKFLOW_DEFAULT_NAMES[req.body.trigger];

    const [createdWorkflow, errForCreatedWorkflow] = await Repository.create({
      tableName: DB_TABLES.WORKFLOW,
      createObject: req.body,
      t,
    });
    if (errForCreatedWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to create workflow',
        error: `Error while creating workflow: ${errForCreatedWorkflow}.`,
      });
    }

    t.commit();
    return successResponse(
      res,
      `Created trigger successfully.`,
      createdWorkflow
    );
  } catch (err) {
    t.rollback();
    logger.error(`Error while creating workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while creating workflow: ${err.message}.`,
    });
  }
};

const fetchWorkflow = async (req, res) => {
  try {
    const params = workflowJOI.fetchWorkflowSchema.validate(req.query);
    if (params.error)
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });

    const { cadence_id, option } = params.value;

    const [workflow, errForWorkflow] = await Repository.fetchAll({
      tableName: DB_TABLES.WORKFLOW,
      query: {
        cadence_id: option === WORKFLOW_LEVEL.CADENCE ? cadence_id : null,
        company_id: req.user.company_id,
      },
    });
    if (errForWorkflow)
      return serverErrorResponseWithDevMsg({
        res,
        msg: `Failed to fetch workflow`,
        error: `Error while fetching workflow: ${errForWorkflow}`,
      });
    if (!workflow) return successResponse(res, `No workflow found.`, []);

    return successResponse(res, `Fetched workflow successfully.`, workflow);
  } catch (err) {
    logger.error(`Error while fetching workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching workflow: ${err.message}.`,
    });
  }
};

const updateWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const params = workflowJOI.UpdateWorkflowSchema.validate(req.body);
    if (params.error) {
      t.rollback();
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }
    if (req.body.name === '' || req.body.trigger)
      req.body.name = WORKFLOW_DEFAULT_NAMES[req.body.trigger];

    const [data, err] = await Repository.update({
      tableName: DB_TABLES.WORKFLOW,
      query: { workflow_id: req.params.workflow_id },
      updateObject: { ...req.body },
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update workflow',
        error: `Error while updating workflow: ${err.message}`,
      });
    }

    t.commit();
    return successResponse(res, `Updated successfully.`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while updating workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating workflow: ${err.message}.`,
    });
  }
};

const deleteWorkflow = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [workflow, errForWorkflow] = await Repository.fetchOne({
      tableName: DB_TABLES.WORKFLOW,
      query: { workflow_id: req.params.workflow_id },
      t,
    });
    if (errForWorkflow) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete workflow',
        error: `Error while fetching trigger to delete: ${err.message}. `,
      });
    }
    if (!workflow) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to delete workflow',
        error: `Trigger not found`,
      });
    }
    if (
      workflow.trigger === WORKFLOW_TRIGGERS.WHEN_A_OWNER_CHANGES &&
      !workflow.cadence_id
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: `This trigger cannot be deleted`,
      });
    }

    const [data, err] = await Repository.destroy({
      tableName: DB_TABLES.WORKFLOW,
      query: { workflow_id: req.params.workflow_id },
      t,
    });
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete workflow',
        error: `Error while deleting workflow: ${err}.`,
      });
    }

    t.commit();
    return successResponse(res, `Deleted worflow successfully.`);
  } catch (err) {
    t.rollback();
    logger.error(`Error while deleting workflow: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting workflow: ${err.message}.`,
    });
  }
};

const WorkflowController = {
  createWorkflow,
  fetchWorkflow,
  updateWorkflow,
  deleteWorkflow,
};

module.exports = WorkflowController;
