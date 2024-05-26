// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');
const {
  CADENCE_ACTIONS,
  SETTING_TYPES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');
const NodeRepository = require('../../../../../../Cadence-Brain/src/repository/node.repository');
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');

// Helpers and services
const CadenceHelper = require('../../../../../../Cadence-Brain/src/helper/cadence');
const NodeHelper = require('../../../../../../Cadence-Brain/src/helper/node');
const getSettingsForUser = require('../../../../../../Cadence-Brain/src/helper/user/getSettingsForUser');
const getStartTimeForTask = require('../../../../../../Cadence-Brain/src/helper/task/getStartTimeForTask');

const addNodeToSequence = async (req, res) => {
  try {
    const { node, previous_node_id } = req.body;

    // * check if cadence id exists
    if (!node?.cadence_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: 'Cadence id is required',
      });

    // * check if node is valid
    const [isValidNode, errForIsValidNode] = NodeHelper.isValidNode(node);
    if (errForIsValidNode)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: `Error while validating node: ${errForIsValidNode}`,
      });

    // * check access
    const cadencePromise = Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id: node.cadence_id,
      },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'user_id', 'company_id'] },
      },
    });

    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });

    const [[cadence, errForCadence], [user, errForUser]] = await Promise.all([
      cadencePromise,
      userPromise,
    ]);
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    // * create a node
    const [createdNode, errForNode] = await CadenceHelper.addNodeToCadence(
      node,
      previous_node_id
    );
    if (errForNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to add step',
        error: `Error while adding node to cadence: ${errForNode}`,
      });

    return successResponse(res, 'Node created successfully', createdNode);
  } catch (err) {
    logger.error(`Error while adding node to sequence: ${err.message}.`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while adding node to sequence: ${err.message}`,
    });
  }
};

const updateNode = async (req, res) => {
  try {
    const { id: node_id } = req.params;

    const [node, errForNode] = await NodeRepository.getNode({ node_id });
    if (errForNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while fetching node: ${errForNode}`,
      });

    // * check if updatedNode is valid or not
    const [isValidNode, errForIsValidNode] = NodeHelper.isValidNode({
      ...node,
      ...req.body,
    });
    if (errForIsValidNode)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while validating node: ${errForIsValidNode}`,
      });

    // * check access
    const cadencePromise = Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id: node.cadence_id,
      },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'user_id', 'company_id'] },
      },
    });

    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });

    const [[cadence, errForCadence], [user, errForUser]] = await Promise.all([
      cadencePromise,
      userPromise,
    ]);
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while checking cadence action access: ${errForAccess}`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const [data, err] = await NodeRepository.updateNode(
      { node_id }, // * query
      req.body // * updated node
    );
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `Error while updating node: ${err}`,
      });
    if (!data[0])
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to update step',
        error: `No node found with id ${node_id}`,
      });

    // Updating StartTime
    // if (req.body.wait_time) {
    //   const [existTask, errForexistTask] = await Repository.fetchAll({
    //     tableName: DB_TABLES.TASK,
    //     query: { node_id, completed: 0, is_skipped: 0 },
    //     extras: {
    //       attributes: ['task_id', 'node_id', 'lead_id', 'completed', 'user_id'],
    //     },
    //     include: {
    //       [DB_TABLES.NODE]: {
    //         attributes: ['wait_time'],
    //       },
    //     },
    //   });

    // Code for updating start time...
    // if (existTask) {
    //   let emailSettingObj = {};
    //   for (let i = 0; i < existTask.length; i++) {
    //     let emailSetting = {};
    //     let automatedMailSettings = '',
    //       errForAutomatedMailSettings = '';

    //     if (emailSettingObj[existTask[i].user_id]) {
    //       automatedMailSettings = emailSettingObj[existTask[i].user_id];
    //     } else {
    //       const [requiredCompanyUser, errForRequiredCompanyUser] =
    //         await UserRepository.findUserByQuery({
    //           user_id: existTask[i].user_id,
    //         });
    //       if (errForRequiredCompanyUser)
    //         return serverErrorResponse(res, errForRequiredCompanyUser);

    //       const automatedMailSettingsPromise = getSettingsForUser({
    //         user_id: requiredCompanyUser.user_id,
    //         setting_type: SETTING_TYPES.AUTOMATED_TASK_SETTINGS,
    //       });

    //       [[automatedMailSettings, errForAutomatedMailSettings]] =
    //         await Promise.all([automatedMailSettingsPromise]);
    //       if (errForAutomatedMailSettings) {
    //         logger.error(
    //           `Error while fetching automated email settings for user.`,
    //           errForSetting
    //         );
    //         return [null, errForAutomatedMailSettings];
    //       }
    //       if (!automatedMailSettings.Automated_Task_Setting) {
    //         logger.error(
    //           `No automated mail settings found for user: ${requiredCompanyUser.user_id}.`
    //         );
    //         return [null, `No automated mail settings found.`];
    //       }
    //       automatedMailSettings['timezone'] = requiredCompanyUser.timezone;
    //       emailSettingObj[existTask[i].user_id] = automatedMailSettings;
    //     }

    //     emailSetting = automatedMailSettings.Automated_Task_Setting;

    //     const [fetchPreviousNode, errForPreviousNode] =
    //       await Repository.fetchOne({
    //         tableName: DB_TABLES.NODE,
    //         query: { next_node_id: existTask[i].node_id },
    //         include: {
    //           [DB_TABLES.TASK]: {
    //             where: { lead_id: existTask[i].lead_id },
    //             attributes: ['task_id', 'complete_time'],
    //           },
    //         },
    //       });
    //     if (errForPreviousNode)
    //       return serverErrorResponse(res, errForexistTask);

    //     let startTime = await getStartTimeForTask(
    //       automatedMailSettings.timezone,
    //       existTask[i].Node.wait_time,
    //       emailSetting,
    //       fetchPreviousNode.Tasks[0].complete_time
    //     );

    //     const [updateStartTime, errForUpdateStartTime] =
    //       await Repository.update({
    //         tableName: DB_TABLES.TASK,
    //         query: { node_id, lead_id: existTask[i].lead_id, completed: 0 },
    //         updateObject: {
    //           start_time: startTime,
    //         },
    //       });

    //     if (errForUpdateStartTime)
    //       return serverErrorResponse(res, errForUpdateStartTime);

    //     logger.info(`Updating Lead For ${i}.`);
    //   }
    // }
    // }

    return successResponse(res, 'Node updated successfully.');
  } catch (err) {
    logger.error(`Error while updating node: ${err.message}.`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while updating node: ${err.message}`,
    });
  }
};

const fetchNode = async (req, res) => {
  try {
    // * retreive node_id
    const { id: node_id } = req.params;

    const [requiredNode, errForRequiredNode] = await NodeRepository.getNode({
      node_id,
    });
    if (errForRequiredNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch node',
        error: `Error while fetching node: ${errForRequiredNode}`,
      });
    if (!requiredNode)
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Selected step does not exist',
        error: 'Node not found',
      });

    return successResponse(res, 'Node fetched successfully.', requiredNode);
  } catch (err) {
    logger.error(`Error while fetching node: ${err.message}`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching node: ${err.message}`,
    });
  }
};

const deleteNode = async (req, res) => {
  try {
    const { id: node_id } = req.params;

    // * check access
    const [node, errForNode] = await NodeRepository.getNode({ node_id });
    if (errForNode)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete step',
        error: `Error while fetching node: ${errForNode}`,
      });

    const cadencePromise = Repository.fetchOne({
      tableName: DB_TABLES.CADENCE,
      query: {
        cadence_id: node.cadence_id,
      },
      include: {
        [DB_TABLES.USER]: { attributes: ['sd_id', 'user_id', 'company_id'] },
      },
    });

    const userPromise = Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: { user_id: req.user.user_id },
    });

    const [[cadence, errForCadence], [user, errForUser]] = await Promise.all([
      cadencePromise,
      userPromise,
    ]);
    if (errForCadence)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete step',
        error: `Error while fetching cadence: ${errForCadence}`,
      });
    if (errForUser)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete step',
        error: `Error while fetching user: ${errForUser}`,
      });

    const [access, errForAccess] = CadenceHelper.checkCadenceActionAccess({
      cadence: cadence,
      user,
      action: CADENCE_ACTIONS.UPDATE,
    });
    if (errForAccess)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete step',
        error: `Error while checking cadence action access`,
      });
    if (!access)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'You do not have access to this functionality',
      });

    const [data, err] = await NodeHelper.deleteNode(node_id, cadence);
    if (err) {
      if (
        err
          ?.toLowerCase()
          ?.includes('cannot delete this step without deleting replied to node')
      )
        return badRequestResponseWithDevMsg({
          res,
          msg: err,
        });
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete step',
        error: `Error while deleting node: ${err}`,
      });
    }

    return successResponse(res, 'Node deleted successfully.');
  } catch (err) {
    logger.error(`Error while deleting node: ${err.message}.`);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting node: ${err.message}`,
    });
  }
};

const assignStepNumberToExistingNodes = async (req, res) => {
  let [cadences, errForCadences] = await CadenceRepository.getCadences({});
  if (errForCadences)
    return serverErrorResponseWithDevMsg({
      res,
      msg: 'Failed to update cadence',
      error: `Error while fetching cadence: ${errForCadences}`,
    });
  if (!cadences.length)
    return badRequestResponseWithDevMsg({
      res,
      msg: 'No cadences found',
    });

  successResponse(res, 'Started processing.');

  for (let cadence of cadences) {
    let i = 1;
    logger.info(`Updating cadence: ${cadence.cadence_id} ${cadence.name}...`);
    for (let node of cadence.Nodes) {
      await NodeRepository.updateNode(
        { node_id: node.node_id },
        { step_number: i }
      );
      i += 1;
    }

    logger.info(`Updating cadence: ${cadence.cadence_id} ${cadence.name}...`);
  }
};

const NodeController = {
  addNodeToSequence,
  updateNode,
  fetchNode,
  deleteNode,
  assignStepNumberToExistingNodes,
};

module.exports = NodeController;
