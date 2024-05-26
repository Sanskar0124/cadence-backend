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
const SubDepartmentSettingsController = require('../../../../controllers/v1/sales/sub-department/sub-department-settings.controllers');

// Routes
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.createSubDepartmentSettings
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.getSubDepartmentSettingsForManager
);

router.get(
  '/:sd_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.getSubDepartmentSettings
);
router.put(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.updateSubDepartmentSettingsForManager
);
router.put(
  '/:sd_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.updateSubDepartmentSettings
);
router.delete(
  '/:sd_settings_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.SUB_DEPARTMENT_SETTINGS
    ),
  ],
  SubDepartmentSettingsController.deleteSubDepartmentSettings
);

module.exports = router;
