// Pacakages
const express = require('express');
const router = express();

const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const pipedriveController = require('../../../../controllers/v2/oauth/pipedrive.controllers');

// Routes
router.get('/redirect', pipedriveController.redirectToPipedrive);
router.get('/authorize', auth, pipedriveController.authorizePipedrive);
router.get('/signout', auth, pipedriveController.signOutFromPipedrive);

module.exports = router;
