// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const tokenMiddleware = require('../../../../middlewares/oauth.token.middlewares');

// Controllers
const authenticationController = require('../../../../controllers/v2/outlook/authentication/authentication.controller');

router.get('/', authenticationController.getLink);
router.get('/signout', authenticationController.signout);
router.post('/', authenticationController.authorize);

module.exports = router;
