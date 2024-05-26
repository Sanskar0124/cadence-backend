// * Packages
const express = require('express');
const router = express();

// * Middlewares
const { supportAuth } = require('../../../middlewares/support.middlewares');

// * Controllers
const userController = require('../../../controllers/v2/support/user.controllers');

router.get(
  '/send-mail/:user_id',
  supportAuth,
  userController.sendMailToSuperAdmin
);

router.put('/add', supportAuth, userController.addSupportAgent);

router.put('/remove/:user_id', supportAuth, userController.removerSupportUser);

router.patch(
  '/update/:user_id',
  supportAuth,
  userController.updateSupportUserRole
);

router.put(
  '/complete-product-tour/:user_id',
  supportAuth,
  userController.markProductTourAsCompleted
);

module.exports = router;
