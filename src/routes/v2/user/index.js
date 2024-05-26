// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Pacakages
const express = require('express');
const router = express();

// Middlwares
const { auth } = require('../../../middlewares/auth.middlewares');
const { devAuth } = require('../../../middlewares/dev.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const userControllers = require('../../../controllers/v2/user/user.controllers');

// to mark product tour as completed for user
router.get(
  '/product-tour/completed',
  auth,
  userControllers.markProductTourCompleted
);

// to create dummy leads for product tour
router.post(
  '/product-tour/leads',
  auth,
  userControllers.createDummyLeadsForProductTour
);

router.get('/delay/:user_id', userControllers.fetchAutomatedTasksDelay);

router.get(
  '/get-users',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.getUsers
);

router.get(
  '/get-company-users',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.getAllCompanyUsers
);

router.delete(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.deleteUser
);

router.post(
  '/login-as-user',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_ANY,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.adminLoginAsUser
);

// router.post('/forgot-password', userControllers.forgotPasswordClick);

// router.post('/change-password', userControllers.changeForgottenPassword);

router.get('/onboarding', auth, userControllers.checkIfOnboardingComplete);

router.put('/onboarding', auth, userControllers.updateOnboardingValue);

router.get('/disconnect', auth, userControllers.disconnectUser);

router.get('/change-owner', auth, userControllers.getChangeOwner);

router.get(
  '/calendar',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.AUTOMATED_TASK_SETTINGS
    ),
  ],
  userControllers.getCompanyAutomatedTaskSettings
);

// * Check if a user with email exists
router.post(
  '/check-email-exist',
  devAuth,
  userControllers.checkIfUserWithEmailExist
);

module.exports = router;
