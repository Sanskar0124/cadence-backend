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
const signatureControllers = require('../../../../controllers/v1/sales/employee/signatures.controllers');

// Routes
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.EMAIL_SIGNATURE
    ),
  ],
  signatureControllers.createUserSignature
);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.EMAIL_SIGNATURE
    ),
  ],
  signatureControllers.getSignatures
);

router.put(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.EMAIL_SIGNATURE
    ),
  ],
  signatureControllers.updateUserSignature
);

router.delete(
  '/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.EMAIL_SIGNATURE
    ),
  ],
  signatureControllers.deleteUserSignature
);
router.put(
  '/primary/:id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.EMAIL_SIGNATURE
    ),
  ],
  signatureControllers.markSigantureAsPrimary
);

module.exports = router;
