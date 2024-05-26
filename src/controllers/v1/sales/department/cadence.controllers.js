// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  unprocessableEntityResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  LEAD_STATUS,
  NODE_TYPES,
  CADENCE_STATUS,
  CADENCE_LEAD_STATUS,
  EMAIL_STATUS,
  ACTIVITY_TYPE,
  COMPANY_CONTACT_REASSIGNMENT_OPTIONS,
  COMPANY_ACCOUNT_REASSIGNMENT_OPTIONS,
  CADENCE_ACTIONS,
  WORKFLOW_TRIGGERS,
  CRM_INTEGRATIONS,
  BULK_OPTIONS,
  SHEETS_CADENCE_INTEGRATION_TYPE,
  SETTING_TYPES,
  ACTIVITY_SUBTYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  LEAD_CADENCE_ORDER_MAX,
  INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE,
} = require('../../../../../../Cadence-Brain/src/utils/constants');

// Packages
const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');
const TaskRepository = require('../../../../../../Cadence-Brain/src/repository/task.repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const AccountRepository = require('../../../../../../Cadence-Brain/src/repository/account.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');
const EmailRepository = require('../../../../../../Cadence-Brain/src/repository/email.repository');

// Helpers and Services
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const SalesforceService = require('../../../../../../Cadence-Brain/src/services/Salesforce');
const ActivityHelper = require('../../../../../../Cadence-Brain/src/helper/activity');
const TaskHelper = require('../../../../../../Cadence-Brain/src/helper/task');
const WorkflowHelper = require('../../../../../../Cadence-Brain/src/helper/workflow');
const JsonHelper = require('../../../../../../Cadence-Brain/src/helper/json');
const AutomatedTasksHelper = require('../../../../../../Cadence-Brain/src/helper/automated-tasks');
const AccessTokenHelper = require('../../../../../../Cadence-Brain/src/helper/access-token');
const LeadToCadenceHelper = require('../../../../../../Cadence-Brain/src/helper/lead-to-cadence');
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');

// Joi
const CadenceJoi = require('../../../../joi/v1/sales/department');
const GoogleSheetsLeadSchema = require('../../../../joi/v2/sales/department/cadence-imports/google-sheets-imports.joi');
const ExcelLeadSchema = require('../../../../joi/v2/sales/department/cadence-imports/excel-imports.joi');

const updateCadence = async (req, res) => {
  try {
    const { id: cadence_id } = req.params;

    // validate field map only if integration_type is google sheet or excel
    if (req.body.field_map) {
      let fieldMapValidation = { error: '' };
      if (req.user.integration_type === CRM_INTEGRATIONS.GOOGLE_SHEETS)
        fieldMapValidation = GoogleSheetsLeadSchema.fieldMapSchema.validate(
          req.body.field_map
        );
      else if (req.user.integration_type === CRM_INTEGRATIONS.EXCEL)
        fieldMapValidation = ExcelLeadSchema.fieldMapSchema.validate(
          req.body.field_map
        );
      else delete req.body.field_map; // if any other integration type dont allow to update field map

      if (fieldMapValidation.error)
        return unprocessableEntityResponseWithDevMsg({
          res,
          error: `For field map: ${fieldMapValidation.error.message}`,
        });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update cadence',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.SUB_DEPARTMENT]: {
          attributes: ['department_id'],
          [DB_TABLES.DEPARTMENT]: {
            attributes: ['company_id'],
          },
        },
      },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
        error: `No cadence found`,
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const [existingNameCadence, errForExistingNameCadence] =
      await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE,
        query: { name: req.body?.name?.trim() || '' },
        include: {
          [DB_TABLES.USER]: {
            where: {
              company_id: user.company_id,
            },
            required: true,
          },
        },
      });
    if (
      existingNameCadence &&
      existingNameCadence.cadence_id !== req.body.cadence_id
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: `A cadence with same name exists, please use another name`,
      });

    if (req.body.status) delete req.body.status;

    if (req.body.priority)
      TaskHelper.recalculateDailyTasksForCadenceUsers(cadence_id);

    const [data, err] = await CadenceRepository.updateCadence(
      { cadence_id },
      req.body
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update cadence',
        error: `Error while updating cadence: ${err}`,
      });

    if (cadence.salesforce_cadence_id) {
      // Fetching salesforce token and instance url
      const [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          user_id: req.user.user_id,
        });
      if (errForAccessToken)
        return successResponse(res, 'Kindly login with salesforce to update.');

      req.body.salesforce_cadence_id = cadence.salesforce_cadence_id;
      req.body.cadence_id = cadence_id;
      const [updatedSalesforceCadence, errForSalesforce] =
        await SalesforceService.updateCadence(
          req.body,
          access_token,
          instance_url
        );
    }

    //* update scheduled time
    if (req.body.scheduled) {
      const [schedules, errForSchedules] = await Repository.fetchOne({
        tableName: DB_TABLES.CADENCE_SCHEDULE,
        query: { cadence_id },
      });

      if (errForSchedules)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update cadence',
          error: `Error while fetching cadence schedule: ${errForSchedules}`,
        });

      if (!schedules) {
        //create schedules if not present (in pause and not_started)
        const [createdSchedule, errForCreatingSchedule] =
          await Repository.create({
            tableName: DB_TABLES.CADENCE_SCHEDULE,
            createObject: {
              cadence_id,
              launch_at: req.body.launch_at,
            },
          });
        if (errForCreatingSchedule)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update cadence',
            error: `Error while creating cadence schedule: ${errForCreatingSchedule}`,
          });
      } else {
        const [scheduleUpdate, errForScheduleUpdate] = await Repository.update({
          tableName: DB_TABLES.CADENCE_SCHEDULE,
          query: { cadence_id },
          updateObject: {
            launch_at: req.body.launch_at,
          },
        });

        if (errForScheduleUpdate)
          return serverErrorResponseWithDevMsg({
            res,
            msg: 'Failed to update cadence',
            error: `Error while updating cadence schedule: ${errForScheduleUpdate}`,
          });
      }
    } else {
      const [schedules, errForRemovingSchedule] = await Repository.destroy({
        tableName: DB_TABLES.CADENCE_SCHEDULE,
        query: {
          cadence_id,
        },
      });

      if (errForRemovingSchedule)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to update cadence',
          error: `Error while deleting cadence schedule: ${errForRemovingSchedule}`,
        });
    }

    return successResponse(res, 'Cadence updated successfully.');
  } catch (err) {
    logger.error(`Error while updating cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating cadence: ${err.message}`,
    });
  }
};

const updateCadenceName = async (req, res) => {
  try {
    const { id: cadence_id } = req.params;

    const [cadence, errForCadence] = await CadenceRepository.getCadence({
      cadence_id,
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
      });

    const [data, err] = await CadenceRepository.updateCadence(
      { cadence_id },
      {
        name: req.body.name,
      }
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update cadence name',
        error: `Error while updating cadence: ${err}`,
      });

    return successResponse(res, 'Cadence name updated successfully.');
  } catch (err) {
    logger.error(`Error while updating cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating cadence name: ${err.message}`,
    });
  }
};

const deleteCadence = async (req, res) => {
  try {
    let { id: cadence_id } = req.params;
    cadence_id = parseInt(cadence_id);

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          required: false,
          attributes: ['lead_id'],
        },
        // [DB_TABLES.USER]: {
        //   attributes: ['sd_id', 'company_id'],
        // },
        // [DB_TABLES.SUB_DEPARTMENT]: {
        //   attributes: ['department_id'],
        //   [DB_TABLES.DEPARTMENT]: {
        //     attributes: ['company_id'],
        //   },
        // },
      },
      extras: {
        attributes: [
          'cadence_id',
          'status',
          'user_id',
          'sd_id',
          'company_id',
          'salesforce_cadence_id',
          'type',
        ],
      },
    });

    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadence',
        error: `Error while fetching cadence data: ${errForCadence}`,
      });

    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
      });

    // Checks if cadence is running. If it is, it cannot be deleted
    if (cadence?.status === CADENCE_STATUS.IN_PROGRESS)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'This cadence is running. It cannot be deleted.',
      });
    if (
      cadence?.salesforce_cadence_id === INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: `You cannot delete a product tour cadence`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user: req.user,
      action: CADENCE_ACTIONS.DELETE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const lead_ids = cadence?.LeadToCadences?.map((ltc) => ltc.lead_id);

    const [deletedCadence, errForDeletedCadence] =
      await CadenceHelper.deleteAllCadenceInfo({
        cadence_id,
        lead_ids,
      });
    if (errForDeletedCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete cadence',
        error: `Error while deleting cadence from db: ${errForDeletedCadence}`,
      });

    logger.info(deletedCadence);

    // Delete automatedTasks belonging to this cadence
    AutomatedTasksHelper.deleteAutomatedTasks({ cadence_id });

    // if (cadence.salesforce_cadence_id) {
    //   // Fetching salesforce token and instance url
    //   const [{ access_token, instance_url }, errForAccessToken] =
    //     await AccessTokenHelper.getAccessToken({
    //       integration_type: CRM_INTEGRATIONS.SALESFORCE,
    //       user_id: req.user.user_id,
    //     });
    //   if (errForAccessToken === 'Please log in with salesforce')
    //     return successResponse(
    //       res,
    //       'Cadence deleted in the tool. To delete in salesforce, kindly login.'
    //     );

    //   req.body.salesforce_cadence_id = cadence.salesforce_cadence_id;
    //   const [updatedSalesforceCadence, errForSalesforce] =
    //     await SalesforceService.deleteCadence(
    //       req.body,
    //       access_token,
    //       instance_url
    //     );
    // }

    return successResponse(
      res,
      'Cadence deleted successfully. Leads will be deleted shortly.'
    );
  } catch (err) {
    logger.error(`Error while deleting cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting cadence: ${err.message}`,
    });
  }
};

const stopCadenceForLead = async (req, res) => {
  try {
    // * retreive lead id,status,reason,cadence_ids
    let { lead_ids, status, reason, cadence_ids } = req.body;

    for (const lead_id of lead_ids) {
      const [data, err] = await CadenceHelper.stopCadenceForLead(
        lead_id,
        status,
        reason,
        cadence_ids,
        req.user
      );
      if (err) {
        if (
          [
            `Cannot stop cadence for a lead. It's already stopped.`,
            'Lead not found',
            'Invalid status sent.',
          ].includes(err)
        )
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to stop cadence for a lead',
            error: `Error while stop cadence for lead: ${err}`,
          });
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to stop cadence for a lead',
          error: `Error while stopping cadence for a lead: ${err}`,
        });
      }

      logger.info(`Lead ${lead_id} updated with status ${status}.`);

      // Delete automatedTasks belonging to this cadence
      AutomatedTasksHelper.deleteAutomatedTasks({
        lead_id,
        cadence_id: {
          [Op.in]: cadence_ids,
        },
      });
    }

    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);

    cadence_ids.forEach((cadence_id) =>
      lead_ids.forEach((workflow_lead_id) =>
        WorkflowHelper.applyWorkflow({
          trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_IS_MANUALLY_STOPPED,
          cadence_id,
          lead_id: workflow_lead_id,
        })
      )
    );

    return successResponse(res, 'Stopped cadence for lead.');
  } catch (err) {
    logger.error(`Error while stopping cadence for a lead: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while stopping cadence for a lead: ${err.message}`,
    });
  }
};

const pauseCadenceForLead = async (req, res) => {
  try {
    const { lead_ids, cadence_ids, pauseFor } = req.body;
    if (!Array.isArray(lead_ids) || !Array.isArray(cadence_ids))
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence for lead',
        error: 'Please provide array of lead ids and cadence ids',
      });

    if (!cadence_ids.length || !lead_ids.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence for lead',
        error: `Please provide atleast 1 lead_id and 1 cadence_id`,
      });

    for (const lead_id of lead_ids) {
      const [data, err] = await CadenceHelper.pauseCadenceForLead(
        lead_id,
        cadence_ids,
        pauseFor,
        req.user
      );
      if (err)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to pause cadence for lead',
          error: `Error while pausing cadence for lead: ${err}`,
        });

      AutomatedTasksHelper.deleteAutomatedTasks({
        lead_id,
        cadence_id: cadence_ids,
      });

      for (let cadence_id of cadence_ids)
        await WorkflowHelper.applyWorkflow({
          trigger: WORKFLOW_TRIGGERS.WHEN_A_CADENCE_IS_PAUSED,
          cadence_id,
          lead_id,
        });
    }
    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);
    return successResponse(res, 'Paused cadence for leads.');
  } catch (err) {
    logger.error(`Error while pausing cadence for a lead: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while pausing cadence for a lead: ${err.message}`,
    });
  }
};

const resumeCadenceForLead = async (req, res) => {
  try {
    // * retreive lead_id from body
    const { lead_id, cadence_ids } = req.body;

    const [data, err] = await CadenceHelper.resumeCadenceForLead(
      lead_id,
      cadence_ids
    );
    if (err) {
      logger.error(`Error while resuming cadence for lead: ${err}`, {
        user_id: req.user.user_id,
      });
      if (
        [
          `Cannot resume cadence for a lead. Since its already stopped.`,
          `Cannot resume the cadence since the cadence is not started or paused.`,
        ].includes(err)
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to resume cadence for a lead',
          error: `Error while resuming cadence for lead: ${err}`,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to resume cadence for a lead',
        error: `Error while resuming cadence for a lead`,
      });
    }

    // recalculate tasks for this user
    TaskHelper.recalculateDailyTasksForUsers([req.user.user_id]);

    return successResponse(
      res,
      'Successfully resumed cadence and created task for lead.'
    );
  } catch (err) {
    logger.error(`Error while resuming cadence for a lead: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while resuming cadence for a lead: ${err.message}`,
    });
  }
};

const getCadenceSidebarForLead = async (req, res) => {
  try {
    let { lead_id, cadence_id } = req.params;
    lead_id = parseInt(lead_id);
    cadence_id = parseInt(cadence_id);

    const [lead, errForLead] = await Repository.fetchOne({
      tableName: DB_TABLES.LEAD,
      query: { lead_id },
      include: {
        [DB_TABLES.LEADTOCADENCE]: {
          required: false,
          where: { cadence_id },
          [DB_TABLES.CADENCE]: {
            attributes: ['name'],
            [DB_TABLES.NODE]: {
              attributes: ['node_id'],
              required: false,
            },
          },
        },
      },
      extras: {
        attributes: ['lead_id'],
      },
    });
    if (errForLead)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence data',
        error: `Error while fetching lead: ${errForLead}.`,
      });

    if (!lead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: `No lead found with id ${lead_id}`,
      });

    if (!lead?.LeadToCadences?.length)
      return badRequestResponseWithDevMsg({
        res,
        msg: `Lead is not present in any active cadence`,
      });

    // * to return response
    let cadenceLead = lead.LeadToCadences[0];
    const nodeIds = cadenceLead.Cadences[0].Nodes.map((node) => node.node_id);
    cadenceLead.name = cadenceLead.Cadences[0].name;
    delete cadenceLead.Cadences;

    const [nodesWithTask, errForNodesWithTask] = await Repository.fetchAll({
      tableName: DB_TABLES.NODE,
      query: {
        cadence_id,
        node_id: { [Op.in]: nodeIds },
      },
      include: {
        [DB_TABLES.TASK]: {
          where: { lead_id },
          attributes: ['completed', 'complete_time', 'is_skipped', 'metadata'],
          required: false,
        },
        [DB_TABLES.EMAIL]: {
          where: { lead_id },
          attributes: ['status'],
          required: false,
        },
      },
      extras: {
        order: [['step_number', 'ASC']],
        attributes: {
          include: [
            [
              sequelize.literal(
                'CASE WHEN Tasks.completed=1 THEN "completed" WHEN Tasks.is_skipped=1 THEN "skipped" WHEN Tasks.completed=0 THEN "ongoing" ELSE "not_created" END'
              ),
              'status',
            ],
          ],
        },
      },
    });
    if (errForNodesWithTask)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence data',
        error: `Error while fetching nodes with task: ${errForNodesWithTask}`,
      });

    return successResponse(res, 'Fetched nodes for sidebar.', [
      {
        cadence: cadenceLead,
        nodes: nodesWithTask,
      },
    ]);
  } catch (err) {
    logger.error(`Error while fetching cadence sidebar for lead: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const launchCadence = async (req, res) => {
  const t = await sequelize.transaction();
  const { cadence_id } = req.params;

  let ogStatus;
  try {
    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
      t,
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to launch cadence',
        error: `Error while fetching user: ${errForUser}`,
      });
    }

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
        [DB_TABLES.NODE]: { attributes: ['node_id'] },
      },
      t,
    });
    if (!cadence) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
        error: `Cadenece not found`,
      });
    }
    if (errForCadence) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to launch cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    }
    // if its a product tour cadence, then you cannot launch through this route
    if (
      cadence.salesforce_cadence_id === INTEGRATION_ID_FOR_PRODUCT_TOUR_CADENCE
    ) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        error: `You cannot launch product tour cadence`,
      });
    }

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to launch cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    }
    if (!access) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });
    }
    if (cadence.Nodes.length === 0) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You can’t launch cadence with 0 steps',
      });
    }
    if (cadence.status === CADENCE_STATUS.PROCESSING) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot resume a cadence that is currently processing. Kindly try again later',
      });
    }
    if (cadence.status === CADENCE_STATUS.IN_PROGRESS) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cadence is already in progress',
      });
    }

    ogStatus = cadence.status;

    const [cadenceStatusUpdate, errForStatusUpdate] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { status: CADENCE_STATUS.PROCESSING },
      query: { cadence_id },
    });
    if (errForStatusUpdate) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to launch cadence',
        error: `Error while updating cadence status: ${errForStatusUpdate}`,
      });
    }

    successResponse(
      res,
      //'Cadence processing has been started, tasks for sales persons will be created soon.'
      'Cadence is in process, tasks will be created soon. Please come back later.'
    );

    const [launchCadence, errForLaunchCadenceManager] =
      await CadenceHelper.launchCadenceManager({ cadence, user, t });
    if (errForLaunchCadenceManager) {
      await t.rollback();
      // Update cadence status to original status

      const [updateCadenceToOgStatus, errForUpdate] = await Repository.update({
        tableName: DB_TABLES.CADENCE,
        updateObject: { status: ogStatus },
        query: { cadence_id },
      });
      logger.error(
        `Error while launching cadence with launch cadence manager: `,
        {
          err: errForLaunchCadenceManager,
          user_id: user.user_id,
        }
      );
    }

    // Commit transaction
    t.commit();

    if (!res.headersSent)
      return successResponse(res, `Cadence launched successfully`);
  } catch (err) {
    await t.rollback();
    const [updateCadenceToOgStatus, errForUpdate] = await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { status: ogStatus },
      query: { cadence_id },
    });
    logger.error(`Error while launching cadence:`, err);
  }
};

const pauseCadenceForTime = async (req, res) => {
  try {
    const { cadence_id, pause_for } = req.body;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [cadence, errForCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'company_id'] },
      },
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
        error: `Cadenece not found`,
      });
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence',
        error: `Error while fetching cadence: ${errForCadence}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    // If cadence status in paused, you cannot pasue the cadence again
    if (cadence.status === CADENCE_STATUS.PAUSED)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot pause a cadence that is already paused',
      });

    // If cadence status in processing, you cannot pasue the process
    if (cadence.status === CADENCE_STATUS.PROCESSING)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You cannot pause a cadence while it is processing',
      });

    // Updating cadence status to processing
    await Repository.update({
      tableName: DB_TABLES.CADENCE,
      updateObject: { status: CADENCE_STATUS.PROCESSING },
      query: { cadence_id },
    });

    successResponse(
      res,
      'Cadence processing has started, the cadence will be paused soon.'
    );

    unixTS = pause_for;

    // Delete automatedTasks belonging to this cadence
    AutomatedTasksHelper.deleteAutomatedTasks({ cadence_id });

    //create activities for only those whose cadence is 'IN_PROGRESS'
    const [leadToCadences, errForLeadToCadences] = await Repository.fetchAll({
      tableName: DB_TABLES.LEADTOCADENCE,
      query: {
        cadence_id: cadence.cadence_id,
        status: CADENCE_LEAD_STATUS.IN_PROGRESS,
      },
      include: {
        [DB_TABLES.LEAD]: {
          [DB_TABLES.USER]: {},
        },
      },
    });

    const [activityFromTemplate, errForActivityFromTemplate] =
      ActivityHelper.getActivityFromTemplates({
        type: ACTIVITY_TYPE.PAUSE_CADENCE,
        variables: {
          cadence_name: cadence.name,
          first_name: user?.first_name || null,
          last_name: user?.last_name || null,
        },
      });

    CadenceHelper.pauseCadenceActivity({
      leadToCadences,
      cadence_id,
      cadence,
      activity: activityFromTemplate,
    });

    //const activities = await Promise.all(
    //leadToCadences.map(async (leadToCadence) => {
    //const activity_status = `Cadence Paused  ${
    //pause_for ? 'till ' + pause_for : ''
    //}`;

    ////const [task, errForTask] = await TaskRepository.getTask({
    ////lead_id: leadToCadence.lead_id,
    ////cadence_id: cadence_id,
    ////completed: false,
    ////is_skipped: false,
    ////});
    ////if (errForTask) logger.error(errForTask);

    //const [activityFromTemplate, errForActivityFromTemplate] =
    //ActivityHelper.getActivityFromTemplates({
    //type: ACTIVITY_TYPE.PAUSE_CADENCE,
    //variables: {
    //cadence_name: cadence.name,
    //},
    //activity: {
    //cadence_id: leadToCadence.cadence_id,
    //lead_id: leadToCadence.lead_id,
    //user_id: leadToCadence?.Leads[0].user_id,
    //incoming: null,
    ////node_id: task?.node_id ?? null,
    //},
    //});

    //return activityFromTemplate;
    //})
    //);

    //const [sendingActivity, errForSendingActivity] =
    //await ActivityHelper.bulkActivityCreation(activities);
    //if (errForSendingActivity) logger.error(errForSendingActivity);

    // recalculate tasks for users belonging to this cadence
    TaskHelper.recalculateDailyTasksForCadenceUsers(cadence_id);

    // Updating cadence status to paused
    const [data, err] = await CadenceRepository.updateCadence(
      { cadence_id },
      { status: CADENCE_STATUS.PAUSED, unix_resume_at: unixTS }
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to pause cadence',
        error: `Error while updating cadence: ${err}`,
      });
    if (cadence.salesforce_cadence_id) {
      // Fetching salesforce token and instance url
      const [{ access_token, instance_url }, errForAccessToken] =
        await AccessTokenHelper.getAccessToken({
          integration_type: CRM_INTEGRATIONS.SALESFORCE,
          user_id: req.user.user_id,
        });

      [updatedSalesforceCadence, errForSalesforce] =
        await SalesforceService.updateCadence(
          {
            salesforce_cadence_id: cadence.salesforce_cadence_id,
            status: CADENCE_STATUS.PAUSED,
          },

          access_token,
          instance_url
        );
    }
  } catch (err) {
    //console.log(err);
    logger.error(`Error while pausing cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while pausing cadence: ${err.message}`,
    });
  }
};

const getCadenceStatistics = async (req, res) => {
  try {
    const { cadence_id } = req.params;

    const [cadence, errForCadence] =
      await CadenceRepository.getForCadenceStatistics({ cadence_id });

    if (errForCadence) return serverErrorResponse(res, errForCadence);
    if (!cadence)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to fetch cadence statistics',
        error: 'Cadence not found',
      });

    const totalLeadsPromise =
      LeadToCadenceRepository.getLeadToCadenceLinkByQuery({
        cadence_id,
      });

    // const [finishedLeads, errForFinishedLeads] =
    //   await LeadToCadenceRepository.getCountForLeadToCadenceLinkByLeadQuery(
    //     { cadence_id, status: CADENCE_LEAD_STATUS.STOPPED },
    //     {
    //       status: LEAD_STATUS.CONVERTED,
    //     }
    //   );

    // * retreive finishedLeads stats
    const finishedLeadsPromise = TaskRepository.getTasksByNodeQuery(
      // * completed tasks for last node of the cadence
      {
        cadence_id,
        completed: 1,
      },
      {
        next_node_id: null,
      }
    );

    // * retreive activeLeads stats
    const activeLeadsPromise =
      LeadToCadenceRepository.getCountForLeadToCadenceLinkByLeadQuery(
        { cadence_id, status: CADENCE_LEAD_STATUS.IN_PROGRESS },
        {}
      );

    // * retreive deletedLeads stats
    const deletedLeadsPromise =
      LeadToCadenceRepository.getCountForLeadToCadenceLinkByLeadQuery(
        { cadence_id },
        {
          status: LEAD_STATUS.TRASH,
        }
      );
    // * retreive converted stats
    const convertedLeadsPromise =
      LeadToCadenceRepository.getCountForLeadToCadenceLinkByLeadQuery(
        { cadence_id },
        {
          status: LEAD_STATUS.CONVERTED,
        }
      );

    const [
      [cadenceLeads, errForCadenceLeads],
      [finishedLeads, errForFinishedLeads],
      [activeLeads, errForActiveLeads],
      [deletedLeads, errForDeletedLeads],
      [convertedLeads, errForConvertedLeads],
    ] = await Promise.all([
      totalLeadsPromise,
      finishedLeadsPromise,
      activeLeadsPromise,
      deletedLeadsPromise,
      convertedLeadsPromise,
    ]);

    if (errForCadenceLeads) return serverErrorResponse(res, errForCadenceLeads);

    if (errForFinishedLeads)
      return serverErrorResponse(
        res,
        `Error while fetching finished leads: ${errForFinishedLeads}.`
      );

    if (errForActiveLeads)
      return serverErrorResponse(
        res,
        `Error while fetching active leads: ${errForActiveLeads}.`
      );

    if (errForDeletedLeads)
      return serverErrorResponse(
        res,
        `Error while fetching deleted leads: ${errForDeletedLeads}.`
      );

    if (errForConvertedLeads)
      return serverErrorResponse(
        res,
        `Error while fetching converted leads: ${errForConvertedLeads}.`
      );

    // * total leads
    const LEADS_LENGTH = cadenceLeads.length;

    const nodes = cadence?.Nodes;

    // * result to return
    let result = {
      cadenceName: cadence?.name,
      metrics: {
        totalLeads: LEADS_LENGTH || 0,
        finishedLeads: finishedLeads?.length || 0,
        activeLeads: activeLeads?.length || 0,
        deletedLeads: deletedLeads?.length || 0,
        convertedLeads: convertedLeads?.length || 0,
      },
      nodeStats: {},
    };

    // * loop for all nodes
    for (let node of nodes) {
      // * retreive all tasks for a node
      const tasks = node.Tasks;

      // * find all completed tasks
      const completedTasks = tasks.filter((task) => task.completed).length;
      // * save its value in number and in percentage
      result['nodeStats'][node.step_number] = {
        name: node.name,
        node_id: node.node_id,
        value: completedTasks,
        percentValue: LEADS_LENGTH
          ? ((completedTasks / LEADS_LENGTH) * 100).toFixed(2)
          : (0).toFixed(2),
        data: node.type === 'linkedin' ? node.data : null,
      };
    }

    return successResponse(res, 'Fetched statistics.', result);
  } catch (err) {
    logger.error(`Error while fetching cadence statistics: `, err);
    return serverErrorResponse(res, err.message);
  }
};

// * Stop cadence for lead and assign a new cadence
const stopCadenceForLeadAndReplaceCadence = async (req, res) => {
  try {
    const params =
      CadenceJoi.stopCadenceForLeadAndReplaceCadenceSchema.validate(req.body);
    if (params.error) {
      if (
        params.error.message
          ?.toLowerCase()
          ?.includes('cadence_to_start must be different from cadence_to_stop')
      )
        return unprocessableEntityResponseWithDevMsg({
          res,
          msg: 'You cannot move lead in same cadence',
        });
      return unprocessableEntityResponseWithDevMsg({
        res,
        error: params.error.message,
      });
    }

    let { cadence_to_stop, lead_ids, cadence_to_start, option } = req.body;
    option = option || BULK_OPTIONS.SELECTED;

    const [cadenceToStart, errForRequiredCadence] = await Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: { cadence_id: cadence_to_start },
      include: {
        [DB_TABLES.USER]: {
          attributes: ['user_id', 'company_id'],
          required: true,
        },
      },
    });
    if (errForRequiredCadence)
      return serverErrorResponseWithDevMsg({
        res,
        error: `Error while fetching cadence to start: ${errForRequiredCadence}`,
        msg: 'Cadence to start not found',
      }); // * Unable to fetch cadence to start
    if (!cadenceToStart)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected cadence not found',
        error: 'Targeted cadence not found!',
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadenceToStart,
      user: req.user,
      action: CADENCE_ACTIONS.REASSIGN,
    });
    if (errForAccess) {
      return serverErrorResponseWithDevMsg({
        res,
        msg: "User don't have access to selected cadence",
        error: `Error for cadence action access: ${errForAccess}`,
      });
    }

    // * Add cadence to start to Recent actions
    Repository.upsert({
      tableName: DB_TABLES.RECENT_ACTION,
      upsertObject: {
        user_id: req.user.user_id,
        cadence_id: cadence_to_start,
      },
    });

    if (req.user.integration_type === CRM_INTEGRATIONS.SHEETS) {
      if (
        cadenceToStart.integration_type ===
        SHEETS_CADENCE_INTEGRATION_TYPE.SHEETS
      ) {
        const errorMessage =
          'Move to another cadence is not supported for google sheets leads or cadence with google sheet leads';
        logger.error(errorMessage);
        return [null, errorMessage];
      } else {
        let [updateCadence, errForUpdatingCadence] = await Repository.update({
          tableName: DB_TABLES.CADENCE,
          query: { cadence_id: cadenceToStart.cadence_id },
          updateObject: {
            integration_type: SHEETS_CADENCE_INTEGRATION_TYPE.EXCEL,
          },
        });
        if (errForUpdatingCadence) {
          const errorMessage = `Error while updating cadence type: ${errForUpdatingCadence}`;
          logger.error(errorMessage);
          return [null, errorMessage];
        }
      }
    }

    successResponse(res, 'Reassigning cadence process has started.');

    // Background proccess for moving leads to another cadence
    // * Fetch leads
    let leads, errForLeads;
    if (option == BULK_OPTIONS.SELECTED) {
      [leads, errForLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {
          lead_id: {
            [Op.in]: lead_ids,
          },
        },
        include: {
          [DB_TABLES.ACCOUNT]: {},
          [DB_TABLES.USER]: {
            attributes: ['timezone'],
          },
        },
      });
    } else if (option == BULK_OPTIONS.ALL) {
      [leads, errForLeads] = await Repository.fetchAll({
        tableName: DB_TABLES.LEAD,
        query: {},
        include: {
          [DB_TABLES.LEADTOCADENCE]: {
            where: {
              cadence_id: cadence_to_stop,
            },
            required: true,
          },
          [DB_TABLES.ACCOUNT]: {},
          [DB_TABLES.USER]: {
            attributes: ['timezone'],
          },
        },
      });
    }
    if (errForLeads)
      return logger.error(
        `Error while fetching leads from cadence: ${errForLeads}`
      );

    if (leads.length > 0)
      LeadHelper.moveLeadsToAnotherCadence({
        cadence_ids_to_stop: [cadence_to_stop],
        cadenceToStart,
        option,
        user: req.user,
        leads,
      });
    else logger.info('No lead to transfer!');

    logger.info('Move to cadence done.');
  } catch (err) {
    logger.error(`Error while assigning leads to a different cadence: `, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while stopping cadence: ${err.message}`,
    });
  }
};

const changeStatusForLeadInCadence = async (req, res) => {
  try {
    const { lead_id, cadence_id, status } = req.body;
    if (
      (cadence_id === null || cadence_id === undefined) &&
      (lead_id === null || lead_id === undefined)
    )
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to change status for lead in cadence',
        error: 'Provide a valid lead id and cadence id list',
      });

    // Fetching lead
    const [lead, errForLead] = await LeadRepository.getLeadByQuery({
      lead_id,
    });
    if (!lead)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected lead does not exist',
        error: 'Lead not found',
      });
    if (errForLead)
      return serverErrorResponse(
        res,
        `Error while fetching cadence: ${errForCadence}`
      );
    if (lead.status === LEAD_STATUS.STOPPED)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Cannot change lead status if lead has been stopped',
      });

    // Fetching cadence
    const [cadence, errForCadence] = await CadenceRepository.getCadence({
      cadence_id,
    });
    if (!cadence)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Selected cadence does not exist',
        error: 'Cadence not found',
      });
    if (errForCadence)
      return serverErrorResponse(
        res,
        `Error while fetching cadence: ${errForCadence}`
      );

    if (status === CADENCE_LEAD_STATUS.PAUSED) {
      let [data, err] = await CadenceHelper.pauseCadenceForLead(
        lead_id,
        [cadence_id],
        null,
        req.user
      );
      if (err)
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Failed to change status for lead in cadence',
          error: `Error while pausing cadence for lead: ${err}`,
        });

      await CadenceHelper.updateCadenceMemberStatusInSalesforce(
        lead,
        cadence,
        status
      );

      logger.info(`Lead with ${lead_id} updated with status ${status}.`);
      return successResponse(res, 'Paused cadence for lead.');
    } else if (status === CADENCE_LEAD_STATUS.IN_PROGRESS) {
      if (cadence.status === CADENCE_STATUS.IN_PROGRESS) {
        let [data, err] = await CadenceHelper.resumeCadenceForLead(lead_id, [
          cadence_id,
        ]);
        if (err)
          return badRequestResponseWithDevMsg({
            res,
            msg: 'Failed to change status for lead in cadence',
            error: `Error while resuming cadence for lead: ${err}`,
          });

        await CadenceHelper.updateCadenceMemberStatusInSalesforce(
          lead,
          cadence,
          status
        );

        logger.info(`Lead with ${lead_id} updated with status ${status}.`);
        return successResponse(res, 'Resumed cadence for lead.');
      } else {
        return badRequestResponseWithDevMsg({
          res,
          msg: 'Change the cadence status to in progress in order to change it for this lead',
        });
      }
    } else if (status === CADENCE_LEAD_STATUS.STOPPED) {
      const [data, err] = await CadenceHelper.stopCadenceForLead(
        lead_id,
        status,
        req.body.reason ?? 'No reason provided',
        [cadence_id],
        req.user
      );
      if (err) return serverErrorResponse(res, err);

      await CadenceHelper.updateCadenceMemberStatusInSalesforce(
        lead,
        cadence,
        status
      );

      logger.info(`Lead with ${lead_id} updated with status ${status}.`);
      return successResponse(res, 'Stopped cadence for lead.');
    }
  } catch (err) {
    logger.error(`Error while changing status for lead in cadence: `, err);
    return serverErrorResponse(res, err.message);
  }
};

// * Get all accounts from cadence id
const getAllAccountsForCadence = async (req, res) => {
  try {
    const { cadence_id } = req.params;

    // * get accounts for the cadence
    const [cadenceAccounts, errForCadenceLeadsAndAccounts] =
      await AccountRepository.fetchAccountsByLeadToCadenceQuery({ cadence_id });

    if (errForCadenceLeadsAndAccounts)
      return serverErrorResponse(res, errForCadenceLeadsAndAccounts);

    return successResponse(res, 'Cadence accounts fetched', cadenceAccounts);
  } catch (err) {
    logger.error(`Error while fetching accounts for a cadence: `, err);
    return serverErrorResponse(res, err.message);
  }
};

// * Change account owner
const changeAccountOwner = async (req, res) => {
  try {
    const { account_ids, user_id } = req.body;

    // * Fetch user
    let [user, errForFetchingUser] = await UserRepository.findUserByQuery({
      user_id,
    });
    if (errForFetchingUser) return serverErrorResponse(res, errForFetchingUser);

    // * If salesforce_owner_id is null -> return error
    if (user.salesforce_owner_id === null)
      return serverErrorResponse(
        res,
        'No salesforce owner id present for this user'
      );

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to change account owner',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    else if (errForAccessToken) return serverErrorResponse(res);

    for (let account_id of account_ids) {
      // * Fetch all leads of account-> If any lead does not have 'salesforce_id'
      const [account, errForAccountLeads] =
        await AccountRepository.fetchAccountLeads({
          salesforce_account_id: account_id,
        });

      if (errForAccountLeads) continue;

      let contacts = [];
      let lead_ids = [];

      account[0].dataValues.Leads.forEach((c) => {
        if (c.dataValues.salesforce_contact_id !== null) {
          contacts.push(c.dataValues.salesforce_contact_id);
          lead_ids.push(c.dataValues.lead_id);
        }
      });

      // * Update in account salesforce
      await SalesforceService.updateAccountOwner(
        account_id,
        user.salesforce_owner_id,
        access_token,
        instance_url
      );

      // * update lead owners in salesforce
      for (const contact of contacts) {
        await SalesforceService.updateContactOwner(
          contact,
          user.salesforce_owner_id,
          access_token,
          instance_url
        );
      }

      // * Update lead owner with user_id
      let [_, errForUpdateLead] = await LeadRepository.updateLeads(
        {
          lead_id: {
            [Op.or]: lead_ids,
          },
        },
        {
          user_id,
        }
      );

      if (errForUpdateLead) continue;
    }

    return successResponse(res, 'Account owner and contact owner updated');
  } catch (err) {
    logger.error(`Error while updating account owner: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

// * Change lead owner
const changeLeadOwner = async (req, res) => {
  try {
    const { lead_ids, user_id } = req.body;

    // * Fetch user
    let [user, errForFetchingUser] = await UserRepository.findUserByQuery({
      user_id,
    });
    if (errForFetchingUser) return serverErrorResponse(res, errForFetchingUser);

    // * If salesforce_owner_id is null -> return error
    if (user.salesforce_owner_id === null)
      return serverErrorResponse(
        res,
        'No salesforce owner id present for this user'
      );

    successResponse(res, 'Lead and their account owner update has started');

    // Fetching salesforce token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to change lead owner',
        error: `Error while fetching access token: ${errForAccessToken}`,
      });
    else if (errForAccessToken) return serverErrorResponse(res);

    for (lead_id of lead_ids) {
      // * Fetch lead from lead_id
      let [lead, errForLead] = await LeadRepository.getLeadByQuery({ lead_id });
      if (errForLead) continue;

      if (lead.salesforce_contact_id !== null) {
        await SalesforceService.updateContactOwner(
          lead.salesforce_contact_id,
          user.salesforce_owner_id,
          access_token,
          instance_url
        );
        if (lead.Account.salesforce_account_id !== null)
          await SalesforceService.updateAccountOwner(
            lead.Account.salesforce_account_id,
            user.salesforce_owner_id,
            access_token,
            instance_url
          );
      } else if (lead.salesforce_lead_id !== null)
        await SalesforceService.updateLeadOwner(
          lead.salesforce_lead_id,
          user.salesforce_owner_id,
          access_token,
          instance_url
        );

      // * Update lead owner with user_id
      let [_, errForUpdateLead] = await LeadRepository.updateLeads(
        {
          lead_id,
        },
        {
          user_id,
        }
      );

      // * Update account owner with user_id
      let [updatedAccount, errForUpdateAccount] =
        await AccountRepository.updateAccountByQuery(
          {
            account_id: lead.Account.account_id,
          },
          {
            user_id,
          }
        );

      let [__, errForUpdatedTasks] = await TaskRepository.updateTasks(
        { lead_id },
        { user_id }
      );
    }
  } catch (err) {
    logger.error(`Error while changing lead owner: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

// * Reassign Account Owners
const reassignAllAccountsOfSalesperson = async (req, res) => {
  try {
    const { reassign_from, reassign_to } = req.body; // * reassign_from -> user_id whose accounts are to be assigned to 'reassign_to'

    /*
      reassign_from: <string>
      reassign_to : [
        {
          id: "",
          accounts: <int>
        }
      ],
      cadence_id: <string>
    */

    // * Fetch all accounts of "reassign_from"
    let [userToReassignFrom, errForFetchingUserToReassignFrom] =
      await UserRepository.findUserByQueryWithCompany({
        user_id: reassign_from,
      });
    if (errForFetchingUserToReassignFrom)
      return serverErrorResponse(res, errForFetchingUserToReassignFrom);

    // * If salesforce_owner_id is null -> return error
    if (userToReassignFrom.salesforce_owner_id === null)
      return serverErrorResponse(
        res,
        'No salesforce owner id present for this user'
      );

    // * Fetch accounts where 'userToReassignFrom' is the owner
    let [accounts, errAccounts] =
      await AccountRepository.fetchAccountLeadsWithSalesforceContactId(
        {
          user_id: userToReassignFrom.user_id,
        },
        req.body.cadence_id
      );
    if (errAccounts) return serverErrorResponse(res, errAccounts);

    let { account_reassignment_rule } =
      userToReassignFrom.Company.Company_Setting;

    logger.info(`Account reassignment rule: ${account_reassignment_rule}`);
    logger.info(`Accounts to reassign: ${accounts.length}`);

    // * Get access token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please connect with salesforce to reassign',
      });
    else if (errForAccessToken) return serverErrorResponse(res);

    let reassignedAccountCounter = 0;

    for (let target of reassign_to) {
      // * Fetch user to reassign to
      let [userToReassignTarget, errForFetchingUserToReassignTarget] =
        await UserRepository.findUserByQuery({
          user_id: target.id,
        });

      if (errForFetchingUserToReassignTarget || !userToReassignTarget) continue;
      if (
        account_reassignment_rule ===
        COMPANY_ACCOUNT_REASSIGNMENT_OPTIONS.ACCOUNT_ONLY
      ) {
        // * Reassign all accounts to target
        //   console.log('Reassigning to: ' + userToReassignTarget.first_name);

        // * Extract accounts to reassign in salesforce
        let accountsToReassign = accounts.slice(
          reassignedAccountCounter,
          reassignedAccountCounter + target.accounts
        );

        const [updatedAccounts, errUpdatingAccounts] =
          await SalesforceService.bulkUpdateAccountOwner(
            accountsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingAccounts) continue;

        reassignedAccountCounter = reassignedAccountCounter + target.accounts;

        //* Update account owners in db
        await AccountRepository.updateAccountByQuery(
          {
            account_id: {
              [Op.in]: updatedAccounts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );
      } else if (
        account_reassignment_rule ===
        COMPANY_ACCOUNT_REASSIGNMENT_OPTIONS.ACCOUNT_AND_CONTACT
      ) {
        // * Reassign all accounts and it's contacts to target
        // * Reassign all accounts to target
        //   console.log('Reassigning to: ' + userToReassignTarget.first_name);

        // * Extract accounts to reassign in salesforce
        let accountsAndContactsToReassign = accounts.slice(
          reassignedAccountCounter,
          reassignedAccountCounter + target.accounts
        );

        let contacts = [];

        // * Extracting leads from accounts
        accountsAndContactsToReassign.forEach((el) => {
          contacts.push(...el.Leads);
        });

        const [updatedAccountsWithLeads, errUpdatingAccountsWithLeads] =
          await SalesforceService.bulkUpdateAccountOwner(
            accountsAndContactsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingAccountsWithLeads) continue;

        // * Find other contacts of the accounts
        let [contactsOfAccounts, errForFetchingContactsOfAccount] =
          await LeadRepository.getLeadsByQuery({
            account_id: {
              [Op.in]: updatedAccountsWithLeads,
            },
          });
        if (errForFetchingContactsOfAccount) continue;

        const [updatedContacts, errUpdatedContacts] =
          await SalesforceService.bulkUpdateContactOwner(
            contactsOfAccounts,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );
        if (errUpdatedContacts) continue;

        reassignedAccountCounter = reassignedAccountCounter + target.accounts;

        // * Update account owners in db
        await AccountRepository.updateAccountByQuery(
          {
            account_id: {
              [Op.in]: updatedAccountsWithLeads,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );

        // * Update lead owners in db
        await LeadRepository.updateLeads(
          {
            lead_id: {
              [Op.in]: updatedContacts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );
      }
    }
    return successResponse(res, 'Successfully reassigned accounts');
  } catch (err) {
    logger.error(`Error while reassigning account owner: ${err.message}.`);
    //return serverErrorResponse(res, err.message);
  }
};

// * Reassign Lead Owners
const reassignAllLeadsOfSalesperson = async (req, res) => {
  try {
    const { reassign_from, reassign_to } = req.body; // * reassign_from -> user_id whose leads are to be assigned to 'reassign_to'
    /*
      reassign_from: <string>
      reassign_to : [
        {
          id: "",
          leads: <int>
        }
      ],
      cadence_id: <string>
    */

    // * Fetch all leads of "reassign_from"
    let [userToReassignFrom, errForFetchingUserToReassignFrom] =
      await UserRepository.findUserByQuery({
        user_id: reassign_from,
      });
    if (errForFetchingUserToReassignFrom)
      return serverErrorResponse(res, errForFetchingUserToReassignFrom);

    // * If salesforce_owner_id is null -> return error
    if (userToReassignFrom.salesforce_owner_id === null)
      return serverErrorResponse(
        res,
        'No salesforce owner id present for this user'
      );

    // * Fetch accounts where 'userToReassignFrom' is the owner
    // * get leads for the cadence
    const [cadenceLeads, errForCadenceLeads] =
      await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery(
        {
          cadence_id: req.body.cadence_id,
        },
        {
          user_id: reassign_from,
          [Op.not]: {
            salesforce_lead_id: null,
          },
        }
      );

    if (errForCadenceLeads) return serverErrorResponse(res, errForCadenceLeads);

    let leads = [];

    // * Separate leads from cadenceLeads
    cadenceLeads.map((cadenceLead) => {
      cadenceLead = JSON.parse(JSON.stringify(cadenceLead));
      if (cadenceLead.Leads && cadenceLead.Leads.length > 0) {
        leads.push(cadenceLead.Leads[0]);
      }
    });

    // * Get access token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please connect with Salesforce to reassign',
      });
    else if (errForAccessToken) return serverErrorResponse(res);

    let reassignedLeadCounter = 0;

    for (let target of reassign_to) {
      // * Fetch user to reassign to
      let [userToReassignTarget, errForFetchingUserToReassignTarget] =
        await UserRepository.findUserByQuery({
          user_id: target.id,
        });

      if (errForFetchingUserToReassignTarget || !userToReassignTarget) continue;

      logger.info(`Reassigning to: ${userToReassignTarget.first_name}`);

      let leadsToReassign = leads.slice(
        reassignedLeadCounter,
        reassignedLeadCounter + target.leads
      );

      const [updatedLeads, errUpdatingLeads] =
        await SalesforceService.bulkUpdateLeadOwner(
          leadsToReassign,
          userToReassignTarget.salesforce_owner_id,
          access_token,
          instance_url
        );

      //   console.log(updatedLeads);

      if (errUpdatingLeads) continue;

      reassignedLeadCounter = reassignedLeadCounter + target.leads;

      // * Update lead owners in db
      await LeadRepository.updateLeads(
        {
          lead_id: {
            [Op.in]: updatedLeads,
          },
        },
        {
          user_id: userToReassignTarget.user_id,
        }
      );
    }
    return successResponse(res, 'Successfully reassigned leads');
  } catch (err) {
    logger.error(`Error while reassigning lead owner: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

// * Reassign Contact Owners
const reassignAllContactsOfSalesperson = async (req, res) => {
  try {
    const { reassign_from, reassign_to } = req.body; // * reassign_from -> user_id whose contacts are to be assigned to 'reassign_to'

    /*
      reassign_from: <string>
      reassign_to : [
        {
          id: "",
          contacts: <int>
        }
      ],
      cadence_id: <string>
    */

    // * Fetch all accounts of "reassign_from"
    let [userToReassignFrom, errForFetchingUserToReassignFrom] =
      await UserRepository.findUserByQueryWithCompany({
        user_id: reassign_from,
      });
    if (errForFetchingUserToReassignFrom)
      return serverErrorResponse(res, errForFetchingUserToReassignFrom);

    // * If salesforce_owner_id is null -> return error
    if (userToReassignFrom.salesforce_owner_id === null)
      return serverErrorResponse(
        res,
        'No salesforce owner id present for this user'
      );

    // * Fetch accounts where 'userToReassignFrom' is the owner
    // * get leads for the cadence
    const [cadenceLeads, errForCadenceLeads] =
      await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery(
        {
          cadence_id: req.body.cadence_id,
        },
        {
          user_id: reassign_from,
          [Op.not]: {
            salesforce_contact_id: null,
          },
        }
      );

    if (errForCadenceLeads) return serverErrorResponse(res, errForCadenceLeads);

    let contacts = [];

    // * Separate leads from cadenceLeads
    cadenceLeads.map((cadenceLead) => {
      cadenceLead = JSON.parse(JSON.stringify(cadenceLead));
      if (cadenceLead.Leads && cadenceLead.Leads.length > 0) {
        contacts.push(cadenceLead.Leads[0]);
      }
    });

    let { contact_reassignment_rule } =
      userToReassignFrom.Company.Company_Setting;

    logger.info(`Contact reassignment rule: ${contact_reassignment_rule}`);

    // * Get access token and instance url
    const [{ access_token, instance_url }, errForAccessToken] =
      await AccessTokenHelper.getAccessToken({
        integration_type: CRM_INTEGRATIONS.SALESFORCE,
        user_id: req.user.user_id,
      });
    if (errForAccessToken === 'Please log in with salesforce')
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Please connect with Salesforce to reassign',
      });
    else if (errForAccessToken) return serverErrorResponse(res);

    let reassignedContactCounter = 0;

    for (let target of reassign_to) {
      // * Fetch user to reassign to
      let [userToReassignTarget, errForFetchingUserToReassignTarget] =
        await UserRepository.findUserByQuery({
          user_id: target.id,
        });

      if (errForFetchingUserToReassignTarget || !userToReassignTarget) continue;

      if (
        contact_reassignment_rule ===
        COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ONLY
      ) {
        // * Reassign all contacts to target
        logger.info('Reassigning to: ' + userToReassignTarget.first_name);

        // * Extract contacts to reassign in salesforce
        let contactsToReassign = contacts.slice(
          reassignedContactCounter,
          reassignedContactCounter + target.contacts
        );

        const [updatedContacts, errUpdatingContacts] =
          await SalesforceService.bulkUpdateContactOwner(
            contactsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingContacts) continue;

        reassignedContactCounter = reassignedContactCounter + target.contacts;

        // * Update lead owners in db
        await LeadRepository.updateLeads(
          {
            lead_id: {
              [Op.in]: updatedContacts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );
      } else if (
        contact_reassignment_rule ===
        COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_AND_ACCOUNT
      ) {
        // * Reassign all contacts to target
        logger.info('Reassigning to: ' + userToReassignTarget.first_name);

        // * Extract accounts to reassign in salesforce
        let contactsToReassign = contacts.slice(
          reassignedContactCounter,
          reassignedContactCounter + target.contacts
        );

        // * Update Lead's account owner
        let accountsToReassign = [];
        contactsToReassign.forEach((contact) => {
          accountsToReassign.push(contact.Account);
        });

        const [updatedContacts, errUpdatingContacts] =
          await SalesforceService.bulkUpdateContactOwner(
            contactsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingContacts) continue;

        const [updatedAccounts, errUpdatingAccounts] =
          await SalesforceService.bulkUpdateAccountOwner(
            accountsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingAccounts) continue;

        reassignedContactCounter = reassignedContactCounter + target.contacts;

        // * Update lead owners in db
        await LeadRepository.updateLeads(
          {
            lead_id: {
              [Op.in]: updatedContacts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );

        //* Update account owners in db
        await AccountRepository.updateAccountByQuery(
          {
            account_id: {
              [Op.in]: updatedAccounts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );
      } else if (
        contact_reassignment_rule ===
        COMPANY_CONTACT_REASSIGNMENT_OPTIONS.CONTACT_ACCOUNT_AND_OTHER_CONTACTS
      ) {
        // * Reassign all contacts to target
        logger.info(`Reassigning to: ${userToReassignTarget.first_name}`);

        // * Extract accounts to reassign in salesforce
        let contactsToReassign = contacts.slice(
          reassignedContactCounter,
          reassignedContactCounter + target.contacts
        );

        // * Update Lead's account owner
        let accountsToReassign = [];
        contactsToReassign.forEach((contact) => {
          accountsToReassign.push(contact.Account);
        });

        const [updatedAccounts, errUpdatingAccounts] =
          await SalesforceService.bulkUpdateAccountOwner(
            accountsToReassign,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingAccounts) continue;

        // * Find other contacts of the accounts
        let [contactsOfAccounts, errForFetchingContactsOfAccount] =
          await LeadRepository.getLeadsByQuery({
            account_id: {
              [Op.in]: updatedAccounts,
            },
          });

        if (errForFetchingContactsOfAccount) continue;

        reassignedContactCounter = reassignedContactCounter + target.contacts;

        // console.log('Reassigning: ' + contactsOfAccounts.length);

        const [updatedContacts, errUpdatingContacts] =
          await SalesforceService.bulkUpdateContactOwner(
            contactsOfAccounts,
            userToReassignTarget.salesforce_owner_id,
            access_token,
            instance_url
          );

        if (errUpdatingContacts) continue;
        // * Update lead owners in db
        await LeadRepository.updateLeads(
          {
            lead_id: {
              [Op.in]: updatedContacts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );

        //* Update account owners in db
        await AccountRepository.updateAccountByQuery(
          {
            account_id: {
              [Op.in]: updatedAccounts,
            },
          },
          {
            user_id: userToReassignTarget.user_id,
          }
        );
      }
    }
    return successResponse(res, 'Successfully reassigned accounts');
  } catch (err) {
    logger.error(`Error while reassigning contact owner: ${err.message}.`);
    return serverErrorResponse(res, err.message);
  }
};

// * Get user account breakdown
const getUserAccountLeadBreakdown = async (req, res) => {
  try {
    // * Fetch all leads of the cadence
    let [leads, errLeads] = await LeadRepository.getLeadsByCadenceId(
      req.params.cadence_id
    );

    // * Error while fetching leads
    if (errLeads) serverErrorResponse(res, errLeads);

    // * Logic to separate user account, contact, lead
    let owner = {};
    let accounts = [];

    // console.log('Length of leads: ' + leads.length);

    // * Iterate through leads
    for (let lead of leads) {
      // * lead has an account, and is a salesforce contact
      if (lead.Account && lead.salesforce_contact_id) {
        // * Check if account owner exist
        if (
          !accounts.includes(lead.Account.account_id) &&
          lead.Account.salesforce_account_id !== null &&
          lead.Account.user_id != null
        ) {
          accounts.push(lead.Account.account_id); // * Account has been visited.
          if (owner[lead.Account.User.user_id])
            owner[lead.Account.User.user_id].accounts =
              owner[lead.Account.User.user_id].accounts + 1;
          else
            owner[lead.Account.User.user_id] = {
              user_id: lead.Account.User.user_id,

              name:
                lead.Account.User.first_name +
                ' ' +
                lead.Account.User.last_name,
              accounts: 1,
              leads: 0,
              contacts: 0,
            };
        }
      }

      // * Check if lead is a salesforce contact or salesforce lead
      if (lead.salesforce_contact_id) {
        // * Lead is a salesforce contact
        if (owner[lead.User.user_id])
          owner[lead.User.user_id].contacts =
            owner[lead.User.user_id].contacts + 1;
        else
          owner[lead.User.user_id] = {
            user_id: lead.User.user_id,
            name: lead.User.first_name + ' ' + lead.User.last_name,
            accounts: 0,
            leads: 0,
            contacts: 1,
          };
      } else {
        // * Lead is a salesforce lead
        if (owner[lead.User.user_id])
          owner[lead.User.user_id].leads = owner[lead.User.user_id].leads + 1;
        else
          owner[lead.User.user_id] = {
            user_id: lead.User.user_id,
            name: lead.User.first_name + ' ' + lead.User.last_name,
            accounts: 0,
            leads: 1,
            contacts: 0,
          };
      }
    }

    let data = [];

    for (const [_, value] of Object.entries(owner)) {
      data.push(value);
    }

    return successResponse(
      res,
      'Successfully fetched account-lead breakdown',
      data
    );
  } catch (err) {
    logger.error(
      `Error while fetching account and lead breakdown for user: ${err.message}.`
    );
    return serverErrorResponse(res, err.message);
  }
};
const getStatistics = async (req, res) => {
  try {
    const { cadence_id } = req.params;
    if (cadence_id) {
      const [emails, err] = await EmailRepository.getEmailsByQuery({
        cadence_id,
        sent: 1, // only count for sent mails
      });

      let delivered = 0,
        opened = 0,
        clicked = 0,
        bounced = 0,
        unsubscribed = 0;

      for (let email of emails) {
        if (email.status === EMAIL_STATUS.DELIVERED) delivered++;
        else if (email.status === EMAIL_STATUS.OPENED) {
          delivered++;
          opened++;
        } else if (email.status === EMAIL_STATUS.CLICKED) {
          delivered++;
          opened++;
          clicked++;
        } else if (email.status === EMAIL_STATUS.BOUNCED) bounced++;
      }
      const [unsubscribedCadenceLeads, errForUnsubscribedCadenceLeads] =
        await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery({
          cadence_id,
          unsubscribed: true,
        });
      if (!errForUnsubscribedCadenceLeads)
        unsubscribed = unsubscribedCadenceLeads.length;
      return successResponse(res, 'Fetched email statistics for cadence', {
        delivered,
        opened,
        clicked,
        bounced,
        unsubscribed,
      });
    } else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch statistics',
        error: 'Cadence id is required',
      });
  } catch (err) {
    logger.error(
      'ERROR: An error occured while trying to get email statistics: ',
      err
    );
    return serverErrorResponse(res);
  }
};

const getStatisticsByNode = async (req, res) => {
  try {
    const { cadence_id, node_id } = req.params;
    if (cadence_id && node_id) {
      const [emails, err] = await EmailRepository.getEmailsByQuery({
        cadence_id,
        node_id,
        sent: 1, // only count for sent mails
      });

      let delivered = 0,
        opened = 0,
        clicked = 0,
        bounced = 0,
        unsubscribed = 0;
      for (let email of emails) {
        if (email.status === EMAIL_STATUS.DELIVERED) delivered++;
        else if (email.status === EMAIL_STATUS.OPENED) {
          delivered++;
          opened++;
        } else if (email.status === EMAIL_STATUS.CLICKED) {
          delivered++;
          opened++;
          clicked++;
        } else if (email.status === EMAIL_STATUS.BOUNCED) bounced++;
      }
      const [unsubscribedCadenceLeads, errForUnsubscribedCadenceLeads] =
        await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery({
          cadence_id,
          unsubscribe_node_id: node_id,
          unsubscribed: true,
        });
      if (!errForUnsubscribedCadenceLeads)
        unsubscribed = unsubscribedCadenceLeads.length;
      return successResponse(res, 'Fetched Email Statistics for Node', {
        delivered,
        opened,
        clicked,
        bounced,
        unsubscribed,
      });
    } else
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to fetch statistics by steps',
        error: 'Cadence id and node id is required',
      });
  } catch (err) {
    logger.error(
      'ERROR: An error occured while trying to get email statistics: ',
      err
    );
    return serverErrorResponse(res);
  }
};

const CadenceController = {
  updateCadence,
  updateCadenceName,
  deleteCadence,
  pauseCadenceForLead,
  resumeCadenceForLead,
  stopCadenceForLead,
  getCadenceSidebarForLead,
  launchCadence,
  pauseCadenceForTime,
  getCadenceStatistics,
  getUserAccountLeadBreakdown,
  stopCadenceForLeadAndReplaceCadence,
  getAllAccountsForCadence,
  changeStatusForLeadInCadence,
  changeAccountOwner,
  changeLeadOwner,
  reassignAllAccountsOfSalesperson,
  reassignAllLeadsOfSalesperson,
  reassignAllContactsOfSalesperson,
  getStatistics,
  getStatisticsByNode,
};

module.exports = CadenceController;
