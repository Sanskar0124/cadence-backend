// Utils
const {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Pacakages
const multer = require('multer');
const express = require('express');
const router = express();
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

// Middlwares
const { auth } = require('../../../middlewares/auth.middlewares');
const tokenMiddleware = require('../../../middlewares/oauth.token.middlewares');
const AccessControlMiddleware = require('../../../middlewares/accessControl.middlewares');

// Controllers
const userControllers = require('../../../controllers/v1/user/user.controllers');

// Route imports
const authRoutes = require('./auth/authentication.routes');
const calendarSettingsRoutes = require('./calendar-settings');

// Routes
router.use('/auth', authRoutes);
router.use('/calendar/settings', calendarSettingsRoutes);

router.get(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.getUser
);
router.put(
  '/',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  userControllers.updateUser
);
// router.put(
//   '/change/password',
//   [
//     auth,
//     AccessControlMiddleware.checkAccess(
//       RBAC_ACTIONS.UPDATE_OWN,
//       RBAC_RESOURCES.USER
//     ),
//   ],
//   userControllers.updatePassword
// );
router.put(
  '/change/profile/pic',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  upload.single('image'),
  userControllers.updateProfilePicture
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
router.put(
  '/primary-email',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.UPDATE_OWN,
      RBAC_RESOURCES.USER
    ),
  ],
  tokenMiddleware,
  userControllers.updateUser
);
router.get(
  '/are-tokens-expired',
  [
    auth,
    AccessControlMiddleware.checkAccess(
      RBAC_ACTIONS.READ_OWN,
      RBAC_RESOURCES.USER
    ),
  ],

  userControllers.areTokensExpired
);

module.exports = router;
