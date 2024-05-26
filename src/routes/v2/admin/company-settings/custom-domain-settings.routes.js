//Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

//Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

//Controllers
const customDomainSettingControllers = require('../../../../controllers/v2/admin/custom-domain-settings.controller');

router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  customDomainSettingControllers.addCustomTrackingDomain
);

router.patch(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  customDomainSettingControllers.updateCustomTrackingDomain
);

router.delete(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  customDomainSettingControllers.deleteCustomTrackingDomain
);

router.get(
  '/validate',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  customDomainSettingControllers.validateCustomTrackingDomain
);

module.exports = router;
