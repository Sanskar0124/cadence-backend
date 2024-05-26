// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');

// Controllers
const CompanyFieldMap = require('../../../../controllers/v2/admin/company-field-map.controllers');

// * Insert company field map
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.createCompanyMap
);

// * Fetch salesforce map
router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.fetchCompanyFieldMap
);

// * Describe object
router.get(
  '/describe/:object',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CRM_OBJECTS
    ),
  ],
  CompanyFieldMap.describeObject
);

// * Test salesforce field
router.post(
  '/salesforce/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testSalesforceFieldMap
);

// * Set all salesforce field maps
router.post(
  '/all',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.createAllCrmMap
);

// * Set custom object
router.post(
  '/custom-object',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.createCustomObject
);

// * Test custom object
router.post(
  '/custom-object/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testCustomObject
);

// * Fetch pipedrive fields
router.get(
  '/pipedrive/person/:person_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getPersonAndOrganizationFromPipedrive
);

// * Test pipedrive field
router.post(
  '/pipedrive/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testPipedriveFieldMap
);

// * Test hubspot field
router.post(
  '/hubspot/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testHubspotFieldMap
);
router.post(
  '/hubspot/contact/:contact_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getContactAndCompanyFromHubspot
);
// * Test zoho field
router.post(
  '/zoho',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getLeadOrContactFromZoho
);
// * Test zoho field
router.post(
  '/zoho/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testZohoFieldMap
);

// * Test sellsy field
router.post(
  '/sellsy/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testSellsyFieldMap
);

router.post(
  '/sellsy',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getContactAndAccountFromSellsy
);

router.post(
  '/bullhorn',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getLeadOrContactOrCandidateFromBullhorn
);
router.post(
  '/bullhorn/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testBullhornFieldMap
);

router.post(
  '/dynamics/test',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.testDynamicsFieldMap
);
router.post(
  '/dynamics',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_SETTINGS
    ),
  ],
  CompanyFieldMap.getLeadOrContactFromDynamics
);

router.get(
  '/describePicklist/:object',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CRM_OBJECTS
    ),
  ],
  CompanyFieldMap.describePicklist
);
module.exports = router;
