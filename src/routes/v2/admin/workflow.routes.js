// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const workflowControlMiddleware = require('../../../middlewares/workflowAccess.middleware');

// Controllers
const WorkflowController = require('../../../controllers/v2/admin/workflow.controllers');

router.post(
  '/',
  [
    auth,
    workflowControlMiddleware.checkWorkFlowAccess(RBAC_ACTIONS.CREATE_OWN),
  ],
  WorkflowController.createWorkflow
);

router.get(
  '/',
  [auth, workflowControlMiddleware.checkWorkFlowAccess(RBAC_ACTIONS.READ_OWN)],
  WorkflowController.fetchWorkflow
);

router.put(
  '/:workflow_id',
  [
    auth,
    workflowControlMiddleware.checkWorkFlowAccess(RBAC_ACTIONS.UPDATE_OWN),
  ],
  WorkflowController.updateWorkflow
);

router.delete(
  '/:workflow_id',
  [
    auth,
    workflowControlMiddleware.checkWorkFlowAccess(RBAC_ACTIONS.DELETE_OWN),
  ],
  WorkflowController.deleteWorkflow
);

module.exports = router;
