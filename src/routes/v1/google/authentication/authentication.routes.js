// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const tokenMiddleware = require('../../../../middlewares/oauth.token.middlewares');

// Controllers
const authenticationController = require('../../../../controllers/v1/google/authentication/authentication.controller');

// Routes
router.get('/', authenticationController.getLink);
router.get('/signout', authenticationController.signout);
router.post('/', authenticationController.authorize);
router.post('/revoke', tokenMiddleware, authenticationController.revoke);

module.exports = router;
