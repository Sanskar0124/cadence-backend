// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express.Router();

//importing middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const ActivityController = require('../../../../controllers/v1/sales/lead/activity.controllers');

// Routes
router.get(
  '/read/:activity_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.ACTIVITY
    ),
  ],
  ActivityController.markActivityAsRead
);

module.exports = router;
