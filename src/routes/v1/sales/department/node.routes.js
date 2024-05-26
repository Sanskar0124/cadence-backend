// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const nodeController = require('../../../../controllers/v1/sales/department/node.controllers');

// Routes
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.NODE
    ),
  ],
  nodeController.addNodeToSequence
);

router.put(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.NODE
    ),
  ],
  nodeController.updateNode
);

router.get(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.NODE
    ),
  ],
  nodeController.fetchNode
);

router.delete(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.NODE
    ),
  ],
  nodeController.deleteNode
);

router.get(
  '/assign/step',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.NODE
    ),
  ],
  nodeController.assignStepNumberToExistingNodes
);

module.exports = router;
