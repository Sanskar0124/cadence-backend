// * Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// * Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const AutomatedWorkflowController = require('../../../controllers/v2/admin/automated-workflow.controller');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_WORKFLOW
    ),
  ],
  AutomatedWorkflowController.createAutomatedWorkflow
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_WORKFLOW
    ),
  ],
  AutomatedWorkflowController.fetchAutomatedWorkflows
);

router.put(
  '/:aw_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_WORKFLOW
    ),
  ],
  AutomatedWorkflowController.updateAutomatedWorkflow
);

router.delete(
  '/:aw_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_WORKFLOW
    ),
  ],
  AutomatedWorkflowController.deleteAutomatedWorkflow
);

module.exports = router;
