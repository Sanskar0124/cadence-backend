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
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const CalendarSettingsController = require('../../../controllers/v1/admin/calendar-settings.controllers');

// Routes
router.post(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.CREATE_OWN,
      RBAC_RESOURCES.COMPANY_CALENDAR_SETTINGS
    ),
  ],
  CalendarSettingsController.createCalendarSettings
);
router.put(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.COMPANY_CALENDAR_SETTINGS
    ),
  ],

  CalendarSettingsController.changeCalendarSettings
);
router.get(
  '/:company_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.COMPANY_CALENDAR_SETTINGS
    ),
  ],
  CalendarSettingsController.fetchCalendarSettings
);
router.delete(
  '/:calendar_id',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.DELETE_OWN,
      RBAC_RESOURCES.COMPANY_CALENDAR_SETTINGS
    ),
  ],
  CalendarSettingsController.deleteCalendarSettings
);

module.exports = router;
