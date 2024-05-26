// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const express = require('express');
const router = express();

// Middlewares
const AccessControlMiddleware = require('../../../../middlewares/accessControl.middlewares');
const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const CalendarSettingsController = require('../../../../controllers/v1/user/calendar-settings.controllers');

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.CALENDAR_SETTINGS
    ),
  ],
  CalendarSettingsController.fetchCalendarSettings
);
router.put(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.CALENDAR_SETTINGS
    ),
  ],
  CalendarSettingsController.changeCalendarSettings
);

module.exports = router;
