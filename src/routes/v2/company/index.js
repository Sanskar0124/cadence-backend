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
const { supportAuth } = require('../../../middlewares/support.middlewares');
const { devAuth } = require('../../../middlewares/dev.middlewares');
const {
  ringoverDevAuth,
} = require('../../../middlewares/ringoverDev.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const companyController = require('../../../controllers/v2/company/company.controllers');

// To change mail integration
router.put(
  '/mail-integration',
  [
    auth,
    // should have access to change company integration
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_ANY,
      RBAC_RESOURCES.MAIL_INTEGRATION
    ),
  ],
  companyController.updateMailIntegration
);

// To change integration
router.put(
  '/integration',
  [
    auth,
    // should have access to change company integration
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_ANY,
      RBAC_RESOURCES.COMPANY_INTEGRATION
    ),
  ],
  companyController.changeIntegration
);

// To change integration
router.put(
  '/status',
  [
    auth,
    // should have access to change company integration
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_ANY,
      RBAC_RESOURCES.COMPANY_STATUS
    ),
  ],
  companyController.updateCompanyStatus
);

// External
router.put(
  '/activities',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.SF_ACTIVITES_TO_LOG
    ),
  ],
  companyController.updateActivityToLog
);
router.get(
  '/activities',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.SF_ACTIVITES_TO_LOG
    ),
  ],
  companyController.fetchActivityToLogInSalesforce
);

router.post(
  '/ringover',
  ringoverDevAuth,
  companyController.createCompanyFromRingover
);
router.put(
  '/ringover',
  ringoverDevAuth,
  companyController.updateCompanyFromRingover
);

router.get('/:company_id', auth, companyController.getCompanyInfo);
router.put('/:company_id', auth, companyController.updateCompanyInfo);
router.post('/sync', auth, companyController.syncSalesforceEmailAndPhone);

router.post(
  '/create-company',
  supportAuth,
  companyController.createCompanyAndAdmin
);

router.post(
  '/update-integration',
  supportAuth,
  companyController.updateIntegrationFromSupport
);

// Internal
router.post('/', devAuth, companyController.createCompanyAndAdmin);

module.exports = router;
